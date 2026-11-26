(function(root){
  'use strict';
  const qmark=/怎么|怎样|如何|什么|多少|几[人个份张批]|上限|限制|能否|可否|能不能|可不可以|要不要|行不行|是否|为什么|规则|哪[里个些]|[?？]|[吗么](?:[，,。！!]|$)/;
  const importGuide=/(?:怎么|如何|怎样).*(?:导入|上传|填写|整理)|(?:导入(?![前后])|上传|填表|设班).*(?:怎么|如何|步骤|格式|流程)|(?:上传|添加附件)(?:入口)?(?:在哪|哪里)|(?:下载|获取).*(?:模板|示例)/;
  const seatTopic=/名额|余位|空位|还(?:能|可(?:以)?)报(?:名)?(?:几|多少)/;
  const seatRule=/上限|限制|规则|怎么算|如何计算|计算方式|(?:怎么|如何)(?:设置|分配)/;
  const attachmentText=/(?:附件|文件|表格|这份表)(?:里|中|上)/;
  const sensitive=q=>/绕过(?:权限|授权)|跳过审批|身份证|(?:其他学校|外校|跨校(?!区)).*?(?:课表|成绩|名额|名单|联系方式|导出)/.test(q)||
    /(?:查询|查一下|查下|查看|导出|调取|获取|发送|给我|下载).*?(?:手机号|联系方式|学生成绩|学员成绩)|全部.*(?:成绩|手机号)/.test(q)&&
    !/需要.*权限|权限.*(?:规则|要求)|规则|能不能查|能否查/.test(q);
  const transferTerms=/调班|转班|换班|调换班级|转校|换校/;
  const transferScopes={
    跨校:/跨校(?!区)|不同学校|其他学校|转校|换校/,
    跨校区:/跨校区|其他校区|不同校区|校区之间/,
    同校区:/同(?:一)?校区|本校区|校区内/
  };
  const fileLimits='对话支持 Excel（.xlsx、.xls）、CSV 和 Word（.docx）。一次最多 10 份，单份上限 10 MB。';
  const uploadHelp='在智能问答输入「解读附件」，按回复上传规则资料。打开教务排课可直接点击「上传设班资料」。';
  const importUploadHelp='打开「教务排课」，点击「上传设班资料」选择班级明细，可同时上传教师、教学区和招生预算资料。';
  const importSteps='识别完成后，依次确认资料与归属、字段和规则校验结果。校验通过后核对清单，再点击「确认导入」。缺资料时可在当前任务补传。';
  const oldImportSteps='系统会识别工作表和表头，完成字段转换及规则校验。需要确认的项会单独列出。校验通过后可核对清单，再点击「确认导入」。';
  const previousUploadReplies=new Map([
    [fileLimits+'点击输入框的「添加附件」选文件。',fileLimits+uploadHelp],
    [fileLimits+'在智能问答输入「解读附件」，按回复上传规则资料。在教务排课输入「整理设班资料」，按回复上传班级资料。桌面端也可将文件拖入输入框。',fileLimits+uploadHelp],
    ['在「教务排课」点「添加附件」选择 Excel，可一起上传预算表和 Word 说明。输入「整理设班资料」后发送，'+oldImportSteps,importUploadHelp+importSteps],
    ['在「教务排课」输入「整理设班资料」，点回复中的「上传设班资料」选择 Excel 再发送，可一起上传预算表和 Word 说明。'+oldImportSteps,importUploadHelp+importSteps]
  ]);
  const help={
    capabilities:{
      questions:[
        /^(?:你们?|您|教务助手|这个助手|这里)?(?:都|主要|具体)?(?:能(?:够)?|可以|会)(?:(?:帮|为)我们?)?(?:做(?:些|一些)?(?:什么|哪些(?:事(?:情)?|(?:教务)?工作|操作))|干(?:什么|嘛|吗)|处理(?:什么|哪些)(?:教务)?(?:工作|事项|业务|任务)?|解决(?:什么|哪些)(?:教务)?问题|提供(?:什么|哪些)帮助)$/,
        /^(?:(?:你们?|您|教务助手|这个助手|这里)(?:都|主要)?)?(?:有(?:什么|哪些)(?:功能|能力)|支持(?:什么|哪些)(?:教务)?(?:功能|工作|事项|业务|操作)?|是做什么的|是谁|功能介绍|帮助)$/,
        /^(?:怎么|怎样|如何)(?:用|使用|开始使用)(?:这个)?(?:助手|教务助手|(?:教务)?工作台)?$/
      ],
      loading:'正在整理功能说明…',
      text:'这里是智能问答。你可以查询教务规则和办理步骤，上传附件核对条款，也可以查询有权限的校区班级名额。需要教务确认时，可在原对话查阅通知和回复。'
    },
    formats:{
      questions:[
        /^(?:你们?|这里)?(?:支持|能|可以)(?:上传|传|识别|读取|解析|接收)?(?:哪些|什么)(?:(?:类型|格式)的)?(?:(?:文件|附件|资料|表格|文档)(?:格式|类型)?|文件格式|格式)$/,
        /^(?:上传的?)?(?:文件|附件|资料|表格|文档)(?:支持|能用)(?:什么|哪些)(?:格式|类型)$/,
        /^(?:支持|(?:能|可以)(?:上传|识别|读|读取|解析))(?:Excel|XLSX?|CSV|Word|DOCX?|PDF|图片)(?:文件|文档|格式)?[吗么]?$/i,
        /^(?:Excel|XLSX?|CSV|Word|DOCX?|PDF|图片)(?:文件|文档|格式)?(?:能|可以)(?:上传|识别|读取|解析)[吗么]?$/i,
        /^(?:一次|一个任务|每次)?(?:最多)?(?:能|可以)?(?:上传|传|添加|发|发送)(?:最多)?(?:多少|几)(?:个|份|张)(?:附件|文件|资料|表格)?$/,
        /^(?:单份|单个|每个|每份)?(?:文件|附件|资料)(?:(?:最大|限制)?(?:多大|多少)|(?:大小|上传)?(?:上限|限制)(?:是(?:多少|什么))?)$/
      ],
      text:fileLimits+uploadHelp
    },
    templates:{
      questions:[
        /^(?:请|帮我|我想|我要)?(?:下载|打开|给我|发我|怎么下(?:载)?|如何下载|哪(?:儿|里)下载|有没有|有|哪里有)?(?:设班(?:资料)?)?(?:空白模板|标准模板|模板|填写示例)(?:在(?:哪儿|哪里|哪)(?:下(?:载)?)?|怎么下(?:载)?|如何下载|在哪找)?[吗么]?$/
      ],
      text:'「设班模板」里可以下载空白 Excel 和填写示例。空白模板包含班级资料和招生预算两张表。',
      action:{label:'打开设班模板',act:'templates'}
    },
    mapping:{
      questions:[/^(?=.*(?:表头|字段映射|字段转换))(?=.*(?:怎么|怎样|如何|在哪|哪里|找不到|没识别|识别错|识别不准|是什么意思))/],
      text:'打开任务的「字段核对」，先对照来源、原字段与值、系统字段与值。要改映射，展开「查看并调整表头映射」，选择工作表和表头所在行，再展开「调整来源列与系统字段」。',
      cites:['import']
    },
    audit:{
      questions:[
        /^(?:请|帮我|怎么|怎样|如何|(?:在)?哪(?:里|儿)(?:可以|能)?)?(?:下载|导出)(?:本次|这份)?(?:回读核对表|核对表|回读结果|核对结果)(?:CSV)?$/i,
        /^(?:回读核对表|核对表|回读结果|核对结果)(?:CSV)?(?:怎么|如何|在哪(?:里|儿)?)(?:下载|导出)$/i
      ],
      text:'从「教务排课」左侧打开对应任务，进入「导入回读」，点击「下载核对表 CSV」。表里有系统记录编号、班级、字段、提交值、回读值和核对结果。'
    },
    tasks:{
      questions:[/^(?:怎么(?:打开|看|查|查看)|如何(?:打开|查看)|在哪(?:里|儿)?(?:找|看|查)|(?:查看|打开))?(?:设班)?任务记录(?:在(?:哪儿|哪里|哪)|怎么查看|怎么打开)?$/],
      text:'在「教务排课」左侧的「排课任务」中选择任务，可继续当前步骤或查看回读结果。'
    },
    handoff:{
      questions:[/^(?:查|查看|打开)?(?:转接记录|人工工单|教务回复)(?:在(?:哪里|哪儿|哪)|怎么查看|怎么打开)?$/],
      text:'打开原问答对话，在通知卡点「查看通知」或「查阅消息」，可核对钉钉通知和老师回复。'
    },
    history:{
      questions:[
        /^(?:我的)?(?:历史会话|历史对话|会话历史|对话历史|历史聊天|会话记录|对话记录)(?:在(?:哪儿|哪里|哪)|怎么(?:查看|找|删(?:除)?)|(?:能|可以)删(?:除)?[吗么])?$/,
        /^(?:怎么|如何|怎样)(?:删(?:除)?|查看|找到)(?:一条|我的)?(?:历史会话|历史对话|会话|对话|历史聊天)$/
      ],
      text:'从「智能问答」左侧的「会话」打开对话。要删除时，点对应会话旁的「···」并确认。'
    },
    knowledge:{
      questions:[/^(?:怎么(?:打开|使用)|如何(?:打开|使用)|打开)?知识中心(?:在(?:哪儿|哪里|哪)|怎么用|有什么用|怎么使用)?$/],
      text:'直接在这里问要查的教务事项。答复有引用时，点开条目标题即可核对出处和适用条件。'
    },
    teachingRules:{
      questions:[/^(?:我想|我要|帮我|请)?(?:查(?:询|看)?(?:一下)?|了解(?:一下)?|说下)?(?:有哪些)?(?:教务规则|教务制度|规则查询)(?:有哪些|怎么查|在哪(?:里)?查)?$/],
      topic:'teaching-rules',
      text:'你想查哪项教务规则？直接告诉我事项或场景即可，例如「调课审批通过后能撤回吗」。'
    },
    classChange:{
      topic:'class-change',
      text:'你说的「调班」是指学员从原班换到另一个班，还是调整班级的上课时间？'
    },
    studentChange:{
      questions:[/^(?:学员|学生)(?:的)?调整(?:的)?(?:规则|责任归属|由谁负责)$/],
      text:'你提到的学员调整具体指哪项业务？可以直接说要换班、转校，或说明其他变更。'
    },
    notices:{
      questions:[/^(?:怎么(?:打开|使用)|如何(?:打开|使用)|打开)?公告工作台(?:在(?:哪儿|哪里|哪)|怎么用|怎么使用)?$/],
      text:'公告工作台已撤下。你可以直接查询公告编写规则，例如需要写明哪些事项。'
    }
  };

  function classRule(question,previous){
    const mentioned=transferTerms.test(question);
    const pending=previous==='class-change';
    const student=/学员|学生|转班|换班|转校|换校/.test(question);
    const lesson=/调课|调整(?:已有)?(?:课表|排课|(?:班级的?)?上课时间)/.test(question);
    const scope=Object.keys(transferScopes).find(key=>transferScopes[key].test(question));
    const scopeReply=/^(?:那如果|那|如果|是|在|能不能|能否|能|可以|想查|查)?(?:同校区|同一校区|本校区|校区内|跨校区|其他校区|不同校区|跨校|不同学校)(?:呢|的|怎么样|怎么办|怎么处理|行吗|可以吗|吗)?$/.test(question);
    const studentReply=/^(?:我问的|我说的|我指的|是|说的是|指的是|就是)?(?:学员|学生)(?:的|那种)?$/.test(question);
    const wantsStudent=pending&&/^(?:前者|第(?:一|1)种|第(?:一|1)个)$/.test(question);
    const wantsLesson=pending&&/^(?:后者|第(?:二|2)种|第(?:二|2)个)$/.test(question);
    const followsUp=wantsStudent||(pending||previous==='transfer-rule')&&(scopeReply||studentReply);
    if(wantsLesson||(mentioned||pending)&&lesson&&!student){
      if(/入口|在哪|哪儿|怎么操作|审批记录|申请记录/.test(question))return {kind:'answer',doc:'guide'};
      return {kind:'answer',doc:'schedule',focus:/审批中|待审批|还没|审批前/.test(question)?'pending':'overview'};
    }
    if(!mentioned&&!followsUp)return null;
    return student||scope||followsUp?{kind:'transfer-rule',scope}:{kind:'help',topic:'classChange'};
  }

  function route(input,previous=''){
    const q=input.replace(/\s+/g,'');
    if(sensitive(q))return {kind:'answer',doc:'access'};
    if(/^(你好[呀啊哇]?|您好[呀啊]?|早上好|早|嗨|哈喽|在吗|hello|hi)[!?！？。～~]*$/i.test(q))return {kind:'greet'};
    const question=q.replace(/^(?:你好|您好)[，,。！!]+/,'').replace(/^请问[，,：:]*/,'').replace(/[!?！？。～~]+$/,'');
    const helpTopic=Object.keys(help).find(key=>help[key].questions?.some(pattern=>pattern.test(question)));
    if(helpTopic)return {kind:'help',topic:helpTopic};
    if(/^(?:谢谢|感谢|多谢|好的|好|收到|明白了|知道了|了解了)$/.test(question))return {kind:'acknowledge'};
    if(/^(?:你|助手)?(?:刚才|目前|现在)?(?:能|可以|已经)?(?:从(?:这份|刚才的)?(?:附件|文件|资料|表格)(?:里|中)?)?(?:读(?:取)?|识别|提取|看)(?:出|到)?(?:了)?(?:什么|哪些(?:内容|信息|数据))$/.test(question)||
       /^(?:这份|这批|刚才的)?(?:附件|文件|资料|表格)(?:里|中)?(?:都)?有(?:什么|哪些内容)$/.test(question))return {kind:'file-overview'};
    if(!/附件|文件|表格|这份表/.test(q)){
      const rule=classRule(question,previous);
      if(rule)return rule;
    }
    if(seatTopic.test(q)&&!attachmentText.test(q)){
      if(!seatRule.test(q)&&!/(?:不要|不用|先别|暂不)(?:再|先)?(?:查询|查|看)/.test(q))return {kind:'seat-lookup'};
      if(/班级|班额/.test(q)&&seatRule.test(q))return {kind:'answer',doc:'capacity'};
    }
    const edit=q.match(/(?:班额|容量)(?:统一|都|全部|请|先|一起|给我|帮我|人数|的人数|人数上限)*(?:改(?:成|为|到)?|调整(?:为|到)?|设(?:成|为)?|填(?:为)?|补(?:为)?|是)(\d{1,3})/);
    if(edit&&!qmark.test(q)&&!/(?:别|勿|不要|不用|无需).*(?:改|调|设|填|补)|可以.*(?:改|调)/.test(q))return {kind:'edit',key:'capacity',value:Number(edit[1]),all:/全部|所有|每个|都改|统一/.test(q)};
    if(/^(?:请|帮我)?(?:确认|开始|执行|现在)(?:导入|写入|提交)[!！。]?$/.test(q))return {kind:'confirm'};
    if(/(?:先别|先不|不要|暂不|别|暂缓)(?:导入|写入|提交)/.test(q)&&!/整理|上传|校验|识别|看看|核对/.test(q))return {kind:'hold'};
    if(/(?:重试|重新|再)(?:回读|查询回执|核对结果)/.test(q)&&!qmark.test(q)&&!/(?:别|不要|不用|无需|不必|先不|暂不).*(?:重试|重新|再)/.test(q))return {kind:'reread'};
    if(/(?:查|查看|看看|打开|继续|返回|进度|状态).*(?:当前任务|这个任务|任务进度|核对表|设班任务|任务卡)|(?:任务|导入)(?:进度|状态|结果)|做到哪/.test(q))return {kind:'status'};
    if(importGuide.test(q))return {kind:'answer',doc:'import'};
    if(/班额|班均|容量/.test(q)&&qmark.test(q))return {kind:'answer',doc:'capacity'};
    if(/(?:帮我|请|开始|我要|麻烦|新建|发起|需要|重新|先|继续)?(?:整理|识别|新建|上传|导入|校验|核对).*(?:设班|这份|这张|这个|本次|资料|预算表|班级|excel|表格|任务)|(?:设班资料|这份表|这张表|excel).*(?:整理一下|整理下|整理好|帮我整理)|^(?:设班|整理资料|开始整理)$/i.test(q))return {kind:'prepare'};
    if(/按钮|报错|不可用|点不了|没有反应/.test(q)&&(/调课|审批|撤回/.test(q)||['schedule','guide'].includes(previous)))return {kind:'answer',doc:'failure'};
    if(/调课|撤回|恢复.*课表|审批通过|待审批|审批中|已审批|审批前|还没(?:批|审)/.test(q)||(previous==='schedule'||previous==='guide')&&/^(那|如果|假如|已经|还没|还在|然后)/.test(q)){
      if(/入口|在哪|哪儿|怎么操作|审批记录|申请记录/.test(q))return {kind:'answer',doc:'guide'};
      return {kind:'answer',doc:'schedule',focus:/审批中|待审批|还没|审批前/.test(q)?'pending':'schedule'};
    }
    if(/班额|班均|容量/.test(q))return {kind:'answer',doc:'capacity'};
    if(/预算|校区|任务归属/.test(q)&&qmark.test(q))return {kind:'answer',doc:'scope'};
    if(/权限|个人成绩|其他学校/.test(q))return {kind:'answer',doc:'access'};
    if(/期次|第[一二三四1-4]期|时段|排课冲突|教师冲突|(?:教师|老师).*(?:排课|设班|安排|科目|冲突)/.test(q))return {kind:'answer',doc:'teacher'};
    if(/回读|写入|差异|写前校验|规则校验|导入前.*(?:核对|校验|检查)|导入后.*(?:核对|校验|检查)/.test(q))return {kind:'answer',doc:'verify'};
    if(/公告|通知/.test(q)&&!/选课/.test(q))return {kind:'answer',doc:'notice'};
    if(/选课/.test(q))return {kind:'answer',doc:'selection'};
    return {kind:'clarify'};
  }
  function filePurpose(input,hasFiles=false){
    const text=input.replace(/\s+/g,'');
    if(!text)return hasFiles?'choose':'';
    const specific=/附件|(?:这|该|上面|刚才)(?:一)?(?:份|张|个)?(?:表|文档|文件|Excel|Word|资料|核对表)|表(?:格)?里|(?:文件|文档|资料)(?:里|中)/i;
    if(importGuide.test(text)&&!specific.test(text))return '';
    const explicitInterpret=/^(?:请|帮我|麻烦|想|我想|先|只|仅)*(?:(?:查找|解读|解释)(?:一下|下)?(?:附件)?(?:规则|条款)|(?:解读|解释)(?:一下|下)?(?:这份|该)?附件|规则解读)[。！]?$/i;
    const ruleTopic=/规则|条款|政策|规定|班额上限|限制/;
    const interpret=explicitInterpret.test(text)||(specific.test(text)&&ruleTopic.test(text)&&/查找|解读|解释|核对|总结|汇总|提炼|归纳|是什么|有没有|多少|[?？]/.test(text));
    const auditTopic=/核对表|核对结果|回读结果|回读值/;
    const auditAction=/汇总|查看|看看|解读|列出|统计|比对|有没有|哪些|[?？]/;
    const explicitRecap=/^(?:请|帮我|先|我想|我要)*(?:汇总|统计)(?:一下)?(?:核对结果|回读结果)[。！]?$/.test(text);
    const recap=explicitRecap||(hasFiles||specific.test(text))&&auditTopic.test(text)&&auditAction.test(text);
    const prepare=/^(?:请|帮我|先|继续|开始)*(?:设班|设班整理|整理设班|整理设班资料|整理成班级清单|排课|教务排课|整理排课资料)[。！]?$/.test(text) ||
      /(?:整理|生成|转换|制成|按模板核对|新建|发起).*?(?:设班(?:资料|任务|清单|预算表|表格)?|班级资料|班级清单|班级列表)(?!的?(?:规则|条款|要求|政策))/i.test(text);
    const wantsInterpret=interpret&&!/(?:不需要|不用|别|不要|无需|暂不)(?:再|先|自动|直接)*(?:查找|解读|解释)/.test(text);
    const wantsPrepare=prepare&&!importGuide.test(text)&&!/(?:不需要|不用|别|不要|无需|不是|暂不)(?:再|先|自动|直接)*(?:设班|整理(?!规则)|生成班级|新建设班)/.test(text);
    const wantsReadback=recap&&!/(?:不需要|不用|别|不要|无需|暂不)(?:先|再)?(?:汇总|查看|比对|统计)/.test(text);
    const purposes=[wantsPrepare&&'prepare',wantsInterpret&&'interpret',wantsReadback&&'readback'].filter(Boolean);
    if(purposes.length===1)return purposes[0];
    if(purposes.length>1||hasFiles&&(specific.test(text)||/看看|查看表格数据|查看附件内容|整理一下|整理成表格|识别内容/.test(text)))return 'choose';
    return '';
  }

  const detailQuestions={
    scope:/缺|没填|没识别|漏填|待确认|怎么补|多个|几[个份]/,
    teacher:/教师|老师|冲突|重叠|同一时段/,
    verify:/回读|导入后|差异|提交值/,
    selection:/结果|查不到|查询|怎么查/
  };
  function reply(intent,doc,question=''){
    if(intent.doc==='schedule'&&intent.focus==='overview')return doc.body.split('\n\n')[0];
    if(intent.doc==='schedule')return intent.focus==='pending'?'还在待审批状态时，发起人可以在申请详情中撤回。打开「排课管理 → 调课申请」，核对状态后选择「撤回」。':'审批通过后，如需恢复原安排，请另行提交恢复申请，注明原申请编号，由学校管理员审核。待审批的申请可由发起人撤回。';
    if(intent.doc==='import')return importUploadHelp+importSteps;
    if(intent.doc==='verify'&&/回读|回执/.test(question)&&/超时|失败|重试|重新|重复/.test(question)){
      return '在原设班对话点任务卡，进入「导入回读」，点击「重试回读」。系统按原回执的记录编号重新查询并比对字段，沿用本次的导入记录。';
    }
    if(intent.doc==='verify'&&/差异/.test(question)&&/查看|怎么看|在哪|怎么处理|怎么办/.test(question)){
      return '打开原任务的「导入回读」，点击「仅看差异」。按班级和字段核对提交值、回读值及系统记录编号。可以下载核对表交给负责人复核。';
    }
    if(intent.doc==='verify'&&/回读|导入后/.test(question)&&/查看|怎么看|在哪/.test(question)){
      return '在原设班对话点任务卡，进入「导入回读」。回读核对表按班级展示提交值、实际保存值和核对结果。';
    }
    if(intent.doc==='capacity'&&/班均/.test(question))return doc.body;
    const [overview,detail]=doc.body.split('\n\n');
    return detail&&detailQuestions[intent.doc]?.test(question)?detail:overview;
  }
  root.DeskIntent={route,reply,filePurpose,help,transferTerms,transferScopes,sensitive,
    updateUploadReferences:text=>previousUploadReplies.get(text)??text,isQuestion:question=>qmark.test(question.replace(/\s+/g,''))};
})(window);
