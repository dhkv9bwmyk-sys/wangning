(function (root) {
  'use strict';
  const I = root.ClassPrepImport;
  const number = /^(\d{1,3})\s*(?:人(?:\/班)?)?$/;
  const capacity = '(?:班额|每班(?:人数)?|班级人数|班级容量)';
  const limit = new RegExp(capacity + '(?:的)?(?:上限|最大值?|至多|不超过|不得超过|不能超过|最多|≤|<=)[:：为是\\s]*(\\d{1,3})(?!\\d)');
  const range = new RegExp(capacity + '(?:范围)?(?:为|是|[:：])?\\s*(\\d{1,3})\\s*(?:至|到|-|–|~|～)\\s*(\\d{1,3})(?!\\d)');
  const required = /(预算编号|班额|教师编号|校区|期次|时段)(?:为|是|属)?(?:必填|必须填写|必须提供)/;
  const names = {'预算编号':'budget','班额':'capacity','教师编号':'teacher','校区':'campus','期次':'period','时段':'slot'};
  const transferTerms = root.DeskIntent.transferTerms;
  const topics = [
    [/核对表|核对结果|回读|差异|一致项/,'readback','核对结果'],
    [transferTerms,'transfer','学员转班或转校'],
    [/调课|撤回|恢复申请|审批/,'schedule','调课与审批'],
    [/选课|截止时间|提交截止/,'deadline','办理时间'],
    [/班额|班均|班级人数|每班|上限|容量/,'capacity','班额'],
    [/预算/,'budget','预算'],
    [/校区/,'campus','校区'],
    [/教师|老师|师资/,'teacher','教师'],
    [/期次|第[一二三四1-4]期|轮次/,'period','期次'],
    [/时段|上课时间/,'slot','时段'],
    [/必填|模板/,'required','必填要求']
  ];
  const knownTopic = text => topics.find(([pattern])=>pattern.test(text))?.[1] || '';
  const fact = (key, description, source, kind='rule') => ({key,description,source,kind});

  function clauseFacts(text, source) {
    const found = [];
    const scheduleContext = /调课|恢复原安排/.test(text);
    for (const value of text.slice(0,1200).normalize('NFKC').split(/[。；;\n！？!?]/)) {
      const clause = value.trim();
      if (!clause || /^(?:举例|示例|如:|例如|以.+为例)|不作为.*规则/.test(clause)) continue;
      const bounds = clause.match(range);
      const cap = clause.match(limit);
      const field = clause.match(required);
      if (bounds && +bounds[1] <= +bounds[2]) found.push(fact('capacity','班额范围写为 '+(+bounds[1])+' 至 '+(+bounds[2])+' 人',source));
      else if (cap) found.push(fact('capacity','班额上限写为 '+(+cap[1])+' 人',source));
      if (field) found.push(fact(names[field[1]],field[1]+'为必填项',source));
      const transferClause = transferTerms.test(clause);
      const transferLimit = clause.match(/(?:禁止|不得|不允许|不能)\s*跨(?:校区|校)(?:转班|换班|调班|转校)?/);
      if (transferClause&&transferLimit&&!/是否|能否|能不能|可否|可不可以/.test(clause)) {
        found.push(fact('transfer','转班或转校条款写明'+transferLimit[0],source));
      }
      if (!transferClause&&/(?:禁止|不得|不允许|不能)跨校区/.test(clause)) found.push(fact('campus','该条写明不得跨校区',source));
      if (/(?:一个|每个|单个)任务.{0,14}(?:一个|1\s*个|单一)校区.{0,10}(?:一个|一份|1\s*个|1\s*份|单一)预算/.test(clause)) {
        found.push(fact('budget','每个任务按一个校区和一份预算处理',source));
      }
      if (/同一(?:位)?教师.{0,26}同一(?:个)?时段.{0,14}(?:只能安排一个班|最多安排一个班|不可重复排课|不得重复排课)/.test(clause)) {
        found.push(fact('teacher','同一教师在同一时段的排班受到重复限制',source));
      }
      if (scheduleContext&&/(?:待审批|审批中|未审批)/.test(clause)&&/(?:发起人|申请人)(?:可|可以|能)撤回|(?:发起人|申请人)在(?:待审批|审批中|未审批)(?:时|状态下)(?:可|可以)撤回/.test(clause)) {
        found.push(fact('schedule','调课申请处于待审批状态时，发起人可撤回',source));
      }
      if (scheduleContext&&/审批通过后[，,\s]*(?:(?:须|必须|需(?:要)?|应)(?:另行|重新)?|(?:另行|重新))提交恢复申请/.test(clause)) {
        found.push(fact('schedule','调课审批通过后，需提交恢复申请',source));
      }
      const reviewer = clause.match(/(?:必须|需要|须)由(学校管理员|教务管理员|审批负责人)(?:审核|审批|复核)/);
      if (reviewer) found.push(fact(transferClause?'transfer':'schedule','该项需由'+reviewer[1]+'审核',source));
      const deadline = clause.match(/(选课|调课申请|设班资料提交)(?:的)?截止(?:时间)?(?:为|是|:)?\s*(\d{1,2}):(\d{2})(?!\d)/);
      if (deadline&&Number(deadline[2])<24&&Number(deadline[3])<60) {
        found.push(fact('deadline',deadline[1]+'截止时间写为 '+deadline[2].padStart(2,'0')+':'+deadline[3],source));
      }
    }
    return found;
  }

  function wordFacts(file) {
    const items = [];
    const hinted = new Set();
    for (const [index, content] of file.paragraphs.entries()) {
      const source = file.id+' · 正文第 '+(index+1)+' 段';
      const exact = clauseFacts(content,source);
      items.push(...exact);
      const topic = topics.find(([pattern])=>pattern.test(content));
      if (topic && exact.length===0 && !hinted.has(topic[1])) {
        hinted.add(topic[1]);
        items.push(fact(topic[1],'该段提到'+topic[2]+'，具体条件请核对原段落',source,'location'));
      }
    }
    return items;
  }

  function sheetFacts(file, sheet) {
    const items = [];
    const encode = root.XLSX.utils.encode_cell;
    const location = (r,c) => file.id+' · '+sheet.label+'!'+encode({r,c});
    for (const [r,row] of sheet.rows.entries()) for (const [c,value] of row.entries()) {
      if (typeof value !== 'string') continue;
      if (/(?:上限|最多|必填|不得|同一|范围|预算|撤回|审批|由.{2,10}审核|截止)/.test(value)) items.push(...clauseFacts(value,location(r,c)));
      if (/^(?:班额上限|每班上限|每班最多人数)$/.test(value.trim())) {
        const right = String(row[c+1] ?? '').trim().match(number);
        const below = String(sheet.rows[r+1]?.[c] ?? '').trim().match(number);
        const hit = right || below;
        if (hit && !(right&&below&&right[1]!==below[1])) {
          const cell = right ? {r,c:c+1} : {r:r+1,c};
          items.push(fact('capacity','班额上限栏写为 '+(+hit[1])+' 人',location(r,c)+' / '+encode(cell)));
        }
      }
    }
    const populated = populatedRows(sheet);
    const header = sampleStart(populated);
    const mapping = I.mappings(populated[header]?.values || []);
    const rows = populated.slice(header+1);
    const sheetSource = file.id+' · '+sheet.label;
    for (const [field, topic, title] of [['capacity','capacity','计划班额'],['period_id','period','期次'],['slot_id','slot','时段']]) {
      const column = mapping[field];
      if (column === undefined) continue;
      const sources = new Map();
      for (const row of rows) {
        const value = I.canonical(field,row.values[column]);
        if (value===null || (field==='capacity'&&(value<1||value>999))) continue;
        if (!sources.has(value)) sources.set(value,row.number);
      }
      if (!sources.size) continue;
      const preview = [...sources].slice(0,4);
      const values = preview.map(([value])=>String(value)+(field==='capacity'?' 人/班':''));
      const cells = preview.map(([,r])=>encode({r:r-1,c:column}));
      items.push(fact(topic,title+'列记录了 '+values.join('、')+(sources.size>preview.length?' 等取值':''),sheetSource+'!'+cells.join('、'),'data'));
    }
    if (mapping.budget_id !== undefined) {
      const empty = rows.filter(row=>String(row.values[mapping.budget_id] ?? '').trim()==='').length;
      if (empty) {
        const first = rows.find(row=>String(row.values[mapping.budget_id] ?? '').trim()==='');
        items.push(fact('budget','预算编号有 '+empty+' 条留空',location(first.number-1,mapping.budget_id),'data'));
      }
    }
    return items;
  }

  const hasValue = value => String(value ?? '').trim() !== '';
  const plainLabels = /^(序号|条目|索引|类别|事项|名称|状态|原因|日期|时间|数量|说明|补充说明|备注|位置|关联信息|正文|事项说明|办理要求|办理时间|口径|字段|系统记录ID|提交值|回读值|结果|一致|差异|待审批|审批中|已通过|调课申请|选课)$/i;
  const excerptTerms = /适用范围|办理步骤|申请时间|截止时间|调课申请|选课|发起人|待审批|审批通过|撤回|恢复申请|班额|校区|预算编号|教师编号|教务管理员|说明|备注/g;
  const excerpt = text => [...new Set(String(text).match(excerptTerms) || [])].slice(0,5);

  function populatedRows(sheet) {
    return sheet.rows.map((values,index)=>({
      values,number:index+1,filled:values.filter(hasValue).length
    })).filter(row=>row.filled);
  }

  function sampleStart(rows) {
    return rows.slice(0,12).reduce((start,row,index)=>row.filled>rows[start].filled?index:start,0);
  }

  function sampleValue(raw,key,mask,label) {
    const value=String(raw??'').trim();
    if(!value)return '';
    if(key){
      const amount=key==='capacity'?I.canonical(key,raw):null;
      return amount===null?I.safe(value,key,mask).slice(0,36):amount+' 人/班';
    }
    if(I.fieldOf(value)||plainLabels.test(value))return value;
    if(/^(序号|数量)$/.test(label)&&/^\d{1,4}(?:\.\d{1,2})?$/.test(value))return value;
    const words=excerpt(value);
    return words.length?words.join('、'):'';
  }

  function isReadable(file) {
    return file.extension === 'docx'
      ? file.paragraphs.some(hasValue)
      : file.sheets.some(sheet=>sheet.formulaMissing.length || sheet.rows.some(row=>row.some(hasValue)));
  }

  function readbackSummary(sheet, mask) {
    const columns = sheet.analysis.readback;
    const rows = sheet.analysis.rows.filter(({values})=>hasValue(values[columns.record])||hasValue(values[columns.field]));
    const records = new Set(), totals = {matched:0,different:0,pending:0};
    const results = rows.map(row=>{
      const {values} = row;
      const id = String(values[columns.record]??'').trim(), field = String(values[columns.field]??'').trim();
      const sent = String(values[columns.sent]??'').trim(), actual = String(values[columns.actual]??'').trim();
      if (id) records.add(id);
      const outcome = !id||!field||!sent||!actual||/^(未读到|缺失|—)$/.test(actual)
        ? 'pending' : sent===actual ? 'matched' : 'different';
      totals[outcome]++;
      return {row:row.number, field, sent, actual, outcome};
    });
    const count = records.size+' 条'+(sheet.map.class_name===undefined?'系统记录':'班级记录')+'，'+rows.length+' 项字段核对';
    const status = totals.matched+' 项一致，'+totals.different+' 项有差异'+(totals.pending?'，'+totals.pending+' 项待核实':'');
    const sample = results.find(row=>row.outcome==='different')||results.find(row=>row.outcome==='pending')||results[0];
    const source = sheet.label+' · 第 '+(sheet.header+1)+' 行表头';
    const examples = [{description:status,source:sheet.label+' · 按提交值与回读值比对'}];
    if (sample) {
      const key = I.fieldOf(sample.field);
      const outcome = {matched:'一致',different:'差异',pending:'待核实'}[sample.outcome];
      const description = key
        ? I.labels[key]+' · 提交 '+(I.safe(sample.sent,key,mask)||'空')+' · 回读 '+(I.safe(sample.actual,key,mask)||'空')+' · '+outcome
        : '字段比对 · '+outcome;
      examples.push({description,source:sheet.label+' · 第 '+sample.row+' 行'});
    }
    return {count,status,source,examples};
  }

  function previewSheet(sheet, mask) {
    const source = sheet.label;
    const rows=populatedRows(sheet), start=sampleStart(rows), columns=new Set();
    for(const row of rows)row.values.forEach((value,index)=>{if(hasValue(value))columns.add(index);});
    const headers=rows[start]?.values || [];
    const examples=rows.slice(start,start+2).map((row,offset)=>{
      const cells=row.values.flatMap((value,column)=>{
        const label=offset?String(headers[column]??'').trim():'';
        const key=I.fieldOf(label);
        const visible=sampleValue(value,key,mask,label);
        if(!visible)return [];
        return [key||/^(序号|数量)$/.test(label)?label+' '+visible:visible];
      }).slice(0,10);
      return {
        description:cells.length?'样例 · '+cells.join(' · '):'该行有 '+row.filled+' 个非空单元格',
        source:source+' · 第 '+row.number+' 行'
      };
    });
    const title='表格内容 · '+rows.length+' 个非空行，'+columns.size+' 列有内容';
    return {title,source,examples};
  }

  function preview(file, name, mask) {
    if (file.extension==='docx') {
      const paragraphs=file.paragraphs.map((text,index)=>({text,number:index+1})).filter(item=>hasValue(item.text));
      const examples=paragraphs.slice(0,3).map(({text,number})=>{
        const words=excerpt(text);
        return {description:words.length?'原文摘词 · '+words.join('、'):'该段有 '+text.trim().length+' 个字符',source:'正文第 '+number+' 段'};
      });
      return {name,structure:'Word 正文 · '+paragraphs.length+' 个有文字的段落',sections:[{title:'正文样例',examples}]};
    }
    const sheets = file.sheets;
    const sections = sheets.slice(0,3).map(sheet=>previewSheet(sheet,mask));
    const extra = sheets.length-sections.length;
    const structure = file.extension==='csv'?'CSV 表格':sheets.length+' 张工作表';
    return {name,structure,sections,note:extra?'另有 '+extra+' 张工作表。':''};
  }

  function report(file, purpose, name='资料 '+file.id.slice(1)+'.'+file.extension) {
    const word = file.extension === 'docx';
    const mask = I.privacy();
    const facts = purpose==='readback' ? I.identifyReadback(file).flatMap(sheet=>{
      const audit = readbackSummary(sheet,mask);
      return [
        fact('readback',audit.count+'，'+audit.status,file.id+' · '+audit.source,'readback'),
        ...audit.examples.slice(1).map(item=>fact('readback',item.description,file.id+' · '+item.source,'readback'))
      ];
    }) : word ? wordFacts(file) : file.sheets.flatMap(sheet=>sheetFacts(file,sheet));
    const selected = [], seen = new Set();
    // Keep distinct values with a real source. Names and free-form source text never enter the report.
    for (const item of [...facts.filter(f=>f.kind==='readback'||f.kind==='rule'),...facts.filter(f=>f.kind!=='readback'&&f.kind!=='rule')]) {
      const key = item.kind+'|'+item.description;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(item);
      if (selected.length===12) break;
    }
    return {
      name,
      structure:word?file.paragraphCount+' 段 Word 正文':file.sheets.length+' 张工作表',
      facts:selected
    };
  }

  function fileCitations(selected){
    const groups=new Map();
    for(const {file,description,source} of selected){
      if(!groups.has(file))groups.set(file,{name:file.name,structure:file.structure,facts:[]});
      groups.get(file).facts.push({description,source});
    }
    return [...groups.values()];
  }
  function answer(reports, question='', purpose='interpret') {
    const topic = knownTopic(question);
    const facts = reports.flatMap(file=>file.facts.map(item=>({...item,file})));
    const matches = topic ? facts.filter(item=>item.key===topic) : facts;
    const explicit = matches.filter(item=>item.kind==='rule');
    const data = matches.filter(item=>item.kind==='data');
    const readback = facts.filter(item=>item.kind==='readback');
    if (purpose==='readback') {
      if(!readback.length)return {text:'汇总核对结果需要系统记录ID、字段、提交值和回读值。请上传含这几列的核对表。',cites:['verify'],attachmentCites:[]};
      const selected=readback.slice(0,4);
      return {text:'按附件里的提交值和回读值比对，'+selected.map(item=>item.description).join('。')+'。',attachmentCites:fileCitations(selected)};
    }
    const cite=(text,items,handoffReason)=>{
      const selected=items.slice(0,4);
      const excerpts=selected.map(item=>item.description+'（'+item.source+'）').join('\n');
      return {text:text+'\n\n'+excerpts,attachmentCites:fileCitations(selected),handoffReason};
    };
    if (explicit.length) return cite('我从附件中定位到以下条款。',explicit);
    const handoffReason='附件中暂无可引用的规则条款';
    if (data.length) {
      const verdict=topic?'这项规则待核实。附件里可以确认以下数据。':'附件里可以确认以下数据。适用规则需要对应的条款。';
      return cite(verdict,data,handoffReason);
    }
    const clues = matches.filter(item=>item.kind==='location');
    if (clues.length) return cite('我定位到了相关内容。判断适用条件还需要核对原段落。',clues,handoffReason);
    const conclusion=topic?'在已读取的附件里，暂时没有定位到这项规则。':'在已读取的附件里，暂时还没有定位到可引用的规则条款。';
    return {text:conclusion,handoffReason,attachmentCites:[]};
  }

  function overview(files){
    const readable=files.filter(file=>!file.error&&file.sections?.length);
    const shown=readable.slice(0,4);
    const lines=shown.map(file=>{
      const parts=file.sections.map(section=>[section.source,section.title].filter(Boolean).join(' · '));
      return '• '+[file.name,file.structure,...parts].filter(Boolean).join(' · ');
    });
    const sample=readable.flatMap(file=>file.sections.flatMap(section=>section.examples||[]))
      .find(example=>/^(样例|原文摘词) · /.test(example.description));
    if(!readable.length)return {text:'这批附件暂时读不出可核对的内容。',handoffReason:'附件内容未能识别'};
    const text='我读到了 '+readable.length+' 份附件的结构。\n\n'+lines.join('\n');
    const cited=readable.filter((file,index)=>index<shown.length||file.sections.some(section=>section.examples?.includes(sample)));
    const attachmentCites=cited.map(file=>({name:file.name,structure:file.structure,
      facts:file.sections.flatMap(section=>[{description:section.title,source:section.source},...(section.examples||[]).filter(item=>item===sample)])}));
    if(sample)return {text:text+'\n\n提取到的样例为「'+sample.description.replace(/^(样例|原文摘词) · /,'')+'」（'+sample.source+'）。',attachmentCites};
    return {text:text+'\n\n目前需要人工确认这些行所记录的业务内容。',handoffReason:'附件只识别出结构，具体内容待核对',attachmentCites};
  }

  const reply=(reports,question,purpose)=>answer(reports,question,purpose).text;
  root.FileRules = {isReadable,preview,report,reply,answer,overview,knownTopic};
})(window);
