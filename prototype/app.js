(function(root){
  'use strict';
  const S=root.DeskState,U=root.DeskUI,V=root.DeskTaskView,D=root.PrepDesk,I=root.ClassPrepImport,R=root.DeskRecords,K=root.DeskServices,A=root.DeskIntent,C=root.ClassPrep,F=root.FileRules;
  const Q=root.DeskSeatLookup;
  const E=root.DeskSemantics;
  const {$,esc,btn,attr,toast,setupPage,activeSetup,chatMessages}=U;
  const activeWrites=new Set();
  const attachmentPace={received:360,read:650,identify:650,inspect:840,merge:650};
  const textReplyPace=720;
  const seatLookupPace={access:550,read:650};
  const setupSampleFiles=['暑期班级明细.xlsx','暑期招生预算.xlsx','暑期教师安排.xlsx','暑期教学区对照.xlsx'];
  const purposes={prepare:'整理设班资料',interpret:'查找附件条款',readback:'汇总核对结果'};
  const purposeProgress={prepare:'正在检查设班所需字段',interpret:'正在查找附件条款',readback:'正在比对提交值和回读值'};
  const confirmAction={
    edit:'请说清楚要修改的班级、字段和目标值，例如「把第 1 个班的班额改为 18」。',
    confirm:'请在待导入清单核对范围和数量，再点击「确认导入」。',
    reread:'如果你要重新核对已导入记录，请明确回复「重试回读」。'
  };
  const introduction='你好，我是教务助手。';
  const greeting=introduction+'今天需要我帮你做什么？';
  const schedulingHelp='这里是教务排课。上传班级资料后，依次确认资料、字段和校验结果，再确认导入并查看回读。';
  const areaLink=area=>({label:'去'+U.areas[area].label,act:'nav',id:area});
  const currentTask=()=>S.tasks.get(S.dialog?.id)||S.tasks.get(S.pane?.id);
  const here=c=>S.page==='chat'&&S.chatId===c.id;
  function redraw(){U.renderMain();}
  function bottom(){requestAnimationFrame(()=>{const e=$('#chat-scroll');if(e)e.scrollTop=e.scrollHeight;});}
  function clearComposer(input){
    if(input?.example)return;
    S.draftText.delete(S.chatId);
    const box=$('#question');if(box)box.value='';
  }
  function openFilePicker(input){
    if(!input?.matches('input[type="file"]'))throw Error('文件选择器暂不可用，请刷新页面后重试。');
    input.click();
  }
  function attachInChat(){
    if(U.areaOf(U.chat())==='history')return;
    if(S.page!=='chat')present('chat');
    U.close();
    openFilePicker($('#composer input[type="file"]'));
  }
  async function beginSetup(){
    await openSetupStart();
    $('#workspace-body .file-trigger')?.focus({preventScroll:true});
  }
  async function remember(c){c.updated=D.clock();await R.saveChat(c);}
  function tell(c,text,extra={}){c.messages.push({role:'assistant',text,...extra});}
  async function handoff(c,input,answer,{question=input.query,files=[],extra={}}={}){
    const recipient=K.handoffRecipient();
    if(!recipient){
      tell(c,answer.text+'\n\n当前学校的教务接收人待配置。请联系学校教务。',extra);
      await remember(c);
      return;
    }
    const sources=files.map(file=>[file.name,file.structure,file.sections?.[0]?.source].filter(Boolean).join(' · '));
    const interpretation=question&&question!==input.text?question:undefined;
    const prior=!sources.length&&[...S.handoffs.values()].find(ticket=>
      ticket.chatId===c.id&&ticket.schoolId===recipient.schoolId&&ticket.reason===answer.handoffReason&&
      !ticket.sources.length&&(ticket.interpretation||ticket.question)===(interpretation||input.text)
    );
    const draft=prior||{
      id:D.uid('HF'),chatId:c.id,...recipient,created:D.clock(),status:'待处理',
      question:input.text||question,interpretation,reason:answer.handoffReason,sources
    };
    const sent=K.dingTalkSent(draft);
    const ticket=sent?draft:{...draft,notification:K.dingTalkNotice(draft)};
    const next={...c,messages:[...c.messages],updated:D.clock()};
    tell(next,answer.text,{...extra,handoff:ticket.id});
    const ownsProgress=!S.jobs.has(c.id);
    showProgress(c.id,sent?'正在查找已发送的通知…':'正在发送钉钉通知…');
    try{
      if(sent)await R.saveChat(next);
      else K.publishHandoff(await R.createHandoff(ticket,next,!!prior));
      Object.assign(c,next);
    }catch(error){
      if(error.chatId)throw error;
      const errorText=sent?'通知状态暂未更新。':'钉钉通知暂未发送。';
      tell(c,answer.text+'\n\n'+errorText+'请重新发送问题再试。',extra);
      await remember(c);
    }finally{
      if(ownsProgress)S.jobs.delete(c.id);
    }
  }
  async function answerQuestion(c,input,answer,options={}){
    const extra={cites:answer.cites,citeChunks:answer.citeChunks,attachmentCites:answer.attachmentCites,...options.extra};
    if(answer.handoffReason){
      if(U.areaOf(c)==='qa')await handoff(c,input,answer,{...options,extra:{...extra,processCite:'handoff-procedure'}});
      else {
        tell(c,answer.text+'\n\n需要教务协助时，可以到智能问答继续询问。',{...extra,actions:[areaLink('qa')]});
        await remember(c);
      }
      return;
    }
    tell(c,answer.text,extra);
    await remember(c);
  }
  function user(c,input,attachments=[],taskId){
    const {text,interpretation}=typeof input==='string'?{text:input}:input;
    if(!c.messages.length)c.title=text.slice(0,24)||'附件处理';
    const message={role:'user',text,attachments,interpretation};
    if(taskId)message.taskId=taskId;
    c.messages.push(message);
    return message;
  }
  function selectChat(id){
    if(S.chatId!==id){S.pane=null;S.workspaceOpen=false;S.expanded=false;}
    S.chatId=id;
    try{sessionStorage.setItem('edu-chat-'+U.areaOf(U.chat()),id);}catch{}
  }
  function chatDraft(area){
    const now=D.clock();
    return {id:D.uid('CH'),area,title:'新对话',messages:[],focus:'',topic:'',created:now,updated:now};
  }
  async function newChat(area=U.areaOf(U.chat())==='schedule'?'schedule':'qa'){
    const c=chatDraft(area);
    await R.put('chats',c);
    S.chats.set(c.id,c);
    selectChat(c.id);
    return c;
  }
  function isSetupStart(c){
    return c?.area==='schedule'&&!c.focus&&!c.messages.length&&!S.jobs.has(c.id)&&
      !S.attachments.get(c.id)?.length&&!S.draftText.get(c.id)&&
      !pendingFor(c).length&&
      ![...S.tasks.values()].some(task=>task.chatId===c.id);
  }
  async function openSetupStart(){
    const draft=U.chatsFor('schedule').find(isSetupStart);
    if(draft)selectChat(draft.id);
    const c=draft||await newChat('schedule');
    S.pane=null;S.workspaceOpen=false;S.expanded=false;
    present('chat');
    return c;
  }
  async function forgetChat(id){
    const area=U.areaOf(S.chats.get(id));
    S.chats.delete(id);
    S.attachments.delete(id);
    S.draftText.delete(id);
    for(const item of S.pendingFiles.values()){
      if(item.chatId===id)S.pendingFiles.delete(item.id);
    }
    if(S.chatId!==id)return;
    const remaining=U.chatsFor(area);
    const next=remaining.find(item=>item.messages.length)||remaining[0];
    if(next)selectChat(next.id);
    else await nav(area==='history'?'qa':area);
  }
  function confirmDeleteChat(id){
    const target=S.chats.get(id);
    U.closeSessionMenu(true);
    if(!target)return;
    if(S.jobs.has(id))throw Error('会话正在处理消息，请完成后再删除。');
    const hasCards=target.messages.some(message=>message.task||message.handoff);
    const body=`<div class="delete-session-copy"><strong>「${esc(target.title)}」</strong><p>会话消息、草稿和暂存附件将被删除，无法恢复。</p>${hasCards?'<p class="hint">本会话中的任务卡或通知入口也会移除。</p>':''}</div>`;
    const foot=btn('取消','close')+btn('删除会话','confirm-delete-chat',attr('id',id),'danger');
    U.panel('delete-chat','删除会话？',target.updated?'最近更新 '+U.time(target.updated):'',body,foot,{key:id,chatId:id,narrow:true});
    $('#panel-foot [data-act="close"]').focus();
  }
  async function deleteChat(id,button){
    if(S.dialog?.type!=='delete-chat'||S.dialog.chatId!==id||button.disabled)return;
    if(S.jobs.has(id))throw Error('会话正在处理消息，请完成后再删除。');
    button.disabled=true;
    try{
      const area=U.areaOf(S.chats.get(id));
      const replacement=S.chatId===id&&area!=='history'&&U.chatsFor(area).length===1?chatDraft(area):null;
      await R.removeChat(id,replacement);
      if(replacement)S.chats.set(replacement.id,replacement);
      await forgetChat(id);
      U.close();
      redraw();
      ($('#sessions [aria-current="true"]')||$('.new-chat')).focus({preventScroll:true});
      toast('会话已删除。');
    }finally{
      if(button.isConnected)button.disabled=false;
    }
  }
  function clearMissingTaskLinks(c){
    if(c.focus&&!S.tasks.has(c.focus))c.focus='';
    if(c.pending?.task&&!S.tasks.has(c.pending.task))c.pending=null;
    if(c.pending?.ids){
      c.pending.ids=c.pending.ids.filter(id=>S.tasks.has(id));
      if(!c.pending.ids.length)c.pending=null;
    }
  }
  function setupTaskForRemoval(id){
    const task=S.tasks.get(id);
    if(!task||task.hiddenFromList||U.areaOf(S.chats.get(task.chatId))!=='schedule')throw Error('这项任务已不在列表中。');
    if(activeWrites.has(id)||S.jobs.has(task.chatId))throw Error('任务正在处理，请在本次处理结束后再操作。');
    return task;
  }
  function confirmTaskRemoval(id,fulltime){
    U.closeSessionMenu(true);
    const task=fulltime?root.DeskFulltime.forRemoval(id):setupTaskForRemoval(id);
    const name=fulltime?task.name:U.taskName(task);
    const removeOnly=!fulltime&&!!task.receipt;
    const label=removeOnly?'移出列表':'删除任务';
    const details=removeOnly?'任务将从排课列表移出，已保存的待设班资料和导入回执会保留。':
      fulltime?'将删除该任务的基础资料、核对进度和课表方案，无法恢复。':'将删除该任务的上传资料与核对进度，无法恢复。';
    const body=`<div class="delete-session-copy"><strong>「${esc(name)}」</strong><p>${details}</p></div>`;
    const foot=btn('取消','close')+btn(label,'confirm-remove-task',attr('id',id),removeOnly?'primary':'danger');
    U.panel('task-removal',removeOnly?'移出任务列表？':'删除任务？',id,body,foot,
      {key:id,fulltime,removeOnly,etag:task.etag,narrow:true});
    $('#panel-foot [data-act="close"]').focus();
  }
  async function removeTask(id,button){
    const dialog=S.dialog;
    if(dialog?.type!=='task-removal'||dialog.key!==id||button.disabled)return;
    button.disabled=true;
    try{
      if(dialog.fulltime){
        await root.DeskFulltime.remove(id);
      }else{
        setupTaskForRemoval(id);
        const displayed=U.chat();
        const wasActive=S.page==='chat'&&displayed?.focus===id;
        if(dialog.removeOnly){
          const updated=await R.changeTask('tasks',id,saved=>{
            if(saved.etag!==dialog.etag||saved.hiddenFromList||!saved.receipt){
              throw Error('任务状态已变化，请刷新后再操作。');
            }
            return {...saved,hiddenFromList:true,etag:saved.etag+1};
          });
          S.tasks.set(id,updated);
        }else{
          const updated=await R.removeSetupTask(id,dialog.etag);
          S.tasks.delete(id);
          D.release(id);
          for(const [key,batch] of S.pendingFiles)if(batch.taskId===id)S.pendingFiles.delete(key);
          const owner=S.chats.get(updated.id);
          if(owner)Object.assign(owner,updated);
        }
        if(S.pane?.id===id){S.pane=null;S.workspaceOpen=false;S.expanded=false;}
        if(wasActive&&U.chat()===displayed&&S.page==='chat')await openSetupStart();
      }
      U.close();
      redraw();
      ($('#sessions [aria-current="true"]')||$('#sidebar-create')).focus({preventScroll:true});
      toast(dialog.removeOnly?'任务已移出列表。':'任务已删除。');
    }finally{
      if(button.isConnected)button.disabled=false;
    }
  }
  function present(page){
    U.close();document.body.classList.remove('menu-open');
    if(page!==S.page){S.workspaceOpen=false;S.expanded=false;}
    S.page=page;
    const route=page==='chat'?U.areaOf(U.chat()):page;
    if(location.hash!=='#'+route)history.replaceState(null,'','#'+route);
    U.renderMain();
    if(page!=='chat')$('#view').scrollTop=0;
  }
  async function nav(id,restoreSetup=false){
    if(id==='fulltime')await root.DeskFulltime.load();
    if(Object.hasOwn(U.plannedModules,id)){present(id);return;}
    const area=id==='tasks'?'schedule':Object.hasOwn(U.areas,id)?id:'qa';
    const candidates=U.chatsFor(area);
    if(area==='history'&&!candidates.length){await nav('qa');return;}
    let stored;
    try{stored=sessionStorage.getItem('edu-chat-'+area)||(area==='history'&&sessionStorage.getItem('edu-chat'));}catch{}
    const selected=candidates.find(c=>c.id===stored);
    if(area==='schedule'&&(!restoreSetup||!activeSetup(selected)&&!isSetupStart(selected))){
      await openSetupStart();return;
    }
    const next=selected||candidates.find(c=>c.messages.length)||candidates[0];
    if(next)selectChat(next.id);
    else await newChat(area);
    present('chat');
  }
  async function refresh(){
    for(const s of ['chats','tasks','handoffs'])S[s]=new Map((await R.all(s)).map(v=>[v.id,v]));
    for(const task of S.tasks.values())D.restoreReview(task);
    for(const chat of S.chats.values()){
      if(chat.area==='schedule')Object.assign(chat,R.withoutTaskMessages(chat,id=>!S.tasks.has(id)));
      clearMissingTaskLinks(chat);
    }
    const systems=await R.all('system');
    S.systems=new Map(systems.filter(system=>system.id!=='campus').map(system=>[system.id,system]));
  }
  async function loadTaskSystem(task){
    const system=await R.loadSystem(task.chatId);
    S.systems.set(task.chatId,system);
    return system;
  }
  async function edit(t,fn,writeSystem=false){
    const result=await R.edit(t.id,t.etag,(task,system)=>fn(D.restoreReview(task),system),writeSystem);
    S.tasks.set(t.id,result.task);
    S.systems.set(result.task.chatId,result.system);
    return result.task;
  }
  function openTask(id,step,focus=true){
    const task=S.tasks.get(id);
    if(!task){toast('未找到这项任务。');return;}
    if(focus&&S.chats.has(task.chatId)&&(S.chatId!==task.chatId||S.page!=='chat')){
      selectChat(task.chatId);
      present('chat');
    }
    U.close();
    if(S.pane?.id!==id){S.pages={};S.fieldFilter='';S.diffOnly=false;}
    const current=U.chat();
    if(focus&&current?.id===task.chatId&&current.focus!==id){
      current.focus=id;
      remember(current).catch(()=>{});
      redraw();
    }
    V.taskView(id,step??(S.pane?.id===id?S.viewStep:task.stage));
  }
  function reviewTask(id){
    openTask(id,S.tasks.get(id)?.stage);
  }
  function activePane(task){
    return S.workspaceOpen&&S.pane?.id===task.id&&S.page==='chat'&&S.chatId===task.chatId;
  }
  const control=task=>({label:'打开核对工作区',act:'task',id:task.id});

  function validateFiles(entries,existing=0){
    if(entries.length+existing>10)throw Error('一次最多 10 份资料。请分成两个任务。');
    for(const file of entries){
      if(file.size>10*1024*1024)throw Error('单份资料上限为 10 MB。');
      if(!/\.(xlsx|xls|csv|docx)$/i.test(file.name))throw Error('请选择 Excel、CSV 或 Word 文档（XLSX、XLS、CSV、DOCX）。');
    }
  }
  function assignLabels(files){
    return files.map((item,i)=>({...item,label:'资料 '+String(i+1).padStart(2,'0')+item.name.match(/\.[^.]+$/)[0].toLowerCase()}));
  }
  function queueFiles(entries){
    if(!entries.length)return;
    const c=U.chat(), queued=U.files();
    const combined=queued.concat(entries);
    validateFiles(combined);
    const input=$('#question');
    if(input)S.draftText.set(c.id,input.value.startsWith('/')?'':input.value);
    S.attachments.set(c.id,assignLabels(combined));
    redraw();
    $('#question')?.focus({preventScroll:true});
  }
  function showProgress(id,message){
    S.jobs.set(id,message);
    if(S.page==='chat'&&S.chatId===id){
      redraw();
      bottom();
    }
  }
  function holdVisibleStep(id,started,minimum){
    if(S.page!=='chat'||S.chatId!==id||document.hidden)return;
    const remaining=minimum-(root.performance.now()-started);
    if(remaining>0)return new Promise(resolve=>root.setTimeout(resolve,remaining));
  }
  async function bufferFor(item){
    return new Uint8Array(await item.file.arrayBuffer());
  }
  function intakeSummary(task,system,model=D.model(task,S.data,system,{checkRules:false})){
    const pending=Object.values(model.sk.fields).filter(field=>field.issue);
    const count=model.r.records.length;
    D.log(task,'定位工作表和表头',model.r.recognition.tables.length+' 张纳入的工作表 · '+count+' 条班级');
    if(!count)return '已读取资料。请补充班级明细，或检查有班级数据的工作表和表头。';
    if(pending.length){
      const fields=pending.map(field=>I.labels[field.key]).join('、');
      D.log(task,'识别任务归属','待确认'+fields);
      const ask=pending.some(field=>field.seen.size>1)?'资料中有多个'+fields+'取值，请按来源确认本次范围。':'请补充或确认'+fields+'，再核对资料与归属。';
      return '读到 '+count+' 条班级。'+ask;
    }
    const included=new Set(model.r.recognition.tables.map(table=>table.file)).size;
    const prefix=included>1?'已将 '+included+' 份表格合并为 '+count+' 条班级。':'已整理 '+count+' 条班级。';
    return prefix+'请核对纳入的资料和任务归属。';
  }
  function pendingFor(c){
    const taskId=activeSetup(c)?.id;
    return [...S.pendingFiles.values()].filter(item=>item.chatId===c.id&&(!item.taskId||item.taskId===taskId));
  }
  const batchReference=/第\s*(\d+|[一二三四五六七八九十])\s*批|(?:最近|最后)一批/;
  const batchReply=new RegExp('^(?:请|就|先)?(?:用|选用|选|选择|处理)?(?:'+batchReference.source+')(?:附件|资料)?[。！]?$');
  function attachmentBatchIndex(text,length){
    const reference=text.match(batchReference);
    if(!reference)return null;
    if(!reference[1])return length-1;
    const ordinal=reference[1], number=Number(ordinal);
    return Number.isNaN(number)?'一二三四五六七八九十'.indexOf(ordinal):number-1;
  }
  function markPurpose(chat,id,purpose){
    const message=chat.messages.find(item=>item.role==='assistant'&&item.fileRequest===id);
    if(message)message.fileChoice=purpose;
  }
  async function inspectAttachments(id,entries,intro){
    const items=[];
    const trace=[{label:'接收附件',state:'done',detail:entries.length+' 份'}];
    showProgress(id,{intro,trace});
    await holdVisibleStep(id,root.performance.now(),attachmentPace.received);

    const readStarted=root.performance.now();
    const reading={label:'读取文件',state:'running',detail:''};
    trace.push(reading);
    for(const [index,entry] of entries.entries()){
      const {label}=entry;
      const content=label.endsWith('.docx')?'正文':'单元格内容';
      reading.detail='正在读取 '+label+' 的'+content;
      showProgress(id,{intro,trace});
      try{
        const file=I.readContent(await bufferFor(entry),entry.name,index+1);
        items.push(F.isReadable(file)?{label,file}:{label,error:'未读到有内容的单元格或 Word 正文。'});
      }catch(error){
        const detail=String(error.message||'');
        const message=/^(?:当前单任务|当前单表|无法读取表格|未发现可识别|未识别到Word正文|单个文件)/.test(detail)
          ? detail : '读取失败。请检查文件格式，或重新保存后添加。';
        items.push({label,error:message});
      }
    }
    await holdVisibleStep(id,readStarted,attachmentPace.read);
    const readable=items.filter(item=>item.file);
    const blocked=readable.length!==items.length;
    reading.state=blocked?'attention':'done';
    reading.detail='成功读取 '+readable.length+' 份'+(blocked?'，'+(items.length-readable.length)+' 份需调整':'');
    const sheets=readable.flatMap(item=>item.file.sheets);
    if(readable.length){
      const identifying={label:'识别资料结构',state:'running',detail:'正在查看工作表与正文段落'};
      trace.push(identifying);
      showProgress(id,{intro,trace});
      const identifyStarted=root.performance.now();
      const paragraphs=readable.reduce((sum,{file})=>sum+(file.paragraphs?.filter(line=>line.trim()).length||0),0);
      const structure=[];
      if(sheets.length)structure.push(sheets.length+' 张工作表');
      if(paragraphs)structure.push(paragraphs+' 个有文字的段落');
      await holdVisibleStep(id,identifyStarted,attachmentPace.identify);
      identifying.state='done';
      identifying.detail=structure.join(' · ');
      const inspect={label:'提取样例与出处',state:'running',detail:'正在摘取单元格和段落样例'};
      trace.push(inspect);
      showProgress(id,{intro,trace});
      const inspectStarted=root.performance.now();
      const mask=I.privacy();
      for(const item of readable)item.preview=F.preview(item.file,item.label,mask);
      const samples=readable.reduce((sum,item)=>sum+item.preview.sections.reduce((count,section)=>count+section.examples.length,0),0);
      await holdVisibleStep(id,inspectStarted,attachmentPace.inspect);
      inspect.state='done';
      inspect.detail='标出 '+samples+' 处样例和来源';
    }
    const preview=items.map(item=>item.preview||{name:item.label,error:item.error});
    return {items,preview,trace,blocked};
  }
  async function ensureSetupTask(c,sentIndex,askForFiles=false){
    if(S.jobs.has(c.id))throw Error('正在处理本次任务。');
    const existing=activeSetup(c),task=existing||D.task(c.id);
    if(existing&&!askForFiles){
      c.messages[sentIndex].taskId=existing.id;
      return existing;
    }
    const next={...c,messages:[...c.messages],focus:task.id,updated:D.clock()};
    next.messages[sentIndex]={...next.messages[sentIndex],taskId:task.id};
    if(askForFiles){
      const {text,actions}=U.attachmentRequests.prepare;
      next.pending=null;
      tell(next,(existing?'':'已创建排课任务。')+text,{taskId:task.id,expectFile:'prepare',actions});
    }else if(!existing)tell(next,'已创建排课任务，开始读取资料。',{taskId:task.id});
    showProgress(c.id,existing?'正在准备上传资料…':'正在创建排课任务…');
    try{
      if(existing)await R.saveChat(next);
      else{await R.createIntake(task,next);S.tasks.set(task.id,task);}
      Object.assign(c,next);
      return task;
    }finally{
      S.jobs.delete(c.id);
      if(here(c)){redraw();bottom();}
      else if(S.page==='chat'&&U.chat()?.area==='schedule')redraw();
    }
  }
  async function requestSetupFiles(c,input){
    if(here(c))clearComposer(input);
    if(activeSetup(c)?.receipt)c=await openSetupStart();
    const sentIndex=c.messages.length;
    user(c,input);
    await ensureSetupTask(c,sentIndex,true);
  }
  async function submitAttachments(c,input,entries,purpose='prepare',request=null,introduce=false){
    if(S.jobs.has(c.id))throw Error('正在读取本次资料。');
    const origin=c;
    const setup=U.areaOf(c)==='schedule'&&(purpose==='prepare'||!purpose&&!input.overview);
    const current=setup?activeSetup(c):null;
    validateFiles(entries,purpose==='prepare'&&!current?.receipt?(current?.files.length||0):0);
    if(current?.receipt){
      if(!request&&!input.example){S.attachments.delete(c.id);if(here(c))clearComposer(input);}
      c=await openSetupStart();
    }
    const started=root.performance.now();
    const elapsed=()=>Math.round(root.performance.now()-started);
    const receipt='收到 '+entries.length+' 份资料。我先读取内容，看看每份文件记录了什么。';
    const intro=introduce?introduction+'\n\n'+receipt:receipt;
    const message=input.text?input:purposes[purpose]||'';
    const sentIndex=c.messages.length;
    if(request){
      user(c,message,c===origin?[]:entries.map(file=>file.label));
    }else{
      if(!input.example)S.attachments.delete(c.id);
      if(here(c))clearComposer(input);
      user(c,message,entries.map(file=>file.label));
    }
    let intake;
    try{
      if(setup)intake=await ensureSetupTask(c,sentIndex);
      if(request)showProgress(c.id,purposeProgress[purpose]);
      const work=request?.work||await inspectAttachments(c.id,entries,intro);
      const {items,preview,trace,blocked}=work;
      const next={...c,messages:c.messages.map(item=>({...item})),updated:D.clock()};
      if(next.pending?.type==='attachment-batch')next.pending=null;
      if(request)markPurpose(next,request.id,purpose);
      if(purpose&&!request&&!blocked)showProgress(c.id,purposeProgress[purpose]);
      const prepared=purpose==='prepare'&&!blocked?items.map(({file,label})=>({file:I.identify(file),label})):[];
      const sheets=prepared.flatMap(item=>item.file.sheets);
      const needsClassData=sheets.length>0&&sheets.every(sheet=>sheet.analysis.readback);
      if(!purpose||needsClassData||blocked){
        const id=D.uid('IN');
        next.messages[sentIndex].fileRequest=id;
        const expectFile=blocked||needsClassData?purpose||undefined:undefined;
        const steps=request?[]:[...trace];
        if(needsClassData)steps.push({label:'检查设班资料',state:'attention',detail:'附件是回读核对表，建班需要班级明细'});
        const result=blocked?'请调整标出的附件。':
          needsClassData?'这批表记录的是回读结果。请补充要整理的班级明细。':'已把读到的样例和原文位置标在下方。';
        const summary=input.overview?F.overview(preview):{text:result};
        await answerQuestion(next,input,summary,{files:preview,extra:{
          fileIntro:request?'':intro,fileTrace:steps,fileTraceMs:elapsed(),fileAnalysis:needsClassData?true:'preview',fileRequest:id,
          filePreview:request?undefined:preview,expectFile,fileSummarized:input.overview,taskId:intake?.id
        }});
        Object.assign(c,next);
        S.pendingFiles.set(id,{id,chatId:c.id,taskId:intake?.id,entries,work,needsClassData});
        if(request)S.pendingFiles.delete(request.id);
        return;
      }
      const task=purpose==='prepare'?JSON.parse(JSON.stringify(intake)):null;
      if(task){
        next.messages[sentIndex].taskId=task.id;
        if(request){
          for(const message of next.messages)if(message.fileRequest===request.id)message.taskId=task.id;
        }
        const sources=prepared.filter(({file})=>!I.onlyReadback(file));
        for(const {file,label} of sources)D.addParsedFile(task,file,label);
        next.focus=task.id;
        next.pending=null;
        const note=sources.length<items.length?'已把班级和相关资料放入设班任务。回读核对表可用于查看核对结果。':'';
        const system=await loadTaskSystem(task);
        const model=D.model(task,S.data,system,{checkRules:false});
        const taskTrace=request?[]:[...trace];
        const tables=model.r.recognition.tables;
        const combined=new Set(tables.map(table=>table.file)).size>1;
        if(combined){
          const accepted=tables.reduce((sum,table)=>sum+table.accepted,0);
          const skipped=tables.reduce((sum,table)=>sum+table.rowCount+table.ignoredRows-table.accepted,0);
          const links=[...model.r.recognition.links.values()];
          const teacherCount=links.filter(link=>link.teacher).length;
          const areaCount=links.filter(link=>link.area).length;
          const matchDetail=[model.r.records.length+' 条班级',model.r.demand.length+' 条科目预算',
            teacherCount?teacherCount+' 条教师匹配':'',areaCount?areaCount+' 条教学区匹配':''].filter(Boolean).join(' · ');
          const steps=[
            ['提取有效行','正在筛选参与核对的行',tables.length+' 张表 · 纳入 '+accepted+' 行'+(skipped?' · 跳过 '+skipped+' 行':''),false],
            ['合并设班字段','正在匹配班级标识、教学区和预算归属',matchDetail,!!model.r.recognition.mergeIssues.length]
          ];
          for(const [label,running,detail,attention] of steps){
            const step={label,state:'running',detail:running};
            taskTrace.push(step);
            showProgress(c.id,{intro,trace:taskTrace});
            await holdVisibleStep(c.id,root.performance.now(),attachmentPace.merge);
            Object.assign(step,{state:attention?'attention':'done',detail});
          }
        }
        const result=[note,intakeSummary(task,system,model)].filter(Boolean).join('\n\n');
        taskTrace.push({label:'核对资料与归属',state:'attention',
          detail:model.r.records.length?model.r.records.length+' 条班级 · 待确认资料与归属':'待补充班级明细'});
        tell(next,result,{task:task.id,fileIntro:request?'':intro,fileTrace:taskTrace,fileTraceMs:elapsed(),fileAnalysis:true});
        const updated=await R.updateIntake(task,next,intake.etag);
        S.tasks.set(updated.id,updated);
      }else{
        const reports=items.map(({file,label})=>F.report(file,purpose,label));
        const question=request?.question??input.query;
        const answer=F.answer(reports,question,purpose);
        const hasEvidence=!answer.handoffReason&&reports.some(report=>report.facts.length);
        const evidence=purpose==='readback'
          ? (hasEvidence?'已按提交值和回读值逐项比对':'需要含提交值和回读值的核对表')
          : (hasEvidence?'已检查条款与相关来源':'需要补充可引用条款');
        const review={label:purposes[purpose],state:hasEvidence?'done':'attention',detail:evidence};
        await answerQuestion(next,input,answer,{question,files:reports,extra:{
          fileIntro:request?'':intro,fileTrace:request?[review]:[...trace,review],fileTraceMs:elapsed(),
          fileAnalysis:true,fileSources:reports,filePurpose:purpose
        }});
      }
      Object.assign(c,next);
      if(request)S.pendingFiles.delete(request.id);
      if(task&&here(c))openTask(task.id,task.stage,false);
    }catch(error){
      if(error.chatId)throw error;
      if(!request&&!input.example)S.attachments.set(c.id,assignLabels(entries.concat(S.attachments.get(c.id)||[])));
      const retry=input.example?'可以重新选择该示例。':'可以调整附件后重新发送。';
      tell(c,(error.message||'这批资料处理失败。')+retry,{taskId:intake?.id,expectFile:purpose==='prepare'?'prepare':undefined});
      await remember(c);
    }finally{
      S.jobs.delete(c.id);
      if(here(c)){redraw();bottom();}
      else if(intake&&S.page==='chat'&&U.chat()?.area==='schedule')redraw();
    }
  }
  async function chooseFilePurpose(c,id,purpose,input,question=input.query){
    const request=S.pendingFiles.get(id);
    if(!request||request.chatId!==c.id)throw Error('请重新添加这批附件。');
    if(!purposes[purpose])throw Error('请说明附件用途。');
    if(request.work.blocked)throw Error('请先调整未能读取的附件。');
    if(purpose==='prepare'&&request.needsClassData)throw Error('请添加班级明细。当前附件可以汇总核对结果。');
    clearComposer(input);
    await submitAttachments(c,input,request.entries,purpose,{...request,question});
  }
  async function adjustAttachments(c,id){
    const request=S.pendingFiles.get(id);
    if(!request||request.chatId!==c.id)return;
    if(S.jobs.has(c.id))throw Error('正在读取本次资料。');
    queueFiles(request.entries);
    markPurpose(c,id,'adjusted');
    S.pendingFiles.delete(id);
    await remember(c);
    redraw();
  }
  async function uploadSetupFiles(c,entries,task){
    validateFiles(entries,task?.files.length||0);
    if(S.jobs.has(c.id))throw Error('正在读取本次资料。');
    if(task&&D.archive(task))throw Error('请新建任务上传其他设班资料。');
    if(task&&activeWrites.has(task.id))throw Error('本次导入正在处理，请稍候。');
    U.close();
    showProgress(c.id,(task?'正在补充 ':'正在读取 ')+entries.length+' 份资料…');
    try{
      if(!task){
        task=D.task(c.id);
        D.log(task,'创建排课任务');
        const owner={...c,focus:task.id,updated:D.clock()};
        await R.createIntake(task,owner);
        S.tasks.set(task.id,task);
        Object.assign(c,owner);
        if(setupPage())redraw();
      }
      const batch=[];
      for(const entry of entries){
        try{batch.push({name:entry.name,label:entry.label,bytes:await bufferFor(entry)});}
        catch{
          throw Error(entry.label?'示例资料暂未载入，请再次点击「载入示例资料」。':'第 '+(batch.length+1)+' 份资料暂未读到，请重新选择文件。');
        }
      }
      let summary;
      const updated=await edit(task,(draft,system)=>{
        for(const [index,entry] of batch.entries()){
          try{D.addFile(draft,entry.bytes,entry.name,entry.label);}
          catch(error){throw Error('第 '+(index+1)+' 份资料。'+error.message);}
        }
        summary=intakeSummary(draft,system);
      });
      if(U.areaOf(c)!=='schedule'){
        c.focus=updated.id;c.pending=null;
        user(c,'补充设班资料',assignLabels(entries).map(e=>e.label),updated.id);
        tell(c,summary,{task:updated.id});
        await remember(c).catch(error=>{
          if(error.chatId)throw error;
          toast('资料已补充。会话记录暂未保存。',true);
        });
      }
      if(activePane(updated))openTask(updated.id,updated.stage,false);
    }finally{
      S.jobs.delete(c.id);
      redraw();
      if(here(c)&&!setupPage())bottom();
    }
  }
  async function scopeFromChat(task,value,c){
    let summary;
    const updated=await edit(task,(item,system)=>{
      D.selectScope(item,S.data,'budget_id',value);
      summary=intakeSummary(item,system);
    });
    tell(c,'已确认预算 '+value+'。'+summary,{task:updated.id});
    if(here(c))openTask(updated.id,updated.stage,false);
    return updated;
  }
  function matchTasks(c,q){
    let items=[...S.tasks.values()].filter(t=>t.chatId===c.id),id=q.match(/CP-[a-z0-9]+/i)?.[0];
    if(id)return items.filter(t=>t.id.toUpperCase()===id.toUpperCase());
    const campus=q.match(/校区\s*(\d{2})/),budget=q.match(/BUD-C\d{2}-(?:AU|SU)-\d{2}/i);
    if(campus||budget)return items.filter(t=>{const x=D.scope(t,S.data).context;return (!campus||x.campusId==='C'+campus[1])&&(!budget||x.budgetId===budget[0].toUpperCase());});
    return items;
  }
  function chooseIntentTask(c,intent,q){
    const reference=intent.kind==='scope'?q.replace(new RegExp(intent.value,'ig'),''):q;
    let items=matchTasks(c,reference);
    if(/当前任务|这项任务/.test(reference)&&c.focus&&!/CP-[a-z0-9]+/i.test(reference))items=items.filter(task=>task.id===c.focus);
    if(['edit','scope','confirm'].includes(intent.kind))items=items.filter(t=>!D.archive(t));
    if(intent.kind==='reread')items=items.filter(t=>t.receipt);
    if(items.length===1)return items[0];
    if(!items.length){tell(c,'当前会话没有可执行此操作的任务。可以打开原设班对话，或添加本次班级资料。',{actions:[{label:'添加附件',act:'new-task'}]});return;}
    c.pending={type:'task',intent,q,ids:items.map(t=>t.id)};
    tell(c,'这句话涉及哪一项设班任务？',{actions:items.map(t=>({label:D.scope(t,S.data).context.campus+' · '+t.id,act:'pick-intent-task',id:t.id}))});return;
  }
  function resolveRows(q,m,intent){
    const chinese='一二三四五六七八九十';
    const number=word=>/^\d+$/.test(word)?Number(word):word==='两'?2:word.length===1?chinese.indexOf(word)+1:NaN;
    const ordinals=[...q.matchAll(/第\s*([一二两三四五六七八九十\d]+)\s*(?:个班|条|行|个|班)/g)];
    const ids=new Set(m.records.filter(r=>r.class_name&&q.includes(r.class_name)).map(r=>r.row));
    if(/(?:到|至|至第|到第|[-～~])第?[一二两三四五六七八九十\d]+(?:条|行|班)/.test(q))return [];
    for(const item of ordinals){const idx=number(item[1])-1;if(!m.records[idx])return [];ids.add(m.records[idx].row);}
    const count=q.match(/(前|最后|后)([一二两三四五六七八九十\d]+)(?:个班|条|行|班)/);
    if(count){const n=number(count[2]);if(!Number.isInteger(n)||n<1||n>m.records.length)return [];const group=count[1]==='前'?m.records.slice(0,n):m.records.slice(-n);group.forEach(r=>ids.add(r.row));}
    if(/除|以外|之外|其余|其他班/.test(q))return ids.size?m.records.filter(r=>!ids.has(r.row)).map(r=>r.row):[];
    if(ids.size)return [...ids];
    if(/部分|前几|后几|这几个|其中|指定/.test(q))return [];
    if(/全部|所有|每个班|全体班级/.test(q))return m.records.map(r=>r.row);
    return m.records.length===1?[m.records[0].row]:[];
  }
  async function runIntent(c,intent,q,t,message){
    if(!t)return;
    message.taskId=t.id;
    c.focus=t.id;
    if(intent.kind==='scope'){
      if(D.archive(t))throw Error('已导入的归属只能查看。');
      await scopeFromChat(t,intent.value,c);return;
    }
    if(intent.kind==='edit'){
      const m=D.model(t,S.data,U.systemForTask(t),{checkRules:false});
      if(!m.sk.ready||!m.records.length){tell(c,'请先核对校区和预算，再修改目标班级。',{task:t.id});return;}
      const rows=resolveRows(q,m,intent);
      if(!rows.length){
        c.pending={type:'rows',task:t.id,intent,version:t.version};
        tell(c,'要把哪几个班的班额改为 '+intent.value+' 人？可以回复班级名称、第几条，或者“全部班级”。',{taskId:t.id,actions:[{label:'全部 '+m.records.length+' 条班级',act:'all-rows',id:t.id},control(t)]});return;
      }
      const updated=await edit(t,v=>D.correct(v,S.data,rows,'capacity',intent.value));
      const summary=updated.stage===0?'请先确认资料与归属。':'请重新核对字段并校验。';
      tell(c,'已将 '+rows.length+' 条记录的班额改为 '+intent.value+' 人。'+summary,{task:t.id});if(activePane(updated))openTask(updated.id,updated.stage,false);return;
    }
    if(intent.kind==='confirm'){tell(c,t.status==='ready'?'请核对清单上的校区、预算和数量，再确认导入。':'请在工作区按当前步骤继续核对。',{task:t.id});if(here(c))openTask(t.id,t.stage,false);return;}
    if(intent.kind==='reread'){
      const updated=await edit(t,(v,sys)=>D.readback(v,sys));
      reportReadback(c,updated);
      if(activePane(updated))openTask(t.id,3,false);
      return;
    }
    tell(c,'任务当前为“'+D.states[t.status]+'”。',{task:t.id});
  }
  async function sendHelp(c,input,guide){
    if(S.jobs.has(c.id))throw Error('正在处理上一条消息，请稍候。');
    const {loading,resolve}=guide;
    const started=root.performance.now();
    const expectFile=c.messages.at(-1)?.expectFile;
    user(c,input);
    clearComposer(input);
    if(loading)showProgress(c.id,loading);
    try{
      if(loading)await holdVisibleStep(c.id,started,textReplyPace);
      const answer=resolve?resolve():guide;
      const {action,topic,semanticClarification,files,question,fileTrace}=answer;
      const cites=answer.cites??(U.areaOf(c)==='qa'&&!answer.handoffReason&&!answer.attachmentCites?.length?['usage-guide']:undefined);
      if(topic)c.topic=topic;
      await answerQuestion(c,input,answer,{question,files,extra:{
        expectFile,cites,semanticClarification,fileTrace,
        fileTraceMs:fileTrace?Math.round(root.performance.now()-started):undefined,
        actions:action?[action]:undefined
      }});
    }finally{
      if(loading)S.jobs.delete(c.id);
      if(here(c)){redraw();bottom();}
    }
  }
  function offerArea(c,input,area){
    const text=area==='schedule'?'可以到教务排课整理班级资料、核对清单和确认导入。':'可以到智能问答查询教务规则、附件条款和班级名额。';
    return sendHelp(c,input,{text,action:areaLink(area)});
  }
  async function sendSeatLookup(c,input,priorQuestion=''){
    if(S.jobs.has(c.id))throw Error('正在处理上一条消息，请稍候。');
    const expectFile=c.messages.at(-1)?.expectFile;
    user(c,input);
    clearComposer(input);
    const started=root.performance.now();
    const access={label:'校区权限校验',state:'running',detail:'正在核对当前账号的校区查询范围'};
    const trace=[access];
    const progress=()=>showProgress(c.id,{trace});
    const reply=(text,extra)=>tell(c,text,{expectFile,fileTrace:trace,fileTraceMs:Math.round(root.performance.now()-started),...extra});
    progress();
    try{
      await holdVisibleStep(c.id,started,seatLookupPace.access);
      const scope=Q.checkAccess(input.text,priorQuestion);
      if(scope.state==='missing'){
        Object.assign(access,{state:'attention',detail:'待提供校区编号'});
        reply('请告诉我查询哪个校区，例如「校区02」。',{seatCampusQuestion:priorQuestion||input.text,cites:['access']});
      }else if(scope.state==='denied'){
        Object.assign(access,{state:'attention',detail:'该请求超出当前账号的校区授权'});
        reply('当前账号无权查询该校区的班级名额。请联系学校管理员确认授权。',{cites:['access']});
      }else{
        Object.assign(access,{state:'done',detail:'当前账号已获 '+scope.campusName+' 的名额查询授权'});
        const read={label:'查询班级名额',state:'running',detail:'正在读取班级报名台账'};
        trace.push(read);
        const readStarted=root.performance.now();
        progress();
        let report;
        try{report=await Q.readRoster(scope);}catch{}
        await holdVisibleStep(c.id,readStarted,seatLookupPace.read);
        if(!report){
          Object.assign(read,{state:'attention',detail:'报名台账读取失败'});
          reply('校区权限校验已通过，报名台账暂时读取失败。请稍后重新查询。',{cites:['access']});
        }else if(!report.rows.length){
          Object.assign(read,{state:'done',detail:'当前台账中没有符合条件的班级'});
          reply('暂未查到符合条件的班级名额。台账范围为 '+report.campusName+' · '+report.term+'。',{seatReport:report});
        }else{
          const {capacity,enrolled,available}=report.totals;
          Object.assign(read,{state:'done',detail:'已读取 '+report.rows.length+' 条班级记录并计算剩余名额'});
          reply(report.campusName+' · '+report.term+'\n共 '+report.rows.length+' 个班，计划 '+capacity+' 个名额，已报名 '+enrolled+' 人，剩余 '+available+' 个名额。',{seatReport:report});
        }
      }
      await remember(c);
    }finally{
      S.jobs.delete(c.id);
      if(here(c)){redraw();bottom();}
    }
  }
  async function send(original,{example=false}={}){
    const c=U.chat(), queued=example?[]:U.files();
    const area=U.areaOf(c);
    if(area==='history')return;
    if(S.jobs.has(c.id))throw Error('正在处理上一条消息，请稍候。');
    const visible=chatMessages(c);
    const lastMessage=visible.at(-1);
    const input={...E.understand(original,{topic:c.topic,pending:lastMessage?.semanticClarification}),example};
    const {text,query:q,clarification}=input;
    if(await command(text))return;
    if(!text&&!queued.length){$('#question')?.focus();return;}
    if(clarification){
      await sendHelp(c,input,{...K.answerKnowledge(input,{kind:'clarify'}),semanticClarification:clarification.options});
      return;
    }
    let intent=A.route(q,c.topic);
    if(q!==text&&Object.hasOwn(confirmAction,intent.kind)){
      const originalIntent=A.route(text,c.topic);
      if(originalIntent.kind!==intent.kind){
        await sendHelp(c,input,{text:confirmAction[intent.kind]});
        return;
      }
      intent=originalIntent;
    }
    if(intent.kind==='help'){
      const guide=A.help[intent.topic];
      if(area==='schedule'&&['knowledge','teachingRules','classChange','studentChange','handoff'].includes(intent.topic)){
        await offerArea(c,input,'qa');
        return;
      }
      await sendHelp(c,input,{
        loading:guide.loading||'正在查找适用的教务资料…',
        resolve:()=>{
          const answer=K.answerKnowledge(input,intent);
          if(area==='schedule'&&intent.topic==='capabilities')return {...answer,text:schedulingHelp};
          if(area==='qa'&&['audit','tasks'].includes(intent.topic))return {...answer,action:areaLink('schedule')};
          return answer;
        }
      });
      return;
    }
    if(intent.kind==='file-overview'){
      if(queued.length){
        await submitAttachments(c,{...input,overview:true},queued,'');
      }else{
        const source=visible.findLast(message=>message.filePreview?.length||message.fileSources?.length);
        const files=source?.filePreview||source?.fileSources;
        const summary=source?.filePreview?F.overview(files):
          files?F.answer(files,'',source.filePurpose):{text:'添加 Excel、CSV 或 Word 后，我可以先读工作表结构、可识别的字段和正文段落，再给你带出处的预览。'};
        await sendHelp(c,input,{...summary,files});
      }
      return;
    }
    const pendingFiles=pendingFor(c);
    const expected=lastMessage?.expectFile;
    const acknowledgesFile=/^(?:给你|在这[儿里]?|就是这份|已上传|附件在这[里儿]?)[。！]?$/.test(q);
    const requested=q&&!(queued.length&&expected&&acknowledgesFile)
      ?A.filePurpose(q,queued.length>0||pendingFiles.length>0)
      :expected||'choose';
    const purpose=Object.hasOwn(purposes,requested)?requested:'';
    const seatCampusQuestion=lastMessage?.seatCampusQuestion;
    const seatLookup=intent.kind==='seat-lookup'||seatCampusQuestion&&Q.isCampusReply(q);
    const schedulingAction=['edit','confirm','reread','hold','status'].includes(intent.kind)||
      intent.kind==='prepare'&&requested!=='choose'&&!queued.length&&!pendingFiles.length;
    if(area==='qa'&&(purpose==='prepare'||!purpose&&schedulingAction)){
      await offerArea(c,input,'schedule');
      return;
    }
    const otherRule=intent.kind==='answer'&&!['import','scope','capacity','teacher','verify','access'].includes(intent.doc);
    if(area==='schedule'&&(purpose==='interpret'||!purpose&&(seatLookup||intent.kind==='transfer-rule'||otherRule))){
      await offerArea(c,input,'qa');
      return;
    }
    if(intent.kind==='transfer-rule'){
      const label=intent.scope==='跨校'?'跨校转班或转校':(intent.scope||'学员')+'转班';
      const duties=E.responsibility.test(q);
      const subject=label+(duties?'责任分工':'')+'条款';
      await sendHelp(c,input,{
        loading:'正在查找'+subject+'…',
        resolve:()=>K.answerKnowledge(input,intent)
      });
      return;
    }
    if(seatLookup){
      await sendSeatLookup(c,input,intent.kind==='seat-lookup'?'':seatCampusQuestion);
      return;
    }
    const pendingBatch=c.pending?.type==='attachment-batch'?c.pending:null;
    if(!queued.length&&pendingBatch&&batchReply.test(q)){
      const index=attachmentBatchIndex(q,pendingBatch.ids.length);
      const id=pendingBatch.ids[index];
      if(id&&S.pendingFiles.has(id)){
        await chooseFilePurpose(c,id,pendingBatch.purpose,input,pendingBatch.question);
        return;
      }
      user(c,input);clearComposer(input);
      if(id){
        c.pending=null;
        tell(c,'请重新添加这批附件，再说明希望如何处理。');
      }else{
        tell(c,'请回复第 1 批至第 '+pendingBatch.ids.length+' 批中的一个批次。');
      }
      await remember(c);redraw();bottom();
      return;
    }
    const lastReport=visible.findLast(item=>item.fileSources);
    const reportPurpose=lastReport?.filePurpose||
      (lastReport?.fileSources.some(report=>report.facts.some(fact=>fact.kind==='readback'))?'readback':'interpret');
    if(!queued.length&&!pendingFiles.length&&lastReport&&(!purpose||purpose===reportPurpose)&&/附件|核对表|刚才的表|上面那份|文件里/.test(q)&&F.knownTopic(q)){
      const started=root.performance.now();
      user(c,input);clearComposer(input);
      const answer=F.answer(lastReport.fileSources,q,reportPurpose);
      await answerQuestion(c,input,answer,{files:lastReport.fileSources,extra:{
        fileAnalysis:true,fileSources:lastReport.fileSources,filePurpose:reportPurpose,
        fileTraceMs:Math.round(root.performance.now()-started),
        fileTrace:[{label:'在附件证据中查找',state:'done',detail:'使用上一次读取的内容'}]
      }});
      redraw();bottom();
      return;
    }
    if(queued.length){
      if(purpose){
        await submitAttachments(c,input,queued,purpose);
        return;
      }
      if(requested==='choose'||['clarify','prepare','greet','hold'].includes(intent.kind)){
        await submitAttachments(c,input,queued,'',null,intent.kind==='greet');
        return;
      }
    }else if(purpose){
      const batchIndex=attachmentBatchIndex(q,pendingFiles.length);
      const selected=batchIndex===null&&pendingFiles.length===1?pendingFiles[0]:pendingFiles[batchIndex];
      if(selected){
        await chooseFilePurpose(c,selected.id,purpose,input);
        return;
      }
      if(purpose==='prepare'&&!pendingFiles.length){
        await requestSetupFiles(c,input);return;
      }
      user(c,input);
      clearComposer(input);
      if(pendingFiles.length){
        c.pending={type:'attachment-batch',purpose,question:q,ids:pendingFiles.map(item=>item.id)};
        const batches=pendingFiles.map((item,index)=>{
          const files=item.work.preview.map(file=>[file.name,file.structure].filter(Boolean).join(' · '));
          return '第 '+(index+1)+' 批 · '+files.join('、');
        });
        tell(c,'你想处理哪一批附件？请回复批次编号，例如「第 1 批」。\n\n'+batches.join('\n'));
      }else{
        const {text,actions}=U.attachmentRequests[purpose];
        tell(c,text,{expectFile:purpose,actions});
      }
      await remember(c);redraw();bottom();
      return;
    }else if(requested==='choose'&&pendingFiles.length){
      user(c,input);clearComposer(input);
      tell(c,'请说明你想用附件完成什么，我会按你的要求继续。');
      await remember(c);redraw();bottom();
      return;
    }
    const budget=text.match(/^\s*(BUD-C\d{2}-(?:SU|AU)-\d{2})\s*$/i)||text.match(/(?:补(?:上|充)?|确认|设置|选择|选用|选|用|填|设为|是|改为)\s*(?:预算(?:编号)?(?:为|是)?)?\s*(BUD-C\d{2}-(?:SU|AU)-\d{2})/i);
    if(budget&&!A.isQuestion(text)&&!A.isQuestion(q)&&!/(?:不要|别|不用|先不|暂不).*(?:补|确认|设置|选|用|填|改)/.test(text))intent={kind:'scope',value:budget[1].toUpperCase()};
    if(area==='qa'&&intent.kind==='scope'){await offerArea(c,input,'schedule');return;}
    const pending=c.pending;
    const selectingRows=pending?.type==='rows'&&intent.kind==='clarify'&&/全部|所有|第.+(?:条|行|班)|班级|入口科目/.test(text);
    const selectingTask=pending?.type==='task'&&intent.kind==='clarify'&&/CP-|校区\d{2}/i.test(text);
    if(intent.kind==='answer'||intent.kind==='clarify'&&!selectingRows&&!selectingTask&&/[\p{L}\p{N}]/u.test(q)){
      await sendHelp(c,input,{
        loading:area==='schedule'?'正在核对设班要求…':'正在查找适用的教务资料…',
        resolve:()=>area==='schedule'&&intent.kind==='clarify'
          ? {text:'请说明要整理的资料或需要核对的班级字段。查教务规则可进入智能问答。',action:areaLink('qa')}
          : K.answerKnowledge(input,intent)
      });
      return;
    }
    if(intent.kind==='prepare'){
      await requestSetupFiles(c,input);return;
    }
    const sentMessage=user(c,input);
    clearComposer(input);
    if(selectingRows){
      const t=S.tasks.get(pending.task);c.pending=null;
      if(!t||t.version!==pending.version)tell(c,'资料已经变化，请重新指定修改范围。');
      else await runIntent(c,pending.intent,text,t,sentMessage);
    }else if(selectingTask){
      const match=matchTasks(c,text).filter(t=>pending.ids.includes(t.id));if(match.length===1){c.pending=null;await runIntent(c,pending.intent,pending.q,match[0],sentMessage);}else tell(c,'请从上一条消息中选择确切的任务。');
    }else if(intent.kind==='greet')tell(c,greeting);
    else if(intent.kind==='acknowledge')tell(c,'好的。有需要可以继续告诉我。');
    else if(intent.kind==='hold')tell(c,'资料会保留在当前步骤。准备好后，再到对应任务的导入清单确认。');
    else if(intent.kind==='clarify')tell(c,area==='schedule'?'请说明要整理或核对的资料。':'请发一个你想查询的教务问题。');
    else{c.pending=null;await runIntent(c,intent,text,chooseIntentTask(c,intent,text),sentMessage);}
    await remember(c);if(here(c)){redraw();bottom();}
  }
  async function pick(id,all=false){
    const c=U.chat(),p=c?.pending,t=S.tasks.get(id);if(!p||!t||t.chatId!==c.id)throw Error('这次选择已结束，请重新说明要处理的任务。');
    if(all&&p.type==='rows'&&p.task===id&&t.version===p.version){c.pending=null;await runIntent(c,{...p.intent,all:true},'全部班级',t,user(c,'全部班级'));}
    else if(!all&&p.type==='task'&&p.ids.includes(id)){c.pending=null;await runIntent(c,p.intent,p.q,t,user(c,'选择 '+id));}
    else throw Error('任务内容已变化，请重新选择。');
    await remember(c);redraw();bottom();
  }
  async function command(text){
    if(!text.startsWith('/'))return false;
    const name=text.slice(1).trim();
    if(!['继续','模板','任务','设班'].includes(name))return false;
    if(U.areaOf(U.chat())!=='schedule'){
      await offerArea(U.chat(),E.understand(text),'schedule');
    }else{
      clearComposer();
      if(name==='继续'||name==='任务')await resume();
      else if(name==='模板')V.templates();
      else if(U.files().length)await submitAttachments(U.chat(),E.understand('整理这批设班资料'),U.files());
      else await beginSetup();
    }
    return true;
  }
  async function resume(){
    const id=U.chat()?.focus;
    if(id&&S.tasks.has(id))await reviewTask(id);
    else if(setupPage())await openSetupStart();
  }
  async function refreshTask(task,fn,step){
    const updated=await edit(task,fn);
    if(activePane(updated))openTask(updated.id,step===undefined?updated.stage:Math.min(step,updated.stage),false);
    redraw();
    return updated;
  }
  function reportReadback(c,t){
    const {audit,receipt}=t;
    if(D.setupComplete(t)){
      tell(c,'资料准备完成。已保存 '+receipt.count+' 条待设班资料，回读 '+audit.matched+' / '+audit.total+' 项一致。',{task:t.id});
      return;
    }
    const message=audit?'已保存 '+receipt.count+' 条待设班资料。回读发现 '+audit.differences.length+' 项差异，请打开核对表查看。':
      '导入回执已保存。回读暂未完成，可以在原任务中重试。';
    tell(c,message,{task:t.id});
  }
  async function commit(task,version){
    if(activeWrites.has(task.id))return;
    activeWrites.add(task.id);
    const button=$('[data-act="commit"]');
    if(button)button.disabled=true;
    try{
      const updated=await edit(task,(item,sys)=>D.write(item,S.data,sys,Number(version)),true);
      redraw();
      if(activePane(updated))openTask(updated.id,updated.stage,false);
      if(!updated.receipt)return;
      let last;
      try{last=await edit(updated,(item,sys)=>D.readback(item,sys));}
      catch{toast('导入回执已保存，可以重新回读。',true);return;}
      const c=S.chats.get(task.chatId);
      if(c&&U.areaOf(c)!=='schedule'){
        reportReadback(c,last);
        await remember(c);
      }
      redraw();
      if(activePane(last))openTask(last.id,3,false);
      if(c&&here(c))bottom();
    }finally{
      activeWrites.delete(task.id);
      if(button?.isConnected)button.disabled=false;
    }
  }
  function auditCSV(t){
    if(!t.audit)throw Error('回读完成后可导出核对表。');
    U.download(t.id+'_回读核对表.csv','text/csv;charset=utf-8',U.csv([['任务ID','校区','预算编号','系统记录ID','班级','字段','提交值','回读值','结果'],...t.audit.rows.map(r=>[t.id,t.seal.context.campus,t.seal.context.budgetId,r.record,r.className,r.field,r.expected,r.actual,r.equal?'一致':'差异'])]));
  }
  async function action(b){
    const {act,id,n,key,q}=b.dataset,t=currentTask(),c=U.chat();
    switch(act){
      case'reload':location.reload();return;
      case'close':U.close();return;
      case'home':case'nav':await nav(id||'qa');return;
      case'menu':
        if(root.matchMedia?.('(max-width: 905px)').matches)document.body.classList.toggle('menu-open');
        else $('#app').classList.toggle('sidebar-closed');
        redraw();
        return;
      case'workspace':
        if(S.workspaceOpen){S.workspaceOpen=false;U.workspaceVisibility();}
        else await resume();
        return;
      case'close-workspace':S.workspaceOpen=false;U.workspaceVisibility();$('#workspace-toggle').focus();return;
      case'expand-workspace':S.expanded=!S.expanded;U.workspaceVisibility();return;
      case'pick-file':openFilePicker(b.nextElementSibling);return;
      case'remove-attachment':
        S.attachments.set(c.id,assignLabels(U.files().filter((_,index)=>index!==Number(n))));
        redraw();$('#question')?.focus({preventScroll:true});
        return;
      case'new-chat':await newChat('qa');present('chat');$('#question')?.focus();return;
      case'new-setup':case'start-setup':await beginSetup();return;
      case'new-fulltime':root.DeskFulltime.newTaskDialog();return;
      case'fulltime-task':if(root.DeskFulltime.select(id))present('fulltime');return;
      case'session':if(S.chats.has(id)){selectChat(id);present('chat');}return;
      case'session-options':U.toggleSessionMenu(b);return;
      case'delete-chat':confirmDeleteChat(id);return;
      case'confirm-delete-chat':await deleteChat(id,b);return;
      case'remove-setup-task':case'remove-fulltime-task':confirmTaskRemoval(id,act==='remove-fulltime-task');return;
      case'confirm-remove-task':await removeTask(id,b);return;
      case'new-task':attachInChat();return;
      case'load-setup-sample':{
        const draft=activeSetup(c);
        if(!setupPage()||draft?.files.length||S.jobs.has(c.id))return;
        const entries=setupSampleFiles.map(name=>({
          name,label:name,size:0,file:{async arrayBuffer(){
            const response=await fetch(U.asset(name));
            if(!response.ok)throw Error('示例文件暂不可用。');
            return response.arrayBuffer();
          }}
        }));
        await uploadSetupFiles(c,entries,draft);
        return;
      }
      case'use-question':{
        if(!q||U.areaOf(c)!=='qa'||S.jobs.has(c.id))return;
        hideExamples();
        await send(q,{example:true});
        return;
      }
      case'add-files':if(t)V.uploadPanel(t.id);return;
      case'templates':if(U.areaOf(c)!=='history')V.templates();return;
      case'ask':await send(q);return;
      case'adjust-attachments':await adjustAttachments(c,id);return;
      case'choose-budget':{
        const selected=S.tasks.get(id);
        if(!selected||selected.chatId!==c.id)throw Error('请在原会话中确认预算。');
        if(S.jobs.has(c.id))throw Error('正在读取本次资料。');
        user(c,'选用预算 '+b.dataset.value,[],id);
        c.focus=id;
        await scopeFromChat(selected,b.dataset.value,c);
        await remember(c);
        redraw();bottom();
        return;
      }
      case'pick-intent-task':await pick(id);return;
      case'all-rows':await pick(id,true);return;
      case'task':
        if(document.body.classList.contains('menu-open')){
          document.body.classList.remove('menu-open');
          redraw();
        }
        await reviewTask(id);return;
      case'step':if(!t)return;if(+n>t.stage){toast('请先完成当前步骤。',true);return;}openTask(t.id,+n,false);return;
      case'advance':
        if(t){
          b.disabled=true;
          try{await refreshTask(t,(v,sys)=>D.go(v,S.data,sys,Number(n)));}
          finally{if(b.isConnected)b.disabled=false;}
        }
        return;
      case'edit-budget':if(t)V.editBudget(t,b.dataset.row);return;
      case'edit-row':if(t)V.editRow(t,b.dataset.row);return;
      case'merge-source':if(t)V.mergeSource(t,b.dataset.row);return;
      case'commit':if(t)await commit(t,b.dataset.version);return;
      case'reread':if(t)await refreshTask(t,(v,sys)=>D.readback(v,sys),3);return;
      case'smart-setup':{
        const task=S.tasks.get(id);
        if(!D.setupComplete(task)||task.seal?.context?.schoolId!==S.data.school.id)throw Error('请先完成本批资料的回读核对。');
        toast('资料已准备，请在教务系统继续设班。');
        return;
      }
      case'diff':if(t){S.diffOnly=!S.diffOnly;S.pages.audit=0;V.taskView(t.id);}return;
      case'page':if(t){S.pages[key]=+n;V.taskView(t.id);}return;
      case'export-audit':if(t)auditCSV(t);return;
      case'export-task':if(t)U.download(t.id+'_任务记录.json','application/json',JSON.stringify({id:t.id,status:D.states[t.status],scope:D.scope(t,S.data).context,events:t.events,checks:t.checks,submission:t.seal,receipt:t.receipt,readback:t.audit},null,2));return;
      case'remove-file':if(t)await refreshTask(t,v=>{D.invalidate(v,0);v.files=v.files.filter(f=>f.id!==b.dataset.file);resetSourceEdits(v,b.dataset.file);D.log(v,'移除资料',b.dataset.file);},0);return;
      case'open-handoff':K.openHandoff(id);return;
      case'teacher-handoff':await K.openTeacherHandoff(id);return;
      case'handoff-chat':{
        const ticket=S.handoffs.get(id);
        if(!ticket||ticket.schoolId!==S.data.school.id||!S.chats.has(ticket.chatId)){toast('原对话已无法打开。');return;}
        selectChat(ticket.chatId);
        present('chat');
        bottom();
        return;
      }
    }
  }
  function resetSourceEdits(task,fileId,sheet,field){
    const prefix=fileId+'-S'+(sheet===undefined?'':(sheet+1)+'-');
    for(const key of ['changes','budgetFixes']){
      const overrides=task[key]||{};
      for(const [id,values] of Object.entries(overrides)){
        if(!id.startsWith(prefix))continue;
        if(field)delete values[field];
        if(!field||!Object.keys(values).length)delete overrides[id];
      }
    }
    if(sheet===undefined)task.omit=task.omit.filter(id=>!id.startsWith(prefix));
  }
  async function change(el){
    const t=currentTask(),ds=el.dataset;
    if(ds.upload){const entries=[...el.files];el.value='';await addFiles(entries,ds.upload);return;}
    if(!t)return;
    if(ds.showSheet){const f=t.files.find(x=>x.id===ds.showSheet);f.selected=+el.value;V.taskView(t.id);return;}
    if(el.hasAttribute('data-filter-fields')){S.fieldFilter=el.value;S.pages.conversions=0;V.taskView(t.id);return;}
    if(D.archive(t))return;
    if(ds.scope){if(!el.value){V.taskView(t.id);return;}await refreshTask(t,v=>D.selectScope(v,S.data,ds.scope,el.value));return;}
    if(ds.include){await refreshTask(t,v=>{D.invalidate(v,0);v.omit=v.omit.filter(id=>id!==ds.include);if(!el.checked)v.omit.push(ds.include);D.log(v,el.checked?'纳入来源行':'移出来源行',ds.include);},0);return;}
    if(ds.header||ds.role||ds.map){
      const fid=ds.header||ds.role||ds.file,sel=t.files.find(x=>x.id===fid).selected;
      await refreshTask(t,v=>{const f=v.files.find(x=>x.id===fid);f.selected=sel;const s=f.sheets[sel];
        if(s.analysis.readback)throw Error('回读核对表可用于查看核对结果。请选用班级或预算工作表进行设班。');
        if(ds.header){
          I.setHeader(f,+el.value);
          resetSourceEdits(v,fid,s.sourceIndex);
        }else if(ds.role){
          s.role=el.value;
          f.role=s.role;
          s.analysis=I.analyze(s,s.header,s.role);
        }else{
          D.remap(v,f,s,ds.map,el.value);
          resetSourceEdits(v,fid,s.sourceIndex,ds.map);
        }
        const affectsScope=ds.header||ds.role||D.scopeKeys.includes(ds.map)||ds.map==='area_id';
        D.invalidate(v,affectsScope?0:1);
        D.log(v,ds.header?'修正表头':ds.role?'调整工作表用途':'修正列映射',f.id+' · '+s.label);
      });
    }
  }
  async function formSubmit(f){
    if(f.id==='fulltime-create-form'){if(await root.DeskFulltime.createTask(f))present('fulltime');return;}
    if(f.id==='composer'){await send(f.elements.question?.value||$('#question')?.value);return;}
    if(f.id==='handoff-reply-form'){await K.replyToHandoff(f);return;}
    if(f.id==='budget-form'){
      const t=currentTask(),r=f.dataset.row,x=Object.fromEntries(new FormData(f));
      const cap=Number(x.capacity),target=Number(x.target_students);
      if(!['科目A','科目B','科目C','科目D'].includes(x.subject_id)||!Number.isFinite(target)||target<0||!Number.isInteger(cap)||cap<1)throw Error('请核对科目、目标人次和预算班均。');
      await refreshTask(t,v=>{D.invalidate(v,1);(v.budgetFixes||={})[r]={subject_id:x.subject_id,capacity:cap,target_students:target};D.log(v,'修正预算明细',r);});return;
    }
    if(f.id==='row-form'){
      const t=currentTask(),id=f.dataset.row,m=D.model(t,S.data,U.systemForTask(t),{checkRules:false}),rec=m.records.find(r=>r.row===id),x=Object.fromEntries(new FormData(f));
      await refreshTask(t,v=>{for(const k of D.editable){if(x[k]!==undefined&&x[k]!==''&&String(rec[k]??'')!==x[k])D.correct(v,S.data,[id],k,x[k]);}});
    }
  }
  async function addFiles(files,mode){
    if(!files.length)return;
    hideExamples();
    const entries=files.map(file=>({file,name:file.name,size:file.size}));
    if(mode==='setup'){
      const c=U.chat();
      if(setupPage())await uploadSetupFiles(c,entries,activeSetup(c));
      return;
    }
    const target=mode==='wizard'&&S.tasks.get(S.dialog?.target);
    if(target)await uploadSetupFiles(S.chats.get(target.chatId),entries,target);
    else queueFiles(entries);
  }
  async function handle(fn,source){
    const inWorkspace=!!source?.closest('#workspace'), ownerId=S.chatId;
    try{await fn();}
    catch(error){
      if(error.chatId){
        await forgetChat(error.chatId);
        redraw();
      }else if(/已有新记录/.test(error.message)){
        const id=currentTask()?.id;
        await refresh();redraw();if(id&&S.tasks.has(id)&&S.workspaceOpen)openTask(id);
      }
      toast(error.message||'操作未完成，请重试。',inWorkspace&&S.chatId===ownerId);
    }
  }
  function showExamples(){
    const input=$('#question'), examples=$('#composer-examples');
    if(!input||!examples||input.value.trim()||S.composing||S.jobs.has(S.chatId))return false;
    examples.hidden=false;
    return true;
  }
  function hideExamples(restoreFocus=false){
    const examples=$('#composer-examples');
    if(!examples||examples.hidden)return;
    const restore=restoreFocus&&examples.contains(document.activeElement);
    examples.hidden=true;
    if(restore)$('#question')?.focus({preventScroll:true});
  }
  document.addEventListener('click',event=>{
    if(!event.target.closest('#session-menu,[data-act="session-options"]'))U.closeSessionMenu();
    if(event.target.id==='question')showExamples();
    else if(!event.target.closest('#composer-examples'))hideExamples();
    const element=event.target.closest('[data-act]');
    if(!element)return;
    event.preventDefault();
    if(S.data||element.dataset.act==='reload')handle(()=>action(element),element);
  });
  document.addEventListener('focusin',event=>{
    if(!event.target.closest('#session-menu,[data-act="session-options"]'))U.closeSessionMenu();
    if(!event.target.closest('#question,#composer-examples'))hideExamples();
  });
  $('#sessions').addEventListener('scroll',()=>U.closeSessionMenu(true));
  window.addEventListener('resize',()=>U.closeSessionMenu(true));
  document.addEventListener('submit',event=>{
    event.preventDefault();
    handle(()=>formSubmit(event.target),event.target);
  });
  document.addEventListener('change',event=>handle(()=>change(event.target),event.target));
  document.addEventListener('input',event=>{
    const item=event.target;
    if(item.id==='question'){
      S.draftText.set(S.chatId,item.value);
      hideExamples();
    }
  });
  document.addEventListener('compositionstart',event=>{
    S.composing=true;
    if(event.target.id==='question')hideExamples();
  });
  document.addEventListener('compositionend',()=>S.composing=false);
  document.addEventListener('keydown',event=>{
    if(event.target.id==='question'&&event.key==='ArrowDown'&&!event.isComposing&&showExamples()){
      event.preventDefault();
      $('#composer-examples button')?.focus({preventScroll:true});
      return;
    }
    if(event.target.id==='question'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!S.composing&&event.keyCode!==229){
      event.preventDefault();handle(()=>send(event.target.value));
    }
    if(event.key==='Escape'){
      const examples=$('#composer-examples');
      if(examples&&!examples.hidden){
        event.preventDefault();
        hideExamples(true);
      }else if(!$('#session-menu').hidden){
        event.preventDefault();
        U.closeSessionMenu(true);
      }else if(!$('#panel').open)document.body.classList.remove('menu-open');
    }
  });
  for(const name of ['dragover','dragleave','drop'])document.addEventListener(name,event=>{
    const drop=event.target.closest('[data-drop]');
    if(!drop)return;
    event.preventDefault();
    drop.classList.toggle('is-drag',name==='dragover');
    if(name==='drop')handle(()=>addFiles([...event.dataTransfer.files],drop.dataset.drop),drop);
  });
  $('#panel').addEventListener('cancel',()=>{S.dialog=null;});$('#panel').addEventListener('click',e=>{if(e.target===$('#panel')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)U.close();}});
  window.addEventListener('hashchange',()=>handle(()=>nav(location.hash.slice(1))));
  async function legacy(q,c){
    const profiles=['missing','complete','conflict','campus','budget','duplicate','fourth'],faults=['retry','escalate','mismatch','timeout'];
    if(!profiles.includes(q)&&!faults.includes(q))return;
    const f=C.createTask(S.data,{profile:profiles.includes(q)?q:'complete'}),t=D.task(c.id,faults.includes(q)?q:'');
    const chars=U.csv([['班名','学科','学校','校区','财年','季度','预算编号','轮次','上课时段','授课老师','班额'],...f.input.map(r=>[r.name,r.subject,r.school,r.campus,r.fiscalYear,r.quarter,r.budget,r.period,r.slot,r.teacher,r.capacity])]);
    D.addFile(t,new TextEncoder().encode(chars),'班级资料.csv','班级资料.csv');
    user(c,'整理班级资料',['班级资料.csv'],t.id);
    c.focus=t.id;
    tell(c,intakeSummary(t,await loadTaskSystem(t)),{task:t.id});
    await R.createIntake(t,c);
    S.tasks.set(t.id,t);
  }
  async function init(){
    const json=async path=>{const r=await fetch(path+'?v=setup-upload-1124',{cache:'no-cache'});if(!r.ok)throw Error('资料目录读取失败');return r.json();};
    const [data,docs]=root.DESK_BOOT||await Promise.all([json('data.json'),json('knowledge.json')]);
    S.data=data;await R.init();await refresh();S.docs=new Map([...docs,...await R.all('docs')].map(d=>[d.id,d]));
    const url=new URL(location.href),scenario=url.searchParams.get('case');
    await nav(scenario?'schedule':url.hash.slice(1),!scenario);
    if(scenario){
      if(!U.chat().messages.length)await legacy(scenario,U.chat());
      const cleaned=new URL(location.href);
      cleaned.searchParams.delete('case');
      history.replaceState(null,'',cleaned);
      redraw();
    }
    if(R.temporary)toast('当前浏览器存储暂不可用，本页可继续处理资料。');
  }
  init().catch(()=>{$('#view').innerHTML='<div class="page"><h2>工作台资料暂未加载</h2><p class="lead">请重新读取工作台。</p>'+btn('重新加载','reload','','primary')+'</div>';});
})(window);
