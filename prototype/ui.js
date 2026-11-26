(function (root) {
  'use strict';
  const D = root.PrepDesk;
  const S = root.DeskState = {
    tasks: new Map(), chats: new Map(), docs: new Map(), handoffs: new Map(),
    systems: new Map(), page: 'chat', chatId: '', dialog: null, pane: null,
    workspaceOpen: false, expanded: false, viewStep: 0, pages: {},
    attachments: new Map(), pendingFiles: new Map(), draftText: new Map(), jobs: new Map(), openLogs: new Set(),
    composing: false
  };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]
  ));
  const paths = {
    plus:'M12 4v16M4 12h16', x:'M6 6l12 12M18 6 6 18',
    chat:'M4 4h16v12H9l-5 4z', tasks:'M5 4h14v16H5zM8 9h8m-8 5h6',
    book:'M3 5c4-1 7 0 9 2 2-2 5-3 9-2v13c-4-1-7 0-9 2-2-2-5-3-9-2zM12 7v13',
    notice:'M3 10h5l12-5v14L8 14H3zM7 14l2 6h3l-2-5',
    sidebar:'M4 5h16v14H4zM10 5v14', pane:'M4 5h16v14H4zM14 5v14',
    expand:'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5',
    shrink:'M4 9h5V4m6 0v5h5M9 20v-5H4m16 0h-5v5',
    send:'M12 19V5m-6 6 6-6 6 6', attach:'M8 13l7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9',
    arrow:'M5 12h14m-6-6 6 6-6 6', sheet:'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h8m-4-6v7',
    download:'M12 3v11m-4-4 4 4 4-4M4 16v4h16v-4', clock:'M12 21a9 9 0 1 0-.01 0M12 7v5l4 2',
    check:'m4 12 5 5L20 6', file:'M5 3h9l5 5v13H5zM14 3v6h5',
    more:'M5 12h.1M12 12h.1M19 12h.1',
    trash:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5'
  };
  function icon(name) {
    return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65"><path d="${paths[name] || paths.file}"/></svg>`;
  }
  const btn = (label, act, extra = '', cls = 'outline') =>
    `<button type="button" class="btn ${cls}" data-act="${act}" ${extra}>${esc(label)}</button>`;
  const attr = (name, value) => 'data-' + name + '="' + esc(value) + '"';
  const badge = (value, color = '') => `<span class="badge ${color}">${esc(value)}</span>`;
  const status = task => {
    const color = {blocked:'red',difference:'red',handoff:'red',scope:'warm',mapping:'warm',ready:'warm',pending:'warm'};
    return badge(D.states[task.status], color[task.status] || '');
  };
  const time = value => value ? new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
  const list = map => [...map.values()].sort((a,b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  const chat = () => S.chats.get(S.chatId);
  const areas = {
    qa: {label:'智能问答',icon:'chat',intro:'查教务规则、解读附件条款，或查询有权限的班级名额。',input:'输入教务问题，例如「解读附件」'},
    schedule: {label:'教务排课',icon:'sheet'},
    history: {label:'历史会话',icon:'tasks'}
  };
  const areaOf = c => c?.area==='qa'||c?.area==='schedule' ? c.area : 'history';
  const chatsFor = area => list(S.chats).filter(c=>areaOf(c)===area&&(area!=='history'||c.messages.length));
  const setupPage = () => S.page==='chat' && chat()?.area==='schedule';
  function activeSetup(c){
    const task=S.tasks.get(c?.focus);
    return c?.area==='schedule'&&task&&task.chatId===c.id&&!task.hiddenFromList?task:null;
  }
  function chatMessages(c){
    const task=activeSetup(c);
    return task?root.DeskRecords.withoutTaskMessages(c,id=>id!==task.id).messages:c.messages;
  }
  const systemForTask = task => S.systems.get(task.chatId) || root.DeskRecords.initial(task.chatId);
  const files = () => S.attachments.get(S.chatId) || [];
  const fileInput = mode => `<input type="file" ${attr('upload',mode)} multiple accept=".xlsx,.xls,.csv,.docx" hidden>`;
  function selectFiles(label,mode,style='outline small'){
    return `<button type="button" class="btn ${style} file-trigger" data-act="pick-file">${icon('attach')}${esc(label)}</button>
      ${fileInput(mode)}`;
  }
  const sampleWorkbook = '暑期设班示例.xlsx';
  const questionExamples = [
    ['调课审批通过后还能撤回吗？','查看规则答复与出处'],
    ['查询校区02的班级名额','查看各班剩余名额'],
    ['查询校区07的班级名额','体验校区授权校验'],
    ['补办结业证明需要谁签字？','查看待教务确认的通知']
  ];
  const asset = name => root.OFFLINE_ASSETS?.[name] || 'examples/' + encodeURIComponent(name);
  const assetLink = (label,name) =>
    `<a class="btn small outline" href="${asset(name)}" download="${esc(name)}">${icon('download')}${esc(label)}</a>`;
  const attachmentRequests = {
    prepare: {
      text:'请上传本次班级资料，可以一起发送招生预算和 Word 说明。',
      actions:[
        {label:'上传设班资料',act:'new-task',primary:true},
        {label:'下载设班模板',download:'设班资料标准模板.xlsx'}
      ]
    },
    interpret: {
      text:'请上传要解读的规则资料，可以一并说明想核对的条款。',
      actions:[{label:'上传规则资料',act:'new-task',primary:true}]
    },
    readback: {
      text:'请上传导出的回读核对表。',
      actions:[{label:'上传核对表',act:'new-task',primary:true}]
    }
  };
  const oldUploadPrompts = {
    interpret:'用输入框的「添加附件」选择资料，也可以写上想查找的条款。',
    readback:'用输入框的「添加附件」选择导出的回读核对表。'
  };

  function toast(message, inWorkspace = false) {
    if ($('#panel').open) {
      let item = $('#dialog-alert');
      if (!item) {
        item = document.createElement('div');
        item.id = 'dialog-alert';
        item.setAttribute('role','alert');
        item.className = 'alert';
        $('#panel-body').prepend(item);
      }
      item.textContent = message;
      item.scrollIntoView?.({block:'nearest'});
      return;
    }
    if (inWorkspace && S.workspaceOpen) {
      const alert = $('#workspace-alert');
      alert.textContent = message;
      alert.hidden = false;
      $('#workspace-scroll').scrollTop = 0;
      return;
    }
    const notice = $('#toast');
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => { notice.hidden = true; }, 4200);
  }

  function panel(kind, title, meta, body, foot = '', options = {}) {
    const element = $('#panel'), box = $('#panel-body');
    const same = element.open && S.dialog?.type === kind && S.dialog?.key === options.key;
    const scroll = same ? box.scrollTop : 0;
    S.dialog = {type:kind,...options};
    element.classList.toggle('narrow',!!options.narrow);
    $('#panel-title').textContent = title;
    $('#panel-meta').textContent = meta;
    box.innerHTML = body;
    $('#panel-foot').innerHTML = foot;
    if (!element.open) element.showModal();
    box.scrollTop = scroll;
  }

  function close() {
    const element = $('#panel');
    if (element.open) element.close();
    S.dialog = null;
  }

  function workspaceVisibility() {
    const primary = setupPage();
    const available = S.page==='chat' && areaOf(chat())==='history' && !!S.pane;
    const open = available && S.workspaceOpen;
    const workspace = $('#workspace');
    workspace.hidden = !primary && !open;
    workspace.setAttribute('role',primary?'main':'complementary');
    const toggle = $('#workspace-toggle');
    toggle.hidden = !available;
    toggle.setAttribute('aria-expanded',String(open));
    $('#deck').classList.toggle('setup-flow',primary);
    $('#deck').classList.toggle('with-workspace',open);
    $('#deck').classList.toggle('expanded',open && S.expanded);
    const expand = $('[data-act="expand-workspace"]');
    expand.hidden = $('[data-act="close-workspace"]').hidden = primary;
    expand.setAttribute('aria-label', S.expanded ? '还原工作区宽度' : '扩展工作区');
    expand.innerHTML = icon(S.expanded ? 'shrink' : 'expand');
  }

  function workspaceContent(title, meta, tabs, body, foot, identity) {
    const scroll = $('#workspace-scroll');
    const previousScroll = S.workspaceIdentity === identity ? scroll.scrollTop : 0;
    const open = S.workspaceIdentity === identity ? [...scroll.querySelectorAll('details')].map(item=>item.open) : [];
    S.workspaceIdentity = identity;
    $('#workspace-title').textContent = title;
    $('#workspace-meta').textContent = meta;
    $('#workspace-tabs').innerHTML = tabs;
    $('#workspace-tabs').hidden = !tabs;
    $('#workspace-body').innerHTML = body;
    $('#workspace-alert').hidden = true;
    $('#workspace-foot').innerHTML = foot;
    $('#workspace-foot').hidden = !foot;
    [...scroll.querySelectorAll('details')].forEach((item,index)=>{if(open[index])item.open=true;});
    workspaceVisibility();
    scroll.scrollTop = previousScroll;
  }

  function citationCard(file,location,excerpt,key) {
    return `<details class="citation-card" ${attr('run',key)} ${S.openLogs.has(key)?'open':''}>
      <summary class="citation">${icon('book')}${esc(file)}<span class="citation-chevron" aria-hidden="true">›</span></summary>
      <div class="citation-body"><p class="meta">${esc(location)}</p><p class="copy">${esc(excerpt)}</p></div>
    </details>`;
  }
  function sourceGroup(label,cards) {
    return cards?`<section class="source-group" aria-label="${esc(label)}"><p class="meta">${esc(label)}</p><div class="citations">${cards}</div></section>`:'';
  }
  function citation(id,clause,key) {
    const K=root.DeskKnowledge;
    const doc=S.docs.get(id)||K.referenceDocs[id];
    if(!K.visible(doc,{schoolId:S.data.school.id,role:K.role}))return '';
    const parts=K.split(doc.body);
    const excerpt=parts[clause-1];
    const location=[doc.title,doc.page,doc.version?'版本 '+doc.version:'',excerpt?'第 '+clause+' 条':''].filter(Boolean).join(' · ');
    return citationCard(doc.file||doc.title+'.md',location,excerpt||parts.join('\n\n'),key);
  }

  function attachment(item, removable = false, index = 0) {
    const name = typeof item === 'string' ? item : item.label;
    const remove = removable
      ? `<button type="button" class="icon" aria-label="移除 ${esc(name)}" data-act="remove-attachment" ${attr('n',index)}>${icon('x')}</button>` : '';
    return `<span class="attachment">${icon('file')}<span>${esc(name)}</span>${remove}</span>`;
  }

  function classCount(task) {
    if (task.seal) return task.seal.rows.length;
    const excluded = new Set(task.omit);
    return task.files.reduce((sum,f) => sum + f.sheets.filter(s=>s.role==='classes').reduce((count,s) => (
      count + s.analysis.rows.filter(row=>!excluded.has(root.ClassPrepImport.rowKey(f,s,row.number))).length
    ),0),0);
  }

  function taskLink(task) {
    const label = task.audit ? '查看核对表' : task.status==='ready' ? '核对导入清单' : '打开核对工作区';
    return `<button class="task-link" data-act="task" ${attr('id',task.id)}>${icon('pane')}${label}</button>`;
  }

  function runCard(task, activeChat) {
    const sk = D.scope(task,S.data), context = sk.context;
    const summary = [
      context.campusId ? context.campus : '校区待确认', context.quarter,
      task.files.length + ' 份资料', classCount(task) + ' 条班级'
    ].filter(Boolean).join(' · ');
    const budget = sk.fields.budget_id;
    const acceptsBudget = activeChat && task.stage === 0 && budget.issue === '待确认' && !D.archive(task) &&
      Object.values(sk.fields).filter(f=>f.issue).length === 1 && budget.options.length <= 3;
    const choice = acceptsBudget ? `<div class="run-wait">选择本次预算</div><div class="msg-actions">${budget.options.map(([id])=>btn(
      id,'choose-budget',attr('id',task.id)+' '+attr('value',id),'outline small'
    )).join('')}</div>` : '';
    const last = task.events.at(-1);
    const records = last ? `<details class="run-record" ${attr('run',task.id)} ${S.openLogs.has(task.id)?'open':''}><summary>${esc(last.action)} · ${task.events.length} 项处理记录</summary>
      <ol class="timeline">${task.events.map(entry=>`<li class="event"><time>${time(entry.at)}</time><b>${esc(entry.action)}</b> ${esc(entry.details)}</li>`).join('')}</ol></details>` : '';
    return `<section class="run-card">
      <div class="run-head"><span class="tile-icon">${icon('sheet')}</span><div class="run-main">
        <div class="run-title"><b>设班资料整理</b>${status(task)}</div><div class="meta">${esc(summary)}</div>
      </div>${taskLink(task)}</div>${choice}${records}
    </section>`;
  }

  function composer() {
    const queued = files();
    const busy = S.jobs.has(S.chatId);
    const area = areaOf(chat()), input = areas[area].input;
    return `<div class="chat-dock">
      <form id="composer" class="composer" data-drop="composer">
        ${queued.length?`<div class="attachments" aria-label="待发送附件">${queued.map((item,i)=>attachment(item,true,i)).join('')}</div>`:''}
        <label for="question" class="screenreader">${esc(input)}</label>
        <textarea rows="2" name="question" id="question" placeholder="${esc(input)}" maxlength="2400"
          aria-controls="composer-examples" aria-keyshortcuts="ArrowDown">${esc(S.draftText.get(S.chatId) || '')}</textarea>
        ${examplePicker(busy)}
        ${fileInput('composer')}
        <div class="composer-bottom">
          <button type="submit" class="send" aria-label="发送" ${busy?'disabled':''}>${icon('send')}</button>
        </div>
      </form>
      <div class="composer-meta">${queued.length?queued.length+' / 10 份附件待发送':'桌面端可拖入文件 · Excel、CSV、Word（.docx）· 最多 10 份'}</div>
    </div>`;
  }

  function taskName(task) {
    const {campusId,campus,quarter}=task.seal?.context||D.scope(task,S.data).context;
    return [campusId?campus:'校区待确认',quarter?quarter+'设班':'设班任务'].join(' · ');
  }
  function recordOptions(id,title,act='delete-chat',label='删除会话') {
    return `<button type="button" class="icon session-options" data-act="session-options" ${attr('id',id)}
      ${attr('option-act',act)} ${attr('option-label',label)} aria-label="更多操作 · ${esc(title)}"
      aria-controls="session-menu" aria-expanded="false" title="更多操作">${icon('more')}</button>`;
  }

  const plannedModules = {
    fulltime:{label:'全日制排课',icon:'sheet'},
    'class-release':{label:'放班管理',icon:'tasks'}
  };
  const menu = [['qa',areas.qa],['schedule',areas.schedule],...Object.entries(plannedModules)];
  let sessionTrigger;

  function closeSessionMenu(restoreFocus = false) {
    if (!sessionTrigger) return;
    const trigger = sessionTrigger;
    sessionTrigger = null;
    $('#session-menu').hidden = true;
    trigger.setAttribute('aria-expanded','false');
    if (restoreFocus && trigger.isConnected) trigger.focus({preventScroll:true});
  }

  function toggleSessionMenu(trigger) {
    if (sessionTrigger === trigger) {
      closeSessionMenu(true);
      return;
    }
    closeSessionMenu();
    sessionTrigger = trigger;
    trigger.setAttribute('aria-expanded','true');
    const popup = $('#session-menu'), action = popup.querySelector('button');
    const {id,optionAct,optionLabel}=trigger.dataset;
    const listRemoval=optionLabel==='移出列表';
    action.dataset.id=id;
    action.dataset.act=optionAct;
    action.classList.toggle('list-removal',listRemoval);
    action.innerHTML=icon(listRemoval?'x':'trash')+esc(optionLabel);
    popup.hidden = false;
    const anchor = trigger.getBoundingClientRect();
    const below = anchor.bottom + 4;
    const top = below + popup.offsetHeight <= root.innerHeight - 8
      ? below : Math.max(8,anchor.top - popup.offsetHeight - 4);
    popup.style.top = top + 'px';
    popup.style.left = Math.max(8,anchor.right - popup.offsetWidth) + 'px';
    action.focus({preventScroll:true});
  }

  function layout() {
    closeSessionMenu();
    const c = chat(), area = c ? areaOf(c) : 'qa';
    const currentPage = S.page==='chat' ? area : S.page;
    $('#nav').innerHTML = menu.map(([id,item])=>{
      const planned=Object.hasOwn(plannedModules,id)?badge('规划中','warm nav-plan')+' ':'';
      return `<button class="nav-btn ${currentPage===id?'active':''}" data-act="nav" ${attr('id',id)} ${currentPage===id?'aria-current="page"':''}>${icon(item.icon)}${planned}${esc(item.label)}</button>`;
    }).join('');
    const fulltime=S.page==='fulltime', showList=S.page==='chat', scheduling=currentPage==='schedule';
    const create=$('#sidebar-create'), heading=$('#sidebar-list-title'), entries=$('#sessions');
    create.hidden=heading.hidden=entries.hidden=!showList&&!fulltime;
    let title='';
    if(showList){
      create.dataset.act=scheduling?'new-setup':'new-chat';
      create.innerHTML=icon('plus')+(scheduling?'新建设班任务':'新对话');
      heading.textContent=scheduling?'排课任务':area==='history'?'历史会话':'会话';
      if(scheduling){
        const tasks=list(S.tasks).filter(task=>!task.hiddenFromList&&S.chats.get(task.chatId)?.area==='schedule');
        entries.innerHTML=tasks.map(task=>{
          const name=taskName(task);
          const current=task.id===c?.focus&&task.chatId===c.id;
          if(current)title=name;
          const state=task.status==='input'?(S.jobs.has(task.chatId)?'正在识别资料':'待上传资料'):D.states[task.status];
          const detail=[task.id,state].filter(Boolean).join(' · ');
          return `<div class="session-row ${current?'active':''}">
            <button type="button" class="session task-entry" data-act="task" ${attr('id',task.id)} ${current?'aria-current="true"':''}>
              <span>${esc(name)}</span><span class="task-entry-meta">${esc(detail)}</span>
            </button>
            ${recordOptions(task.id,name,'remove-setup-task',task.receipt?'移出列表':'删除任务')}
          </div>`;
        }).join('');
      }else{
        title=c?.messages.length?c.title:'';
        entries.innerHTML=chatsFor(area).filter(c=>c.messages.length).map(c=>{
          const current = c.id===S.chatId;
          const id = attr('id',c.id);
          return `<div class="session-row ${current?'active':''}">
            <button type="button" class="session" data-act="session" ${id} ${current?'aria-current="true"':''}><span>${esc(c.title)}</span></button>
            ${recordOptions(c.id,c.title)}
          </div>`;
        }).join('');
      }
    }else if(fulltime){
      create.dataset.act='new-fulltime';
      create.innerHTML=icon('plus')+'新建全日制任务';
      heading.textContent='全日制任务';
      entries.innerHTML=root.DeskFulltime.entries();
      title=root.DeskFulltime.current()?.name||'';
    }else{
      entries.innerHTML='';
    }
    $('#crumb').textContent = showList
      ? [areas[area].label,title].filter(Boolean).join(' · ')
      : [menu.find(item=>item[0]===S.page)?.[1].label || '工作台',title].filter(Boolean).join(' · ');
    for (const item of document.querySelectorAll('i[data-ico]')) item.outerHTML = icon(item.dataset.ico);
    const sideToggle = $('[data-act="menu"]');
    const mobile = root.matchMedia?.('(max-width: 905px)').matches;
    const sidebarOpen = mobile ? document.body.classList.contains('menu-open') : !$('#app').classList.contains('sidebar-closed');
    sideToggle.setAttribute('aria-expanded',String(sidebarOpen));
    sideToggle.setAttribute('aria-controls','sidebar');
    workspaceVisibility();
  }

  function exampleOption(title,hint,action) {
    return `<button type="button" class="example-option" ${action}>
      <strong>${esc(title)}</strong><small class="hint">${esc(hint)}</small>
    </button>`;
  }
  function examplePicker(busy) {
    const disabled=busy?' disabled':'';
    const options=questionExamples.map(([question,hint])=>exampleOption(question,hint,'data-act="use-question" '+attr('q',question)+disabled));
    return `<section class="example-popover" id="composer-examples" aria-labelledby="examples-heading" hidden>
      <h3 id="examples-heading">智能问答示例</h3>
      <div class="example-list">${options.join('')}</div>
    </section>`;
  }
  function welcome() {
    const {label,intro} = areas[areaOf(chat())];
    return `<div class="welcome"><span class="welcome-logo" aria-hidden="true"><span class="brandmark"><i></i><i></i><i></i></span></span>
      <h1>${label}</h1><p class="lead">${intro}</p></div>`;
  }

  function attachmentFollowUp(message,chatId){
    if(!message.fileRequest||message.fileChoice)return {};
    const request=S.pendingFiles.get(message.fileRequest);
    if(request&&request.chatId!==chatId)return {};
    const disabled=S.jobs.has(chatId)?' disabled':'';
    const blocked=request?.work.blocked??message.filePreview?.some(file=>file.error)??false;
    const inCard=message.filePreview?.length&&!blocked;
    const adjustment=request
      ? btn(request.entries.length>1&&inCard?'调整本批附件':'调整附件','adjust-attachments',attr('id',request.id)+disabled,inCard?'quiet small':'outline small')
      : btn('重新添加附件','new-task',disabled,'outline small');
    let question='你希望我怎么处理这批资料？';
    if(!request)question='重新添加附件后，可以继续处理这批资料。';
    else if(blocked)question='请调整未能读取的附件，再继续。';
    return {
      previewControl:inCard?adjustment:'',
      prompt:message.fileSummarized
        ?(inCard?'':`<div class="file-follow-up">${adjustment}</div>`)
        :`<div class="file-follow-up"><p class="file-question">${question}</p>${inCard?'':adjustment}</div>`
    };
  }
  function traceDuration(milliseconds){
    if(!Number.isFinite(milliseconds)||milliseconds<0)return '';
    if(milliseconds<100)return '用时不足 0.1 秒';
    if(milliseconds<60000)return '用时 '+(milliseconds/1000).toFixed(1).replace(/\.0$/,'')+' 秒';
    const seconds=Math.floor(milliseconds/1000);
    return '用时 '+Math.floor(seconds/60)+' 分钟 '+seconds%60+' 秒';
  }
  function fileTrace(steps,{key,elapsed,intro=''}={}){
    if(!steps?.length)return '';
    const states={done:'已完成',running:'进行中',attention:'待处理'};
    const items=`<ol class="file-trace-list">${steps.map(step=>{
        const running=step.state==='running';
        const glyph=step.state==='done'?icon('check'):step.state==='attention'?icon('notice'):'<span class="pulse" aria-hidden="true"></span>';
        return `<li class="trace-step ${esc(step.state)}"><span class="trace-icon">${glyph}</span>
          <span class="screenreader">${states[step.state]}</span><span class="trace-label">${esc(step.label)}</span>
          <span class="trace-detail ${running?'run-busy':''}" ${running?'role="status"':''}>${esc(step.detail)}</span>
        </li>`;
      }).join('')}</ol>`;
    if(!key)return `<section class="file-trace" aria-label="处理记录"><h4>处理记录</h4>${items}</section>`;
    const duration=traceDuration(elapsed);
    return `<details class="file-trace file-trace-completed" ${attr('run',key)} ${S.openLogs.has(key)?'open':''}>
      <summary>处理记录${duration?`<span class="trace-duration"> · ${esc(duration)}</span>`:''}</summary>
      <div class="file-trace-body">${intro}${items}</div>
    </details>`;
  }
  function filePreview(files,control=''){
    if(!files?.length)return '';
    return `<section class="file-preview" aria-label="附件识别结果">
      ${files.map((file,index)=>`<section class="preview-file">
        <div class="preview-file-head">${icon('file')}<h4>${esc(file.name)}</h4>
          ${file.structure?`<span class="meta">${esc(file.structure)}</span>`:''}
          ${index===0&&control?`<span class="preview-file-control">${control}</span>`:''}
        </div>
        ${file.error?`<p class="preview-error">${esc(file.error)}</p>`:
          (file.sections||[]).map(section=>`<div class="preview-excerpt">
            ${section.basis?`<p class="preview-basis">${esc(section.basis)}</p>`:''}
            <p class="preview-excerpt-head"><strong>${esc(section.title)}</strong>${section.source?`<span class="meta">${esc(section.source)}</span>`:''}</p>
            ${section.examples.map(example=>`<p class="preview-row">${esc(example.description)}<span class="meta file-source">${esc(example.source)}</span></p>`).join('')}
          </div>`).join('')+
          (file.note?`<p class="hint">${esc(file.note)}</p>`:'')}
      </section>`).join('')}
    </section>`;
  }
  function fileSources(reports,key){
    return (reports||[]).filter(report=>report.facts?.length).map((report,index)=>{
      const legacy=report.name?.match(/^F(\d+) · (XLSX|XLS|CSV|DOCX)$/);
      const file=legacy?'资料 '+legacy[1]+'.'+legacy[2].toLowerCase():report.name;
      const excerpt=report.facts.map(item=>[item.source,item.description].filter(Boolean).join(' · ')).join('\n');
      return citationCard(file,report.structure,excerpt,key+':attachment:'+index);
    }).join('');
  }
  function seatSource(report,key){
    if(!report)return '';
    const location=[report.sourceSheet||'班级明细',report.campusName,report.term].filter(Boolean).join(' · ');
    const excerpt=report.rows.length?'用台账中的计划名额减去已报名人数，得到各班剩余名额，最低为 0。':'台账中暂无符合本次查询条件的班级。';
    return citationCard(report.sourceFile||'班级报名台账.xlsx',location,excerpt,key+':roster');
  }

  function seatResult(report){
    if(!report?.rows.length)return '';
    const headers=['班级','计划名额','已报名','剩余名额'];
    const rows=report.rows.map(row=>tr([row.name,row.capacity,row.enrolled,row.available].map(esc)));
    return '<section class="seat-result" aria-label="班级名额明细">'+table(headers,rows,'compact')+'</section>';
  }

  function interpretationNote(message){
    if(message?.role!=='user'||!message.interpretation)return '';
    return '<p class="interpretation-note">按「'+esc(message.interpretation)+'」理解</p>';
  }
  function handoffReceipt(id){
    const ticket=S.handoffs.get(id);
    if(!ticket||ticket.schoolId!==S.data.school.id)return '';
    const sent=root.DeskServices.dingTalkSent(ticket);
    const delivery=sent?'已通过钉钉通知':'钉钉待通知';
    const label=ticket.reply?'查阅消息':sent?'查看通知':'查看工单';
    const feedback=ticket.reply?ticket.teacher+'已回复，请查阅消息。':ticket.readAt?ticket.teacher+'已查看你的问题。':'';
    return `<section class="run-card" aria-label="人工工单"><div class="run-head"><span class="tile-icon">${icon('chat')}</span>
      <div class="run-main"><div class="run-title"><b>已转人工</b>${badge(ticket.status,'warm')}</div>
      <div class="meta">${esc(delivery+' · '+ticket.schoolName+' · 教务'+ticket.teacher+' · '+ticket.id)}</div>
      ${feedback?`<p role="status" class="hint">${esc(feedback)}</p>`:''}</div>
      ${btn(label,'open-handoff',attr('id',id),'outline small')}</div></section>`;
  }

  function conversation(c,messages) {
    const seen = new Set();
    const historical = areaOf(c)==='history';
    const author = '<div class="author"><span class="logo-chip">教</span>教务助手</div>';
    const items = messages.map((message,index)=>{
      if (message.role === 'user') {
        const sources = message.attachments?.length ? `<div class="attachments">${message.attachments.map(item=>attachment(item)).join('')}</div>` : '';
        return `<div class="msg user">${sources}${message.text?`<p class="user-text">${esc(message.text)}</p>`:''}</div>`;
      }
      const task = message.task && S.tasks.get(message.task);
      const run = task ? (seen.has(task.id) ? `<div class="msg-actions">${taskLink(task)}</div>` : runCard(task,!historical)) : '';
      if (task) seen.add(task.id);
      const citationKey='cite:'+c.id+':'+index;
      const cited=(message.cites||[]).map(id=>citation(id,message.citeChunks?.[id],citationKey+':'+id)).join('')+
        fileSources(message.attachmentCites??message.fileSources,citationKey)+seatSource(message.seatReport,citationKey);
      const receipt=handoffReceipt(message.handoff);
      const process=message.processCite||(receipt?'handoff-procedure':'');
      const legacySetupPrompt = message.expectFile === 'prepare' && message.actions?.length === 1 &&
        message.actions[0].act === 'templates' && message.actions[0].label === '设班模板';
      const oldPrompt = oldUploadPrompts[message.expectFile];
      const legacyUploadPrompt = !historical && (legacySetupPrompt || oldPrompt && message.text === oldPrompt);
      const reply = legacyUploadPrompt ? attachmentRequests[message.expectFile] : message;
      const actions = (reply.actions || [])
        .filter(a=>a.act!=='view-classes'&&(a.act!=='nav'||a.id!=='notices'))
        .filter(a=>!['task','pick-intent-task','all-rows'].includes(a.act)||S.tasks.has(a.id))
        .filter(a=>!historical||a.act==='task').map(a=>a.download
        ? assetLink(a.label,a.download)
        : btn(a.label,a.act,attr('id',a.id || ''),a.primary?'primary small':'soft small')).join('');
      const intro = message.fileIntro ? `<p class="copy">${esc(message.fileIntro)}</p>` : '';
      const trace = fileTrace(message.fileTrace,{key:'file:'+c.id+':'+index,elapsed:message.fileTraceMs,intro});
      const replyText = message.task ? reply.text
        ?.replace(/^设班完成。已在教务系统创建 (\d+) 个班级，回读 (\d+ \/ \d+) 项一致。$/,'资料准备完成。已保存 $1 条待设班资料，回读 $2 项一致。')
        .replace(/^已写入 (\d+) 个班级。回读发现 (\d+) 项差异，请打开核对表查看。$/,'已保存 $1 条待设班资料。回读发现 $2 项差异，请打开核对表查看。') : reply.text;
      const copy = replyText ? `<p class="copy">${esc(root.DeskIntent.updateUploadReferences(replyText))}</p>` : '';
      const heading = message.fileAnalysis==='preview'?'资料预览':'分析结果';
      const analysis = message.fileAnalysis ? `<section class="file-analysis" aria-label="${heading}"><h4>${heading}</h4>${copy}</section>` : copy;
      const {previewControl,prompt=''}=historical?{}:attachmentFollowUp(message,c.id);
      return `<article class="msg">${author}
        ${interpretationNote(messages[index-1])}${trace||intro}${analysis}${seatResult(message.seatReport)}${filePreview(message.filePreview,previewControl)}${prompt}${run}
        ${sourceGroup('引用文件',cited)}${sourceGroup('转接依据',process?citation(process,undefined,citationKey+':process'):'')}${receipt}
        ${actions?`<div class="msg-actions">${actions}</div>`:''}</article>`;
    }).join('');
    const job = S.jobs.get(c.id);
    const pendingNote = job ? interpretationNote(messages.at(-1)) : '';
    const progress = job?.trace
      ? `<article class="msg file-processing">${author}${pendingNote}${job.intro?`<p class="copy">${esc(job.intro)}</p>`:''}${fileTrace(job.trace)}</article>`
      : job ? `<div>${pendingNote}<p class="run-busy" role="status"><span class="pulse" aria-hidden="true"></span>${esc(job)}</p></div>` : '';
    return `<div class="messages">${items}${progress}</div>`;
  }

  function renderChat() {
    const c = chat();
    if (!c) return;
    const scroll = $('#chat-scroll'), oldBox = $('#question');
    const adjustment = S.renderedChat === c.id ? scroll?.scrollTop ?? 0 : Infinity;
    const focus = oldBox && document.activeElement === oldBox;
    const sel = focus ? [oldBox.selectionStart,oldBox.selectionEnd] : null;
    const messages=chatMessages(c);
    const empty = !messages.length && !S.jobs.has(c.id);
    $('#view').innerHTML = `<div class="chat-view"><div id="chat-scroll" class="chat-scroll ${empty?'empty-chat':''}"><div class="chat-pad">${empty?welcome():conversation(c,messages)}</div></div>${areaOf(c)==='history'?'':composer()}</div>`;
    S.renderedChat = c.id;
    const nextScroll = $('#chat-scroll');
    nextScroll.scrollTop = adjustment === Infinity ? nextScroll.scrollHeight : adjustment;
    const box = $('#question');
    if (focus && box) {
      box.focus({preventScroll:true});
      box.setSelectionRange(...sel);
    }
  }

  function renderMain() {
    for (const detail of document.querySelectorAll('details[data-run]')) {
      if (detail.open) S.openLogs.add(detail.dataset.run);
      else S.openLogs.delete(detail.dataset.run);
    }
    const view = $('#view'), plannerView = $('#course-planner-view');
    const showPlanner = S.page==='class-release', showSetup = setupPage();
    if ((showPlanner || showSetup) && !view.hidden) {
      view.replaceChildren();
      S.renderedChat = null;
    }
    view.hidden = showPlanner || showSetup;
    plannerView.hidden = !showPlanner;
    view.classList.toggle('conversation',S.page==='chat'&&!showSetup);
    view.classList.toggle('embedded-prototype',S.page==='fulltime');
    layout();
    if (showSetup) {
      root.DeskTaskView.renderSetup();
    } else if (S.page === 'chat') {
      renderChat();
    } else if (S.page === 'fulltime') {
      root.DeskFulltime.render(view);
    } else if (showPlanner) {
      root.DeskPrototypes.render(plannerView);
    }
  }

  function table(head,rows,cls='') {
    return `<div class="table-wrap ${cls}"><table><thead><tr>${head.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')}</tr></thead><tbody>${rows.join('')||'<tr><td colspan="'+head.length+'">暂无记录</td></tr>'}</tbody></table></div>`;
  }
  const tr = cells => '<tr>' + cells.map(cell=>'<td>'+cell+'</td>').join('') + '</tr>';
  function download(name,type,contents) {
    const url = URL.createObjectURL(new Blob([contents],{type}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1200);
  }
  function csv(rows) {
    const cell = value=>{
      let text = String(value ?? '');
      if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"','""') + '"';
    };
    return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
  }
  root.DeskUI = {
    esc,$,icon,btn,attr,badge,status,time,list,chat,areas,plannedModules,areaOf,chatsFor,setupPage,activeSetup,chatMessages,systemForTask,files,file:selectFiles,asset,assetLink,sampleWorkbook,attachmentRequests,
    toast,panel,close,workspaceVisibility,workspaceContent,toggleSessionMenu,closeSessionMenu,
    renderMain,table,tr,download,csv,taskName,recordOptions
  };
})(window);
