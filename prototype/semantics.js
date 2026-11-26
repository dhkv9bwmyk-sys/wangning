(function(root){
  'use strict';
  const A=root.DeskIntent;
  const commonTerms=[
    [/(?:教务归则|教务规择|教物规则)/g,'教务规则'],
    [/(?:调客|调棵)(?=申请|撤回|审批|规[则择]|流程|[？?。！!]|$)/g,'调课'],
    [/调斑(?=(?:教务)?规[则择]|归责|申请|审批|[？?。！!]|$)/g,'调班'],
    [/转般(?=规[则择]|归责|手续|申请|[？?。！!]|$)/g,'转班'],
    [/设般(?=资料|表格|模[板版]|任务|清单|预算|流程|[？?。！!]|$)/g,'设班'],
    [/(调课|调班|转班|换班|设班|班额|附件)(?:归则|规择)/g,'$1规则'],
    [/模版/g,'模板'],
    [/班额上先|班额上线(?=是多少|多少|限制|[？?。！!]|$)/g,'班额上限'],
    [/核对标(?=怎么|如何|在哪|下载|导出|[？?。！!]|$)/g,'核对表'],
    [/回度(?=超时|失败|结果|校验|核对|[？?。！!]|$)/g,'回读'],
    [/做点(?:啥|什么)/g,'做些什么'],
    [/在码(?=[？?。！!]|$)/g,'在吗']
  ];
  const responsibility=/归责|责任(?:归属|分工|人|划分)|由谁|谁(?:负责|办理|处理|审批|审核|跟进)|找谁|哪个(?:部门|岗位)(?:负责|办理|审批)/;
  const compact=text=>text.replace(/\s+/g,'').replace(/[!?！？。～~]+$/,'');
  const candidate=text=>compact(text).replace(/^(?:请问|我说的是|我问的是|我想(?:查|问)|帮我(?:查询|查|问)(?:一下)?|查一下|就是|是|那)[，,：:]*/,'');

  function followUp(text,options){
    const choice=candidate(text);
    if(/^(?:前者|第[一1]种|规则|规章|规定|条款|(?:学员)?(?:调班|转班)(?:的)?规则)$/.test(choice))return options.rules;
    if(/^(?:后者|第[二2]种|归责|责任(?:归属|分工)?|(?:问)?(?:转班)?(?:由)?谁(?:来)?(?:负责|办理|处理|审批|审核)|谁的责任)$/.test(choice))return options.responsibility;
  }

  function clarify(text,topic){
    const question=candidate(text);
    const scope=Object.keys(A.transferScopes).find(key=>A.transferScopes[key].test(question));
    const wording=scope?question.replace(A.transferScopes[scope],''):question;
    const transfer=topic==='transfer-rule'||A.transferTerms.test(wording);
    if(!/^(?:(?:学员|学生)(?:的)?(?:调整|调班|转班|换班)(?:的)?)?归责(?:是什么|呢)?$/.test(wording))return null;
    if(!transfer&&!/学员|学生/.test(wording))return null;
    const subject=(scope||'')+(transfer?'学员转班':'学员调整');
    const options={rules:subject+'规则',responsibility:subject+'责任归属'};
    return {question:'你是想查「'+options.rules+'」，还是想问「'+subject+'由谁负责」？',options};
  }

  function understand(value,{topic='',pending}={}){
    const text=String(value??'').trim();
    const clean=text.replace(/[\u200B\uFEFF]/g,'');
    const selected=pending&&followUp(clean,pending);
    if(selected)return {text,query:selected,interpretation:selected};
    const seatContext=/校区|班级|C\d{1,2}/i.test(clean);
    let query=clean.split(/(「[^」]*」|“[^”]*”|『[^』]*』|\x60[^\x60]*\x60|"[^"]*")/).map((part,index)=>{
      if(index%2)return part;
      const words=commonTerms.reduce((result,[pattern,meaning])=>result.replace(pattern,meaning),part);
      return seatContext?words.replace(/(还(?:有|剩)?(?:多少|几个)?|剩余(?:多少|几个)?|有没(?:有)?)(?:位子|可报位置)/g,'$1名额'):words;
    }).join('');
    const clarification=clarify(query,topic);
    if(clarification)return {text,query,clarification};
    if(topic==='transfer-rule'&&!A.transferTerms.test(query)){
      query=query.replace(/^(?:(?:那|请问|我想查|帮我查)[，,]?)?((?:跨校区|同校区|跨校)?)(?:学员|学生)(?:的)?调整(?=(?:的)?(?:规则|归责|责任|由谁|谁负责))/,'$1学员转班');
    }
    if(topic==='capacity'&&/^(?:那|那么|还有)?(?:上限|最多(?:多少|几)人)(?:呢|是多少|是多少人)?$/.test(compact(query))){
      query='班额'+query.replace(/^(?:那么|那|还有)[，,]?/,'');
    }
    return {text,query,interpretation:query!==clean?query.slice(0,140):undefined};
  }

  root.DeskSemantics={understand,responsibility};
})(window);
