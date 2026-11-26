// Presentation facts only: this module never changes a plan or approves an adjustment.
const unique=xs=>[...new Set(xs)];
export function captureClassFacts(view,ids){
  return Object.fromEntries(unique(ids).map(id=>{
    const c=view?.byId?.[id];if(!c)return [id,null];
    return [id,{id:c.id,label:c.label,class_code:c.class_code,teacher_id:c.teacher_id,teacherName:c.teacherName,
      room_id:c.room_id,roomName:c.roomName,track:c.track,grade:c.grade,normal_slot:c.normal_slot,
      count:c.count,capacity:c.capacity,roomCapacity:c.roomCapacity,weekday:c.lessons?.[0]?.weekday,subject:c.subject,students:c.students,studentLessonIds:c.studentLessonIds,
      lessonCount:c.lessons?.length,lessons:c.lessons?.map(l=>({id:l.id,start:l.start,end:l.end,weekday:l.weekday,slot_id:l.slot_id,room_id:l.room_id??c.room_id}))}];
  }));
}

const labels={TEACHER_BUSY:'教师已有授课',TEACHER_CONFLICT:'教师时间冲突',STUDENT_CONFLICT:'学生时间冲突',ROOM_CONFLICT:'教室时间冲突',CAPACITY:'容量超限'};
const stamp=x=>`${x.date??x.start?.slice(0,10)}|${x.start}|${x.end}`;
const intervals=rows=>[...new Map(rows.map(row=>[stamp(row),row])).values()].sort((a,b)=>a.start.localeCompare(b.start));

export function buildConflictView(ctx,{report,intent=null,beforeFacts={},classFacts=null,studentFacts={},historical=false,label=''}={}){
  const issues=report.issues??[],facts={...(classFacts??captureClassFacts(report.view,Object.keys(report.view?.byId??{})))};
  if(intent?.kind==='lesson'&&facts[intent.classId]){const c=facts[intent.classId],l=c.lessons.find(l=>l.id===intent.lessonId);if(l){const room=l.room_id??c.room_id;facts[c.id]={...c,normal_slot:l.slot_id,room_id:room,roomName:ctx.rooms[room]?.display_name,roomCapacity:ctx.rooms[room]?.capacity,lessonCount:1,lessons:[l],studentLessonIds:Object.fromEntries(Object.entries(c.studentLessonIds??{}).map(([id,ids])=>[id,ids.filter(key=>key===l.id)]))};}}
  const inferred=Object.values(facts).find(c=>c&&label.startsWith(`调时：${c.label} →`));
  const primaryId=intent?.kind==='merge'?intent.targetId:intent?.classId??inferred?.id??issues[0]?.classIds?.[0];
  const primary=facts[primaryId]??(!historical?ctx.sourceView.byId[primaryId]:null);
  const prior=intent?.classId?beforeFacts[intent.classId]:null,singleBefore=intent?.kind==='lesson'?prior?.lessons?.find(l=>l.id===intent.lessonId):null;
  const before=singleBefore?{...prior,normal_slot:singleBefore.slot_id,room_id:singleBefore.room_id??prior.room_id,roomName:ctx.rooms[singleBefore.room_id??prior.room_id]?.display_name}:prior;
  const sourceIds=new Set(primary?.lessons?.map(l=>l.id)??[]);
  const sourceDates=primary?.lessons?.map(l=>l.start.slice(0,10))??[];
  const slots=ctx.data.time_window_templates;
  const slot=id=>slots.find(s=>s.slot_id===id);
  const destinationSlot=['move','lesson'].includes(intent?.kind)?intent.slot:primary?.normal_slot;
  const targetRoom=intent?.roomId?ctx.rooms[intent.roomId]?.display_name:primary?.roomName;
  const totalLessons=primary?.lessonCount??primary?.lessons?.length??ctx.classes[primaryId]?.lessons?.length??null;
  const groups=issues.map(issue=>{
    const overlap=intervals(issue.overlaps??[]),otherIds=(issue.classIds??[]).filter(id=>id!==primaryId);
    const resources=otherIds.map(id=>facts[id]??(!historical?ctx.sourceView.byId[id]:null)).filter(Boolean);
    const first=overlap[0],last=overlap.at(-1);
    const teacherName=ctx.teachers[issue.teacherId]?.display_name;
    const occupancy=issue.occupancies?.find(b=>first&&Date.parse(b.start)<Date.parse(first.end)&&Date.parse(b.end)>Date.parse(first.start));
    const outside=issue.type==='TEACHER_BUSY'?{title:'已有授课安排',teacherName,start:occupancy?.start??first?.start,end:occupancy?.end??first?.end,detailsAvailable:false}:null;
    const overlapDateSet=new Set(overlap.map(o=>o.date??o.start.slice(0,10)));
    const courses=(issue.classIds??[]).map(id=>facts[id]??(!historical?ctx.sourceView.byId[id]:null)).filter(Boolean);
    const assessed=courses.find(c=>c.id===primaryId)??courses[0];
    const studentRows=(issue.studentIds??[]).map(id=>({id,name:historical?studentFacts[id]?.name??null:ctx.students?.[id]?.display_name??null,
      courses:courses.map(c=>({id:c.id,label:c.label,code:c.class_code,teacher:c.teacherName,room:c.roomName})),
      count:overlap.filter(o=>!assessed?.studentLessonIds?.[id]||o.lessonIds?.some(key=>assessed.studentLessonIds[id].includes(key))).length,
      total:assessed?.studentLessonIds?.[id]?.length??assessed?.lessonCount??null}));
    return {type:issue.type,title:labels[issue.type]??issue.title,rawTitle:issue.title,teacherName,courses,studentRows,
      studentIds:issue.studentIds??[],resources,outside,overlaps:overlap,count:overlap.length,totalLessons,
      firstDate:first?.date??first?.start.slice(0,10),lastDate:last?.date??last?.start.slice(0,10),
      unaffectedDates:sourceDates.filter(date=>!overlapDateSet.has(date)),
      countAfter:issue.count,classCapacity:issue.classCapacity,roomCapacity:issue.roomCapacity,overBy:issue.overBy,
      locationIds:resources.map(r=>r.id)};
  });
  const all=intervals(groups.flatMap(g=>g.overlaps));
  const affectedLessonIds=unique(all.flatMap(o=>(o.lessonIds??[]).filter(id=>sourceIds.has(id))));
  return {primaryId,primary,before,intent,historical,label,groups,
    typeCount:unique(groups.map(g=>g.type)).length,affectedCount:sourceIds.size?affectedLessonIds.length:all.length,
    totalLessons,studentIds:unique(groups.flatMap(g=>g.studentIds)),
    fromSlot:before?.normal_slot,fromWindow:slot(before?.normal_slot),toSlot:destinationSlot,toWindow:slot(destinationSlot),
    targetRoom,weekday:primary?.weekday??before?.weekday??'Saturday'};
}
