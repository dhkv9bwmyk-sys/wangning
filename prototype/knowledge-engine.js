(function(root){
  'use strict';
  const A=root.DeskIntent,E=root.DeskSemantics,Q=root.DeskSeatLookup;
  const role='教务管理员';
  const recallLimit=6,answerLimit=1600;
  const faqCache=new Map();
  const referenceDocs={
    'usage-guide':{
      id:'usage-guide',file:'教务助手使用手册.docx',title:'对话与办理入口',page:'教务助手 / 对话',version:'1.0',
      body:'智能问答支持规则和操作查询、附件条款核对、授权校区的班级名额查询。在对应回复中上传规则资料，发送后可查看结构、样例和出处。左侧「会话」可以打开原对话。\n\n打开教务排课后直接上传设班资料，按资料识别、字段核对、规则校验和导入回读办理。可在当前任务补充资料，并从侧栏打开已有任务继续核对。'
    },
    'handoff-procedure':{
      id:'handoff-procedure',file:'教务问题转接处理规范.docx',title:'缺少适用依据时的处理',page:'智能问答 / 教务协同',version:'1.0',
      body:'暂时缺少可引用的条款时，先向提问人说明核查结果，再将问题转本校教务核实。\n\n钉钉通知包含问题、转接原因和必要的附件线索。教务查看或回复后，提问人可在原对话查看处理状态和回复。'
    }
  };
  const helpSources={formats:'import',templates:'import',mapping:'import',audit:'verify',tasks:'verify',
    notices:'notice',handoff:'handoff-procedure'};
  const faq=[
    {topic:'formats',questions:['支持上传哪些文件格式','一次能传几份文件','附件支持什么格式']},
    {topic:'templates',questions:['设班模板在哪下载','有填写示例吗']},
    {topic:'audit',questions:['在哪里下载核对表','核对表怎么下载']}
  ];
  const normalize=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\d]/gu,'');
  const searchText=text=>normalize(text).replace(/请问|帮我|我想|可以|能不能|可不可以|怎么|怎样|如何|多少|是什么|有哪些|什么|需要|规则|条款|流程|吗|呢/g,'');
  const grams=text=>[...new Set(Array.from({length:Math.max(0,text.length-1)},(_,i)=>text.slice(i,i+2)))];
  const isHeading=/^(?:#{1,6}\s+\S|第[一二三四五六七八九十百\d]+条(?:[、.．\s]|$)|\d+[、.．]\s*\S)/;
  const continuation=/^(?:适用(?:条件|范围|对象)|前置条件|办理条件|附加条件|条件|例外(?:情况|处理)?|限制|优先级|备注|注意|但|除非|否则|其中)(?:[：:，、\s]|$)|^(?:但(?:是|需|须|不)?|除非|否则)/;

  function split(body){
    const units=String(body??'').replace(/\r\n?/g,'\n')
      .split(/\n\s*\n|\n(?=\s*(?:#{1,6}\s|第[一二三四五六七八九十百\d]+条[、.．\s]|\d+[、.．]\s))/)
      .map(part=>part.trim()).filter(Boolean);
    const chunks=[];
    let heading='';
    for(const unit of units){
      const first=unit.split('\n')[0];
      const title=first.replace(/^(?:#{1,6}\s+|第[一二三四五六七八九十百\d]+条[、.．\s]*|\d+[、.．]\s*)/,'');
      if(chunks.length&&continuation.test(title)){
        chunks[chunks.length-1]+='\n\n'+unit.replace(/^#{1,6}\s+/,'');
      }else if(isHeading.test(first)){
        heading=first.replace(/^#{1,6}\s+/,'');
        const tail=unit.slice(first.length).trim();
        chunks.push(tail?heading+'\n'+tail:heading);
      }else if(chunks.length&&chunks.at(-1)===heading){
        chunks[chunks.length-1]+='\n\n'+unit;
      }else chunks.push(heading?heading+'\n'+unit:unit);
    }
    return chunks;
  }

  function visible(doc,env){
    if(!doc||doc.draft)return false;
    const scope=doc.scope||{};
    return (!scope.schoolId||scope.schoolId===env.schoolId)&&
      (!scope.roles?.length||scope.roles.includes(env.role))&&
      (!env.page||!scope.page||scope.page===env.page);
  }

  function retrieve(question,env,{related=false,matchTopic,customOnly=false}={}){
    const query=searchText(question), terms=grams(query);
    const candidates=[];
    for(const doc of env.docs.values()){
      if(!visible(doc,env)||customOnly&&!doc.id.startsWith('KB-'))continue;
      const words=[doc.title,...(doc.keywords||[])].map(searchText).filter(word=>word.length>=3);
      const exact=words.some(word=>query.includes(word));
      const titleCoverage=terms.filter(term=>words.some(word=>word.includes(term))).length/Math.max(1,terms.length);
      for(const [index,text] of split(doc.body).entries()){
        if(matchTopic&&!matchTopic(doc,text))continue;
        const body=searchText(text);
        const hits=terms.filter(term=>body.includes(term)).length;
        const coverage=hits/Math.max(1,terms.length);
        const phrase=query.length>=4&&body.includes(query);
        const keywordScore=exact?1:titleCoverage>=.22?titleCoverage:0;
        const bodyScore=phrase?1:hits>=2?coverage:0;
        if(!keywordScore&&!bodyScore&&!matchTopic)continue;
        candidates.push({doc,index,text,exact,phrase,hits,keywordScore,bodyScore,
          score:keywordScore*.45+bodyScore*.55+(matchTopic ? .35 : 0)});
      }
    }
    const select=field=>candidates.filter(item=>item[field]>0).sort((a,b)=>b[field]-a[field]||b.score-a.score).slice(0,recallLimit);
    const keyword=select('keywordScore'), body=select('bodyScore');
    const topical=matchTopic?candidates.sort((a,b)=>b.score-a.score).slice(0,recallLimit):[];
    const ranked=[...new Map([...keyword,...body,...topical].map(item=>[item.doc.id+':'+item.index,item])).values()]
      .sort((a,b)=>b.score-a.score||b.bodyScore-a.bodyScore||b.hits-a.hits);
    const best=ranked.find(item=>matchTopic||item.exact||item.phrase||
      item.hits>=3&&item.bodyScore>=(related ? .36 : .30)&&item.score>=(related ? .24 : .22));
    return {candidateIds:[...new Set(ranked.map(item=>item.doc.id))],best};
  }

  function inspect(input,intent,env){
    const question=input.query;
    const {schoolId,role:actor}=env;
    const done=(type,action,response={},retrieval)=>{
      const sources=response.cites||[];
      const [label,state,detail]={
        faq:['查找办理说明','done','已找到适用的说明'],
        answer:sources.length?['核对规则依据','done','已找到可引用的条款']:['整理办理指引','done','已找到对应操作'],
        clarify:['确认查询事项','attention','待补充关键信息'],
        handoff:['查找适用依据','attention','待学校教务核实'],
        refuse:['核对查询权限','attention','当前账号超出授权范围'],
        data:['核对查询权限','done','当前账号已获授权']
      }[action];
      return {...response,decision:{intent:type,action,cites:sources,candidates:retrieval?.candidateIds||[]},
        fileTrace:[{label,state,detail}]};
    };
    if(input.clarification)return done('需求澄清','clarify',{text:input.clarification.question});
    if(intent.kind==='seat-lookup'){
      const scope=Q.checkAccess(input.text);
      return done('数据查询',scope.state==='denied'?'refuse':scope.state==='missing'?'clarify':'data');
    }
    if(intent.kind==='help'){
      const entry=faq.find(item=>item.topic===intent.topic&&item.questions.some(prompt=>normalize(prompt)===normalize(question)));
      const response=A.help[intent.topic];
      const source=helpSources[intent.topic]||'usage-guide';
      const doc=env.docs.get(source)||referenceDocs[source];
      if(!visible(doc,env))return done(entry?'常见问题':'操作指引','handoff',
        {text:'暂未找到适用的办理说明。',handoffReason:'知识中心暂无适用答案'});
      if(entry){
        const key=[schoolId,actor,doc.id,doc.page,doc.version,doc.reviewedAt||'',normalize(question)].join('|');
        const cached=faqCache.get(key)||{...response,cites:[doc.id]};
        faqCache.set(key,cached);
        return done('常见问题','faq',cached);
      }
      const needsDetail=['classChange','teachingRules','studentChange'].includes(intent.topic);
      return done(needsDetail?'需求澄清':'操作指引',needsDetail?'clarify':'answer',{...response,cites:[doc.id]});
    }
    if(intent.kind==='transfer-rule'){
      const label=intent.scope==='跨校'?'跨校转班或转校':(intent.scope||'学员')+'转班';
      const duties=E.responsibility.test(question);
      const subject=label+(duties?'责任分工':'')+'条款';
      const requestedScope=A.transferScopes[intent.scope];
      const matched=retrieve(question,env,{matchTopic:(doc,part)=>{
        if(!A.transferTerms.test(doc.title+'\n'+part))return false;
        if(duties&&!/责任|负责|分工|办理人|审批人|审核人|(?:由|交).{1,25}(?:受理|审核|审批|办理|跟进)/.test(part))return false;
        if(!requestedScope||requestedScope.test(part))return true;
        return requestedScope.test(doc.title)&&!Object.values(A.transferScopes).some(pattern=>pattern.test(part));
      }});
      return matched.best?done('规则查询','answer',sourceAnswer(matched.best,'transfer-rule'),matched):
        done('规则查询','handoff',{topic:'transfer-rule',text:'暂无可引用的'+subject+'。',
          handoffReason:'缺少'+subject,question:A.transferTerms.test(question)?question:label+(duties?'责任归属':'规则')},matched);
    }
    if(intent.kind==='answer'){
      const doc=env.docs.get(intent.doc);
      const type=intent.doc==='failure'?'故障诊断':doc?.category==='流程'?'操作指引':'规则查询';
      if(intent.doc==='access'&&A.sensitive(question.replace(/\s+/g,''))){
        return done('越权敏感','refuse',{text:'当前账号无权提供这类信息或执行此项操作。请通过学校管理员核验授权。',
          cites:visible(doc,env)?[doc.id]:undefined,topic:'access'});
      }
      if(!visible(doc,env))return done(type,'handoff',{text:'暂未找到适用条款。',handoffReason:'知识中心暂无适用答案'});
      const related=intent.doc!=='access'?retrieve(question,env,{related:true,customOnly:true}):null;
      const cites=[doc.id];
      if(doc.id==='schedule'&&visible(env.docs.get('guide'),env))cites.push('guide');
      let text=A.reply(intent,doc,question);
      let citeChunks;
      if(related?.best&&related.best.text.length+text.length<=answerLimit){
        const {doc:source,index,text:excerpt}=related.best;
        cites.push(source.id);
        citeChunks={[source.id]:index+1};
        text+='\n\n「'+source.title+'」· '+(source.page||'适用范围待核对')+'\n'+excerpt;
      }
      return done(type,'answer',{text,cites,citeChunks,topic:doc.id,
        action:doc.id==='import'?{label:'去教务排课',act:'nav',id:'schedule'}:undefined},related);
    }
    if(/^(?:(?:请|麻烦|能不能|可以)?(?:你)?(?:帮我)?(?:查|看|处理|整理|确认|核对)(?:一下|下)|帮个忙|请帮忙)$/.test(normalize(question))){
      return done('需求澄清','clarify',{text:'你想查哪项教务信息，或需要我处理什么事？直接告诉我具体事项就行。'});
    }
    const matched=retrieve(question,env);
    if(matched.best)return done('知识查询','answer',sourceAnswer(matched.best),matched);
    return done('知识查询','handoff',{text:'暂未找到能回答这个问题的依据。',handoffReason:'知识中心暂无适用答案'},matched);
  }

  function sourceAnswer(match,topic=match.doc.id){
    const text=match.text.length<=answerLimit?match.text:'已匹配「'+match.doc.title+'」。打开引用可核对完整条款、条件与例外。';
    return {text,cites:[match.doc.id],citeChunks:{[match.doc.id]:match.index+1},topic};
  }

  root.DeskKnowledge={role,split,visible,retrieve,inspect,referenceDocs};
})(window);
