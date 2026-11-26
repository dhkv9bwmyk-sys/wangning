// Pure scheduling rules for the explicitly bounded, read-only interview dataset.
export const clone = value => structuredClone(value);
export const freshPlan = () => ({ merge: false, slots: {}, rooms: {}, routes: {}, profile: 'CURRENT' });
export const signature = p => JSON.stringify({ merge: p.merge, profile: p.profile,
  slots: Object.fromEntries(Object.entries(p.slots).sort()), rooms: Object.fromEntries(Object.entries(p.rooms??{}).sort()), routes: Object.fromEntries(Object.entries(p.routes).sort()),
  merges:[...(p.merges??[])].sort((a,b)=>a.source.localeCompare(b.source)),seriesModes:Object.fromEntries(Object.entries(p.seriesModes??{}).sort()),
  transfers:[...(p.transfers??[])].sort((a,b)=>`${a.studentId}:${a.sourceId}`.localeCompare(`${b.studentId}:${b.sourceId}`)),lessonMoves:Object.fromEntries(Object.entries(p.lessonMoves??{}).sort()) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = rows => [...new Set(rows)];
const byId = rows => Object.fromEntries(rows.map(row => [row.id, row]));
const timeCache=new Map(),intervalCache=new WeakMap(),overlapCache=new WeakMap();
const timeValue = text => {if(!timeCache.has(text)){if(timeCache.size>15000)timeCache.clear();timeCache.set(text,Date.parse(text));}return timeCache.get(text);};
const duration = lesson => (timeValue(lesson.end) - timeValue(lesson.start)) / 60000;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export const mergePairs=(ctx,plan)=>[...(plan.merge?[ctx.scope.merge]:[]),...(plan.merges??[])];
export const hasMerges=plan=>plan.merge||(plan.merges?.length??0)>0;
export function resolveMergedId(ctx,plan,id){const map=Object.fromEntries(mergePairs(ctx,plan).map(p=>[p.source,p.target]));for(let n=0;map[id]&&n<=ctx.data.classes.length;n++)id=map[id];return id;}
export const studentName=(ctx,id)=>ctx.students?.[id]?.display_name??id;
export function studentLessons(ctx,cls,id){const periods=ctx.enrollmentValidity?.[id]?.[cls.subject];if(!periods||periods.some(p=>cls.lessons[0]?.start.slice(0,10)>=p.from&&cls.lessons.at(-1)?.start.slice(0,10)<=p.to))return cls.lessons;return cls.lessons.filter(l=>periods.some(p=>l.start.slice(0,10)>=p.from&&l.start.slice(0,10)<=p.to));}
export const transferRows=(ctx,plan)=>[...Object.entries(plan.routes).map(([studentId,targetId])=>({studentId,sourceId:ctx.scope.partial_math_destinations[0],targetId})),...(plan.transfers??[])];

function seriesLessons(ctx,cls,plan){const nominal=cls.id===ctx.scope.protected_old_class&&plan.profile==='SIMULATE_X_TO_2'?2:plan.slots[cls.id],mode=plan.seriesModes?.[cls.id]??ctx.scope.series_exception_mode??'ALL',room=plan.rooms[cls.id]??cls.room_id;
  return shiftedLessons(ctx,cls,nominal??(mode==='ALL'&&plan.seriesModes?.[cls.id]?cls.normal_slot:undefined),mode).map(l=>({...l,room_id:mode==='PRESERVE'&&ctx.scope.single_lesson_moves&&cls.lessons.find(o=>o.id===l.id)?.slot_id!==cls.normal_slot?cls.room_id:room}));
}
function setCoordinationProfile(ctx,plan){if(plan.profile==='SIMULATE_X_TO_2')return;const changed=ctx.data.classes.some(c=>c.protected&&(plan.slots[c.id]!==undefined&&plan.slots[c.id]!==c.normal_slot||plan.rooms?.[c.id]&&plan.rooms[c.id]!==c.room_id||Object.values(plan.lessonMoves??{}).some(m=>m.classId===c.id)));plan.profile=changed?'SIMULATE_OLD_CHANGE':'CURRENT';}

function shiftedLessons(ctx, cls, slot, mode) {
  if (slot === undefined) return clone(cls.lessons);
  const window = ctx.data.time_window_templates.find(row => row.slot_id === slot);
  return cls.lessons.map(lesson => mode==='PRESERVE'&&lesson.slot_id!==cls.normal_slot?clone(lesson):({ ...lesson, slot_id: slot,
    start: `${lesson.start.slice(0, 10)}T${window.start}:00+08:00`,
    end: `${lesson.start.slice(0, 10)}T${window.end}:00+08:00` }));
}

export function overlapLessons(a, b) {
  let cache=overlapCache.get(a);if(!cache){cache=new WeakMap();overlapCache.set(a,cache);}if(cache.has(b))return cache.get(b);
  const intervals=rows=>{if(!intervalCache.has(rows))intervalCache.set(rows,rows.map(l=>({l,start:timeValue(l.start),end:timeValue(l.end)})).sort((x,y)=>x.start-y.start));return intervalCache.get(rows);};
  const aa=intervals(a),bb=intervals(b),matches=[];let j=0;
  for(const first of aa){while(j<bb.length&&bb[j].end<=first.start)j++;for(let k=j;k<bb.length&&bb[k].start<first.end;k++){const second=bb[k],start=Math.max(first.start,second.start),end=Math.min(first.end,second.end);if(start<end)matches.push({date:first.l.start.slice(0,10),start:new Date(start).toISOString(),end:new Date(end).toISOString(),week:first.l.week,lessonIds:[first.l.id,second.l.id]});}}
  cache.set(b,matches);return matches;
}

function validateInput(data, scenario) {
  assert(data && Array.isArray(data.classes) && data.classes.length, '班级数据不完整');
  assert(Array.isArray(data.teachers) && Array.isArray(data.rooms), '教师或教室数据不完整');
  assert(data.allowed_scope && data.time_window_templates?.length === 5, '试排范围或时点数据不完整');
  const classes = byId(data.classes), teachers = byId(data.teachers), rooms = byId(data.rooms);
  assert(Object.keys(classes).length === data.classes.length, '班级标识重复');
  assert(Object.keys(teachers).length === data.teachers.length && Object.keys(rooms).length === data.rooms.length, '资源标识重复');
  assert(scenario && Array.isArray(scenario.enrollments), '未找到该课表数据');
  const source = data.allowed_scope.merge.source, target = data.allowed_scope.merge.target;
  assert(classes[source] && classes[target], '合班来源或接收班缺失');
  for (const teacher of data.teachers) {
    assert(teacher.load_complete_in_demo === true && Array.isArray(teacher.external_teaching) && Array.isArray(teacher.other_known_busy), '教师忙闲数据不足');
    for (const busy of [...teacher.external_teaching, ...teacher.other_known_busy]) {
      assert(Number.isFinite(timeValue(busy.start)) && timeValue(busy.end) > timeValue(busy.start), '教师占用时间无效');
    }
  }
  const globalLessons = new Set();
  for (const cls of data.classes) {
    assert(teachers[cls.teacher_id] && rooms[cls.room_id], '班级资源引用缺失');
    assert(['A', 'B', 'C'].includes(cls.track) && cls.class_code && cls.grade && cls.curriculum, '班级分类数据不足');
    assert(Number.isInteger(cls.capacity) && cls.capacity > 0 && Number.isInteger(rooms[cls.room_id].capacity) && rooms[cls.room_id].capacity > 0, '容量数据无效');
    const course = data.course_plans[cls.id];
    assert(course && course.curriculum === cls.curriculum && Array.isArray(course.units), '课程计划引用不一致');
    assert(Array.isArray(cls.lessons) && cls.lessons.length === course.expected_lessons, '未来课次不完整');
    assert(cls.lessons.reduce((sum, lesson) => sum + duration(lesson), 0) === course.expected_minutes, '课程时长不完整');
    assert(same(cls.lessons.map(row => [row.unit, duration(row)]).sort(), course.units.map(row => [row.unit, row.minutes]).sort()), '课程单元或课时不一致');
    for (const lesson of cls.lessons) {
      assert(!globalLessons.has(lesson.id), '课次标识重复'); globalLessons.add(lesson.id);
      assert(Number.isFinite(timeValue(lesson.start)) && timeValue(lesson.end) > timeValue(lesson.start), '课次时间无效');
    }
  }
  const relations = new Set();
  if(data.allowed_scope.student_names_required){assert(Array.isArray(data.students)&&new Set(data.students.map(s=>s.id)).size===data.students.length,'学生标识重复或缺失');}
  for (const row of scenario.enrollments) {
    assert(classes[row.class_id] && typeof row.student_id === 'string' && row.state === 'ACTIVE', '有效报名记录不完整');
    if(data.allowed_scope.student_names_required){const profile=data.students?.find(s=>s.id===row.student_id);assert(profile?.display_name&&profile.synthetic===true,'模拟学生资料缺失');assert(profile.grade===classes[row.class_id].grade,'学生与课程年级不一致');const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v??'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;assert(validDate(row.valid_from)&&validDate(row.valid_to)&&row.valid_to>=row.valid_from,'报名有效日期缺失或无效');}
    const key = `${row.student_id}|${row.class_id}`; assert(!relations.has(key), '报名关系重复'); relations.add(key);
  }
  for (const [id, cap] of Object.entries(scenario.class_capacity_overrides)) assert(classes[id] && Number.isInteger(cap) && cap > 0, '班级容量覆盖无效');
}

export function createContext(data, fixtureId = 'S1') {
  const scenario = data.scenarios?.find(row => row.id === fixtureId);
  validateInput(data, scenario);
  const ctx = { data: clone(data), scenario: clone(scenario), classes: byId(clone(data.classes)),
    teachers: byId(clone(data.teachers)), rooms: byId(clone(data.rooms)), scope: clone(data.allowed_scope),
    fixtureId, fingerprint: `${data.version}:${data.source_sha256}:${fixtureId}`, layoutCache: new Map(),students:byId(clone(data.students??[])),enrollmentValidity:{} };
  ctx.sourceRosters = Object.fromEntries(data.classes.map(row => [row.id, []]));
  for (const row of scenario.enrollments){ctx.sourceRosters[row.class_id].push(row.student_id);const subject=ctx.classes[row.class_id].subject;((ctx.enrollmentValidity[row.student_id]??={})[subject]??=[]).push({from:row.valid_from??'0000-01-01',to:row.valid_to??'9999-12-31'});}
  for (const roster of Object.values(ctx.sourceRosters)) roster.sort();
  ctx.sourceView = deriveView(ctx, freshPlan());
  ctx.sourceCoverage = coverage(ctx.sourceView);
  const sourceIssues = inspectView(ctx, ctx.sourceView);
  assert(sourceIssues.length === 0, '源课表存在未处理的数据或排课问题');
  return ctx;
}

export function normalizePlan(ctx, input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), '方案结构无效');
  assert(Object.keys(input).every(key => ['merge', 'slots', 'rooms', 'routes', 'profile','merges','seriesModes','transfers','lessonMoves'].includes(key)), '方案含有未支持字段');
  assert(typeof input.merge === 'boolean' && ['CURRENT', 'SIMULATE_X_TO_2', 'SIMULATE_OLD_CHANGE'].includes(input.profile), '方案条件无效');
  assert(ctx.scope.profiles[input.profile], '该协调条件未声明');
  if (input.profile === 'SIMULATE_X_TO_2') assert(ctx.scope.profiles[input.profile].old_class_change_authorized === true && ctx.scope.profiles[input.profile].X_M_slot === 2, '该老班调整不在允许的条件范围');
  if (input.profile === 'SIMULATE_OLD_CHANGE') assert(ctx.scope.profiles[input.profile].old_class_change_authorized === true, '老班调整条件未开放');
  assert(input.slots && typeof input.slots === 'object' && !Array.isArray(input.slots) && input.routes && typeof input.routes === 'object' && !Array.isArray(input.routes), '方案安排无效');
  const p = freshPlan(); p.merge = input.merge; p.profile = input.profile;
  assert(input.merges===undefined||Array.isArray(input.merges),'合班安排结构无效');
  assert(input.seriesModes===undefined||(input.seriesModes&&typeof input.seriesModes==='object'&&!Array.isArray(input.seriesModes)),'课次范围结构无效');
  if(input.merges?.length){assert(ctx.scope.general_merges===true&&Array.isArray(input.merges),'当前版本未开放此合班方向');p.merges=clone(input.merges);}
  const pairs=mergePairs(ctx,p),sources=new Set();
  for(const pair of pairs){assert(ctx.classes[pair.source]&&ctx.classes[pair.target]&&pair.source!==pair.target,'合班对象无效');assert(!sources.has(pair.source),'班级重复合入');sources.add(pair.source);assert(compatible(ctx.classes[pair.source],ctx.classes[pair.target]),'课程版本、年级、班型或进度不兼容');}
  for(const pair of pairs){const seen=new Set([pair.source]);let id=pair.target;while(sources.has(id)){assert(!seen.has(id),'合班不能形成循环');seen.add(id);id=pairs.find(x=>x.source===id).target;}assert(!seen.has(id),'合班不能形成循环');}
  for (const [id, slot] of Object.entries(input.slots)) {
    assert(ctx.classes[id], '目标班级不存在');
    assert(Number.isInteger(slot) && slot >= 1 && slot <= 5, '目标时点无效');
    const isChinese = id === ctx.scope.merge.source && !p.merge;
    const isMath = own(ctx.scope.whole_class_movement_slots, id) && ctx.scope.whole_class_movement_slots[id].includes(slot);
    const isOld = id === ctx.scope.protected_old_class && p.profile === 'SIMULATE_X_TO_2' && slot === 2;
    const isManual=ctx.scope.manual_movement_slots?.[id]?.includes(slot);
    assert(isChinese || isMath || isOld || isManual, `${ctx.classes[id].label}在该版本的分析范围内固定，尚未进行改时核查`);
    if(ctx.classes[id].protected&&slot!==ctx.classes[id].normal_slot)assert(p.profile!=='CURRENT','老班改时需要保留待协调条件');
    if (slot !== ctx.classes[id].normal_slot) p.slots[id] = slot;
  }
  assert(input.rooms===undefined||(input.rooms&&typeof input.rooms==='object'&&!Array.isArray(input.rooms)),'教室安排无效');
  for(const [id,roomId]of Object.entries(input.rooms??{})){
    assert(ctx.classes[id]&&ctx.rooms[roomId],'班级或教室不存在');
    if(roomId===ctx.classes[id].room_id)continue;
    assert(ctx.scope.manual_room_moves===true,'本版本未开放普通换教室试排');
    assert(ctx.rooms[roomId].campus_id===ctx.classes[id].campus_id,'目标教室不属于当前校区');
    if(ctx.classes[id].protected&&roomId!==ctx.classes[id].room_id)assert(p.profile!=='CURRENT','老班换教室需要保留待协调条件');
    if(roomId!==ctx.classes[id].room_id)p.rooms[id]=roomId;
  }
  for (const [student, target] of Object.entries(input.routes)) {
    assert(ctx.scope.partial_math_students.includes(student) && ctx.scope.partial_math_destinations.includes(target), '分科调班超出当前范围');
    if (target !== ctx.scope.partial_math_destinations[0]) p.routes[student] = target;
  }
  assert(input.transfers===undefined||ctx.scope.general_student_transfers===true&&Array.isArray(input.transfers),'分科安排结构无效或未开放');
  const transferKeys=new Set(Object.keys(p.routes).map(id=>`${id}:${ctx.scope.partial_math_destinations[0]}`));
  for(const row of input.transfers??[]){const {studentId,sourceId,targetId}=row,source=ctx.classes[sourceId],target=ctx.classes[targetId],key=`${studentId}:${sourceId}`;assert(source&&target&&ctx.sourceRosters[sourceId].includes(studentId),'学生转班来源无效');assert(!transferKeys.has(key),'学生重复转班');transferKeys.add(key);assert(compatible(source,target),'转班年级、班型、课程或进度不兼容');assert(resolveMergedId(ctx,p,sourceId)===sourceId&&resolveMergedId(ctx,p,targetId)===targetId,'转班涉及已合入的班级');if(sourceId!==targetId)(p.transfers??=[]).push({studentId,sourceId,targetId});}
  assert(hasMerges(p) || (Object.keys(p.routes).length === 0 && !(p.transfers?.length) && ['CURRENT','SIMULATE_OLD_CHANGE'].includes(p.profile)), '请先提出合班，再进行分科联动安排');
  for(const [id,mode]of Object.entries(input.seriesModes??{})){assert(ctx.classes[id]&&['ALL','PRESERVE'].includes(mode),'课次调整范围无效');assert(ctx.scope.series_exception_mode,'本版本未开放课次范围选择');if(mode!==(ctx.scope.series_exception_mode??'ALL')&&ctx.classes[id].lessons.some(l=>l.slot_id!==ctx.classes[id].normal_slot))(p.seriesModes??={})[id]=mode;}
  assert(input.lessonMoves===undefined||(ctx.scope.single_lesson_moves===true&&input.lessonMoves&&typeof input.lessonMoves==='object'&&!Array.isArray(input.lessonMoves)),'单次课调整结构无效或未开放');
  for(const [lessonId,m]of Object.entries(input.lessonMoves??{})){const cls=ctx.classes[m.classId];assert(cls&&cls.lessons.some(l=>l.id===lessonId)&&resolveMergedId(ctx,p,cls.id)===cls.id,'单次课不存在或已合入其他班');assert(Number.isInteger(m.slot)&&m.slot>=1&&m.slot<=5&&ctx.rooms[m.roomId]?.campus_id===cls.campus_id,'单次课目标时点或教室无效');if(cls.protected)assert(p.profile!=='CURRENT','老班单次调整需要保留待协调条件');const original=seriesLessons(ctx,cls,p).find(l=>l.id===lessonId);if(m.slot!==original.slot_id||m.roomId!==original.room_id)(p.lessonMoves??={})[lessonId]={classId:cls.id,slot:m.slot,roomId:m.roomId};}
  if(p.profile==='SIMULATE_OLD_CHANGE')setCoordinationProfile(ctx,p);
  return p;
}

function classPackageReferences(ctx, plan, classId) {
  if (resolveMergedId(ctx,plan,classId)!==classId) return [];
  return ctx.data.packages.filter(pkg => Object.values(pkg.subjects).some(id =>
    resolveMergedId(ctx,plan,id) === classId)).map(pkg => pkg.id);
}

export function deriveView(ctx, input) {
  const plan = normalizePlan(ctx, input);
  const active = ctx.data.classes.filter(cls => resolveMergedId(ctx,plan,cls.id)===cls.id);
  const roster = clone(ctx.sourceRosters);
  for(const {source}of mergePairs(ctx,plan)){const target=resolveMergedId(ctx,plan,source);roster[target]=unique([...roster[target],...ctx.sourceRosters[source]]).sort();delete roster[source];}
  const mathSource = ctx.scope.partial_math_destinations[0];
  for (const {studentId:student,sourceId,targetId:destination} of transferRows(ctx,plan)) {
    assert(roster[sourceId]&&roster[destination],'分科涉及的班级已合入其他班，请重新核对');roster[sourceId] = roster[sourceId].filter(id => id !== student);
    roster[destination] = unique([...roster[destination], student]).sort();
  }
  const classes = active.map(original => {
    const cls = clone(original), slot = cls.id === ctx.scope.protected_old_class && plan.profile === 'SIMULATE_X_TO_2' ? 2 : plan.slots[cls.id];
    cls.lessons = seriesLessons(ctx,original,plan).map(l=>{const m=plan.lessonMoves?.[l.id];if(!m)return l;const w=ctx.data.time_window_templates.find(t=>t.slot_id===m.slot);return {...l,slot_id:m.slot,room_id:m.roomId,start:`${l.start.slice(0,10)}T${w.start}:00+08:00`,end:`${l.start.slice(0,10)}T${w.end}:00+08:00`};});
    cls.normal_slot = slot ?? cls.normal_slot;
    cls.room_id=plan.rooms[cls.id]??cls.room_id;
    cls.capacity = ctx.scenario.class_capacity_overrides[cls.id] ?? cls.capacity;
    cls.students = roster[cls.id]; cls.count = cls.students.length;
    cls.studentLessonIds=Object.fromEntries(cls.students.map(id=>[id,studentLessons(ctx,cls,id).map(l=>l.id)]));
    cls.teacherName = ctx.teachers[cls.teacher_id].display_name;
    cls.roomName = ctx.rooms[cls.room_id].display_name;
    cls.roomCapacity = ctx.rooms[cls.room_id].capacity;
    cls.hasRoomOverrides=cls.lessons.some(l=>l.room_id!==cls.room_id);
    cls.packageIds = classPackageReferences(ctx, plan, cls.id);
    cls.transferredIn = transferRows(ctx,plan).filter(r=>r.targetId===cls.id).map(r=>r.studentId);
    return cls;
  });
  return { classes, byId: byId(classes), plan };
}

function coverage(view) {
  const output = {};
  for (const cls of view.classes) for (const student of cls.students) {
    const key = `${student}|${cls.subject}`;
    (output[key] ??= []).push(...cls.lessons.filter(l=>!cls.studentLessonIds||cls.studentLessonIds[student].includes(l.id)).map(lesson => `${lesson.unit}:${duration(lesson)}`));
  }
  for (const units of Object.values(output)) units.sort();
  return Object.fromEntries(Object.entries(output).sort());
}

export function compatible(a, b) {
  return ['subject', 'grade', 'track', 'curriculum', 'progress_start'].every(key => a[key] === b[key]) &&
    same(a.lessons.map(row => [row.unit, duration(row)]).sort(), b.lessons.map(row => [row.unit, duration(row)]).sort());
}

function resourceIssues(ctx, view) {
  const issues = [];
  for (const cls of view.classes) {
    const teacher = ctx.teachers[cls.teacher_id];
    if (!teacher.qualifications.some(q => ['subject', 'grade', 'track', 'curriculum'].every(key => q[key] === cls[key]))) {
      issues.push({ type: 'QUALIFICATION', classIds: [cls.id], teacherId: cls.teacher_id, title: '任教资格不匹配' });
    }
    const busy=[...teacher.external_teaching,...teacher.other_known_busy];
    const matches = overlapLessons(cls.lessons,busy);
    if (matches.length) issues.push({ type: 'TEACHER_BUSY', classIds: [cls.id], teacherId: cls.teacher_id, overlaps: matches,
      occupancies:busy.filter(b=>overlapLessons(cls.lessons,[b]).length).map(b=>({start:b.start,end:b.end})),title: '教师已有其他授课占用' });
  }
  for(let i=0;i<view.classes.length;i++)for(let j=i+1;j<view.classes.length;j++){
    const a=view.classes[i],b=view.classes[j];if(a.teacher_id!==b.teacher_id&&a.room_id!==b.room_id&&!a.hasRoomOverrides&&!b.hasRoomOverrides)continue;
    const overlaps=overlapLessons(a.lessons,b.lessons);if(!overlaps.length)continue;
    if(a.teacher_id===b.teacher_id)issues.push({type:'TEACHER_CONFLICT',classIds:[a.id,b.id],teacherId:a.teacher_id,overlaps,title:'教师时间冲突'});
    const rooms=new Map();for(const o of overlaps){const x=a.lessons.find(l=>l.id===o.lessonIds[0]),y=b.lessons.find(l=>l.id===o.lessonIds[1]),room=x.room_id??a.room_id;if(room===(y.room_id??b.room_id)){if(!rooms.has(room))rooms.set(room,[]);rooms.get(room).push(o);}}
    for(const [roomId,rows]of rooms)issues.push({type:'ROOM_CONFLICT',classIds:[a.id,b.id],roomId,overlaps:rows,title:'教室时间冲突'});
  }
  return issues;
}

export function inspectView(ctx, view, options = {}) {
  const issues = options.skipResources ? [] : resourceIssues(ctx, view);
  for(const cls of view.classes){
    if(!cls.hasRoomOverrides){if(cls.count>Math.min(cls.capacity,cls.roomCapacity))issues.unshift({type:'CAPACITY',classIds:[cls.id],count:cls.count,classCapacity:cls.capacity,roomCapacity:cls.roomCapacity,overBy:cls.count-Math.min(cls.capacity,cls.roomCapacity),title:'容量超限'});continue;}
    const groups=new Map();for(const l of cls.lessons){const roomId=l.room_id??cls.room_id,roomCapacity=ctx.rooms[roomId].capacity,count=cls.students.filter(id=>cls.studentLessonIds[id].includes(l.id)).length;if(count>Math.min(cls.capacity,roomCapacity)){const key=`${roomId}:${count}`;if(!groups.has(key))groups.set(key,{type:'CAPACITY',classIds:[cls.id],count,classCapacity:cls.capacity,roomCapacity,roomId,overBy:count-Math.min(cls.capacity,roomCapacity),overlaps:[],title:'容量超限'});groups.get(key).overlaps.push({date:l.start.slice(0,10),start:l.start,end:l.end,week:l.week,lessonIds:[l.id]});}}
    for(const issue of groups.values())issues.unshift(issue);
  }
  for (let i = 0; i < view.classes.length; i++) for (let j = i+1; j < view.classes.length; j++) {
    const a = view.classes[i], b = view.classes[j];
    const students = a.students.filter(id => b.students.includes(id));
    if (!students.length) continue;
    const groups=new Map();
    for(const student of students){const overlaps=overlapLessons(studentLessons(ctx,a,student),studentLessons(ctx,b,student));if(!overlaps.length)continue;const key=JSON.stringify(overlaps);if(!groups.has(key))groups.set(key,{overlaps,students:[]});groups.get(key).students.push(student);}
    for(const group of groups.values())issues.push({type:'STUDENT_CONFLICT',classIds:[a.id,b.id],studentIds:group.students,overlaps:group.overlaps,title:'学生时间冲突'});
  }
  return issues;
}

export function studentScheduleChanges(ctx, before, view) {
  const personSchedule = v => {
    const rows = {};
    for (const cls of v.classes) for (const id of cls.students) {
      (rows[id] ??= []).push(JSON.stringify([cls.subject, cls.id, cls.teacher_id, studentLessons(ctx,cls,id).map(l => [l.start, l.end,l.room_id??cls.room_id])]));
    }
    for (const values of Object.values(rows)) values.sort();
    return rows;
  };
  const old = personSchedule(before), current = personSchedule(view);
  return unique([...Object.keys(old), ...Object.keys(current)]).filter(id => !same(old[id], current[id]));
}
function metrics(ctx, view) {
  const before = ctx.sourceView ?? view;
  const changedStudents = studentScheduleChanges(ctx, before, view);
  const affected = new Set();
  for (const id of unique([...Object.keys(before.byId), ...Object.keys(view.byId)])) {
    const a = before.byId[id], b = view.byId[id];
    if (!a || !b || !same(a.students, b.students) || !same(a.lessons, b.lessons) || a.teacher_id !== b.teacher_id || a.room_id !== b.room_id) {
      for (const student of [...(a?.students ?? []), ...(b?.students ?? [])]) affected.add(student);
    }
  }
  const hours = v => v.classes.reduce((total, cls) => total+cls.lessons.reduce((n, l) => n+duration(l), 0), 0)/60;
  const lessons = v => v.classes.reduce((n, cls) => n+cls.lessons.length, 0);
  return { changedStudents, broaderAffectedStudents: [...affected].sort(), classCount: view.classes.length,
    originalClassCount: before.classes.length, lessonCount: lessons(view), originalLessonCount: lessons(before),
    teachingHours: hours(view), originalTeachingHours: hours(before) };
}

export function evaluatePlan(ctx, input) {
  try {
    const plan = normalizePlan(ctx, input), view = deriveView(ctx, plan), issues = inspectView(ctx, view);
    if (plan.merge && !compatible(ctx.classes[ctx.scope.merge.source], ctx.classes[ctx.scope.merge.target])) {
      issues.unshift({ type: 'COMPATIBILITY', classIds: [ctx.scope.merge.source, ctx.scope.merge.target], title: '课程或进度不一致' });
    }
    for (const destination of unique(Object.values(plan.routes))) if (!compatible(ctx.classes[ctx.scope.partial_math_destinations[0]], ctx.classes[destination])) {
      issues.unshift({ type: 'COMPATIBILITY', classIds: [ctx.scope.partial_math_destinations[0], destination], title: '分科课程或进度不一致' });
    }
    if (!same(coverage(view), ctx.sourceCoverage)) issues.unshift({ type: 'COURSE_COVERAGE', classIds: [], title: '学生课程单元或课时未保留' });
    const conditions=[];
    for(const cls of view.classes.filter(c=>c.protected)){const original=ctx.classes[cls.id],changed=cls.lessons.filter(l=>{const old=original.lessons.find(o=>o.id===l.id);return l.start!==old.start||l.end!==old.end||(l.room_id??cls.room_id)!==(old.room_id??original.room_id);});if(!changed.length)continue;
      if(cls.normal_slot!==original.normal_slot||cls.room_id!==original.room_id)conditions.push({classId:cls.id,fromSlot:original.normal_slot,toSlot:cls.normal_slot,fromRoom:original.room_id,toRoom:cls.room_id,teacherId:cls.teacher_id,scope:'SERIES',lessonCount:changed.length});
      else for(const l of changed){const old=original.lessons.find(o=>o.id===l.id);conditions.push({classId:cls.id,fromSlot:old.slot_id,toSlot:l.slot_id,fromRoom:old.room_id??original.room_id,toRoom:l.room_id??cls.room_id,teacherId:cls.teacher_id,scope:'LESSON',date:l.start.slice(0,10),lessonCount:1});}
    }
    const status = issues.length ? 'CONFLICT' : conditions.length ? 'CONDITIONAL' : 'FEASIBLE';
    return { ok: issues.length === 0, status, issues, conditions, view, metrics: metrics(ctx, view) };
  } catch (error) {
    return { ok: false, status: 'INVALID', issues: [{ type: 'SCOPE', classIds: [], title: error.message }], view: null, metrics: null };
  }
}

function legacyAttemptIntent(ctx, current, intent) {
  const present = evaluatePlan(ctx, current);
  const reject = issue => ({ accepted: false, changed: false, report: { ok: false, status: 'CONFLICT', issues: [issue], view: null, metrics: null }, currentReport: present });
  const source = present.view?.byId[intent.classId];
  if (!source) return reject({ type: 'SCOPE', classIds: [], title: '该班已合入接收班，请先撤销合班' });
  if (intent.kind === 'merge') {
    const target = present.view.byId[intent.targetId];
    if (!target) return reject({ type: 'SCOPE', classIds: [source.id], title: '接收班不存在' });
    if (source.id === target.id) return { accepted: false, changed: false, noop: true, currentReport: present };
    if (source.subject !== target.subject) return reject({ type: 'COMPATIBILITY', classIds: [source.id, target.id], title: '不同科目不能合班' });
    const count = unique([...source.students, ...target.students]).length;
    if (source.id !== ctx.scope.merge.source || target.id !== ctx.scope.merge.target) {
      if (count > Math.min(target.capacity, target.roomCapacity)) return reject({ type: 'CAPACITY', classIds: [source.id, target.id], count,
        classCapacity: target.capacity, roomCapacity: target.roomCapacity, overBy: count-Math.min(target.capacity, target.roomCapacity), title: '合班人数超过接收容量' });
      return reject({ type: 'SCOPE', classIds: [source.id, target.id], title: '该合班方向不在本次可调整范围' });
    }
    if (!compatible(source, target)) return reject({ type: 'COMPATIBILITY', classIds: [source.id, target.id], title: '课程版本、班型或进度不兼容' });
    const next = clone(current); next.merge = true; delete next.slots[source.id];
    const plan = normalizePlan(ctx, next), report = evaluatePlan(ctx, plan);
    return { accepted: true, changed: true, plan, report, label: `合班：${source.label} → ${target.label}` };
  }
  if (intent.kind !== 'move') return reject({ type: 'SCOPE', classIds: [source.id], title: '操作类型无效' });
  if (intent.day && intent.day !== 'Saturday') return reject({ type: 'SCOPE', classIds: [source.id], title: '本次调整保留原授课日' });
  if (intent.roomId && intent.roomId !== source.room_id && !ctx.scope.manual_room_moves) return reject({ type: 'SCOPE', classIds: [source.id], title: '本次试排保留原教室，可调整时点或选择接收班合班' });
  if (source.normal_slot === intent.slot && (!intent.roomId||intent.roomId===source.room_id)) return { accepted: false, changed: false, noop: true, currentReport: present };
  if (source.id === ctx.scope.protected_old_class && current.profile !== 'SIMULATE_X_TO_2' && !ctx.scope.manual_movement_slots) {
    return reject({ type: 'PROTECTED', classIds: [source.id], teacherId: source.teacher_id, title: '老班时点受保护，需单独评估协调条件' });
  }
  const next = clone(current);next.rooms??={};next.slots[source.id] = intent.slot;
  if(intent.roomId)next.rooms[source.id]=intent.roomId;
  if(source.protected&&ctx.scope.manual_movement_slots){
    const changed=intent.slot!==ctx.classes[source.id].normal_slot||(intent.roomId??source.room_id)!==ctx.classes[source.id].room_id;
    next.profile=changed?'SIMULATE_OLD_CHANGE':'CURRENT';
  }
  const report = evaluatePlan(ctx, next);
  const issueKey=i=>JSON.stringify([i.type,[...(i.classIds??[])].sort(),i.teacherId,i.roomId,i.studentIds,i.count,i.overlaps?.map(o=>[o.start,o.end])]);
  const prior=new Set(present.issues.map(issueKey));
  const noNewConflict=ctx.scope.manual_movement_slots&&report.view&&report.issues.every(issue=>prior.has(issueKey(issue)));
  if (!report.ok&&!noNewConflict) return { accepted: false, changed: false, report, currentReport: present, label: `调时：${source.label} → 时点${intent.slot}` };
  return { accepted: true, changed: true, plan: normalizePlan(ctx, next), report, label: `调时：${source.label} → 时点${intent.slot}` };
}

const issueKey=i=>JSON.stringify([i.type,[...(i.classIds??[])].sort(),i.teacherId,i.roomId,[...(i.studentIds??[])].sort(),i.count,i.classCapacity,i.roomCapacity,i.overlaps?.map(o=>[o.start,o.end])]);
export function compareIssues(before,after){const prior=new Set(before.map(issueKey)),next=new Set(after.map(issueKey));return {introduced:after.filter(i=>!prior.has(issueKey(i))),remaining:after.filter(i=>prior.has(issueKey(i))),resolved:before.filter(i=>!next.has(issueKey(i)))};}

export function applyMoves(ctx,current,moves,presentView=null){
  const next=clone(current);next.rooms??={};
  const view=presentView??evaluatePlan(ctx,current).view,seen=new Set();
  assert(Array.isArray(moves)&&moves.length>0&&moves.length<=ctx.data.classes.length,'请选择需要联合调整的课程');
  for(const intent of moves){const source=view?.byId[intent.classId];assert(source&&!seen.has(source.id),'联合调整班级重复或不存在');seen.add(source.id);
    assert(!intent.day||intent.day==='Saturday','本次调整保留原授课日，尚未开放跨日试排');
    next.slots[source.id]=intent.slot;if(intent.roomId)next.rooms[source.id]=intent.roomId;
    if(intent.seriesMode)(next.seriesModes??={})[source.id]=intent.seriesMode;
    if(intent.seriesMode==='ALL')for(const [id,m]of Object.entries(next.lessonMoves??{}))if(m.classId===source.id)delete next.lessonMoves[id];
    if(source.protected&&ctx.scope.manual_movement_slots)next.profile='SIMULATE_OLD_CHANGE';
  }
  if(next.profile==='SIMULATE_OLD_CHANGE')setCoordinationProfile(ctx,next);
  return normalizePlan(ctx,next);
}

export function attemptIntent(ctx,current,intent){
  if(!ctx.scope.general_merges)return legacyAttemptIntent(ctx,current,intent);
  const present=evaluatePlan(ctx,current);
  const finish=result=>({...result,currentReport:present,delta:compareIssues(present.issues,result.report?.issues??present.issues)});
  const reject=(issue,status='CONFLICT')=>finish({accepted:false,changed:false,report:{ok:false,status,issues:[issue],view:null,metrics:null}});
  try{
    if(intent.kind==='joint'){
      assert(ctx.scope.joint_moves===true,'本版本未开放联合调整');
      const plan=applyMoves(ctx,current,intent.moves,present.view);
      if(signature(plan)===signature(current))return {accepted:false,changed:false,noop:true,currentReport:present};
      const report=evaluatePlan(ctx,plan);
      return finish({accepted:report.ok,changed:report.ok,plan:report.ok?plan:undefined,report,label:`联合调整：${intent.moves.length}个班级`});
    }
    const source=present.view?.byId[intent.classId];
    if(!source)return reject({type:'SCOPE',classIds:[],title:'该班已合入接收班，请先撤销合班'});
    if(intent.kind==='lesson'){
      assert(ctx.scope.single_lesson_moves===true,'本版本未开放单次课调整');
      const lesson=source.lessons.find(l=>l.id===intent.lessonId);assert(lesson,'该次课不存在');assert(!intent.day||intent.day===lesson.weekday,'单次课调整保留原授课日');const next=clone(current);(next.lessonMoves??={})[lesson.id]={classId:source.id,slot:intent.slot,roomId:intent.roomId??lesson.room_id??source.room_id};if(source.protected)next.profile='SIMULATE_OLD_CHANGE';const plan=normalizePlan(ctx,next);
      if(signature(plan)===signature(normalizePlan(ctx,current)))return {accepted:false,changed:false,noop:true,currentReport:present};
      const report=evaluatePlan(ctx,plan),delta=compareIssues(present.issues,report.issues),accepted=report.ok||!!(report.view&&delta.introduced.length===0);
      return finish({accepted,changed:accepted,plan:accepted?plan:undefined,report,label:`单次调课：${source.label} · ${lesson.start.slice(0,10)}`});
    }
    if(intent.kind==='merge'){
      const target=present.view.byId[intent.targetId];
      if(!target)return reject({type:'SCOPE',classIds:[source.id],title:'接收班不存在'});
      if(source.id===target.id)return {accepted:false,changed:false,noop:true,currentReport:present};
      if(source.subject!==target.subject)return reject({type:'COMPATIBILITY',classIds:[source.id,target.id],title:'不同科目不能合班'});
      if(!compatible(source,target))return reject({type:'COMPATIBILITY',classIds:[source.id,target.id],title:'年级、班型、课程版本或进度不兼容'});
      const count=unique([...source.students,...target.students]).length;
      const standard=source.id===ctx.scope.merge.source&&target.id===ctx.scope.merge.target;
      if(!standard&&count>Math.min(target.capacity,target.roomCapacity))return reject({type:'CAPACITY',classIds:[source.id,target.id],count,classCapacity:target.capacity,roomCapacity:target.roomCapacity,overBy:count-Math.min(target.capacity,target.roomCapacity),title:'合班人数超过接收容量'});
      const next=clone(current);if(standard)next.merge=true;else(next.merges??=[]).push({source:source.id,target:target.id});delete next.slots[source.id];delete next.rooms?.[source.id];delete next.seriesModes?.[source.id];for(const [id,m]of Object.entries(next.lessonMoves??{}))if(m.classId===source.id)delete next.lessonMoves[id];
      const plan=normalizePlan(ctx,next),report=evaluatePlan(ctx,plan);
      return finish({accepted:report.view!==null,changed:true,plan,report,label:`合班：${source.label} → ${target.label}`});
    }
    if(intent.kind!=='move')return reject({type:'SCOPE',classIds:[],title:'操作类型无效'});
    if(intent.roomId&&intent.roomId!==source.room_id&&!ctx.scope.manual_room_moves)return reject({type:'SCOPE',classIds:[source.id],title:'本版本仅支持原教室调时，尚未开放换教室'});
    const plan=applyMoves(ctx,current,[intent],present.view);
    if(signature(plan)===signature(normalizePlan(ctx,current)))return {accepted:false,changed:false,noop:true,currentReport:present};
    const report=evaluatePlan(ctx,plan),delta=compareIssues(present.issues,report.issues);
    const accepted=report.ok||!!(ctx.scope.manual_movement_slots&&report.view&&delta.introduced.length===0);
    return finish({accepted,changed:accepted,plan:accepted?plan:undefined,report,label:`调时：${source.label} → 时点${intent.slot}`});
  }catch(error){return reject({type:'SCOPE',classIds:[intent.classId].filter(Boolean),title:error.message},'INVALID');}
}

export function checkpointFor(cls, days) {
  assert([30,15,7,3].includes(days),'核查节点无效');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(cls.planned_start_date??''),'计划开班日缺失');
  const start=Date.parse(`${cls.planned_start_date}T00:00:00Z`);
  assert(Number.isFinite(start),'计划开班日无效');
  assert(new Date(start).toISOString().slice(0,10)===cls.planned_start_date,'计划开班日无效');
  return new Date(start-days*86400000).toISOString().slice(0,10);
}

