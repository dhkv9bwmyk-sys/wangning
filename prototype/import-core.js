(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./vendor/xlsx.full.min.js'),require('./vendor/fflate.min.js'));
  else root.ClassPrepImport=factory(root.XLSX,root.fflate);
})(typeof window!=='undefined'?window:this,function(XLSX,fflate){
  'use strict';
  const labels={school_id:'学校',campus_id:'校区',budget_id:'预算编号',fiscal_year:'财年',quarter:'季度',class_name:'班级名称',subject_id:'科目',period_id:'期次',slot_id:'时段',teacher_id:'教师编号',capacity:'班额',target_students:'目标人次'};
  const aliases={school_id:['学校','机构','学校编号','学校名称','schoolid'],campus_id:['校区','所属校区','教学区','教学点','校区名称','校区编号','campusid'],budget_id:['预算','预算编号','预算id','budgetid'],fiscal_year:['财年','年度','fiscalyear'],quarter:['季度','学期','暑秋季','季节','quarter'],class_name:['班级名称','原班名称','班名','班级','classname'],subject_id:['学科','科目','品类','课程科目','subjectid'],period_id:['期次','期数','轮次','暑假轮次','periodid'],slot_id:['时段','上课时段','课时段','时间段','slotid'],teacher_id:['教师编号','授课老师','任课老师','任课教师','教师','教师姓名','教师id','员工编号','工号','中文姓名','真实姓名','姓名','teacherid'],capacity:['班额','计划班额','班均','人数班','班级容量','capacity'],target_students:['目标人次','招生目标','目标人数','目标人头','招生人头','招生人数','targetstudents']};
  const text=v=>String(v??'').trim();
  labels.class_key='班级标识';
  labels.area_id='教学区编码';
  aliases.class_key=['班级标识','班级编号','班级编码','classkey'];
  aliases.area_id=['教学区编码','教学区编号','教学区代号','areaid'];
  const classFields=Object.keys(labels).filter(k=>!['target_students','class_key','area_id'].includes(k));
  const roleNames={classes:'班级资料',budget:'招生预算',teachers:'教师安排',areas:'教学区对照',ignore:'已跳过'};
  const roleFields={
    classes:[...classFields,'class_key','area_id'],
    budget:['school_id','campus_id','fiscal_year','quarter','budget_id','subject_id','capacity','target_students'],
    teachers:['class_key','teacher_id','campus_id','subject_id','period_id','slot_id'],
    areas:['area_id','campus_id']
  };
  const norm=v=>text(v).toLowerCase().replace(/[\s　_\-:：()（）/\\]/g,'');
  const fieldOf=v=>Object.keys(aliases).find(k=>aliases[k].some(a=>norm(a)===norm(v))||norm(k)===norm(v));
  function mappings(headers){const result={};headers.forEach((h,i)=>{const key=fieldOf(h);if(key&&(result[key]===undefined||/编号|id/i.test(text(h))))result[key]=i;});return result;}
  const readbackFields={record:['系统记录id','系统记录编号','系统记录'],field:['字段','核对字段'],sent:['提交值'],actual:['回读值'],result:['结果','核对结果','核对']};
  function readbackColumns(headers){
    const columns={};
    headers.forEach((value,index)=>{
      const key=Object.keys(readbackFields).find(field=>readbackFields[field].includes(norm(value)));
      if(key&&columns[key]===undefined)columns[key]=index;
    });
    return ['record','field','sent','actual'].every(key=>columns[key]!==undefined)?columns:null;
  }
  const onlyReadback=file=>file.sheets.length>0&&file.sheets.every(sheet=>sheet.analysis?.readback);
  function analyze(sheet,headerRow,forcedRole){
    const candidates=sheet.rows.slice(0,25).map((r,i)=>{
      const m=mappings(r);
      const score=(readbackColumns(r)?1000:0)+Object.keys(m).length*10+(m.class_name!==undefined?30:0)+(m.subject_id!==undefined?15:0);
      return {i,score,m};
    }).sort((a,b)=>b.score-a.score||a.i-b.i);
    const storedReadbackHeader=sheet.analysis?.readback?sheet.analysis.headerRow:undefined;
    const selected=storedReadbackHeader??headerRow??candidates[0]?.i??0;
    const headers=sheet.rows[selected]||[],map=mappings(headers);
    const readback=readbackColumns(headers);
    const role=readback?'ignore':forcedRole||(
      map.class_name!==undefined?'classes':
      map.target_students!==undefined&&map.subject_id!==undefined?'budget':
      map.class_key!==undefined&&map.teacher_id!==undefined?'teachers':
      map.area_id!==undefined&&map.campus_id!==undefined?'areas':'ignore'
    );
    const rows=[],ignored=[];
    for(let i=selected+1;i<sheet.rows.length;i++){
      const values=sheet.rows[i],nonempty=values.filter(v=>v!==null&&v!==undefined&&text(v)!=='');
      if(!nonempty.length){ignored.push(i+1);continue;}
      const first=text(nonempty[0]);
      if(/^(合计|总计|汇总)$|^(注|说明|备注)[:：]/.test(first)||nonempty.length===1&&role==='ignore'){ignored.push(i+1);continue;}
      rows.push({number:i+1,values});
    }
    return {headerRow:selected,headers,map,role,readback,rows,ignored,candidates:candidates.slice(0,5),score:candidates.find(c=>c.i===selected)?.score||0};
  }
  function readContent(bytes,name,index=1){
    const ext=text(name).split('.').pop().toLowerCase();
    if(!['xlsx','xls','csv','docx'].includes(ext))throw Error('请选择xlsx、xls、csv或docx文件');
    const buffer=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    if(buffer.byteLength>10*1024*1024)throw Error('单个文件请控制在10MB以内');
    const file={id:'F'+String(index).padStart(2,'0'),name:'上传资料'+String(index).padStart(2,'0')+'.'+ext,extension:ext,size:buffer.byteLength,sheets:[]};
    if(ext==='docx'){
      const zip=fflate.unzipSync(buffer,{filter:e=>e.name==='word/document.xml'&&e.originalSize<2*1024*1024});
      if(!zip['word/document.xml'])throw Error('未识别到Word正文，文件可能为空或格式不受支持');
      const xml=new TextDecoder().decode(zip['word/document.xml']);
      const paragraphs=(xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[]).map(p=>(p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)||[]).map(t=>t.replace(/<[^>]*>/g,'')).join(''));
      file.paragraphCount=paragraphs.length;
      file.paragraphs=paragraphs.map(p=>p.replace(/&(amp|lt|gt|quot|apos);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key])));
      return file;
    }
    let wb;
    try{
      let input=buffer,options={type:'array',sheetRows:1502,cellFormula:true,cellText:true,cellDates:false};
      if(ext==='csv'){let csv=new TextDecoder('utf-8').decode(buffer);if(csv.includes('\ufffd'))csv=new TextDecoder('gb18030').decode(buffer);input=csv.replace(/^\ufeff/,'');options={...options,type:'string',raw:true};}
      wb=XLSX.read(input,options);
    }catch(error){throw Error('无法读取表格，请检查文件是否损坏或加密');}
    wb.SheetNames.forEach((sheetName,i)=>{
      if(wb.Workbook?.Sheets?.[i]?.Hidden)return;
      const ws=wb.Sheets[sheetName],range=XLSX.utils.decode_range(ws['!ref']||'A1'),rows=[],formulaMissing=[];
      if(range.e.r>=1501||ws['!fullref']&&XLSX.utils.decode_range(ws['!fullref']).e.r>=1501)throw Error('当前单表最多识别1500行，请拆分工作表后重试');
      if(range.e.c>=60)throw Error('当前单表最多识别60列，请移除无关列后重试');
      for(let r=0;r<=Math.min(range.e.r,1500);r++){
        const values=[];for(let c=0;c<=range.e.c;c++){const address=XLSX.utils.encode_cell({r,c}),cell=ws[address];values.push(cell?.v??null);if(cell?.f&&(cell.v===undefined||cell.v===null))formulaMissing.push(address);}rows.push(values);
      }
      const safeNames=['说明','班级资料','招生预算','教师名单','教师安排','教学区对照','Sheet1','工作表1'];
      file.sheets.push({label:safeNames.includes(sheetName)?sheetName:'工作表'+String(i+1).padStart(2,'0'),rows,merges:(ws['!merges']||[]).length,formulaMissing,sourceIndex:i});
    });
    if(!file.sheets.length)throw Error('未发现可识别的可见工作表');
    return file;
  }
  function identifiedSheet(sheet,headerRow){
    const analysis=analyze(sheet,headerRow);
    return {...sheet,analysis,map:{...analysis.map},header:analysis.headerRow,role:analysis.role};
  }
  function identify(file){
    if(file.extension==='docx'){
      const ruleCandidates=[[/跨校区|跨区/,'校区约束','核对日内跨校区安排'],[/教师|老师/,'教师约束','核对教师资格与时间占用'],[/前三|第[一二三123]期/,'期次偏好','优先前三期'],[/模板|必填/,'模板约束','按模板补齐必填字段']].flatMap(([rx,topic,value])=>{const n=file.paragraphs.findIndex(p=>rx.test(p));return n<0?[]:[{topic,value,position:'正文第'+(n+1)+'段'}];});
      return {...file,selected:0,role:'rules',ruleCandidates};
    }
    const sheets=file.sheets.map(sheet=>identifiedSheet(sheet));
    const selected=sheets.map((s,i)=>({i,score:s.analysis.score+(s.role==='classes'?10000:s.role==='budget'?1000:0)})).sort((a,b)=>b.score-a.score)[0].i;
    return {...file,sheets,selected,role:sheets[selected].role};
  }
  function identifyReadback(file){
    return file.sheets.flatMap(sheet=>{
      const header=sheet.rows.slice(0,25).findIndex(row=>readbackColumns(row));
      return header<0?[]:[identifiedSheet(sheet,header)];
    });
  }
  function read(bytes,name,index=1,options={}){
    const file=identify(readContent(bytes,name,index));
    if(!options.ruleText)delete file.paragraphs;
    return file;
  }
  function rowKey(file,sheet,number){return file.id+'-S'+(sheet.sourceIndex+1)+'-R'+number;}
  function setSheet(file,index){file.selected=Number(index);file.role=file.sheets[file.selected].role;}
  function setHeader(file,index){const s=file.sheets[file.selected];s.analysis=analyze(s,Number(index));s.header=s.analysis.headerRow;s.map={...s.analysis.map};s.role=s.analysis.role;file.role=s.role;}
  function privacy(){const groups=new Map();return {alias(key,value){const k=key+'|'+text(value);if(!groups.has(k)){const n=[...groups.keys()].filter(v=>v.startsWith(key+'|')).length+1;groups.set(k,key==='class_name'?'来源班级'+String(n).padStart(2,'0'):'来源'+(labels[key]||'字段')+String.fromCharCode(64+((n-1)%26)+1)+(n>26?Math.ceil(n/26):''));}return groups.get(k);}};}
  function canonical(key,value){
    const v=text(value),n=v.replace(/[\s　]/g,''),num=n.replace(/[一二三四]/g,c=>({'一':1,'二':2,'三':3,'四':4}[c]));
    if(!v)return null;
    if(key==='quarter'){if(/^(暑期|暑假|夏季|summer)$/i.test(n))return '暑假';if(/^(秋期|秋季|秋|autumn|fall)$/i.test(n))return '秋季';return null;}
    if(key==='period_id'){if(/^(秋季常规期|秋季常规|常规期)$/.test(n))return '秋季常规期';const m=num.match(/^(?:第)?([1-4])(?:期|轮|轮次)?$/);return m?'第'+m[1]+'期':null;}
    if(key==='slot_id'){const m=num.match(/^(?:第|时段)?([1-4])(?:时段)?$/);return m?'时段'+m[1]:null;}
    if(key==='capacity'||key==='target_students'){const cleaned=n.replace(/(?:人\/班|人每班|人|班均|班额)/g,'');if(!/^\d+(?:\.\d+)?$/.test(cleaned))return null;const result=Number(cleaned);return key==='capacity'&&!Number.isInteger(result)?null:result;}
    if(key==='subject_id'){const m=n.match(/^(?:科目|学科)?([ABCD])$/i);return m?'科目'+m[1].toUpperCase():null;}
    return v;
  }
  function safe(value,key,p){
    const v=text(value);if(!v)return '';
    if(/^来源(?:班级\d+|(?:教师编号|校区|学校|预算编号|财年|季度|科目|期次|时段|班额|字段|目标人次|班级标识|教学区编码)[A-Z]\d*)$/.test(v))return v;
    if(key==='class_name')return /^入口科目[A-D]\d+班$|^(?:来源)?班级\d+$/.test(v)?v:p.alias(key,v);
    if(key==='teacher_id')return /^教师\d{2}-\d{2}$/.test(v)?v:p.alias(key,v);
    if(key==='campus_id')return /^校区\d{2}$|^C\d{2}$/.test(v)?v:p.alias(key,v);
    if(key==='class_key')return /^班级\d{2,}$/.test(v)?v:p.alias(key,v);
    if(key==='area_id')return /^教学区\d{2,}$/.test(v)?v:p.alias(key,v);
    if(key==='school_id')return /^(机构[A-Z]|ORG-[A-Z])$/.test(v)?v:p.alias(key,v);
    if(key==='budget_id')return /^BUD-C\d{2}-(SU|AU)-\d{2}$/.test(v)?v:p.alias(key,v);
    if(key==='fiscal_year')return v==='目标财年'?v:p.alias(key,v);
    if(['quarter','period_id','slot_id','capacity','target_students','subject_id'].includes(key))return canonical(key,v)!==null?v:p.alias(key,v);
    return /^\d{1,4}(?:\.\d+)?$/.test(v)?v:/^\d/.test(v)?'数值':'文本值';
  }
  function sourceHeader(value,i){const k=fieldOf(value);return k||/^(?:核定|计划|核准|备选|备用|标准|上限|最大|可用|实际|课程|上课|拟定|招生|排课){1,3}(?:人数|班额|时段|期次|容量|科目|班名|季度|目标|字段)$/.test(text(value))?text(value):'原始字段'+(i+1);}
  function linkSources(files,excluded){
    const byRow=new Map(),used=new Set(),issues=[];
    const sheets=files.flatMap(file=>file.sheets.map(sheet=>({file,sheet})));
    if(!sheets.some(({sheet})=>sheet.role==='teachers'||sheet.role==='areas'||sheet.role==='classes'&&sheet.map.area_id!==undefined)){
      return {byRow,used,issues};
    }
    const entry=(file,sheet,r)=>{
      const prefix=file.id+' · '+sheet.label+'!';
      const fields=Object.fromEntries(Object.entries(sheet.map).map(([key,col])=>[key,{
        value:text(r.values[col]),source:prefix+XLSX.utils.encode_col(col)+r.number
      }]));
      return {id:rowKey(file,sheet,r.number),source:prefix+'行'+r.number,fields};
    };
    const classes=[],teachers=new Map(),areas=new Map(),classCounts=new Map();
    for(const {file,sheet} of sheets){
      if(!['classes','teachers','areas'].includes(sheet.role))continue;
      for(const r of sheet.analysis.rows){
        if(excluded.has(rowKey(file,sheet,r.number)))continue;
        const item=entry(file,sheet,r);
        const key=item.fields.class_key?.value;
        if(sheet.role==='classes'){
          classes.push(item);
          if(key)classCounts.set(key,(classCounts.get(key)||0)+1);
        }else{
          const index=sheet.role==='teachers'?teachers:areas;
          const id=sheet.role==='teachers'?key:item.fields.area_id?.value;
          if(id){if(!index.has(id))index.set(id,[]);index.get(id).push(item);}
        }
      }
    }
    for(const item of classes){
      const classKey=item.fields.class_key?.value;
      const areaId=item.fields.area_id?.value;
      const staff=teachers.get(classKey)||[],locations=areas.get(areaId)||[];
      const issue=(detail,other=[])=>issues.push({row:item.id,detail,sources:[item,...other]});
      if(staff.length>1||staff.length&&classCounts.get(classKey)>1)issue('同一班级标识对应多条班级或教师安排。',staff);
      const teacher=staff.length===1&&classCounts.get(classKey)===1?staff[0]:null;
      const area=locations.length===1&&locations[0].fields.campus_id?.value?locations[0]:null;
      if(areaId&&!area)issue(locations.length>1?'同一教学区编码对应多条校区记录。':'教学区编码缺少有效的校区对照。',locations);
      if(teacher&&!teacher.fields.teacher_id?.value)issue('教师安排缺少教师编号。',[teacher]);
      for(const match of [teacher,area])if(match)used.add(match.id);
      if(teacher||area||areaId)byRow.set(item.id,{teacher,area,areaId});
    }
    return {byRow,used,issues};
  }
  function compile(files,context,data,bindings={},mask=privacy(),excluded=new Set(),budgetFixes={},links=linkSources(files,excluded)){
    const records=[],demand=[],audits=[],unresolved=new Map(),neededPending=new Set(),fileSummaries=[],fieldMappings=[],tableSummaries=[],ruleCandidates=[],budgetRows=[],budgetIssues=[];
    const mergeIssues=links.issues.slice();
    const contextValues={school_id:context.schoolId,campus_id:context.campusId,budget_id:context.budgetId,fiscal_year:context.fiscalYear,quarter:context.quarter};
    function resolve(key,raw,source){
      if(raw===null||raw===undefined||text(raw)===''){
        const proof=context.evidence?.[key]||(key==='school_id'&&context.schoolId===data.school.id?'当前账号所属学校':'');
        return proof&&contextValues[key] ? {value:contextValues[key],rule:'任务归属 · '+proof} : {value:null,rule:'来源缺省，待确认'};
      }
      const value=text(raw),bindingKey=key+'|'+value;
      if(bindings[bindingKey]!==undefined)return {value:bindings[bindingKey]==='__exclude__'?'__exclude__':bindings[bindingKey],rule:'人工确认主数据关联'};
      if(key==='class_name')return {value:safe(raw,key,mask),rule:'统一班级标识'};
      if(['period_id','slot_id','quarter','capacity','target_students'].includes(key))return {value:canonical(key,raw),rule:key==='capacity'?'提取人数并转为整数':key==='quarter'?'统一季度名称':key==='period_id'?'统一期次枚举':key==='slot_id'?'统一时段枚举':'转为数值'};
      if(key==='subject_id'&&canonical(key,raw))return {value:canonical(key,raw),rule:'统一科目名称'};
      if(key==='school_id'&&(value===context.schoolId||value===context.school))return {value:context.schoolId,rule:'学校主数据匹配'};
      if(key==='campus_id'){const campus=data.campuses.find(c=>c.id===value||c.name===value);if(campus)return {value:campus.id,rule:'校区主数据匹配'};}
      if(key==='budget_id'&&/^BUD-C\d{2}-(SU|AU)-\d{2}$/.test(value))return {value,rule:'预算编号识别'};
      if(key==='fiscal_year'&&value===context.fiscalYear)return {value,rule:'财年匹配'};
      if(key==='teacher_id'&&/^教师\d{2}-\d{2}$/.test(value))return {value,rule:'教师编号识别'};
      if(!unresolved.has(bindingKey))unresolved.set(bindingKey,{key:bindingKey,field:key,label:labels[key],sourceValue:safe(raw,key,mask),source,token:unresolved.size});
      return {value:null,rule:'待确认主数据关联',pendingKey:bindingKey};
    }
    for(const file of files){
      fileSummaries.push({id:file.id,name:file.name,type:file.extension==='docx'?'DOCX':'XLSX',usage:file.role==='rules'?'业务规则':roleNames[file.role]||'班级资料',sheetCount:file.sheets.length,size:file.size});
      if(file.role==='rules'){ruleCandidates.push(...file.ruleCandidates.map(r=>({...r,source:file.id})));continue;}
      const tables=file.sheets.map(sheet=>({sheet,role:sheet.role}));
      for(const {sheet,role}of tables){
        if(role==='ignore'||sheet.analysis.readback)continue;
        const summary={file:file.id,sheet:sheet.label,role,headerRow:sheet.header+1,rowCount:sheet.analysis.rows.length,columnCount:sheet.analysis.headers.length,merges:sheet.merges,ignoredRows:sheet.analysis.ignored.length,formulaMissing:sheet.formulaMissing,accepted:0};
        tableSummaries.push(summary);
        for(const [key,col]of Object.entries(sheet.map))fieldMappings.push({file:file.id,sheet:sheet.label,sourceField:sourceHeader(sheet.analysis.headers[col],col),column:XLSX.utils.encode_col(col),target:key,targetLabel:labels[key]});
        for(const sourceRow of sheet.analysis.rows){
          const rowId=rowKey(file,sheet,sourceRow.number),values={},local=[],pending=[];if(excluded.has(rowId))continue;let skip=false;
          if(role==='teachers'||role==='areas'){if(links.used.has(rowId))summary.accepted++;continue;}
          const keys=role==='budget'?['campus_id','budget_id','quarter','subject_id','target_students','capacity']:classFields;
          const link=links.byRow.get(rowId),where=file.id+' · '+sheet.label+'!行'+sourceRow.number;
          for(const key of keys){
            const col=sheet.map[key],original=sourceRow.values[col];
            const match=!text(original)&&(key==='teacher_id'?link?.teacher?.fields[key]:key==='campus_id'?link?.area?.fields[key]:null);
            const raw=match?.value??original;
            const cell=col===undefined?where:file.id+' · '+sheet.label+'!'+XLSX.utils.encode_cell({r:sourceRow.number-1,c:col});
            const scopeSource=link&&!text(raw)?context.evidence?.[key]:null;
            const source=match?.source||scopeSource||cell;
            const r=resolve(key,raw,source);
            values[key]=r.value;
            if(r.value==='__exclude__')skip=true;
            if(r.pendingKey)pending.push(r.pendingKey);
            const rule=match?(key==='teacher_id'?'按班级标识匹配':'按教学区编码映射')+' · '+r.rule:r.rule;
            local.push({row:rowId,source,sourceField:match||scopeSource?labels[key]:col===undefined?'':sourceHeader(sheet.analysis.headers[col],col),field:key,label:labels[key],raw:safe(raw,key,mask),value:r.value,rule});
          }
          if(skip)continue;
          if(role==='budget'){
            const fixes=budgetFixes[rowId]||{};
            for(const k of ['subject_id','target_students','capacity'])if(Object.hasOwn(fixes,k))values[k]=fixes[k];
            const corrupt=[];
            if(!['科目A','科目B','科目C','科目D'].includes(values.subject_id))corrupt.push('科目');
            if(!Number.isFinite(values.target_students)||values.target_students<0)corrupt.push('目标人次');
            if(!Number.isInteger(values.capacity)||values.capacity<1)corrupt.push('预算班均');
            budgetRows.push({row:rowId,source:where,subject:values.subject_id,target:values.target_students,capacity:values.capacity,issues:corrupt});
            if(corrupt.length){budgetIssues.push({row:rowId,source:where,detail:where+' · 请核对'+corrupt.join('、')});continue;}
            if(values.campus_id!==null&&values.campus_id!==context.campusId||values.budget_id!==null&&values.budget_id!==context.budgetId||values.quarter!==null&&values.quarter!==context.quarter)continue;
            summary.accepted++;
            pending.forEach(k=>neededPending.add(k));
            if(values.subject_id&&values.target_students!==null&&values.capacity>0)demand.push({subject:values.subject_id,target:values.target_students,sourceTarget:values.target_students,rate:1,capacity:values.capacity,classes:Math.ceil(values.target_students/values.capacity),source:file.id+' · '+sheet.label+'!行'+sourceRow.number});
          }else{
            summary.accepted++;
            if(link?.teacher){
              const mismatch=['teacher_id','campus_id','subject_id','period_id','slot_id'].filter(key=>{
                const field=link.teacher.fields[key];
                return field?.value&&values[key]!=null&&resolve(key,field.value,field.source).value!==values[key];
              });
              if(mismatch.length)mergeIssues.push({row:rowId,detail:'教师安排与班级的'+mismatch.map(key=>labels[key]).join('、')+'不一致。',sources:[{id:rowId,source:where},link.teacher]});
            }
            records.push({row:rowId,school:values.school_id,campus:values.campus_id,budget:values.budget_id,fiscalYear:values.fiscal_year,quarter:values.quarter,name:values.class_name,subject:values.subject_id,period:values.period_id,slot:values.slot_id,teacher:values.teacher_id,capacity:values.capacity,source:where});audits.push(...local);pending.forEach(k=>neededPending.add(k));
          }
        }
      }
    }
    const uniqueDemand=[],budgetConflicts=[],scopeConflicts=[];
    for(const d of demand){const previous=uniqueDemand.find(p=>p.subject===d.subject);if(!previous)uniqueDemand.push(d);else if(previous.target!==d.target||previous.capacity!==d.capacity)budgetConflicts.push({subject:d.subject,firstSource:previous.source,otherSource:d.source,reason:'同一预算的科目目标或班均不一致'});}
    for(const field of ['school_id','campus_id','budget_id']){const targets=new Map();for(const [key,value]of Object.entries(bindings)){if(!key.startsWith(field+'|')||value==='__exclude__')continue;const origin=key.slice(field.length+1);if(targets.has(value))scopeConflicts.push({field,label:labels[field],sourceValues:[safe(targets.get(value),field,mask),safe(origin,field,mask)],reason:'不同来源范围不能合并到同一任务，请移出其他范围的记录'});else targets.set(value,origin);}}
    return {records,demand:uniqueDemand,unresolved:[...unresolved.values()].filter(v=>neededPending.has(v.key)),recognition:{budgetRows,budgetIssues,files:fileSummaries,tables:tableSummaries,fieldMappings,conversions:audits,ruleCandidates,budgetConflicts,scopeConflicts,links:links.byRow,mergeIssues,imported:true},mask};
  }
  return {labels,aliases,roleNames,roleFields,fieldOf,mappings,analyze,read,readContent,identify,identifyReadback,rowKey,setSheet,setHeader,privacy,canonical,safe,sourceHeader,linkSources,compile,onlyReadback};
});
