import {clone,signature,normalizePlan,evaluatePlan,applyMoves,attemptIntent,compatible,overlapLessons,studentLessons,mergePairs,resolveMergedId,transferRows} from './domain.js';

export function searchCampus(ctx,input,{maxEvaluations=600,maxMs=16000,beamWidth=20,maxDepth=4}={},helpers){
  const start=performance.now(),base=normalizePlan(ctx,input),current=evaluatePlan(ctx,base),seen=new Set(),valid=[],failures=[],notes=[];
  if(!current.view)throw new Error('当前草案无效，请重新核对');
  const changes=(p,r)=>helpers.planChanges(ctx,current.view,r.view);
  const basis={fingerprint:ctx.fingerprint,signature:signature(base),ruleVersion:ctx.data.rule_version??ctx.data.version};
  let checked=0,limited=false;
  const cost=r=>r.report.conditions.length*10000+r.changes.length*20+r.report.metrics.changedStudents.length*10;
  const inspect=(p,id,title,kind='linked')=>{
    if(checked>=maxEvaluations||performance.now()-start>=maxMs){limited=true;return null;}
    let plan;try{plan=normalizePlan(ctx,p);}catch{return null;}const key=signature(plan);if(seen.has(key))return null;seen.add(key);checked++;
    const report=evaluatePlan(ctx,plan);if(!report.view)return null;const row={id,title,kind,plan,report,basis,changes:changes(plan,report)};
    if(report.ok){valid.push(row);if(valid.length>60){valid.sort((a,b)=>cost(a)-cost(b));valid.length=60;}}return row;
  };
  inspect(base,'current','保留当前安排','current');
  const mergedTargets=new Set(mergePairs(ctx,base).map(p=>resolveMergedId(ctx,base,p.target))),groups=new Map();
  for(const issue of current.issues.filter(i=>i.type==='STUDENT_CONFLICT'))for(const id of issue.classIds){if(mergedTargets.has(id))continue;const group=groups.get(id)??new Set();for(const s of issue.studentIds)group.add(s);groups.set(id,group);}
  // Allocate actual conflicted students; a target's spare seats and each student's
  // real timetable prune assignments before full-plan validation.
  for(const [sourceId,set]of groups){
    const source=current.view.byId[sourceId],students=[...set].sort();if(!source)continue;
    if(students.length>8){notes.push(`${source.label}涉及${students.length}人，未完成全部分科组合检查`);continue;}
    const destinations=current.view.classes.filter(c=>c.id!==sourceId&&compatible(source,c)),free=Object.fromEntries(destinations.map(c=>[c.id,Math.min(c.capacity,...c.lessons.map(l=>ctx.rooms[l.room_id??c.room_id].capacity))-c.count]));
    const options=Object.fromEntries(students.map(student=>[student,destinations.filter(target=>free[target.id]>0&&!target.students.includes(student)&&!current.view.classes.some(other=>other.id!==sourceId&&other.id!==target.id&&other.students.includes(student)&&overlapLessons(studentLessons(ctx,target,student),studentLessons(ctx,other,student)).length)).map(c=>c.id)]));
    const order=[...students].sort((a,b)=>options[a].length-options[b].length||a.localeCompare(b));let assignments=0;
    const route=(plan,student,targetId)=>{
      const original=ctx.sourceRosters[sourceId].includes(student)?sourceId:transferRows(ctx,base).find(r=>r.studentId===student&&r.targetId===sourceId)?.sourceId;
      if(!original)return false;
      plan.transfers=(plan.transfers??[]).filter(r=>r.studentId!==student||r.sourceId!==original);
      if(original===ctx.scope.partial_math_destinations[0]&&ctx.scope.partial_math_students.includes(student)&&ctx.scope.partial_math_destinations.includes(targetId)){plan.routes[student]=targetId;}
      else{if(original===ctx.scope.partial_math_destinations[0])delete plan.routes[student];plan.transfers.push({studentId:student,sourceId:original,targetId});}return true;
    };
    const walk=(index,chosen)=>{
      if(limited||assignments>=2000||performance.now()-start>=maxMs){limited=true;return;}
      if(index===order.length){assignments++;const p=clone(base);for(const [s,t]of Object.entries(chosen))if(!route(p,s,t))return;inspect(p,valid.some(r=>r.id==='partial')?`partial-${checked}`:'partial',`${students.length}人分科调班`,'partial');return;}
      const student=order[index];for(const target of options[student]){if(free[target]<=0)continue;free[target]--;chosen[student]=target;walk(index+1,chosen);free[target]++;delete chosen[student];if(limited)return;}
    };walk(0,{});
    for(const target of destinations.filter(c=>free[c.id]<students.length).slice(0,2))failures.push({title:`全部转入${target.label}`,report:{issues:[{type:'CAPACITY',count:target.count+students.length,classCapacity:target.capacity,roomCapacity:Math.min(...target.lessons.map(l=>ctx.rooms[l.room_id??target.room_id].capacity)),overBy:target.count+students.length-Math.min(target.capacity,...target.lessons.map(l=>ctx.rooms[l.room_id??target.room_id].capacity)),title:'接收席位不足'}]}});
  }
  const initialIds=new Set(current.issues.flatMap(i=>i.classIds??[]));
  const roomOptions=(report,id)=>{const cls=report.view.byId[id];return ctx.data.rooms.filter(room=>room.campus_id===cls.campus_id&&room.capacity>=cls.count&&!report.view.classes.some(other=>other.id!==id&&overlapLessons(cls.lessons,other.lessons.filter(l=>(l.room_id??other.room_id)===room.id)).length)).sort((a,b)=>(a.id===cls.room_id?-1:b.id===cls.room_id?1:a.display_order-b.display_order));};
  // Actual same-teacher swaps, with available rooms checked at the proposed time.
  for(let i=0;i<current.view.classes.length&&!limited;i++)for(let j=i+1;j<current.view.classes.length&&!limited;j++){
    const a=current.view.classes[i],b=current.view.classes[j];if(a.teacher_id!==b.teacher_id||a.normal_slot===b.normal_slot||!initialIds.has(a.id)&&!initialIds.has(b.id))continue;
    try{const p=applyMoves(ctx,base,[{classId:a.id,slot:b.normal_slot},{classId:b.id,slot:a.normal_slot}],current.view),report=evaluatePlan(ctx,p);
      const aa=roomOptions(report,a.id).slice(0,2),bb=roomOptions(report,b.id).slice(0,2);
      for(const ra of aa)for(const rb of bb){const q=applyMoves(ctx,base,[{classId:a.id,slot:b.normal_slot,roomId:ra.id},{classId:b.id,slot:a.normal_slot,roomId:rb.id}],current.view);inspect(q,`coord-${checked}`,'同教师班级联合调整','coordination');}
    }catch{}
  }
  // Search keeps old-class arrangements as currently recorded. Coordinated
  // alternatives above remain separate; no intermediate drag is committed.
  let beam=[{plan:base,report:current,changes:[]}];
  const score=row=>row.report.issues.reduce((n,i)=>n+(i.type==='CAPACITY'?500+i.overBy*10:i.type==='STUDENT_CONFLICT'?15+Math.min(i.studentIds.length,40):30)+(i.overlaps?.length??0),0)+row.changes.length;
  for(let depth=1;depth<=maxDepth&&!limited;depth++){
    const next=[];
    for(const state of beam){
      const ids=[...new Set(state.report.issues.flatMap(i=>i.classIds??[]))];
      for(const id of ids){const cls=state.report.view.byId[id];if(!cls||cls.protected)continue;
        const capacity=state.report.issues.find(i=>i.classIds?.includes(id)&&i.type==='CAPACITY'&&i.count>i.classCapacity);if(capacity)continue;
        for(let slot=1;slot<=5;slot++){if(slot===cls.normal_slot)continue;
          try{const p=applyMoves(ctx,state.plan,[{classId:id,slot}],state.report.view),row=inspect(p,`linked-${checked}`,'保留老班的联动调整');if(row){row.rootKey=state.rootKey??`${id}:${slot}`;if(!row.report.ok)next.push(row);}}catch{}if(limited)break;
        }
        // Room-only remedies are generated only for actual room/capacity issues.
        if(state.report.issues.some(i=>['ROOM_CONFLICT','CAPACITY'].includes(i.type)&&i.classIds.includes(id)))for(const room of roomOptions(state.report,id).filter(r=>r.id!==cls.room_id).slice(0,2)){try{const row=inspect(applyMoves(ctx,state.plan,[{classId:id,slot:cls.normal_slot,roomId:room.id}],state.report.view),`room-${checked}`,'教室与课程联动调整');if(row){row.rootKey=state.rootKey??`${id}:room`;if(!row.report.ok)next.push(row);}}catch{}}
        for(const issue of state.report.issues.filter(i=>i.classIds?.includes(id)&&i.overlaps?.length===1)){const lessonId=issue.overlaps[0].lessonIds.find(key=>cls.lessons.some(l=>l.id===key));if(!lessonId)continue;const lesson=cls.lessons.find(l=>l.id===lessonId);
          for(let slot=1;slot<=5;slot++){if(slot===lesson.slot_id)continue;const p=clone(state.plan);(p.lessonMoves??={})[lessonId]={classId:id,slot,roomId:lesson.room_id??cls.room_id};const row=inspect(p,`lesson-${checked}`,'个别课次联动调整');if(row){row.rootKey=state.rootKey??`${id}:lesson:${slot}`;if(!row.report.ok)next.push(row);}if(limited)break;}
        }
        if(limited)break;
      }if(limited)break;
    }
    const frozenConflict=r=>r.report.issues.some(i=>i.type==='TEACHER_BUSY'||i.type==='TEACHER_CONFLICT'&&i.classIds.some(id=>ctx.classes[id].protected)||i.type==='CAPACITY'&&i.count>i.classCapacity);
    const buckets=new Map();for(const r of next.filter(r=>!frozenConflict(r)&&new Set(r.changes.map(c=>c.classId)).size<=maxDepth).sort((a,b)=>score(a)-score(b))){const key=r.rootKey??'other';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
    beam=[];for(let round=0;beam.length<beamWidth;round++){let added=false;for(const bucket of buckets.values())if(bucket[round]&&beam.length<beamWidth){beam.push(bucket[round]);added=true;}if(!added)break;}if(!beam.length)break;
  }
  const sorted=valid.filter(r=>r.id!=='current').sort((a,b)=>cost(a)-cost(b)),chosen=[];
  const add=row=>{if(row&&!chosen.some(c=>signature(c.plan)===signature(row.plan)))chosen.push(row);};
  add(valid.find(r=>r.id==='current'));add(sorted.find(r=>r.kind==='partial'));add(sorted.find(r=>r.kind!=='partial'&&!r.report.conditions.length));add(sorted.find(r=>r.report.conditions.length));
  if(chosen.length<4){const covered=new Set(chosen.flatMap(r=>r.changes.map(c=>c.classId)));const extra=sorted.filter(r=>r.kind==='linked'&&!chosen.includes(r)).sort((a,b)=>new Set(b.changes.map(c=>c.classId).filter(id=>!covered.has(id))).size-new Set(a.changes.map(c=>c.classId).filter(id=>!covered.has(id))).size||cost(a)-cost(b));add(extra[0]);}
  for(const row of chosen){if(row.kind==='linked')row.title=`保留老班 · 联动${new Set(row.changes.map(c=>c.classId)).size}个班`;if(row.report.conditions.length&&row.id!=='current')row.title='老班调时与教室协调';row.links=[];
    const changedIds=new Set(row.changes.flatMap(c=>[c.classId,c.targetId].filter(Boolean)));
    for(const change of row.changes){if(change.kind==='分科转班'){row.links.push({from:change.label,to:change.targetLabel,reason:`${change.students.length}名学生分科接收`,students:change.students.length});continue;}
      if(!row.report.view.byId[change.classId]||change.kind==='名单变化')continue;const final=row.report.view.byId[change.classId];let p;try{p=applyMoves(ctx,base,[{classId:change.classId,slot:final.normal_slot,roomId:final.room_id}],current.view);}catch{continue;}const r=evaluatePlan(ctx,p);for(const issue of r.issues.filter(i=>i.classIds?.includes(change.classId))){for(const other of issue.classIds.filter(id=>id!==change.classId&&changedIds.has(id))){const key=[change.classId,other].sort().join(':')+issue.type;if(row.links.some(l=>l.key===key))continue;row.links.push({key,from:ctx.classes[change.classId].label,to:ctx.classes[other].label,reason:issue.type==='STUDENT_CONFLICT'?`${issue.studentIds.length}名学生时间重叠`:issue.type==='TEACHER_CONFLICT'?`${ctx.teachers[issue.teacherId].display_name}授课时间重叠`:'教室占用重叠',lessons:issue.overlaps?.length??0});}}
    }
  }
  return {basis,current:{plan:base,report:current},candidates:chosen,failures:failures.slice(0,3),completion:limited?'LIMIT_REACHED':'BOUNDED_SEARCH_COMPLETE',checked,elapsedMs:performance.now()-start,searchScope:{campusWideComplete:false,depth:maxDepth,roomsUnchanged:false,teacherAssignmentUnchanged:true,subjects:current.view.classes.map(c=>c.label),note:`保持当前合班对象，核对冲突学生的多班分科、最多${maxDepth}个相关班级/个别课次与教室联动；不自动转出原接收班学生腾位，任课教师保持。未找到不等于全校区无解。${notes.join('；')}`}};
}