function* routeCombinations(students, destinations, index = 0, current = {}) {
  if (index === students.length) { yield { ...current }; return; }
  for (const target of destinations) {
    current[students[index]] = target;
    yield* routeCombinations(students, destinations, index+1, current);
  }
}

function fastLayout(ctx, plan) {
  const view = deriveView(ctx, plan);
  const badResource = resourceIssues(ctx, view).length > 0;
  const pairs = [];
  for (let i = 0; i < view.classes.length; i++) for (let j = i+1; j < view.classes.length; j++) {
    const a = view.classes[i], b = view.classes[j];
    if (overlapLessons(a.lessons, b.lessons).length) pairs.push([a.id, b.id]);
  }
  const caps = Object.fromEntries(view.classes.map(c => [c.id, Math.min(c.capacity, c.roomCapacity)]));
  return { view, badResource, pairs, caps };
}

function fastFeasible(ctx, layout, routes) {
  if (layout.badResource) return false;
  const roster = Object.fromEntries(layout.view.classes.map(c => [c.id, new Set(c.students)]));
  const source = ctx.scope.partial_math_destinations[0];
  for (const [student, destination] of Object.entries(routes)) {
    if (destination === source) continue;
    if (!compatible(ctx.classes[source], ctx.classes[destination])) return false;
    roster[source].delete(student); roster[destination].add(student);
  }
  for (const [id, cap] of Object.entries(layout.caps)) if (roster[id].size > cap) return false;
  return !layout.pairs.some(([a, b]) => [...roster[a]].some(student => roster[b].has(student)));
}

