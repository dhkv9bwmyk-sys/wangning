(function (root) {
  'use strict';
  const steps=['读任务','拉模板','字段映射','缺省追问','规则校验','写系统','回读核对'];
  const labels={school_id:'学校',campus_id:'校区',budget_id:'预算编号',fiscal_year:'财年',quarter:'季度',class_name:'班级名称',subject_id:'科目',period_id:'期次',slot_id:'时段',teacher_id:'教师编号',capacity:'班额',template_id:'模板号'};
  const writable=Object.keys(labels);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const naturalKey=r=>[r.school_id,r.campus_id,r.budget_id,r.class_name].join('|');
  const profileLabels={missing:'预算与班级资料 · 待补字段',complete:'预算与班级资料 · 字段完整',conflict:'班级资料 · 师资冲突',campus:'班级资料 · 含其他校区',budget:'班级资料 · 含其他预算',duplicate:'班级资料 · 重复记录',fourth:'班级资料 · 第四期'};
  function templateFor(quarter){return {id:quarter==='暑假'?'TPL-ENTRY-SU-01':'TPL-ENTRY-AU-01',version:'1.3',name:quarter+'入口班级模板',quarter,fields:writable.map(key=>({key,label:labels[key],required:true})),periods:quarter==='暑假'?['第1期','第2期','第3期','第4期']:['秋季常规期'],slots:['时段1','时段2','时段3','时段4'],subjects:['科目A','科目B','科目C','科目D'],capacity:{min:1,max:24}};}
  function createTask(data,options={}){
    const campus=data.campuses.find(c=>c.id===options.campusId)||data.campuses[0];
    const quarter=options.quarter||'暑假',seq=options.seq||1,profile=options.profile||'missing';
    const id='CP-'+String(seq).padStart(4,'0');
    const budgetId='BUD-'+campus.id+'-'+(quarter==='暑假'?'SU':'AU')+'-01';
    const context={schoolId:data.school.id,school:data.school.name,campusId:campus.id,campus:campus.name,fiscalYear:data.fiscalYear,quarter,taskId:id,templateId:null,budgetId};
    const period=quarter==='暑假'?'第1期':'秋季常规期';
    const input=Object.entries(campus.targets).map(([subject,target],i)=>({row:'R'+String(i+1).padStart(2,'0'),school:data.school.id,campus:campus.id,budget:budgetId,fiscalYear:data.fiscalYear,quarter,name:'入口'+subject+'01班',subject,period:profile==='missing'?null:profile==='fourth'&&quarter==='暑假'?'第4期':period,slot:profile==='missing'&&i===1?null:'时段'+(i+1),teacher:'教师'+campus.id.slice(1)+'-'+String(i+1).padStart(2,'0'),capacity:16,source:'S02 · 班级准备表!A'+(i+2)+':K'+(i+2)}));
    if(profile==='conflict'){input[1].teacher=input[0].teacher;input[1].slot=input[0].slot;}
    if(profile==='campus')input.push({...clone(input[0]),row:'R05',campus:data.campuses.find(c=>c.id!==campus.id).id,name:'其他校区班级'});
    if(profile==='budget')input.push({...clone(input[0]),row:'R05',budget:budgetId+'-OTHER',name:'其他预算班级'});
    if(profile==='duplicate')input.push({...clone(input[0]),row:'R05'});
    const demand=Object.entries(campus.targets).map(([subject,target])=>({subject,sourceTarget:target,rate:quarter==='暑假'?1:data.rates[subject],target:Math.round(target*(quarter==='暑假'?1:data.rates[subject])*100)/100,capacity:16,classes:Math.ceil(target*(quarter==='暑假'?1:data.rates[subject])/16),source:'S01 · '+campus.ref}));
    return {id,context,profile,profileLabel:profileLabels[profile],fault:options.fault||'none',input,demand,submitted:false,executionCount:0,status:'ready',current:0,view:0,follow:true,steps:steps.map(()=>({status:'idle'})),events:[],template:null,master:null,records:[],excluded:[],checks:[],writeResult:null,readback:null,writeAttempts:0,readAttempts:0,manual:null,answers:[],busy:false,lockVersion:0};
  }
  function masterFor(task){
    const template=task.template||templateFor(task.context.quarter);
    const teachers=Array.from({length:6},(_,i)=>({id:'教师'+task.context.campusId.slice(1)+'-'+String(i+1).padStart(2,'0'),campus:task.context.campusId,subjects:['科目A','科目B','科目C','科目D'],periods:template.periods,slots:template.slots}));
    return {campus:task.context.campusId,budget:task.context.budgetId,teachers,occupied:[{teacher_id:teachers[0].id,period_id:template.periods[0],slot_id:'时段4',class_name:'已有班级01'}],existing:[]};
  }
  function mapFields(task){
    return task.input.map(r=>({row:r.row,source:r.source,school_id:r.school,campus_id:r.campus,budget_id:r.budget,fiscal_year:r.fiscalYear,quarter:r.quarter,class_name:r.name,subject_id:r.subject,period_id:r.period,slot_id:r.slot,teacher_id:r.teacher,capacity:r.capacity===null||r.capacity===undefined||r.capacity===''?null:Number(r.capacity),template_id:task.template.id}));
  }
  function missingFields(task){
    return task.template.fields.flatMap(f=>{const rows=task.records.filter(r=>r[f.key]===null||r[f.key]===undefined||r[f.key]==='');if(!rows.length)return [];const choices=f.key==='period_id'?task.template.periods:f.key==='slot_id'?task.template.slots:f.key==='subject_id'?task.template.subjects:f.key==='teacher_id'?(task.master?.teachers||[]).map(t=>t.id):f.key==='quarter'?[task.context.quarter]:[];const control=f.key==='capacity'?'number':f.key==='class_name'?'text':'select';const item={key:f.key,label:f.label,rows:rows.map(r=>r.row),choices,control};return f.key==='class_name'?rows.map(r=>({...item,id:f.key+'-'+r.row,rows:[r.row]})):[item];});
  }
  function writePayload(task){return task.records.map(r=>Object.fromEntries(writable.map(k=>[k,r[k]])));}
  function validate(task){
    const records=task.records,ctx=task.context,master=task.master,template=task.template;
    const checks=[];
    function add(id,label,bad,detail,level='error'){checks.push({id,label,status:bad.length?(level==='warning'?'warning':'fail'):'pass',rows:bad,detail});}
    add('scope','单校区、单预算',records.filter(r=>r.school_id!==ctx.schoolId||r.campus_id!==ctx.campusId||r.budget_id!==ctx.budgetId||r.fiscal_year!==ctx.fiscalYear||r.quarter!==ctx.quarter).map(r=>r.row),'每条记录必须属于当前学校、校区、预算与财年季度。');
    add('required','模板必填字段',records.filter(r=>template.fields.some(f=>f.required&&(r[f.key]===null||r[f.key]===undefined||r[f.key]===''))).map(r=>r.row),'必填缺省由负责人补齐后继续，不能自行猜测。');
    add('template','模板与字段范围',records.filter(r=>r.template_id!==template.id||r.quarter!==template.quarter||Object.keys(r).some(k=>!writable.includes(k)&&!['row','source'].includes(k))).map(r=>r.row),'使用当前模板及明确的可写字段。');
    add('enum','科目、期次与时段',records.filter(r=>!template.subjects.includes(r.subject_id)||!template.periods.includes(r.period_id)||!template.slots.includes(r.slot_id)).map(r=>r.row),'取值必须命中模板枚举。');
    add('capacity','班额范围',records.filter(r=>!Number.isInteger(r.capacity)||r.capacity<template.capacity.min||r.capacity>template.capacity.max).map(r=>r.row),'班额为1至24的整数。');
    const seen=new Set(),dup=[];
    for(const r of records){const key=naturalKey(r);if(seen.has(key)||master.existing.some(e=>naturalKey(e)===key))dup.push(r.row);seen.add(key);}
    add('duplicate','班级唯一性',dup,'同校区、同预算下，班级名称不得重复。');
    add('qualification','教师资格与校区',records.filter(r=>!master.teachers.some(t=>t.id===r.teacher_id&&t.campus===ctx.campusId&&t.subjects.includes(r.subject_id)&&t.periods.includes(r.period_id)&&t.slots.includes(r.slot_id))).map(r=>r.row),'只使用班级主数据返回的本校区可授课教师。');
    const occupied=new Set(master.occupied.map(r=>[r.teacher_id,r.period_id,r.slot_id].join('|'))),conflict=[];
    for(const r of records){const key=[r.teacher_id,r.period_id,r.slot_id].join('|');if(occupied.has(key))conflict.push(r.row);occupied.add(key);}
    add('conflict','教师时段冲突',conflict,'同一教师在同一期次、同一时段只能对应一个班。');
    add('periodPreference','前三期优先',records.filter(r=>r.period_id==='第4期').map(r=>r.row),'第四期按排课偏好提示，单独保留在核对记录中。','warning');
    add('nonempty','有效输入记录',records.length?[]:['全部'],'移出越界或重复资料后，任务仍须至少包含一条有效记录。');
    return checks;
  }
  function canWrite(task){return task.submitted&&task.template&&task.master&&task.records.length>0&&task.checks.length>0&&!task.checks.some(x=>x.status==='fail')&&!missingFields(task).length;}
  class CampusSystem {
    constructor(){this.records=new Map();this.requests=new Map();this.seq=0;}
    existing(context){return [...this.records.values()].filter(r=>r.campus_id===context.campusId&&r.budget_id===context.budgetId).map(clone);}
    write(task,key){
      const payload=writePayload(task),hash=JSON.stringify(payload);
      if(this.requests.has(key)){const old=this.requests.get(key);if(old.hash!==hash)throw Error('同一请求对应不同资料，已阻止写入');return {...clone(old.result),reused:true};}
      if(!canWrite(task)||validate(task).some(c=>c.status==='fail'))throw Error('规则校验未通过，写入已阻止');
      const bad=payload.some(r=>[...this.records.values()].some(old=>naturalKey(old)===naturalKey(r)));
      if(bad)throw Error('检测到系统已有同名班级，写入已阻止');
      const saved=payload.map(r=>({...clone(r),record_id:'CLS-'+String(++this.seq).padStart(5,'0')}));
      saved.forEach(r=>this.records.set(r.record_id,r));
      const result={batch_id:'WB-'+task.id,count:saved.length,ids:saved.map(r=>r.record_id),reused:false};
      this.requests.set(key,{hash,result});
      return clone(result);
    }
    read(ids){return ids.map(id=>this.records.get(id)).filter(Boolean).map(clone);}
  }
  function compare(expected,actual,ids){
    const rows=[];
    expected.forEach((r,i)=>{
      const a=actual.find(v=>v.record_id===ids[i]);
      writable.forEach(key=>rows.push({record:ids[i],className:r.class_name,key,field:labels[key],expected:r[key],actual:a?a[key]:null,equal:!!a&&r[key]===a[key]}));
    });
    const unique=new Set();
    for(const a of actual){if(unique.has(a.record_id))rows.push({record:a.record_id,className:a.class_name,key:'duplicate_id',field:'重复系统记录',expected:1,actual:2,equal:false});unique.add(a.record_id);}
    actual.filter(a=>!ids.includes(a.record_id)).forEach(a=>rows.push({record:a.record_id,className:a.class_name,key:'unexpected_record',field:'额外记录',expected:null,actual:a.record_id,equal:false}));
    return {rows,matched:rows.filter(r=>r.equal).length,total:rows.length,differences:rows.filter(r=>!r.equal),consistent:rows.every(r=>r.equal)&&actual.length===expected.length};
  }
  const API={steps,labels,writable,profileLabels,clone,naturalKey,createTask,templateFor,masterFor,mapFields,missingFields,writePayload,validate,canWrite,CampusSystem,compare};
  if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.ClassPrep=API;
})(typeof window!=='undefined'?window:this);
