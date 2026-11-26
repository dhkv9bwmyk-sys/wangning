import {clone,signature,normalizePlan,evaluatePlan,applyMoves,attemptIntent,compatible,overlapLessons,studentScheduleChanges} from './domain.js';
import {analyzeCurrentPlan,planChanges} from './planner.js';

// Generates proposals only. Workspace remains the single place that can apply them.
export function recommendAdjustments(ctx,input,request,{maxMs=9000,maxEvaluations=650,maxCandidates=4}={}){
  const start=performance.now(),base=normalizePlan(ctx,input),current=evaluatePlan(ctx,base),seen=new Set([signature(base)]),valid=[],seeds=[],notes=[];
  if(!current.view)throw new Error('当前课表无法读取，请重新核对');
  const basis={fingerprint:ctx.fingerprint,signature:signature(base),ruleVersion:ctx.data.rule_version??ctx.data.version};
  let checked=0,limited=false,requestedReport=null,anchor=null;
  const remaining=()=>Math.max(0,maxMs-(performance.now()-start));
  const exhausted=()=>{if(checked>=maxEvaluations||remaining()<=0){limited=true;return true;}return false;};
  const issueText=i=>i.type==='CAPACITY'?`拟${i.count}人，班容量${i.classCapacity}人、教室${i.roomCapacity}座`:i.type==='STUDENT_CONFLICT'?`${i.studentIds.length}名学生：${i.classIds.map(id=>ctx.classes[id].label).join('与')}时间重叠`:i.type==='TEACHER_CONFLICT'?`${ctx.teachers[i.teacherId].display_name}：${i.classIds.map(id=>ctx.classes[id].label).join('与')}授课重叠`:i.type==='ROOM_CONFLICT'?`${ctx.rooms[i.roomId]?.display_name??'教室'}：${i.classIds.map(id=>ctx.classes[id].label).join('与')}占用重叠`:i.title;
  const inspect=(inputPlan,kind='direct',reason='',links=[])=>{
    if(exhausted())return null;let plan;try{plan=normalizePlan(ctx,inputPlan);}catch{return null;}const key=signature(plan);if(seen.has(key))return null;seen.add(key);checked++;
    const report=evaluatePlan(ctx,plan);if(!report.view)return null;
    const row={id:`suggest-${checked}`,kind,plan,report,basis,changes:planChanges(ctx,current.view,report.view),reason,links,impactStudents:studentScheduleChanges(ctx,current.view,report.view)};
    if(report.ok&&row.changes.length){let relevant=true;if(desired&&anchor){const after=report.view.byId[anchor.id];if(desired.kind==='lesson'){const before=anchor.lessons.find(l=>l.id===desired.lessonId),next=after?.lessons.find(l=>l.id===desired.lessonId);relevant=!!next&&after.lessons.filter(l=>l.id!==desired.lessonId).every(l=>{const old=anchor.lessons.find(x=>x.id===l.id);return old&&old.start===l.start&&old.end===l.end&&(old.room_id??anchor.room_id)===(l.room_id??after.room_id);});if(desired.slot!==before.slot_id&&next?.slot_id===before.slot_id)relevant=false;}else if(desired.slot!==undefined&&desired.slot!==anchor.normal_slot&&after?.normal_slot===anchor.normal_slot)relevant=false;}if(relevant)valid.push(row);}else if(!report.ok&&!report.issues.some(i=>i.type==='TEACHER_BUSY'||i.type==='CAPACITY'&&i.count>i.classCapacity))seeds.push(row);
    return row;
  };
  const availableRooms=(report,id)=>{const c=report.view.byId[id];return ctx.data.rooms.filter(r=>r.campus_id===c.campus_id&&r.capacity>=c.count&&!report.view.classes.some(o=>o.id!==id&&overlapLessons(c.lessons,o.lessons.filter(l=>(l.room_id??o.room_id)===r.id)).length)).sort((a,b)=>(a.id===c.room_id?-1:b.id===c.room_id?1:a.display_order-b.display_order));};
  const addSearch=(seed)=>{
    if(exhausted())return;const allowance=Math.min(maxEvaluations-checked,350);if(allowance<2)return;
    const found=analyzeCurrentPlan(ctx,seed.plan,{maxEvaluations:allowance,maxMs:Math.min(3500,remaining()),beamWidth:20,maxDepth:4});checked+=found.checked;if(found.completion==='LIMIT_REACHED')limited=true;
    for(const candidate of found.candidates){if(exhausted())break;inspect(candidate.plan,'linked',`相关安排存在${seed.report.issues.map(issueText).slice(0,2).join('；')}，建议整组联动。`,candidate.links??[]);}
  };
  const desired=request.intent;
  if(request.kind==='current'){
    if(current.ok){notes.push('当前草案没有未解决冲突；可从班级详情指定目标，再查询可行安排。');}
    else{notes.push(...current.issues.slice(0,3).map(issueText));const found=analyzeCurrentPlan(ctx,base,{maxEvaluations:Math.min(600,maxEvaluations),maxMs:remaining(),beamWidth:20,maxDepth:4});checked+=found.checked;if(found.completion==='LIMIT_REACHED')limited=true;for(const c of found.candidates)inspect(c.plan,'linked','根据当前冲突核对整组调整，具体联动关系见下方。',c.links??[]);}
  }else if(request.kind==='merge'){
    anchor=current.view.byId[request.classId];if(!anchor)throw new Error('该班已合入其他班，请从当前班级重新生成');
    const targets=current.view.classes.filter(c=>c.id!==anchor.id&&compatible(anchor,c)).sort((a,b)=>Math.abs(a.normal_slot-anchor.normal_slot)-Math.abs(b.normal_slot-anchor.normal_slot)||(b.capacity-b.count-anchor.count)-(a.capacity-a.count-anchor.count)||a.id.localeCompare(b.id));
    if(!targets.length)notes.push(`${anchor.label}暂无同年级、同班型且课程进度一致的接收班。`);
    for(const target of targets.slice(0,3)){if(exhausted())break;const attempt=attemptIntent(ctx,base,{kind:'merge',classId:anchor.id,targetId:target.id});if(!attempt.accepted){notes.push(`${target.label}：${attempt.report.issues.map(issueText).join('；')}`);continue;}
      const row=inspect(attempt.plan,'merge',`${anchor.label}${anchor.count}人并入${target.label}${target.count}人；接收班容量${target.capacity}人。`);
      if(row&&!row.report.ok)addSearch(row);if(valid.length>=maxCandidates)break;
    }
    if(targets.length>3){limited=true;notes.push(`当前只核对前3个兼容接收班，另有${targets.length-3}个未检查。`);}
  }else{
    if(request.kind==='joint'){
      if(!Array.isArray(request.moves)||!request.moves.length)notes.push('先选择需要调整的班级及目标时点或教室，再生成联动建议。');
      else{const plan=applyMoves(ctx,base,request.moves,current.view);requestedReport=evaluatePlan(ctx,plan);if(signature(plan)===signature(base))notes.push('所选安排与当前课表一致，请先修改目标时点或教室。');else{
        const row=inspect(plan,'joint','按所选班级的目标安排整组核查。');
        if(row&&!row.report.ok){const touched=[...new Set(request.moves.filter(m=>current.view.byId[m.classId]&&(m.slot!==current.view.byId[m.classId].normal_slot||m.roomId&&m.roomId!==current.view.byId[m.classId].room_id)).map(m=>m.classId))];
          let variants=[row];for(const id of touched){const next=[];for(const v of variants){const cls=v.report.view.byId[id];if(!v.report.issues.some(i=>['CAPACITY','ROOM_CONFLICT'].includes(i.type)&&i.classIds.includes(id))){next.push(v);continue;}for(const room of availableRooms(v.report,id).slice(0,2)){const r=inspect(applyMoves(ctx,v.plan,[{classId:id,slot:cls.normal_slot,roomId:room.id}],v.report.view),'joint','保留所选时点，调整冲突教室。');if(r)next.push(r);}}variants=next.slice(0,4);}
        }
      }}
    }else{
      const intent=desired??{kind:'move',classId:request.classId};anchor=current.view.byId[intent.classId];if(!anchor)throw new Error('该班已合入其他班，请从当前班级重新生成');
      const single=intent.kind==='lesson',lesson=single?anchor.lessons.find(l=>l.id===intent.lessonId):null;if(single&&!lesson)throw new Error('该次课已不存在，请重新选择');
      const goalSlot=intent.slot??lesson?.slot_id??anchor.normal_slot,goalRoom=intent.roomId??lesson?.room_id??anchor.room_id;
      const make=(slot,roomId)=>{if(single){const p=clone(base);(p.lessonMoves??={})[lesson.id]={classId:anchor.id,slot,roomId};if(anchor.protected)p.profile='SIMULATE_OLD_CHANGE';return normalizePlan(ctx,p);}return applyMoves(ctx,base,[{classId:anchor.id,slot,roomId,seriesMode:intent.seriesMode??'PRESERVE'}],current.view);};
      if(desired){const p=make(goalSlot,goalRoom);requestedReport=evaluatePlan(ctx,p);inspect(p,'direct','保留本次目标，完整核查实际课次。');}
      const slots=[1,2,3,4,5].sort((a,b)=>Math.abs(a-goalSlot)-Math.abs(b-goalSlot)||a-b);
      for(const slot of slots){if(exhausted())break;const p=make(slot,goalRoom),r=evaluatePlan(ctx,p);if(!r.view)continue;
        if(single){const candidates=ctx.data.rooms.filter(room=>room.campus_id===anchor.campus_id&&room.capacity>=anchor.count).sort((a,b)=>(a.id===goalRoom?-1:b.id===goalRoom?1:a.display_order-b.display_order));for(const room of candidates){const row=inspect(make(slot,room.id),'direct',`${slot===goalSlot?'保留目标时点':'改用其他时点'}，只调整${lesson.start.slice(0,10)}这1次课，其余${anchor.lessons.length-1}次保持。`);if(row?.report.ok)break;}}
        else{const rooms=availableRooms(r,anchor.id);if(!rooms.length)inspect(p,'linked','需要同时腾出教室或调整占用课程。');for(const room of rooms.slice(0,3))inspect(make(slot,room.id),'direct',`${slot===goalSlot?'保留目标时点':'改用其他时点'}；${room.display_name}${room.capacity}座，班级${anchor.count}人。`);}
      }
      // Whole-class, same-teacher exchanges are proposed atomically, including protected old classes.
      if(!single)for(const other of current.view.classes.filter(c=>c.id!==anchor.id&&c.teacher_id===anchor.teacher_id&&c.normal_slot!==anchor.normal_slot)){
        if(exhausted())break;const p=applyMoves(ctx,base,[{classId:anchor.id,slot:other.normal_slot},{classId:other.id,slot:anchor.normal_slot}],current.view),r=evaluatePlan(ctx,p);if(!r.view)continue;
        const a=availableRooms(r,anchor.id).slice(0,2),b=availableRooms(r,other.id).slice(0,2);if(!a.length)a.push(ctx.rooms[r.view.byId[anchor.id].room_id]);if(!b.length)b.push(ctx.rooms[r.view.byId[other.id].room_id]);
        for(const ra of a)for(const rb of b)inspect(applyMoves(ctx,base,[{classId:anchor.id,slot:other.normal_slot,roomId:ra.id},{classId:other.id,slot:anchor.normal_slot,roomId:rb.id}],current.view),'linked',`${anchor.teacherName}的${anchor.label}与${other.label}联合换时；继续检查学生与教室。`,[{from:anchor.label,to:other.label,reason:`共用教师${anchor.teacherName}，需要整组核查`}]);
      }
    }
    if(requestedReport&&!requestedReport.ok)notes.push(...requestedReport.issues.slice(0,3).map(issueText));
    // Search the strongest relevant partial proposals; no intermediate arrangement is committed.
    const ranked=seeds.sort((a,b)=>a.report.issues.length-b.report.issues.length||a.changes.length-b.changes.length);
    if(!valid.some(c=>!c.report.conditions.length))for(const seed of ranked.slice(0,3)){addSearch(seed);if(valid.length>=maxCandidates||exhausted())break;}
  }
  const rank=c=>c.report.conditions.length*10000+c.impactStudents.length*10+c.changes.length*3;
  const sorted=valid.sort((a,b)=>rank(a)-rank(b)),chosen=[],keys=new Set();
  for(const c of sorted){const cls=anchor?c.report.view.byId[anchor.id]:null,l=desired?.kind==='lesson'?cls?.lessons.find(l=>l.id===desired.lessonId):null,key=request.kind==='merge'?signature(c.plan):`${l?.slot_id??cls?.normal_slot??''}:${c.kind}:${!!c.report.conditions.length}`;if(keys.has(key))continue;keys.add(key);chosen.push(c);if(chosen.length>=maxCandidates)break;}
  for(const c of sorted)if(chosen.length<maxCandidates&&!chosen.includes(c))chosen.push(c);
  for(const c of chosen){const changed=[...new Set(c.changes.map(x=>x.classId))],single=desired?.kind==='lesson';const cls=anchor?c.report.view.byId[anchor.id]:null,l=single?cls?.lessons.find(l=>l.id===desired.lessonId):null;
    c.preservesRequestedTime=desired?.slot!==undefined&&request.origin!=='lesson'?(l?.slot_id??cls?.normal_slot)===desired.slot:null;
    const only=c.changes.find(x=>x.kind!=='名单变化'),transfers=c.changes.filter(x=>x.kind==='分科转班'),linkedCount=new Set(c.changes.filter(x=>!['合班','分科转班','名单变化'].includes(x.kind)).map(x=>x.classId)).size;c.title=c.changes.some(x=>x.kind==='合班')?(transfers.length?`合班后分流到${new Set(transfers.map(x=>x.targetId)).size}个${ctx.classes[transfers[0].classId].subject}班`:linkedCount?`合班后联动${linkedCount}个班`:'合班建议'):transfers.length?`分科转入${new Set(transfers.map(x=>x.targetId)).size}个${ctx.classes[transfers[0].classId].subject}班`:single?only.fromSlot===only.toSlot?`这1次换到${only.toRoom}`:`这1次改到时点${l.slot_id}`:changed.length===1&&only.fromSlot===only.toSlot?`换到${only.toRoom} · 时间不变`:changed.length===1?`调整到时点${cls?.normal_slot??only.toSlot}`:`联动调整${changed.length}个班`;
    if(c.report.conditions.length)c.title+=' · 老班待协调';
  }
  return {kind:'recommendations',request:clone(request),basis,current:{plan:base,report:current},candidates:chosen,failures:[],notes:[...new Set(notes)],completion:limited?'LIMIT_REACHED':'BOUNDED_SEARCH_COMPLETE',checked,elapsedMs:performance.now()-start,searchScope:{campusWideComplete:false,note:'核对当前草案、本次目标及相关课程的有限替代安排；保持任课教师，不自动转出原接收班学生腾位。未找到或触限不表示全校区无解或最优。'}};
}
