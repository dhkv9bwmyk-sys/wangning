(function(root){
  'use strict';
  const S=root.DeskState,D=root.PrepDesk,I=root.ClassPrepImport,C=root.ClassPrep;
  const {esc,btn,attr,badge,status,time,file,assetLink,sampleWorkbook,panel,table,tr,workspaceContent,icon,systemForTask,setupPage,activeSetup,chat}=root.DeskUI;
  const opt=(v,label,given)=>`<option value="${esc(v)}" ${String(v)===String(given)?'selected':''}>${esc(label)}</option>`;
  const select=(key,items,value,extra)=>`<select aria-label="${esc(key)}" ${extra}>${items.map(x=>opt(x[0],x[1],value)).join('')}</select>`;
  function uploadPanel(target=''){
    panel('upload','补充本次资料',target,
      `<div class="drop" data-drop="wizard"><p class="hint">拖入文件，或从本机选择。Excel、CSV、Word 合计最多 10 份，每份上限 10 MB。</p>${file('选择附件','wizard')}</div>`,
      '',{narrow:true,key:target,target});
  }
  function templates(){
    panel('templates','设班模板','',
      `<div class="surface"><h3>空白模板</h3><p class="hint">按班级资料、招生预算两张表填写。</p>${assetLink('下载空白模板','设班资料标准模板.xlsx')}</div>
        <div class="surface"><h3>填写示例</h3><p class="hint">含暑期班级明细和招生预算，可以直接用于设班整理。</p>${assetLink('下载示例资料',sampleWorkbook)}</div>`,
      '',{narrow:true});
  }
  function uploadStart(){
    return `<section class="drop setup-upload" data-drop="setup">
      <p>选择本次班级明细，可一并上传教师安排、教学区和招生预算资料。</p>
      <div class="actions wrap">
        ${file('上传设班资料','setup','primary')}
        ${btn('载入示例资料','load-setup-sample','','outline')}
      </div>
      <p class="hint">Excel、CSV、Word（.docx） · 最多 10 份 · 单份上限 10 MB</p>
    </section>`;
  }
  function uploadProgress(job){
    return `<p class="run-busy" role="status"><span class="pulse" aria-hidden="true"></span>${esc(typeof job==='string'?job:'正在识别本次资料…')}</p>`;
  }
  function supplement(locked){
    if(locked)return '';
    return setupPage()?file('补充资料','setup'):btn('补充资料','add-files','','outline small');
  }
  function paginate(key,all,render,head,cls='wide',size=18){
    const p=Math.min(S.pages[key]||0,Math.max(0,Math.ceil(all.length/size)-1)),first=p*size;
    const nav=(n,label)=>btn(label,'page',attr('key',key)+' '+attr('n',n),'outline small');
    return table(head,all.slice(first,first+size).map(render),cls)+(all.length>size?`<div class="pager">${first?nav(p-1,'上一页'):''}<span>${first+1}–${Math.min(first+size,all.length)} / ${all.length}</span>${first+size<all.length?nav(p+1,'下一页'):''}</div>`:'');
  }
  function namedSource(t,source){
    const parts=source?.match(/^(F\d+) · (.+)$/);
    const file=parts&&t.files.find(f=>f.id===parts[1]);
    return file?file.name+' · '+parts[2]:source||'—';
  }
  const detailText=(value,note)=>esc(value)+(note?`<small class="meta">${esc(note)}</small>`:'');
  function sourced(t,m,locked){
    const fields=Object.values(m.sk.fields);
    function choice(x){
      const items=[['','请选择'],...x.options];
      return select(I.labels[x.key],items,x.value,attr('scope',x.key));
    }
    function proof(x){
      return x.source?namedSource(t,x.source):[...x.seen.values()].slice(0,3).map(v=>v.raw+' · '+namedSource(t,v.source)).join(' / ')||'资料中缺少该字段';
    }
    const pending=fields.filter(x=>x.issue);
    const confirmed=fields.filter(x=>!x.issue);
    const ask=pending.length?`<div class="alert">
      <div class="line-title"><strong>请核对${pending.map(x=>I.labels[x.key]).join('、')}</strong></div>
      <div class="grid">${pending.map(x=>`<label class="field"><span>${I.labels[x.key]}</span>${!locked&&x.seen.size<=1?choice(x):`<strong>${esc(x.issue)}</strong>`}<small>${esc(proof(x))}</small></label>`).join('')}</div>
    </div>`:'';
    const evidence=confirmed.length?`<div class="scope-list">${confirmed.map(x=>`<div class="scope-row"><span>${I.labels[x.key]}</span><strong>${esc(D.display(S.data,x.key,x.value))}</strong><small>${esc(proof(x))}</small></div>`).join('')}</div>`:'';
    const correct=locked||!confirmed.length?'':`<details><summary>修正已识别的归属</summary><div class="grid">${confirmed.map(x=>`<label class="field"><span>${I.labels[x.key]}</span>${choice(x)}</label>`).join('')}</div></details>`;
    return ask+evidence+correct;
  }
  function sheetOptions(t,f,s,locked){
    const fieldList=I.roleFields[s.role]||[];
    const sourceCols=[['','未关联'],...s.analysis.headers.map((h,i)=>[i,root.XLSX.utils.encode_col(i)+' · '+I.sourceHeader(h,i)])];
    return `<details><summary>调整来源列与系统字段</summary><div class="grid">${fieldList.map(k=>`<label class="field"><span>${I.labels[k]}</span>${select(I.labels[k]+'的来源列',sourceCols,s.map[k]??'',attr('map',k)+' '+attr('file',f.id)+' '+attr('sheet',s.sourceIndex)+(locked?' disabled':''))}</label>`).join('')}</div></details>`;
  }
  function documents(t,m,locked){
    return t.files.map(f=>{
      if(f.extension==='docx')return `<div class="surface"><div class="line-title"><h4>${esc(f.name)}</h4>${!locked?btn('移除','remove-file',attr('file',f.id),'outline small'):''}</div><p class="hint">Word 正文 · ${f.paragraphCount} 段</p>${f.ruleCandidates.map(x=>'<p class="meta">'+esc(x.position+' · '+x.topic+' · '+x.value)+'</p>').join('')}</div>`;
      const s=f.sheets[f.selected]||f.sheets[0];if(!s)return '';
      const source=f.id+' · '+s.label;
      const usage=I.roleNames;
      const readback=!!s.analysis.readback, readOnly=locked||readback;
      return `<div class="surface"><div class="line-title"><h4>${esc(f.name)}</h4><div class="inline">${badge(f.sheets.length+' 张工作表')}${!locked?btn('移除','remove-file',attr('file',f.id),'outline small'):''}</div></div><div class="grid">
      <label class="field"><span>查看工作表</span>${select('查看工作表',f.sheets.map((sheet,i)=>[i,sheet.label+' · '+(sheet.analysis.readback?'回读核对表':usage[sheet.role])]),f.selected,attr('show-sheet',f.id))}</label>
      <label class="field"><span>本表用途</span>${select('本表用途',Object.entries(usage).map(([key,label])=>[key,key==='ignore'?(readback?'回读核对表 · 已跳过':'跳过此工作表'):label]),s.role,attr('role',f.id)+(readOnly?' disabled':''))}</label>
      <label class="field"><span>表头所在行</span>${select('表头所在行',s.rows.slice(0,25).map((_,i)=>[i,'第 '+(i+1)+' 行']),s.header,attr('header',f.id)+(readOnly?' disabled':''))}</label></div><p class="meta" style="margin-top:7px">${esc(source)} · ${s.analysis.rows.length} 行资料 · ${s.merges} 处合并单元格</p>
      <details><summary>查看原表前几行</summary>${table(['行号',...s.analysis.headers.map((_,i)=>root.XLSX.utils.encode_col(i))],s.rows.slice(Math.max(0,s.header-1),s.header+4).map((r,i)=>tr([esc(Math.max(0,s.header-1)+i+1),...r.map(esc)])),'compact')}</details>${s.role!=='ignore'?sheetOptions(t,f,s,locked):''}
      ${s.formulaMissing.length?'<div class="alert">公式没有已保存的结果，请核对 '+esc(s.formulaMissing.slice(0,8).join('、'))+'。</div>':''}</div>`;
    }).join('');
  }
  function scopeRows(t,m,locked){
    const matches=Object.values(m.sk.fields).some(x=>x.seen.size>1);
    return `<details ${matches?'open':''}><summary>按来源选择纳入的行（${m.sk.rows.length}）</summary>${paginate('scopeRows',m.sk.rows,r=>tr([`<input type="checkbox" aria-label="纳入 ${esc(r.source)}" ${attr('include',r.id)} ${r.include?'checked':''} ${locked?'disabled':''}>`,esc(namedSource(t,r.source)),esc(r.values.campus_id||'—'),esc(r.values.budget_id||'—')]),['纳入','来源','校区','预算编号'])}</details>`;
  }
  function sourceTables(t,m){
    const tables=m.r.recognition.tables;
    const files=new Map(t.files.map(file=>[file.id,file]));
    const total=new Set(tables.map(item=>item.file)).size;
    if(total<2)return '';
    const body=table(['文件和工作表','用途','纳入核对','跳过'],tables.map(item=>{
      const file=files.get(item.file), sheet=file.sheets.find(value=>value.label===item.sheet);
      const skipped=sheet.analysis.ignored.slice(0,2).map(row=>{
        const text=String(sheet.rows[row-1].find(cell=>String(cell??'').trim())??'');
        const reason=/^(合计|总计|汇总)$/.test(text)?text:text?'说明':'空行';
        return '第 '+row+' 行 '+reason;
      });
      return tr([esc(file.name+' · '+item.sheet),esc(I.roleNames[item.role]),esc(item.accepted+' 行'),
        detailText(item.rowCount+item.ignoredRows-item.accepted+' 行',skipped.join(' · '))]);
    }),'merged-grid');
    return `<details><summary>查看 ${total} 份来源与纳入情况</summary>${body}</details>`;
  }
  function input(t,m,locked){
    const count=m.r.records.length;
    const empty=count?'':'<p class="alert">请纳入一张含班级明细的工作表，或补充本次班级资料。</p>';
    const ownership=t.stage>0?'归属已确认':m.sk.ready?'待确认归属':'有待补齐项';
    return `<div class="line-title"><h3>任务归属</h3><div class="actions wrap">${badge(ownership,t.stage>0?'':'warm')}${supplement(locked)}</div></div>${sourced(t,m,locked)}${scopeRows(t,m,locked)}${sourceTables(t,m)}
      <div class="line-title subtitle"><h3>已识别 ${count} 条班级</h3></div>
      ${empty}${t.files.length?`<details ${count?'':'open'}><summary>查看原表与调整识别结果</summary>${documents(t,m,locked)}</details>`:''}`;
  }
  function recordGrid(t,m,locked,onlyBad=false){
    const bad=new Set((t.checks||[]).flatMap(x=>x.status==='fail'?x.rows:[])),records=onlyBad?m.records.filter(r=>bad.has(r.row)):m.records;
    return paginate(onlyBad?'badRows':'records',records,r=>tr([esc(r.class_name||'待补班名'),esc(r.subject_id||'待补'),esc(r.period_id||'待补'),esc(r.slot_id||'待补'),esc(r.teacher_id||'待补'),esc(r.capacity??'待补'),esc(r.source),locked?'—':btn('修正','edit-row',attr('row',r.row),'outline small')]),['班级','科目','期次','时段','教师','班额','来源','操作']);
  }
  function mapping(t,m,locked){
    const key=S.fieldFilter||'',rows=m.r.recognition.conversions.filter(x=>!key||x.field===key);
    const example=m.r.recognition.conversions.find(x=>x.field==='capacity'&&x.raw&&x.value!==null);
    const sample=example?`<div class="note conversion-preview"><strong>${esc(example.sourceField||example.label)} ${esc(example.raw)}</strong>${icon('arrow')}<strong>${esc(example.label)} ${esc(t.changes[example.row]?.[example.field]??example.value)}</strong><small>${esc(example.source)} · ${esc(Object.hasOwn(t.changes[example.row]||{},example.field)?'教务修正':example.rule)}</small></div>`:'';
    const audit=paginate('conversions',rows,x=>{
      const changed=Object.hasOwn(t.changes[x.row]||{},x.field), converted=changed?t.changes[x.row][x.field]:x.value;
      return tr([esc(namedSource(t,x.source)),`<span>${esc(x.sourceField||'—')}</span>${esc(x.raw||'—')}`,`<span>${esc(x.label)}</span><b>${esc(converted??'待补')}</b>`,esc(changed?'教务修正':x.rule)]);
    },['来源','原字段与值','系统字段与值','依据'],'mapping-table',12);
    return `<div class="line-title"><h3>字段转换</h3><div class="actions wrap">${badge(m.template?'模板 v'+m.template.version:'模板待确认')}${supplement(locked)}</div></div>${sample}
    <label class="field field-select">筛选系统字段 ${select('筛选系统字段',[['','全部字段'],...Object.entries(C.labels).filter(([k])=>k!=='template_id')],key,'data-filter-fields')}</label>
    ${audit}${m.mappingIssues.length?'<div class="alert">'+esc(m.mappingIssues.join(' / '))+'</div>':''}
    <div class="line-title subtitle"><h3>班级清单</h3>${badge(m.records.length+' 条')}</div>${recordGrid(t,m,locked)}
    <details><summary>查看并调整表头映射</summary>${documents(t,m,locked)}</details>
    ${m.r.demand.length?`<details><summary>招生预算 · ${m.r.demand.length} 条科目目标</summary>${table(['科目','目标人次','预算班均','预计班数','来源'],m.r.demand.map(x=>tr([x.subject,x.target,x.capacity,x.classes,x.source].map(esc))))}</details>`:''}`;
  }
  function budgetEditor(t,m,locked){
    const rows=m.r.recognition.budgetRows;
    if(!rows.length)return '';
    return '<h3 class="subtitle">已纳入的预算明细</h3>'+paginate('budgetRows',rows,r=>tr([esc(r.source),esc(r.subject||'待补'),esc(r.target??'待补'),esc(r.capacity??'待补'),esc(r.issues.join('、')||'已识别'),locked?'—':btn('修正','edit-budget',attr('row',r.row),'outline small')]),['来源','科目','目标人次','预算班均','待核对','操作']);
  }
  function editBudget(t,row){
    const r=D.model(t,S.data,systemForTask(t),{checkRules:false}).r.recognition.budgetRows.find(x=>x.row===row);if(!r||D.archive(t))return;
    const form='<form id="budget-form" '+attr('row',row)+'><div class="grid"><label class="field"><span>科目</span>'+select('科目',[['','请选择'],...['科目A','科目B','科目C','科目D'].map(v=>[v,v])],r.subject,'name="subject_id" required')+'</label><label class="field"><span>目标人次</span><input type="number" min="0" step="any" name="target_students" required value="'+esc(r.target??'')+'"></label><label class="field"><span>预算班均</span><input type="number" min="1" step="1" name="capacity" required value="'+esc(r.capacity??'')+'"></label></div></form>';
    panel('edit-budget','修正预算明细',r.source,form,btn('返回','task',attr('id',t.id))+'<button type="submit" form="budget-form" class="btn primary">保存修正</button>',{id:t.id,key:t.id,narrow:true});
  }
  function verify(t,m,locked){
    const checks=t.checks||[];
    const pending=checks.filter(rule=>rule.status!=='pass');
    const passed=checks.filter(rule=>rule.status==='pass');
    const blocking=pending.filter(rule=>rule.status==='fail');
    const warnings=pending.filter(rule=>rule.status==='warning');
    const records=new Map(m.records.map(record=>[record.row,record]));
    const scopeRows=new Map(m.sk.rows.map(row=>[row.id,row.source]));
    function result(rule){
      const rows=(rule.rows||[]).slice(0,6).map(id=>{
        const record=records.get(id);
        if(!record)return namedSource(t,scopeRows.get(id)||id);
        const missing=rule.id==='required'?m.template.fields.filter(f=>f.required&&(record[f.key]==null||record[f.key]==='')).map(f=>f.label):[];
        return [record.class_name||'班级记录',missing.length?'缺少'+missing.join('、'):'',namedSource(t,record.source)].filter(Boolean).join(' · ');
      });
      const color=rule.status==='fail'?'red':rule.status==='warning'?'warm':'';
      const label=rule.status==='fail'?'阻断':rule.status==='warning'?'提醒':'通过';
      return `<div class="rule">${badge(label,color)}<b>${esc(rule.label)}</b><p class="meta">${esc(rule.detail)}</p>
        ${rows.length?`<ul class="rule-sources">${rows.map(row=>'<li>'+esc(row)+'</li>').join('')}</ul>`:''}</div>`;
    }
    const summary=`<div class="line-title"><h3>写前规则校验</h3>${supplement(locked)}</div>
      <div class="actions wrap">${badge(blocking.length+' 项阻断',blocking.length?'red':'')}
        ${badge(warnings.length+' 项提醒',warnings.length?'warm':'')}${badge(passed.length+' 项通过')}</div>`;
    const issues=pending.length?`<div class="surface rule-results">${pending.map(result).join('')}</div>`:'';
    const details=passed.length?`<details><summary>查看 ${passed.length} 项通过的规则</summary><div class="surface">${passed.map(result).join('')}</div></details>`:'';
    const fix=blocking.length&&m.records.length?'<h3 class="subtitle">需要处理的班级</h3>'+recordGrid(t,m,locked,true):'';
    return summary+issues+details+fix+'<details><summary>查看全部班级</summary>'+recordGrid(t,m,locked)+'</details>';
  }
  function mergedGrid(t,m){
    const {rows,rowIds}=t.seal;
    const counts=new Map(), budgets=new Map(m.r.demand.map(item=>[item.subject,item.classes]));
    for(const r of rows)counts.set(r.subject_id,(counts.get(r.subject_id)||0)+1);
    return paginate('mergedClasses',rows.map((r,i)=>({...r,row:rowIds[i]})),r=>{
      const area=m.r.recognition.links.get(r.row)?.areaId;
      const campus=D.display(S.data,'campus_id',r.campus_id);
      const planned=budgets.get(r.subject_id);
      const plan=planned===undefined?'':'预算 '+planned+' 班 · 清单 '+counts.get(r.subject_id)+' 班';
      return tr([
        detailText(r.class_name,r.period_id+' · '+r.slot_id),detailText(area||campus,area?campus:''),
        esc(r.teacher_id),esc(r.capacity),detailText(r.budget_id,plan),
        btn('核对来源','merge-source',attr('row',r.row),'outline small')
      ]);
    },['班级','教学区 / 校区','教师','班额','预算','来源'],'merged-grid');
  }
  function mergeSource(t,id){
    const m=D.model(t,S.data,systemForTask(t),{checkRules:false}),r=m.records.find(record=>record.row===id);
    if(!r)return;
    const link=m.r.recognition.links.get(id);
    const fields=new Map(m.r.recognition.conversions.filter(item=>item.row===id).map(item=>[item.field,item]));
    const budget=m.r.demand.find(item=>item.subject===r.subject_id);
    const ref=(label,value,source,note)=>tr([esc(label),detailText(value,note),esc(namedSource(t,source))]);
    const field=(key,label,value,note)=>{
      const cell=fields.get(key);
      const edited=Object.hasOwn(t.changes[id]||{},key);
      return ref(label,value,cell?.source,edited?'教务修正 · 原值 '+(cell?.raw||'空'):note);
    };
    const campus=D.display(S.data,'campus_id',r.campus_id);
    const body=[
      field('capacity','班级明细',r.capacity+' 人/班','原计划班额 '+(fields.get('capacity')?.raw||'—')),
      field('teacher_id','教师编号',r.teacher_id,link?.teacher?'按班级标识匹配':''),
      field('campus_id','教学区与校区',campus,link?.areaId?'来源教学区 '+link.areaId:''),
      field('budget_id','预算编号',r.budget_id,'核对校区与财年季度')
    ];
    if(budget)body.push(ref('科目预算',r.subject_id+' · 预算 '+budget.classes+' 班',budget.source,
      '目标 '+budget.target+' 人次 · 预算班均 '+budget.capacity+' 人'));
    panel('merge-source','核对班级来源',r.class_name,table(['核对项','整理结果','文件和位置'],body,'merged-grid'));
  }
  function finalStep(t,m){
    if(!t.seal)return '<div class="empty">完成字段核对和写前规则校验后，可查看导入清单。</div>';
    const s=t.seal,ctx=s.context,a=t.audit;
    const title=D.setupComplete(t)?'资料准备完成':t.receipt?'导入回执':'待确认导入清单';
    let body=`<div class="surface"><div class="line-title"><h3>${title}</h3>${status(t)}</div><div class="scope-grid">${[['校区',ctx.campus],['预算编号',ctx.budgetId],['班级数量',s.rows.length+' 条'],['财年季度',ctx.fiscalYear+' · '+ctx.quarter]].map(([k,v])=>`<div class="field"><small>${k}</small><strong>${esc(v)}</strong></div>`).join('')}</div></div>`;
    if(t.receipt)body+=`<p class="note">已保存 ${t.receipt.count} 条待设班资料 · 批次 ${esc(t.receipt.batch_id)}。${t.status==='pending'?'等待按记录编号重新查询。':''}</p>`;
    else if(t.status==='handoff')body+='<div class="alert">写入服务连续失败，已记录请求编号和三次处理记录，请交由负责人核查。</div>';
    else {
      const warning=t.checks.filter(x=>x.status==='warning').length;
      body+=`<div class="note inline wrap">${icon('check')}<strong>写前校验已通过</strong><span>${warning?warning+' 项提醒':'0 项阻断'}</span>${btn('查看字段转换','step',attr('n',1),'outline small')}${btn('查看规则结果','step',attr('n',2),'outline small')}</div>`;
    }
    if(a){
      body+=`<div class="line-title subtitle"><h3>回读核对表</h3>${badge(a.matched+' / '+a.total+' 个字段一致',a.consistent?'':'red')}</div><div class="actions wrap">${btn(S.diffOnly?'查看全部字段':'仅看差异 '+a.differences.length,'diff','','outline small')}${btn('下载核对表 CSV','export-audit','','soft small')}</div>${paginate('audit',S.diffOnly?a.differences:a.rows,r=>tr([esc(r.record),esc(r.className),esc(r.field),esc(r.expected??'—'),esc(r.actual??'未读到'),badge(r.equal?'一致':'差异',r.equal?'':'red')]),['系统记录','班级','字段','提交值','回读值','核对'])}`;
    }
    const sources=sourceTables(t,m);
    const summary=sources?mergedGrid(t,m):table(['班级','科目','期次','时段','教师','班额'],s.rows.map(r=>tr([r.class_name,r.subject_id,r.period_id,r.slot_id,r.teacher_id,r.capacity].map(esc))),'wide');
    body+=a?'<details><summary>查看已确认的导入清单</summary>'+summary+sources+'</details>':
      '<h3 class="subtitle">'+(sources?'合并后的班级清单':'班级清单')+'</h3>'+summary+sources;
    return body;
  }
  function events(t){return `<details><summary>任务处理记录（${t.events.length}）</summary><ol class="timeline">${t.events.map(e=>`<li class="event"><time>${time(e.at)}</time><b>${esc(e.action)}</b>　${esc(e.details)}</li>`).join('')}</ol>${btn('导出任务记录','export-task','','outline small')}</details>`;}
  function stepTabs(current,stage,busy=false){
    return ['资料识别','字段核对','规则校验','导入回读'].map((label,index)=>`<button class="${index===current?'current':index<stage?'done':''}" aria-label="${esc(D.stages[index])}" ${index===current?'aria-current="step"':''} data-act="step" ${attr('n',index)} ${busy||index>stage?'disabled':''}>${label}</button>`).join('');
  }
  function renderSetup(){
    const owner=chat(), task=activeSetup(owner);
    if(task){
      taskView(task.id,S.pane?.id===task.id?S.viewStep:task.stage);
      return;
    }
    S.pane=null;S.workspaceOpen=true;S.viewStep=0;
    const progress=S.jobs.get(owner.id);
    workspaceContent('新建设班任务','',stepTabs(0,0,!!progress),progress?uploadProgress(progress):uploadStart(),'','setup-start');
  }
  function taskView(id,step){
    const t=S.tasks.get(id);if(!t)return;
    const m=D.model(t,S.data,systemForTask(t),{checkRules:false}),locked=D.archive(t);
    S.pane={id};S.workspaceOpen=true;
    if(step!==undefined)S.viewStep=Math.min(step,t.stage);
    const i=S.viewStep=Math.min(S.viewStep,t.stage),footer=[];
    const progress=setupPage()?S.jobs.get(t.chatId):null;
    const tabs=stepTabs(i,t.stage,!!progress);
    const context=m.sk.context;
    const title=context.campusId?context.campus+'设班任务':'设班任务';
    const identity=t.id+':'+i;
    if(progress){
      workspaceContent(title,t.id,tabs,uploadProgress(progress),'',identity+':reading');
      return;
    }
    if(setupPage()&&i===0&&!t.files.length&&!locked){
      workspaceContent(title,t.id+' · 待上传资料',tabs,uploadStart(),'',identity);
      return;
    }
    if(i<t.stage){
      const next=['查看字段核对','查看规则结果','查看待导入清单'][i];
      footer.push(btn(next,'step',attr('n',i+1),'primary'));
    }else if(!locked&&i<3){
      const retry=i===2&&t.status==='blocked';
      const next=['确认资料与归属','确认字段并校验',retry?'重新校验':'查看待导入清单'][i];
      const unavailable=!m.sk.ready||!m.records.length;
      footer.push(btn(next,'advance',attr('n',retry?2:i+1)+(unavailable?' disabled':''),'primary'));
    }
    if(i===3&&t.status==='ready')footer.push(btn('确认导入 '+t.seal.rows.length+' 条待设班资料','commit',attr('version',t.seal.version),'primary'));
    if(i===3&&t.receipt)footer.push(btn(t.status==='pending'?'重试回读':'重新回读','reread','','outline'));
    if(i===3&&D.setupComplete(t))footer.push(btn('智能设班','smart-setup',attr('id',id),'primary'));
    const body=[input,mapping,verify,finalStep][i](t,m,locked)+(i===1||i===2?budgetEditor(t,m,locked):'')+events(t);
    const summary=footer.length?`<span class="foot-summary">${esc(D.stages[i])}</span>`:'';
    workspaceContent(title,t.id+' · '+D.states[t.status],tabs,body,summary+footer.join(''),identity);
  }
  function editRow(t,id){
    const m=D.model(t,S.data,systemForTask(t),{checkRules:false}),r=m.records.find(x=>x.row===id);if(!r||D.archive(t))return;
    const fields={class_name:null,subject_id:m.template.subjects,period_id:m.template.periods,slot_id:m.template.slots,teacher_id:m.work.master?.teachers.map(x=>x.id)||[],capacity:null};
    const content=`<form id="row-form" ${attr('row',id)}><div class="grid">${Object.entries(fields).map(([k,choices])=>`<label class="field"><span>${C.labels[k]}</span>${choices?select(C.labels[k],[['','请选择'],...choices.map(v=>[v,v])],r[k],'name="'+k+'"'):`<input name="${k}" ${k==='capacity'?'type="number" min="1" max="24" step="1"':'maxlength="60"'} value="${esc(r[k]??'')}">`}</label>`).join('')}</div></form><p class="meta" style="margin-top:12px">来源 · ${esc(r.source)}</p>`;
    panel('edit','修正班级字段',t.id+' · '+(r.class_name||r.row),content,btn('返回','task',attr('id',t.id),'outline')+'<button type="submit" class="btn primary" form="row-form">保存修正</button>',{key:t.id,id:t.id,narrow:true});
  }
  root.DeskTaskView={editBudget,renderSetup,taskView,editRow,mergeSource,uploadPanel,templates,opt,select,paginate};
})(window);
