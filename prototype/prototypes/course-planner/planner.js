import {clone,signature,normalizePlan,evaluatePlan,applyMoves,resolveMergedId,hasMerges,teacherLoad} from './domain.js';
import {searchCampus} from './campus-search.js';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function operationKind(a,b){const t=a?.normal_slot!==b?.normal_slot,r=a?.room_id!==b?.room_id;return t&&r?'调时并换教室':t?'调时':r?'换教室':'课次调整';}
export function planChanges(ctx,before,after){
  const rows=[],mergedTargets=new Set();
  for(const a of before.classes){const b=after.byId[a.id];
    if(!b){const target=after.byId[resolveMergedId(ctx,after.plan,a.id)];if(target){rows.push({kind:'合班',classId:a.id,label:a.label,targetLabel:target.label,targetId:target.id,fromSlot:a.normal_slot,toSlot:target.normal_slot,fromRoom:a.roomName,toRoom:target.roomName,fromTeacher:a.teacherName,toTeacher:target.teacherName,fromCount:a.count,toCount:target.count});mergedTargets.add(target.id);}continue;}
    const lessons=b.lessons.filter(l=>{const old=a.lessons.find(o=>o.id===l.id);return !old||old.start!==l.start||old.end!==l.end||(old.room_id??a.room_id)!==(l.room_id??b.room_id);});
    if(lessons.length||a.room_id!==b.room_id){const single=lessons.length===1&&a.normal_slot===b.normal_slot&&a.room_id===b.room_id,afterLesson=single?lessons[0]:null,beforeLesson=single?a.lessons.find(l=>l.id===afterLesson.id):null;rows.push({kind:single?'单次调课':operationKind(a,b),classId:a.id,label:a.label,fromSlot:single?beforeLesson.slot_id:a.normal_slot,toSlot:single?afterLesson.slot_id:b.normal_slot,fromRoom:single?ctx.rooms[beforeLesson.room_id??a.room_id].display_name:a.roomName,toRoom:single?ctx.rooms[afterLesson.room_id??b.room_id].display_name:b.roomName,fromTeacher:a.teacherName,toTeacher:b.teacherName,lessonCount:lessons.length,dates:single?[afterLesson.start.slice(0,10)]:[],exceptionDates:lessons.filter(l=>ctx.classes[a.id].lessons.find(o=>o.id===l.id)?.slot_id!==ctx.classes[a.id].normal_slot).map(l=>l.start.slice(0,10))});}
    if(!equal(a.students,b.students))rows.push({kind:'名单变化',classId:a.id,label:a.label,fromCount:a.count,toCount:b.count,joined:b.students.filter(id=>!a.students.includes(id)),left:a.students.filter(id=>!b.students.includes(id)),fromTeacher:a.teacherName,toTeacher:b.teacherName});
  }
  for(const b of after.classes)if(!before.byId[b.id])rows.push({kind:'恢复班级',classId:b.id,label:b.label,toSlot:b.normal_slot,toRoom:b.roomName,toCount:b.count});
  const transfers=new Map(),rosterChanged=new Set();
  for(const a of before.classes)for(const student of a.students){const target=after.classes.find(c=>c.subject===a.subject&&c.students.includes(student));if(!target||target.id===a.id||resolveMergedId(ctx,after.plan,a.id)===target.id)continue;
    const key=`${a.id}:${target.id}`;if(!transfers.has(key))transfers.set(key,{kind:'分科转班',classId:a.id,label:a.label,targetId:target.id,targetLabel:target.label,fromSlot:a.normal_slot,toSlot:target.normal_slot,fromRoom:a.roomName,toRoom:target.roomName,fromTeacher:a.teacherName,toTeacher:target.teacherName,students:[],sourceBefore:a.count,sourceAfter:after.byId[a.id]?.count,targetBefore:before.byId[target.id]?.count??0,targetAfter:target.count});transfers.get(key).students.push(student);rosterChanged.add(a.id);rosterChanged.add(target.id);
  }
  return [...rows.filter(r=>r.kind!=='名单变化'||(!mergedTargets.has(r.classId)&&!rosterChanged.has(r.classId))),...transfers.values()];
}
export function teacherImpacts(ctx,before,after){
  const result=[],changes=planChanges(ctx,before,after);
  for(const teacher of ctx.data.teachers){const a=teacherLoad(ctx,before,teacher.id),b=teacherLoad(ctx,after,teacher.id),weeks=[...new Set([...Object.keys(a),...Object.keys(b)])].sort((x,y)=>x-y);
    const scheduleChanged=changes.some(r=>r.fromTeacher===teacher.display_name||r.toTeacher===teacher.display_name);
    if(!equal(a,b)||scheduleChanged){const span=v=>{const n=weeks.map(w=>(v[w]??0)/60);return {min:n.length?Math.min(...n):0,max:n.length?Math.max(...n):0,weekly:weeks.map(w=>({week:Number(w),hours:(v[w]??0)/60}))};};result.push({id:teacher.id,name:teacher.display_name,before:span(a),after:span(b),externalIncluded:true,scheduleChanged});}
  }return result;
}

