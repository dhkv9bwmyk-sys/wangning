(function (root) {
  'use strict';
  const I = root.ClassPrepImport, C = root.ClassPrep;
  const scopeKeys = ['school_id','campus_id','fiscal_year','quarter','budget_id'];
  const contextKeys = {school_id:'schoolId',campus_id:'campusId',fiscal_year:'fiscalYear',quarter:'quarter',budget_id:'budgetId'};
  const stages = ['上传识别','字段核对','规则校验与异常处理','确认导入与回读'];
  const states = {input:'待识别',scope:'待核对归属',mapping:'待核对字段',blocked:'待处理异常',checked:'校验通过',ready:'待确认导入',pending:'待回读',matched:'核对一致',difference:'回读有差异',handoff:'待人工核查'};
  const labels = I.labels;
  const editable = ['class_name','subject_id','period_id','slot_id','teacher_id','capacity'];
  const archive = t=>!!t.receipt || t.status==='handoff';
  const setupComplete = t=>t?.status==='matched'&&!!t.receipt&&t.audit?.consistent===true;
  const clock = ()=>new Date().toISOString();
  const uid = prefix=>prefix+'-'+Array.from(crypto.getRandomValues(new Uint8Array(6)),v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
  function log(t,action,details='') { t.events.push({at:clock(),action,details}); }
  function task(chatId, fault='') {
    return {id:uid('CP'),chatId,created:clock(),updated:clock(),version:1,etag:0,stepReview:true,stage:0,status:'input',files:[],serial:0,aliasSerial:0,choices:{},changes:{},omit:[],events:[],fault,checks:[],seal:null,receipt:null,audit:null,reads:0,writes:0};
  }
  function accountOptions(data,key) {
    if(key==='school_id')return [[data.school.id,data.school.name]];
    if(key==='campus_id')return data.campuses.map(c=>[c.id,c.name]);
    if(key==='budget_id')return data.budgets.map(b=>[b.id,b.id]);
    if(key==='quarter')return [['暑假','暑假'],['秋季','秋季']];
    return [[data.fiscalYear,data.fiscalYear]];
  }
  function known(data,key,value) {
    const v=String(value??'').trim();
    if(key==='quarter')return I.canonical('quarter',v);
    return accountOptions(data,key).find(([id,label])=>v===id||v===label)?.[0] || null;
  }
  function display(data,key,value) {return accountOptions(data,key).find(([id])=>id===value)?.[1]||value||'待确认';}
  function rowSource(f,s,n,col) {return f.id+' · '+s.label+'!'+(col===undefined?'行'+n:root.XLSX.utils.encode_col(col)+n);}
  const aliasCache=new Map(), rawSources=new Map();
  function taskMask(task){
    let cache=aliasCache.get(task.id);
    if(!cache){
      cache={values:new Map(),serial:task.aliasSerial||0};
      aliasCache.set(task.id,cache);
    }
    return {alias(key,value){
      const token=key+'|'+value;
      if(!cache.values.has(token)){
        cache.serial=Math.max(cache.serial,task.aliasSerial||0)+1;
        const name=key==='class_name'?'来源班级'+cache.serial:'来源'+(labels[key]||'字段')+'A'+cache.serial;
        cache.values.set(token,name);
      }
      task.aliasSerial=Math.max(task.aliasSerial||0,cache.serial);
      return cache.values.get(token);
    }};
  }
  function protect(t,f) {
    const mask=taskMask(t);
    for(const s of f.sheets) {
      rawSources.set(t.id+'|'+f.id+'|'+s.sourceIndex,s.rows);
      const old=s.analysis,roles=Object.fromEntries(Object.entries(s.map).map(([k,v])=>[v,k]));
      s.rows=s.rows.map((row,r)=>row.map((raw,c)=>{
        if(raw===null||raw===undefined||raw==='')return null;
        const v=String(raw).trim();
        if(I.fieldOf(v))return v;
        if(r===s.header)return old.readback&&Object.values(old.readback).includes(c)?v:I.sourceHeader(v,c);
        if(/^(合计|总计|汇总)$/.test(v))return v;
        if(/^(注|备注|说明)[:：]/.test(v))return '备注：说明';
        if(r<s.header)return '说明文字';
        if(roles[c])return I.safe(v,roles[c],mask);
        if(/^(\d{1,4}|校区\d{2}|教师\d{2}-\d{2}|科目[A-D]|BUD-C\d{2}-(SU|AU)-\d{2}|目标财年|机构[A-Z]|暑期|暑假|秋季)$/.test(v))return v;
        if(/^[0-9]{1,4}(?:人\/班|人每班|人)$/.test(v)||['period_id','slot_id','quarter','subject_id'].some(k=>I.canonical(k,v)!==null))return v;
        return mask.alias('field',v);
      }));
      s.analysis=I.analyze(s,s.header);
      s.map={...old.map};
    }
    return f;
  }
  function release(id){aliasCache.delete(id);for(const k of rawSources.keys())if(k.startsWith(id+'|'))rawSources.delete(k);}
  function remap(t,f,s,key,col){
    if(col===''){delete s.map[key];return;}
    const c=Number(col);s.map[key]=c;
    const original=rawSources.get(t.id+'|'+f.id+'|'+s.sourceIndex);
    if(original){
      const mask=taskMask(t);
      for(const r of s.analysis.rows){const v=original[r.number-1]?.[c];s.rows[r.number-1][c]=v==null?null:I.safe(v,key,mask);}
    }
    s.analysis=I.analyze(s,s.header,s.role);
  }
  function addParsedFile(t,parsed,displayName) {
    if(archive(t))throw Error('此任务已提交，请新增任务。');
    if(t.files.length>=10)throw Error('一个任务合计最多 10 份资料。');
    if(I.onlyReadback(parsed))throw Error('这份资料是回读核对表。请添加班级明细用于设班。');
    const file={...parsed,id:'F'+String(++t.serial).padStart(2,'0'),sheets:parsed.sheets.map(sheet=>({...sheet}))};
    delete file.paragraphs;
    protect(t,file);
    if(displayName)file.name=displayName;
    t.files.push(file);
    invalidate(t,0);
    log(t,'读取资料',file.name+' · '+(file.extension==='docx'?file.paragraphCount+' 段正文':file.sheets.length+' 张工作表'));
    return file;
  }
  function addFile(t,bytes,name,displayName) {
    return addParsedFile(t,I.read(bytes,name,t.serial+1),displayName);
  }
  function invalidate(t,stage=1) {
    if(archive(t))throw Error('已导入的资料只能查看。');
    t.version++;t.stage=Math.min(t.stage,stage);t.seal=null;t.checks=[];t.status=t.stage===0?(t.files.length?'scope':'input'):'mapping';
  }
  function restoreReview(t) {
    if(t.stepReview||archive(t))return t;
    t.stepReview=true;
    if(t.stage>0){
      invalidate(t,0);
      log(t,'待重新核对资料与归属','请按当前步骤确认后继续');
    }
    return t;
  }
  function scope(t,data) {
    const fields={},rows=[],omitted=new Set(t.omit);
    const links=I.linkSources(t.files,omitted);
    const usedAreas=new Set([...links.byRow.values()].map(link=>link.area?.id));
    for(const key of scopeKeys)fields[key]={key,seen:new Map(),value:'',source:'',issue:'',options:accountOptions(data,key)};
    for(const f of t.files)for(const s of f.sheets.filter(x=>x.role!=='ignore'&&!x.analysis.readback)){
      for(const r of s.analysis.rows){
        const id=I.rowKey(f,s,r.number),row={id,source:rowSource(f,s,r.number),include:!omitted.has(id),values:{}};
        const scopeEvidence=s.role!=='teachers'&&(s.role!=='areas'||usedAreas.has(id));
        for(const key of scopeKeys){
          const col=s.map[key],raw=String(r.values[col]??'').trim();if(!raw)continue;
          const value=known(data,key,raw);
          const legacyAlias=!archive(t)&&/^来源(?:校区|学校|预算编号)[A-Z]$/.test(raw);
          const token=value||(legacyAlias?raw+'|'+f.id+'|'+s.sourceIndex:raw);
          row.values[key]=display(data,key,value||raw);
          if(row.include&&scopeEvidence&&!fields[key].seen.has(token))fields[key].seen.set(token,{raw,value,source:rowSource(f,s,r.number,col)});
        }
        rows.push(row);
      }
    }
    for(const field of Object.values(fields)){
      const items=[...field.seen.values()];
      field.signature=JSON.stringify([...field.seen.keys()].sort());
      const pick=t.choices[field.key];
      if(items.length>1){field.issue='多种取值';continue;}
      if(pick&&pick.signature===field.signature&&field.options.some(([id])=>id===pick.value)){
        field.value=pick.value;field.source='教务确认'+(items[0]?' · '+items[0].source:'');continue;
      }
      if(items.length===1&&items[0].value){field.value=items[0].value;field.source=items[0].source;continue;}
      if(!items.length&&field.key==='school_id'){field.value=data.school.id;field.source='当前账号所属学校';continue;}
      field.issue=items.length?'待关联':'待确认';
    }
    const budget=data.budgets.find(b=>b.id===fields.budget_id.value);
    for(const [key,prop] of [['school_id','school'],['campus_id','campus'],['quarter','quarter'],['fiscal_year','year']]){
      const x=fields[key];
      if(!budget)continue;
      if(!x.value&&!x.seen.size){x.value=budget[prop];x.source='预算主数据 · '+budget.id;x.issue='';}
      else if(x.value&&x.value!==budget[prop]){x.issue='与预算归属不符';fields.budget_id.issue='与资料归属不符';}
    }
    fields.budget_id.options=data.budgets.filter(b=>[['school_id','school'],['campus_id','campus'],['quarter','quarter'],['fiscal_year','year']].every(([k,p])=>!fields[k].value||fields[k].value===b[p])).map(b=>[b.id,b.id]);
    const context={taskId:t.id,evidence:{}},bindings={};
    for(const x of Object.values(fields)){
      context[contextKeys[x.key]]=x.value;
      if(x.value&&!x.issue)context.evidence[x.key]=x.source;
      if(x.value&&x.seen.size===1){const v=[...x.seen.values()][0];if(!v.value||v.value!==x.value)bindings[x.key+'|'+v.raw]=x.value;}
    }
    context.school=display(data,'school_id',context.schoolId);context.campus=display(data,'campus_id',context.campusId);
    return {fields,rows,context,bindings,links,ready:Object.values(fields).every(x=>x.value&&!x.issue)};
  }
  function selectScope(t,data,key,value) {
    if(archive(t))throw Error('已导入的资料只能查看。');
    const field=scope(t,data).fields[key];
    if(!field||!field.options.some(([id])=>id===value)||field.seen.size>1)throw Error('请在可用的任务归属中选择。');
    t.choices[key]={value,signature:field.signature};invalidate(t,0);log(t,'补充归属信息',labels[key]+' · '+display(data,key,value));
  }
  function model(t,data,system={rows:[]},{checkRules=true}={}) {
    const sk=scope(t,data),r=I.compile(t.files,sk.context,data,sk.bindings,I.privacy(),new Set(t.omit),t.budgetFixes||{},sk.links);
    const template=sk.context.quarter?C.templateFor(sk.context.quarter):null;
    const work={id:t.id,context:sk.context,input:r.records,template,submitted:true};
    const records=template?C.mapFields(work):[];
    for(const rec of records)Object.assign(rec,t.changes[rec.row]||{});
    work.records=records;
    const restored=system.rows||[];
    if(sk.ready&&template){
      work.master=C.masterFor(work);
      work.master.existing=restored.filter(row=>row.campus_id===sk.context.campusId&&row.budget_id===sk.context.budgetId);
      work.master.occupied.push(...restored.filter(row=>row.school_id===sk.context.schoolId&&row.fiscal_year===sk.context.fiscalYear&&row.quarter===sk.context.quarter));
    }
    const mappingIssues=[];
    for(const f of t.files)for(const s of f.sheets.filter(x=>x.role!=='ignore')){
      const seen=new Map();
      for(const [key,col] of Object.entries(s.map)){if(seen.has(col))mappingIssues.push(f.id+' · '+s.label+' '+root.XLSX.utils.encode_col(col)+'列同时对应'+labels[seen.get(col)]+'和'+labels[key]);seen.set(col,key);}
    }
    const checks=[];
    if(checkRules){
      if(work.master)checks.push(...C.validate(work));
      if(!sk.ready)checks.unshift({id:'sources',label:'任务归属依据',status:'fail',rows:[],detail:'先补齐或拆分资料中的学校、校区、财季及预算。'});
      for(const issue of [...mappingIssues,...r.recognition.budgetConflicts.map(x=>x.reason),...r.recognition.scopeConflicts.map(x=>x.reason)]){
        checks.push({id:'input',label:'来源一致性',status:'fail',rows:[],detail:issue});
      }
      for(const issue of r.recognition.budgetIssues)checks.push({id:'budgetRows',label:'招生预算明细',status:'fail',rows:[issue.row],detail:issue.detail});
      for(const issue of r.recognition.mergeIssues){
        checks.push({id:'sourceMatch',label:'跨表匹配',status:'fail',rows:issue.sources.map(item=>item.id),detail:issue.detail});
      }
    }
    work.checks=checks;
    return {sk,r,work,records,template,checks,mappingIssues,valid:sk.ready&&!!work.master&&C.canWrite(work)};
  }
  function go(t,data,system,step) {
    if(archive(t))throw Error('此任务已提交。');
    restoreReview(t);
    const retry=step===2&&t.stage===2&&t.status==='blocked';
    if(!Number.isInteger(step)||step<1||step>3||step!==t.stage+1&&!retry)throw Error('请按顺序确认当前步骤。');
    if(step===3&&t.status!=='checked')throw Error('请先处理写前校验的阻断项。');
    const m=model(t,data,system,{checkRules:step>1});
    if(!t.files.length||!m.r.records.length)throw Error('请上传至少含一条班级资料的工作表，并核对工作表用途。');
    if(!m.sk.ready)throw Error('请先确认任务归属。多校区或多预算资料可按来源拆分。');
    if(step===1){t.stage=1;t.status='mapping';log(t,'确认资料与归属',m.sk.context.campus+' · '+m.sk.context.budgetId);return;}
    if(step===2&&!retry)log(t,'确认班级字段',m.records.length+' 条班级');
    t.checks=m.checks;
    if(step===2||!m.valid){
      t.stage=2;t.status=m.valid?'checked':'blocked';t.seal=null;
      log(t,'执行写前规则校验',m.valid?'通过':m.checks.filter(x=>x.status==='fail').map(x=>x.label).join('、'));
      return;
    }
    t.stage=3;t.status='ready';
    t.seal={version:t.version,context:m.sk.context,rows:C.writePayload(m.work),rowIds:m.records.map(r=>r.row),at:clock()};
    log(t,'生成待导入清单',t.seal.rows.length+' 条班级');
  }
  function correct(t,data,rows,key,value){
    if(archive(t))throw Error('已导入的资料只能查看。');
    if(!editable.includes(key)||!rows.length)throw Error('请选择要修改的班级和字段。');
    const m=model(t,data,undefined,{checkRules:false});
    if(!rows.every(id=>m.records.some(r=>r.row===id)))throw Error('所选记录已变化，请重新选择。');
    if(key==='capacity'){if(!/^\d+$/.test(String(value))||Number(value)<1||Number(value)>24)throw Error('班额须为 1 至 24 的整数。');value=Number(value);}
    if(key==='class_name'&&!String(value).trim())throw Error('请输入班级名称。');
    if(key==='class_name'&&!/^(?:入口科目[A-D]\d+班|(?:来源)?班级\d+)$/.test(value))value=I.safe(value,key,{alias:()=> '来源班级'+(++t.aliasSerial)});
    for(const id of rows)(t.changes[id]||={})[key]=value;
    invalidate(t,1);log(t,'修正字段',rows.length+' 条 · '+labels[key]+' → '+value);
  }
  function restoreSystem(data){const s=new C.CampusSystem();s.seq=data.seq||0;s.records=new Map((data.rows||[]).map(x=>[x.record_id,x]));s.requests=new Map(data.requests||[]);return s;}
  function readReceipt(t,system){return restoreSystem(system).read(t.receipt.ids);}
  function write(t,data,system,version){
    if(t.receipt)return;
    if(!t.stepReview||t.stage!==3||!t.seal||t.seal.version!==t.version||version!==t.seal.version||t.status!=='ready')throw Error('请重新查看并确认当前版本的导入清单。');
    const m=model(t,data,system);
    if(!m.valid||JSON.stringify(C.writePayload(m.work))!==JSON.stringify(t.seal.rows)){
      t.stage=2;t.status='blocked';t.checks=m.checks;t.seal=null;log(t,'导入前复核','资料或系统占用已变化，请重新校验');return;
    }
    const client=restoreSystem(system),key=t.id+':'+version;
    for(let attempt=1;attempt<=3;attempt++){
      t.writes++;
      try{
        if(t.fault==='escalate')throw Error('写入接口暂时不可用');
        const result=client.write(m.work,key);
        if(t.fault==='retry'&&attempt===1)throw Error('写入响应超时');
        t.receipt=result;break;
      }catch(e){log(t,'写入重试',e.message);if(attempt===3){t.status='handoff';log(t,'转人工核查',key);return;}}
    }
    system.seq=client.seq;system.rows=[...client.records.values()];system.requests=[...client.requests.entries()];
    release(t.id);t.status='pending';log(t,'教务确认导入',t.receipt.count+' 条 · '+t.receipt.batch_id);
  }
  function readback(t,system){
    if(!t.receipt||!t.seal)throw Error('尚未导入。');
    t.reads++;
    if(t.fault==='timeout'&&t.reads===1){t.status='pending';log(t,'回读待重试','查询超时，保留写入回执');return;}
    const actual=readReceipt(t,system);
    if(t.fault==='mismatch'&&t.reads===1&&actual.length)actual[0].capacity=actual[0].capacity===18?17:18;
    t.audit=C.compare(t.seal.rows,actual,t.receipt.ids);
    t.status=t.audit.consistent?'matched':'difference';
    log(t,'回读核对',t.audit.matched+' / '+t.audit.total+' 个字段一致');
  }
  root.PrepDesk={remap,task,scope,selectScope,display,scopeKeys,contextKeys,model,go,restoreReview,invalidate,correct,addFile,addParsedFile,release,write,readback,readReceipt,log,uid,archive,setupComplete,clock,states,stages,editable};
})(window);
