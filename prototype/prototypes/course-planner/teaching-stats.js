// Teaching statistics use the whole term, not timetable card occurrences or highlighted rows.
const SUBJECT_GROUPS=Object.freeze({'英语口语':'英语','阅读':'语文'});
const ORDER=['语文','数学','英语','物理'];
export const teachingSubject=subject=>SUBJECT_GROUPS[subject]??subject;
const divide=(a,b)=>b>0?a/b:null;
const prepKey=c=>JSON.stringify([c.grade,teachingSubject(c.subject),c.track]);
const GRADES=['一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级','高一','高二','高三'];
const gradeRank=g=>GRADES.includes(g)?GRADES.indexOf(g):100;

export function buildTeachingStats(ctx,view){
  if(!view?.classes||!ctx.sourceView?.classes)throw new Error('教学统计缺少有效课表');
  const teachers=new Map(ctx.data.teachers.map(t=>[t.id,t])),memberships=new Map(),seen=new Set();
  const source=ctx.sourceView.classes,classes=view.classes;
  for(const c of [...source,...classes]){
    if(!teachers.has(c.teacher_id))throw new Error('教学统计缺少教师资料');
    const subject=teachingSubject(c.subject);if(!memberships.has(subject))memberships.set(subject,new Set());memberships.get(subject).add(c.teacher_id);
  }
  for(const c of classes){if(seen.has(c.id))throw new Error('教学统计班级重复');seen.add(c.id);if(!Number.isInteger(c.count)||c.count<0||!c.grade||!c.subject||!c.track)throw new Error('教学统计班级资料不完整');}
  const subjects=[...memberships.keys()].sort((a,b)=>{const aa=ORDER.indexOf(a),bb=ORDER.indexOf(b);return (aa<0?100:aa)-(bb<0?100:bb)||a.localeCompare(b,'zh-CN');});
  const summarize=(rows,teacherIds)=>{
    const preps=new Map(teacherIds.map(id=>[id,new Map()]));
    for(const c of rows){if(!preps.has(c.teacher_id))throw new Error('教学统计教师名册不完整');preps.get(c.teacher_id).set(prepKey(c),{grade:c.grade,subject:teachingSubject(c.subject),track:c.track});}
    const prepCount=[...preps.values()].reduce((n,s)=>n+s.size,0),enrollmentCount=rows.reduce((n,c)=>n+c.count,0),classCount=rows.length,teacherCount=teacherIds.length;
    return {classCount,teacherCount,enrollmentCount,prepCount,averageClassLoad:divide(classCount,teacherCount),averagePrepHeads:divide(prepCount,teacherCount),averageClassSize:divide(enrollmentCount,classCount)};
  };
  const teacherRows=(subject=null)=>{
    const ids=subject?[...memberships.get(subject)]:[...teachers.keys()];
    return ids.map(id=>{const t=teachers.get(id),rows=classes.filter(c=>c.teacher_id===id&&(!subject||teachingSubject(c.subject)===subject)),preps=[...new Map(rows.map(c=>[prepKey(c),{grade:c.grade,subject:teachingSubject(c.subject),track:c.track}])).values()].sort((a,b)=>a.subject.localeCompare(b.subject,'zh-CN')||gradeRank(a.grade)-gradeRank(b.grade)||a.grade.localeCompare(b.grade,'zh-CN')||a.track.localeCompare(b.track));
      return {id,name:t.display_name,subjects:subject?[subject]:subjects.filter(s=>memberships.get(s).has(id)),classIds:rows.map(c=>c.id),classCount:rows.length,prepCount:preps.length,preps,enrollmentCount:rows.reduce((n,c)=>n+c.count,0),averageClassSize:divide(rows.reduce((n,c)=>n+c.count,0),rows.length)};
    });
  };
  const overall={...summarize(classes,[...teachers.keys()]),lessonCount:classes.reduce((n,c)=>n+c.lessons.length,0),teachingHours:classes.reduce((n,c)=>n+c.lessons.reduce((total,l)=>total+(Date.parse(l.end)-Date.parse(l.start))/3600000,0),0)};
  const rows=subjects.map(subject=>({subject,...summarize(classes.filter(c=>teachingSubject(c.subject)===subject),[...memberships.get(subject)]),teachers:teacherRows(subject)}));
  return {scope:'CAMPUS_TERM_CURRENT_PLAN',overall,subjects:rows,teachers:teacherRows(),teacherMembershipSource:'TERM_SOURCE_ASSIGNMENTS_PLUS_CURRENT',subjectGroups:SUBJECT_GROUPS};
}