// Separate from the preserved legacy enumeration. Returned candidates are revalidated.
export function analyzeCurrentPlan(ctx,input,options={}){return ctx.scope.general_student_transfers?searchCampus(ctx,input,options,{planChanges}):legacyCurrentAnalysis(ctx,input,options);}
function legacyCurrentAnalysis(ctx,input,{maxEvaluations=900,maxMs=18000,beamWidth=8,maxDepth=3}={}){
  const start=performance.now(),base=normalizePlan(ctx,input),current=evaluatePlan(ctx,base),seen=new Set(),valid=[],failures=[];
  if(!current.view)throw new Error('当前草案数据无效，请重新核对');
  const basis={fingerprint:ctx.fingerprint,signature:signature(base),ruleVersion:ctx.data.rule_version??ctx.data.version};
  let checked=0,limited=false;
  const cost=r=>r.report.issues.reduce((n,i)=>n+(i.type==='CAPACITY'?1000+(i.overBy??1)*50:i.type==='STUDENT_CONFLICT'?30+Math.min(i.studentIds.length,10)*3:50)+(i.overlaps?.length??0),0)+r.changes.length*2;
  const inspect=(plan,id,title)=>{
    if(checked>=maxEvaluations||performance.now()-start>=maxMs){limited=true;return null;}
    let p;try{p=normalizePlan(ctx,plan);}catch{return null;}const key=signature(p);if(seen.has(key))return null;seen.add(key);checked++;
    const report=evaluatePlan(ctx,p);if(!report.view)return null;
    const row={id,title,plan:p,report,basis,changes:planChanges(ctx,current.view,report.view)};if(report.ok)valid.push(row);return row;
  };
  inspect(base,'current','保留当前安排');
  const math=ctx.scope.partial_math_destinations[0],students=ctx.scope.partial_math_students;
  if(hasMerges(base)&&current.view.byId[math])for(const target of ctx.scope.partial_math_destinations.filter(id=>id!==math&&current.view.byId[id])){
    const p=clone(base);for(const student of students)p.routes[student]=target;
    const row=inspect(p,'partial',`${students.length}人分科转班`);if(row&&!row.report.ok)failures.push(row);
  }
  const classes=current.view.classes;
  for(let i=0;i<classes.length;i++)for(let j=i+1;j<classes.length;j++){
    const a=classes[i],b=classes[j];if(a.normal_slot===b.normal_slot||a.teacher_id!==b.teacher_id)continue;
    try{inspect(applyMoves(ctx,base,[{classId:a.id,slot:b.normal_slot},{classId:b.id,slot:a.normal_slot}]),'conditional','同教师班级联合调时');}catch{}
  }
  let beam=[{plan:base,report:current,changes:[]}];
  for(let depth=1;depth<=maxDepth&&!limited;depth++){
    const next=[];
    for(const state of beam){const ids=[...new Set(state.report.issues.flatMap(i=>i.classIds??[]))];
      for(const id of ids){const cls=state.report.view.byId[id];if(!cls)continue;
        for(let slot=1;slot<=5;slot++){if(slot===cls.normal_slot)continue;try{const row=inspect(applyMoves(ctx,state.plan,[{classId:id,slot}]),`linked-${checked}`,`联动调整${depth}步`);if(row&&!row.report.ok)next.push(row);}catch{}if(limited)break;}if(limited)break;
      }if(limited)break;
    }
    beam=next.sort((a,b)=>cost(a)-cost(b)).slice(0,beamWidth);if(!beam.length)break;
  }
  const rank=r=>r.report.conditions.length*1000+r.changes.length*20+r.report.metrics.changedStudents.length;
  const sorted=valid.filter(c=>c.id!=='current').sort((a,b)=>rank(a)-rank(b)),chosen=[];
  const add=r=>{if(r&&!chosen.some(x=>signature(x.plan)===signature(r.plan)))chosen.push(r);};
  add(valid.find(c=>c.id==='current'));add(sorted.find(c=>c.id==='partial'));add(sorted.find(c=>!c.report.conditions.length&&c.id!=='partial'));add(sorted.find(c=>c.report.conditions.length));
  for(const r of sorted)if(chosen.length<3)add(r);
  return {basis,current:{plan:base,report:current},candidates:chosen,failures:failures.slice(0,2),completion:limited?'LIMIT_REACHED':'BOUNDED_SEARCH_COMPLETE',checked,elapsedMs:performance.now()-start,
    searchScope:{campusWideComplete:false,depth:maxDepth,roomsUnchanged:true,teacherAssignmentUnchanged:true,subjects:classes.map(c=>c.label),note:'检查当前相关课程调时、同教师联合换时及已报名学生分科；最多三轮联动，教室和任课教师保持当前安排。未找到不表示全校区无解。'}};
}
