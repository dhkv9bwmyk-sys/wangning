(function(root){
  'use strict';
  const S=root.DeskState,U=root.DeskUI,D=root.PrepDesk,R=root.DeskRecords,N=root.DeskKnowledge;
  const {esc,attr,btn,badge,time,panel,toast}=U;
  const schoolStaff=Object.freeze({'ORG-A':'林老师'});
  const handoffUpdates=typeof root.BroadcastChannel==='function'?new root.BroadcastChannel('academic-desk-handoffs'):null;
  function knowledgeEnv(){
    return {docs:S.docs,schoolId:S.data.school.id,role:N.role};
  }
  function answerKnowledge(input,intent){
    const env=knowledgeEnv();
    const page=[...S.docs.values()].find(d=>d.page&&input.query.includes(d.page)&&N.visible(d,env))?.page||'';
    return N.inspect(input,intent,{...env,page});
  }
  function handoffRecipient(){
    const school=S.data.school;
    const teacher=schoolStaff[school.id];
    return teacher?{schoolId:school.id,schoolName:school.name,teacher}:null;
  }
  const dingTalkSent=ticket=>ticket.notification?.channel==='dingtalk'&&ticket.notification.status==='sent';
  function handoffText(ticket){
    const lines=[
      '工单编号 '+ticket.id,
      '问题原文 '+ticket.question,
      ticket.interpretation?'确认后的问题 '+ticket.interpretation:'',
      '转接原因 '+(ticket.reason==='知识中心暂无适用答案'?'暂无适用依据':ticket.reason),
      ticket.sources.length?'附件线索 '+ticket.sources.join('、'):''
    ];
    return lines.filter(Boolean).join('\n');
  }
  function dingTalkNotice(ticket){
    return {channel:'dingtalk',status:'sent',sentAt:D.clock(),title:'教务问题待处理',text:handoffText(ticket)};
  }
  function publishHandoff(ticket){
    S.handoffs.set(ticket.id,ticket);
    if(!R.temporary)handoffUpdates?.postMessage(ticket.id);
  }
  handoffUpdates?.addEventListener('message',async event=>{
    if(!S.data||R.temporary||typeof event.data!=='string')return;
    const tickets=await R.all('handoffs').catch(()=>[]);
    const ticket=tickets.find(item=>item.id===event.data&&item.schoolId===handoffRecipient()?.schoolId);
    if(!ticket)return;
    const previous=S.handoffs.get(ticket.id);
    if(previous?.reply&&!ticket.reply||previous?.readAt&&!ticket.readAt)return;
    S.handoffs.set(ticket.id,ticket);
    if(S.page==='chat'&&S.chatId===ticket.chatId)U.renderMain();
    if(S.page==='chat'&&S.chatId===ticket.chatId&&ticket.status!==previous?.status&&ticket.readAt){
      toast(ticket.teacher+(ticket.reply?'已回复，请查阅消息。':'已查看你的问题。'));
    }
  });
  function handoffForSchool(id){
    const ticket=S.handoffs.get(id);
    if(!ticket||ticket.schoolId!==handoffRecipient()?.schoolId)throw Error('当前账号无法查看这项工单。');
    return ticket;
  }
  function noticeBody(ticket){
    if(dingTalkSent(ticket)){
      const note=ticket.notification;
      return `<p class="meta">钉钉已通知 · ${esc(time(note.sentAt))}</p>
        <h3 class="subtitle">${esc(note.title)}</h3><p class="copy">${esc(note.text.replace(/^转接原因 知识中心暂无适用答案$/m,'转接原因 暂无适用依据'))}</p>`;
    }
    return `<h3 class="subtitle">工单内容</h3><p class="copy">${esc(handoffText(ticket))}</p>`;
  }
  function replyBody(ticket){
    return ticket.reply?`<h3 class="subtitle">${esc(ticket.teacher)}的回复</h3>
      <p class="copy">${esc(ticket.reply.text)}</p><p class="meta">${esc(time(ticket.reply.sentAt))}</p>`:'';
  }
  function openHandoff(id){
    const ticket=handoffForSchool(id);
    const process=dingTalkSent(ticket)&&!ticket.reply?btn('教务处理','teacher-handoff',attr('id',id),'soft'):'';
    panel('handoff',ticket.reply?'教务回复':dingTalkSent(ticket)?'钉钉通知':'人工工单',ticket.id+' · '+time(ticket.created),
      `<div class="line-title"><strong>${esc(ticket.schoolName+' · 教务'+ticket.teacher)}</strong>${badge(ticket.status,'warm')}</div>
      ${ticket.readAt?`<p class="meta">${esc(ticket.teacher+'已查看 · '+time(ticket.readAt))}</p>`:''}
      ${replyBody(ticket)}${noticeBody(ticket)}`,
      btn('关闭','close','','outline')+process,{key:id,narrow:true});
  }
  function teacherPanel(ticket){
    const form=ticket.reply?'':`<form id="handoff-reply-form" ${attr('id',ticket.id)} class="subtitle">
      <label class="field"><span>回复内容</span><textarea name="reply" rows="4" maxlength="1500" required></textarea></label></form>`;
    const send=form?'<button form="handoff-reply-form" type="submit" class="btn primary">发送回复</button>':'';
    panel('teacher-handoff','教务处理',ticket.id,
      `<div class="line-title"><strong>${esc(ticket.schoolName+' · 教务'+ticket.teacher)}</strong>${badge(ticket.status,'warm')}</div>
      ${noticeBody(ticket)}${replyBody(ticket)}${form}`,
      btn('返回原对话','handoff-chat',attr('id',ticket.id),'outline')+send,{key:ticket.id,narrow:true});
  }
  function updateTeacherHandoff(id,reply){
    const recipient=handoffRecipient();
    return R.editHandoff(id,ticket=>{
      if(ticket.schoolId!==recipient?.schoolId||!dingTalkSent(ticket))throw Error('当前工单暂无可处理的钉钉通知。');
      if(ticket.reply||!reply&&ticket.readAt)return ticket;
      const now=D.clock();
      return {...ticket,readAt:ticket.readAt||now,status:reply?'已回复':'已查看',
        ...(reply?{reply:{text:reply,sentAt:now}}:{})};
    });
  }
  async function openTeacherHandoff(id){
    handoffForSchool(id);
    const ticket=await updateTeacherHandoff(id);
    publishHandoff(ticket);
    U.renderMain();
    teacherPanel(ticket);
  }
  async function replyToHandoff(form){
    const text=form.elements.reply.value.trim();
    if(!text||text.length>1500)throw Error('请输入 1 至 1500 字的回复内容。');
    const id=form.dataset.id;
    handoffForSchool(id);
    const ticket=await updateTeacherHandoff(id,text);
    publishHandoff(ticket);
    U.renderMain();
    teacherPanel(ticket);
  }
  root.DeskServices={answerKnowledge,
    handoffRecipient,dingTalkSent,dingTalkNotice,publishHandoff,openHandoff,openTeacherHandoff,replyToHandoff};
})(window);