export function analyzeOptions(ctx, { maxConfigurations = 10000 } = {}) {
  const start = performance.now(), sourceMath = ctx.scope.partial_math_destinations[0];
  const proposed = freshPlan(); proposed.merge = true;
  const groupOptions = ctx.scope.partial_math_destinations.filter(id => id !== sourceMath).map(id => {
    const plan = clone(proposed);
    for (const student of ctx.scope.partial_math_students) plan.routes[student] = id;
    return { plan: normalizePlan(ctx, plan), report: evaluatePlan(ctx, plan), destinationId: id };
  });
  const partial = groupOptions.find(candidate => candidate.report.ok) ?? groupOptions.at(-1);
  const conditionalOptions = ctx.scope.whole_class_movement_slots[sourceMath].map(slot => {
    const plan = { ...clone(proposed), profile: 'SIMULATE_X_TO_2', slots: { [sourceMath]: slot } };
    return { plan: normalizePlan(ctx, plan), report: evaluatePlan(ctx, plan) };
  });
  const conditional = conditionalOptions.find(candidate => candidate.report.ok) ?? conditionalOptions[0];
  const total = 2 * ctx.scope.whole_class_movement_slots[sourceMath].length * ctx.scope.partial_math_destinations.length ** ctx.scope.partial_math_students.length;
  const searchScope={kind:'MATH_SLOT_AND_STUDENT_ROUTING_SUBSET',campusWideComplete:false,otherClassesUnchanged:true};
  if (total > maxConfigurations) return { partial, conditional, searchScope,completion: 'LIMIT_REACHED', counts: null,
    checked: 0, total, elapsedMs: performance.now()-start };
  const counts = {}, checkedByProfile = {};
  for (const profile of ['CURRENT', 'SIMULATE_X_TO_2']) {
    counts[profile] = 0; checkedByProfile[profile] = 0;
    for (const slot of ctx.scope.whole_class_movement_slots[sourceMath]) {
      const layout = fastLayout(ctx, { ...clone(proposed), profile, slots: { [sourceMath]: slot } });
      for (const routes of routeCombinations(ctx.scope.partial_math_students, ctx.scope.partial_math_destinations)) {
        checkedByProfile[profile]++;
        if (fastFeasible(ctx, layout, routes)) counts[profile]++;
      }
    }
  }
  return { partial, conditional, searchScope,completion: 'COMPLETE', counts, checkedByProfile,
    checked: Object.values(checkedByProfile).reduce((a, b) => a+b, 0), total, elapsedMs: performance.now()-start };
}

export function focusMatches(view, { query = '', track = 'ALL', grade = 'ALL' } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return new Map(view.classes.map(cls => {
    const fields = [cls.label, cls.class_code, cls.teacherName, ...cls.packageIds].join(' ').toLocaleLowerCase();
    return [cls.id, (!needle || fields.includes(needle)) && (track === 'ALL' || cls.track === track) && (grade === 'ALL' || cls.grade === grade)];
  }));
}

export function teacherLoad(ctx, view, teacherId) {
  const minutes = {};
  for (const cls of view.classes.filter(row => row.teacher_id === teacherId)) for (const lesson of cls.lessons) minutes[lesson.week] = (minutes[lesson.week] ?? 0)+duration(lesson);
  for (const busy of ctx.teachers[teacherId].external_teaching) minutes[busy.week] = (minutes[busy.week] ?? 0)+duration(busy);
  return minutes;
}
