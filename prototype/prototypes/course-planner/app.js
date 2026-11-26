import { createContext, clone, freshPlan, signature, evaluatePlan, attemptIntent, analyzeOptions, focusMatches, teacherLoad, checkpointFor,hasMerges,mergePairs,resolveMergedId } from './domain.js';
import { Workspace } from './workspace.js';
import {analyzeCurrentPlan} from './planner.js';
import {recommendAdjustments} from './recommendations.js';
import {teachingOverview,teacherStatsDetail} from './stats-ui.js';
import {reviewChanges,reviewSidebar,reviewComparison,reviewClass,reviewStudent,reviewIssues,reviewJoint,reviewCandidate,reviewHistory,reviewArchive,reviewLesson} from './review-ui.js';
import {buildConflictView,captureClassFacts} from './conflict-view.js';

const app = document.querySelector('#app'), overlays = document.querySelector('#overlay-root');
const ui = { filters: { query: '', track: 'ALL', grade: 'ALL' }, draftFilters:{query:'',track:'ALL',grade:'ALL'},checkDays:30,draftCheckDays:30,subjectStatsExpanded:false,readAt:null,reading:false,queryError:'',day: 'Saturday', drawer: null,
  modal: null, analysis: null, busy: false, dragId: null, dragLessonId:null, dragCache: new Map(), requestId: null,location:null,jointDraft:[],jointPreview:null,archives:null,archiveError:null,recommendRequest:null };
let ctx, workspace, data, worker, toastTimer, lastFocus;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const unique = rows => [...new Set(rows)];
const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
const button = (action, label, { id = '', kind = '', disabled = false, extra = '' } = {}) => `<button type="button" data-action="${action}" ${id ? `data-id="${esc(id)}"` : ''} class="${kind}" ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`;
const dayName = day => day === 'Sunday' ? '周日' : '周六';
const clock = value => new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value));
const dateText = value => new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value)).replaceAll('/', '.');
const logTime = value => Number.isNaN(Date.parse(value)) ? '时间未记录' : new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai',year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit',second:'2-digit', hour12:false }).format(new Date(value)).replaceAll('/','.');
const windowText = slot => { const t = ctx.data.time_window_templates.find(row => row.slot_id === slot); return `${t.start}—${t.end}`; };
const period = () => `${ctx.data.weeks[0].slots[0].start.slice(0,10).replaceAll('-','.')}—${ctx.data.weeks.at(-1).slots[0].start.slice(0,10).replaceAll('-','.')}`;
const clsName = id => ctx.classes[id]?.label ?? id;
const statusText = report => report.status === 'CONDITIONAL' ? '待协调' : report.ok ? '核查通过' : report.status === 'INVALID' ? '待核对' : report.issues.some(row => row.type === 'CAPACITY') ? '容量超限' : report.issues[0]?.title ?? '待核查';
const statusKind = report => report.status === 'CONDITIONAL' ? 'amber' : report.ok ? 'green' : 'red';

function reviewEnv(){return {ctx,workspace,ui};}

function toast(message, error = false) {
  const node = document.querySelector('#toast'); clearTimeout(toastTimer);
  node.textContent = message; node.className = `toast visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => node.classList.remove('visible'), error ? 5200 : 3400);
}

function filterMarkup() {
  const options = (rows, selected) => rows.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const f=ui.draftFilters;
  return `<form id="query-form" class="filters" aria-label="课表筛选">
    <div class="filter-group"><label for="campus">校区</label><select id="campus" class="wide"><option>中心校区</option></select></div>
    <div class="filter-group"><label for="term">学期</label><select id="term" class="wide"><option>2026秋季</option></select></div>
    <div class="filter-group"><label for="filter-grade">年级</label><select id="filter-grade">${options([['ALL','全部'],...unique(ctx.data.classes.map(c=>c.grade)).map(g=>[g,g])],f.grade)}</select></div>
    <div class="filter-group"><label for="filter-track">班型</label><select id="filter-track">${options([['ALL','全部'],...ctx.data.class_types.map(t=>[t.code,t.label])],f.track)}</select></div>
    <div class="filter-group"><span class="sr-only">授课周期</span><div class="period-button" aria-label="授课周期">${period()}</div></div>
    <div class="search"><label for="filter-query" class="sr-only">搜索班级、教师或套班</label><input id="filter-query" type="search" autocomplete="off" value="${esc(f.query)}" placeholder="搜索班级、教师或套班">${f.query ? button('clear-search','×',{extra:'aria-label="清除搜索"'}) : ''}</div>
    <button class="primary query-button" type="submit" ${ui.reading?'disabled':''}>${ui.reading?'查询中':'查询'}</button>
    <div class="node-filter" role="group" aria-label="核查节点"><span>核查节点</span>${[30,15,7,3].map(days=>button('check-node',`开班前${days}天`,{id:String(days),extra:`aria-pressed="${ui.draftCheckDays===days}"`,kind:ui.draftCheckDays===days?'selected':''})).join('')}</div>
  </form>`;
}

function checkSummaryMarkup(){
  const cls=ctx.sourceView.byId[ctx.scope.merge.source];
  return `<div class="check-summary" data-testid="check-summary"><span>开班前${ui.checkDays}天核查</span><span>计划开班 ${cls.planned_start_date.replaceAll('-','.')}</span><span>核查日期 ${checkpointFor(cls,ui.checkDays).replaceAll('-','.')}</span><span>模拟数据截止 ${data.source_snapshot_at?logTime(data.source_snapshot_at):'未提供'}</span><span>本次读取 ${ui.readAt?logTime(ui.readAt):'—'}</span>${ui.queryError?`<strong class="query-error" role="alert">${esc(ui.queryError)}</strong>`:''}</div>`;
}

async function queryTimetable(){
  if(ui.reading)return;
  const filters=clone(ui.draftFilters),days=ui.draftCheckDays;
  ui.reading=true;ui.queryError='';render({preserveFocus:true});
  try{
    const response=await fetch(new URL('./demo-data.json',import.meta.url),{cache:'no-store'});
    if(!response.ok)throw new Error('课表数据读取失败，请重试');
    const next=await response.json();createContext(next,ctx.fixtureId);
    if(JSON.stringify(next)!==JSON.stringify(data))throw new Error('源版本已变化，请保存当前草案后重新载入');
    ui.filters=filters;ui.checkDays=days;ui.readAt=new Date().toISOString();
  }catch(error){ui.queryError=error.message;}
  finally{ui.reading=false;render({preserveFocus:true});if(!ui.queryError)toast(`查询完成 · ${lowEnrollmentClasses().length}个班级报名不足`);}
}

function lowEnrollmentClasses(){return ctx.sourceView.classes.filter(c=>c.class_lifecycle!=='EXISTING'&&c.count<(ctx.data.checkpoints?.threshold??6)).sort((a,b)=>a.planned_start_date.localeCompare(b.planned_start_date)||a.count-b.count||a.class_code.localeCompare(b.class_code));}
function comparableClasses(source){return ctx.sourceView.classes.filter(c=>c.id!==source.id&&['subject','grade','track','curriculum','progress_start'].every(k=>c[k]===source[k]));}
function locationMarkup(){if(!ui.location)return '';const c=workspace.report.view.byId[ui.location.primaryId],others=ui.location.comparisonIds.map(clsName);return `<div class="location-banner" role="status" data-testid="location-banner"><span><strong>已定位：${esc(c.label)}</strong>${others.length?`<small>同科对比：${others.map(esc).join('、')}</small>`:''}</span>${button('details','查看班级',{id:c.id,kind:'quiet'})}${button('clear-location','取消定位',{kind:'quiet'})}</div>`;}
function locateClass(id,comparisonIds=[]){
  const view=workspace.report.view,actualId=view.byId[id]?id:hasMerges(workspace.plan)?resolveMergedId(ctx,workspace.plan,id):null;
  if(!actualId)return toast('该课程已不在当前试排中，请查看保存方案',true);
  const cls=view.byId[actualId];ui.day=cls.lessons[0].weekday;ui.drawer=null;ui.modal=null;
  ui.location={primaryId:actualId,comparisonIds:unique(comparisonIds.filter(other=>other!==actualId&&view.byId[other]))};clearDrag();render();
  requestAnimationFrame(()=>{const node=app.querySelector(`.class-card[data-class-id="${actualId}"][draggable="true"]`);node?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center',inline:'center'});node?.focus({preventScroll:true});});
  toast(`已定位${cls.label} · ${dayName(ui.day)}时点${cls.normal_slot} · ${cls.roomName}`);
}

function visibleClasses(report) { return report.view.classes.filter(cls => cls.lessons.some(lesson => lesson.weekday === ui.day)); }
function focusActive() { return !!ui.filters.query.trim() || ui.filters.track !== 'ALL' || ui.filters.grade !== 'ALL'; }

function cardMarkup(cls,report,matches,{reference=false,lesson=null}={}){
  const single=!!lesson,matched=matches.get(cls.id)??false,focus=focusActive(),roomId=lesson?.room_id??cls.room_id,roomName=ctx.rooms[roomId].display_name;
  const isConflict=!reference&&report.issues.some(i=>i.classIds?.includes(cls.id)&&(!single||!i.overlaps?.length||i.overlaps.some(o=>o.lessonIds.includes(lesson.id))));
  const conditional=!isConflict&&report.conditions?.some(c=>c.classId===cls.id||c.teacherId===cls.teacher_id);
  const located=!reference&&!single&&ui.location?.primaryId===cls.id,comparison=!reference&&!single&&ui.location?.comparisonIds.includes(cls.id);
  const styles=['class-card',focus&&matched?'focused':'',focus&&!matched?'dimmed':'',isConflict?'conflict':'',conditional?'conditional':'',reference?'reference':'',single?'exception':'',located?'located-primary':'',comparison?'located-comparison':''].filter(Boolean).join(' ');
  const proposed=mergePairs(ctx,workspace.plan).some(p=>resolveMergedId(ctx,workspace.plan,p.target)===cls.id)||cls.count!==ctx.sourceRosters[cls.id]?.length;
  let title=`${esc(cls.label)} <span class="card-count">· ${proposed?'拟':''}${cls.count}/${cls.capacity}人</span>`,room=`${esc(cls.teacherName)}老师 · ${esc(roomName)}${cls.protected?(report.conditions.some(c=>c.classId===cls.id)?' · 老班待协调':' · 老班'):''}`;
  let packages=cls.packageIds.length?`套班：${proposed&&hasMerges(workspace.plan)?'拟 ':''}${cls.packageIds.join(' / ')}`:'套班：独立班';
  const roomExceptions=cls.packageIds.filter(id=>ctx.data.packages.find(p=>p.id===id)?.default_room_id!==roomId);if(roomExceptions.length)room+=` · ${roomExceptions.join('/')}教室例外`;
  if(cls.transferredIn?.length){room+=' · 分科转入';const origins=unique(cls.transferredIn.flatMap(id=>ctx.data.student_original_package_membership[id]??[]));packages=`${cls.packageIds.length?`套班：${cls.packageIds.join(' / ')}`:'独立班'} · ${origins.join('/')}${origins.length?'分科':''}转入${cls.transferredIn.length}人`;}
  if(reference){title=`${esc(cls.label)} · 拟并入${esc(clsName(resolveMergedId(ctx,workspace.plan,cls.id)))}`;room=`${esc(cls.teacherName)}老师 · ${esc(roomName)} · 原${cls.count}人`;packages=`${cls.packageIds.join(' / ')} · 原排课`;}
  const occurrence=single?`<div class="card-occurrence"><strong>${dateText(lesson.start).slice(5)} · 1次</strong><span>${clock(lesson.start)}—${clock(lesson.end)}</span></div>`:'';
  const exceptions=cls.lessons.filter(l=>l.slot_id!==cls.normal_slot||(l.room_id??cls.room_id)!==cls.room_id);
  const scope=!single&&!reference&&exceptions.length?`<div class="card-series-scope">${cls.lessons.length-exceptions.length}次常规 · ${exceptions.length}次另排</div>`:'';
  const draggable=!reference&&(!single||ctx.scope.single_lesson_moves);
  return `<article class="${styles}" tabindex="0" role="button" aria-label="${esc(cls.label)} ${single?`${dateText(lesson.start)} 单次课`:'整班'} ${cls.grade} ${cls.track}级 ${cls.teacherName} ${roomName}" data-class-id="${cls.id}" data-reference="${reference?'source':single?'exception':''}" data-card-kind="${reference?'reference':single?'lesson':'series'}" ${single?`data-lesson-id="${lesson.id}"`:''} data-match="${matched}" ${draggable?'draggable="true"':''}><span class="merge-drop-label">合入${esc(cls.label)}</span><div class="card-title">${title}</div>${occurrence}<div class="card-meta">${esc(cls.class_code)} · ${esc(cls.grade)} · ${esc(cls.track)}级</div><div class="card-room">${room}</div><div class="card-packages">${esc(packages)}</div>${scope}${located?'<span class="card-location">已定位</span>':comparison?'<span class="card-location compare">同科对比</span>':''}</article>`;
}

function tableMarkup(report, matches) {
  const actual = visibleClasses(report);
  const rooms = [...ctx.data.rooms].sort((a,b)=>a.display_order-b.display_order);
  const headers = ctx.data.time_window_templates.map(t=>`<div class="slot-header"><strong>时点 ${t.slot_id}</strong><small>${t.start}—${t.end}</small></div>`).join('');
  const rows = rooms.map(room=>`<div class="room-header"><strong>${esc(room.display_name)}</strong><small>${room.capacity}座</small></div>${ctx.data.time_window_templates.map(t=>{
    let cards = actual.filter(cls=>cls.room_id===room.id&&cls.normal_slot===t.slot_id&&cls.lessons.some(l=>l.slot_id===t.slot_id&&(l.room_id??cls.room_id)===room.id)).map(cls=>cardMarkup(cls,report,matches)).join('');
    if (hasMerges(workspace.plan) && ui.day==='Saturday') for(const pair of mergePairs(ctx,workspace.plan)){
      const original=ctx.sourceView.byId[pair.source];
      if(original.room_id===room.id&&original.normal_slot===t.slot_id&&!cards)cards=cardMarkup(original,report,matches,{reference:true});
    }
    for(const cls of actual)for(const lesson of cls.lessons.filter(l=>l.weekday===ui.day&&l.slot_id===t.slot_id&&(l.room_id??cls.room_id)===room.id&&(l.slot_id!==cls.normal_slot||(l.room_id??cls.room_id)!==cls.room_id)))cards+=cardMarkup(cls,report,matches,{lesson});
    return `<div class="time-cell" data-drop-slot="${t.slot_id}" data-drop-room="${room.id}" aria-label="${room.display_name} 时点${t.slot_id}">${cards}</div>`;
  }).join('')}`).join('');
  return `<section class="timetable" aria-label="中心校区课表"><div class="table-title"><div class="day-controls"><label for="filter-day">授课日</label><select id="filter-day" aria-label="授课日"><option value="Saturday" ${ui.day==='Saturday'?'selected':''}>周六</option><option value="Sunday" ${ui.day==='Sunday'?'selected':''}>周日</option></select><span>· 12周</span></div></div><div class="table-scroll"><div class="schedule-grid"><div class="grid-corner">教室<small>（座位数）</small></div>${headers}${rows}</div></div>${!actual.length?'<div class="empty-day">暂无排课</div>':''}</section>`;
}

function summaryMarkup(report) {return teachingOverview(ctx,report.view,{dirty:workspace.hasEdits,expanded:ui.subjectStatsExpanded});}

function statusCard(title, lines, kind='') { return `<div class="status-card ${kind}"><strong>${esc(title)}</strong>${lines.map(line=>`<p>${line}</p>`).join('')}</div>`; }
function section(title, lines) { return `<section class="side-section"><h3>${esc(title)}</h3>${lines.map(line=>`<p>${line}</p>`).join('')}</section>`; }
function changesMarkup(report){return reviewChanges(reviewEnv(),report);}

function sidebarMarkup(report) {
  const low=lowEnrollmentClasses(),threshold=ctx.data.checkpoints?.threshold??6;
  if(!workspace.hasEdits){const a=low.find(c=>c.id===ui.location?.primaryId)??low[0],comparisons=a?comparableClasses(a):[];return `<aside class="side-panel"><h2>报名不足待处理${low.length?` · ${low.length}班`:''}</h2>${low.length?low.map(c=>`<div class="low-entry-wrap"><button type="button" class="status-card check-entry" data-action="locate-check" data-id="${c.id}" aria-label="定位报名不足班级${esc(c.label)}"><strong>${esc(c.label)} · ${esc(c.class_code)}</strong><span class="check-numbers"><b>${c.count}</b>人 / 核查线${threshold}人</span><span>${esc(c.teacherName)} · ${esc(c.roomName)} · 时点${c.normal_slot}</span><span class="check-entry-action">定位${esc(c.label)}</span></button>${button('suggest-merge','合班建议',{id:c.id,kind:'low-entry-suggest'})}</div>`).join(''):statusCard('没有报名不足班级',['当前班级均达到核查线'],'green')}${comparisons.length?`<h3 class="comparison-heading">同科班级 · ${esc(a.label)}</h3>${comparisons.map(b=>`<div class="check-comparison"><strong>${esc(b.label)} · ${esc(b.class_code)}</strong><p>${esc(b.teacherName)} · ${esc(b.roomName)} · 时点${b.normal_slot}</p><p>${b.count} / ${b.capacity}人 · ${b.packageIds.map(esc).join(' / ')}</p>${button('locate-class',`定位${esc(b.label)}`,{id:b.id,kind:'quiet'})}</div>`).join('')}`:a?`<div class="check-comparison"><strong>${esc(a.label)} · 暂无兼容接收班</strong><p>当前没有同年级、同班型且课程进度一致的接收班。</p></div>`:''}${section('课程周期',[period(),'共12次课 · 每次120分钟'])}</aside>`;}
  return reviewSidebar(reviewEnv(),report);
}

function render({ preserveFocus = false } = {}) {
  const focused=preserveFocus?document.activeElement:null, selection=focused?.id==='filter-query'?[focused.selectionStart,focused.selectionEnd]:null;
  const report=workspace.report;if(!report.view)throw new Error('试排状态无法读取');
  const matches=focusMatches(report.view,ui.filters),actual=visibleClasses(report),matched=actual.filter(c=>matches.get(c.id)).length;
  const low=lowEnrollmentClasses();
  const checkBadge=low.length?button('locate-check',`报名不足 ${low.length}班`,{id:low[0].id,kind:'badge amber',extra:'aria-label="定位报名不足班级"'}):badge('无报名不足班级','green');
  const badges=badge(!workspace.hasEdits?'起始课表':workspace.isSaved?'已保存':'未保存')+(!workspace.hasEdits?checkBadge:badge(statusText(report),statusKind(report)))+(report.conditions.length&&report.status!=='CONDITIONAL'?badge('老班待协调','amber'):'')+(workspace.hasEdits?badge('未执行'):'');
  app.innerHTML=`${filterMarkup()}${checkSummaryMarkup()}<section class="toolbar" aria-label="试排操作"><h1>中心校区课表</h1><span class="scope-count">${workspace.hasEdits?'拟':''}${actual.length}个班级 · ${ctx.data.rooms.length}间教室 · ${ctx.data.teachers.length}位教师 · ${ctx.data.packages.length}套班 · ${unique(report.view.classes.flatMap(c=>c.students)).length}名学生</span><div class="toolbar-badges">${badges}${focusActive()?`<span class="match-count" data-testid="match-count">匹配 ${matched} / ${actual.length} 班</span>`:''}</div><div class="toolbar-actions">${button('joint','联合调整')}${button('history','操作记录')}${button('undo','撤销',{disabled:!workspace.undoStack.length})}${button('save','保存方案',{kind:'primary',disabled:!workspace.hasEdits||workspace.isSaved})}</div></section>${summaryMarkup(report)}${locationMarkup()}<div class="workspace-layout"><div class="workspace-main">${tableMarkup(report,matches)}</div>${sidebarMarkup(report)}</div>`;
  app.setAttribute('aria-busy','false');
  if(preserveFocus&&focused?.id){const next=document.getElementById(focused.id);next?.focus({preventScroll:true});if(selection&&next?.setSelectionRange)try{next.setSelectionRange(...selection);}catch{}}
  renderOverlay();
}

function renderComparison(){return reviewComparison(reviewEnv());}

function issueDescription(issue, report) {
  if(issue.type==='CAPACITY')return `拟${issue.count}人 / 班级容量${issue.classCapacity}人 / 教室${issue.roomCapacity}座，超出${issue.overBy}人`;
  if(issue.type==='STUDENT_CONFLICT')return `${issue.studentIds.join('、')} · ${issue.classIds.map(clsName).join(' / ')} · ${unique(issue.overlaps.map(row=>row.date)).length}次课`;
  if(issue.type==='TEACHER_CONFLICT')return `${ctx.teachers[issue.teacherId].display_name} · ${issue.classIds.map(clsName).join(' / ')}`;
  if(issue.type==='TEACHER_BUSY')return `${ctx.teachers[issue.teacherId].display_name}已有其他授课占用`;
  if(issue.type==='ROOM_CONFLICT')return `${ctx.rooms[issue.roomId].display_name} · ${issue.classIds.map(clsName).join(' / ')}`;
  return issue.title;
}

function drawerShell(title, subtitle, content, footer=button('close','返回课表'),extraClass='') {
  return `<div class="drawer-backdrop" data-close-backdrop></div><section class="drawer ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-header"><div class="drawer-heading"><h2 id="drawer-title">${esc(title)}</h2>${button('close','×',{kind:'icon-button',extra:'aria-label="关闭详情"'})}</div>${subtitle?`<p class="drawer-subtitle">${subtitle}</p>`:''}</header><div class="drawer-body">${content}</div><footer class="drawer-footer">${footer}</footer></section>`;
}

function classDetails(){return reviewClass(reviewEnv());}

function studentDetails(){return reviewStudent(reviewEnv());}

function issuesDetails(){return reviewIssues(reviewEnv());}

function historyDetails(){return reviewHistory(reviewEnv());}

function saveModal() {
  const report=workspace.report;
  const defaultName=workspace.report.conditions.length?'老班协调':Object.keys(workspace.plan.routes).length?'分科调整':hasMerges(workspace.plan)?'合班草案':'课表调整';
  return `<div class="overlay-backdrop" data-close-backdrop><section class="modal small" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">保存方案</h2>${button('close','×',{kind:'icon-button',extra:'aria-label="关闭保存"'})}</div><form id="save-form"><label class="field-label" for="plan-name">方案名称</label><input id="plan-name" name="name" class="text-field" value="${defaultName}${String(workspace.saved.length+1).padStart(2,'0')}" maxlength="40" required autocomplete="off"><div class="save-meta">${badge(statusText(report),statusKind(report))}${report.conditions.length&&report.status!=='CONDITIONAL'?badge('老班待协调','amber'):''}${badge('未执行')}</div><p class="save-note">保存在当前浏览器</p><div id="save-error" class="form-error" aria-live="polite"></div><div class="modal-actions">${button('close','取消')}<button type="submit" class="primary">保存方案</button></div></form></section></div>`;
}

function renderOverlay() {
  app.inert=!!(ui.modal||ui.drawer);
  document.body.classList.toggle('modal-open',!!(ui.modal||ui.drawer));
  if(ui.modal?.type==='compare')overlays.innerHTML=renderComparison();
  else if(ui.modal?.type==='save')overlays.innerHTML=saveModal();
  else if(ui.modal?.type==='candidate')overlays.innerHTML=reviewCandidate(reviewEnv());
  else if(ui.drawer?.type==='teaching-stats')overlays.innerHTML=drawerShell('教师带班与课头明细','本校区 · 当前课程周期 · 全部授课日',teacherStatsDetail(ctx,workspace.report.view,ui.drawer.subject),button('close','返回课表'),'stats-drawer');
  else if(ui.drawer?.type==='joint')overlays.innerHTML=reviewJoint(reviewEnv());
  else if(ui.drawer?.type==='archive')overlays.innerHTML=reviewArchive(reviewEnv());
  else if(ui.drawer?.type==='class')overlays.innerHTML=classDetails();
  else if(ui.drawer?.type==='lesson')overlays.innerHTML=reviewLesson(reviewEnv());
  else if(ui.drawer?.type==='student')overlays.innerHTML=studentDetails();
  else if(ui.drawer?.type==='issues')overlays.innerHTML=issuesDetails();
  else if(ui.drawer?.type==='history')overlays.innerHTML=historyDetails();
  else overlays.innerHTML='';
  if(ui.modal||ui.drawer)requestAnimationFrame(()=>{const first=overlays.querySelector('input, button:not(:disabled), select');first?.focus({preventScroll:true});});
}

function closeOverlay() {
  if(ui.busy){worker?.terminate();worker=null;ui.busy=false;ui.requestId=null;}
  ui.modal=null;ui.drawer=null;render();
  const fallback=lastFocus?.dataset?.action?app.querySelector(`[data-action="${lastFocus.dataset.action}"]`):null;
  (lastFocus?.isConnected?lastFocus:fallback)?.focus({preventScroll:true});
}

function openDrawer(value) { lastFocus=document.activeElement;ui.modal=null;ui.drawer=value;renderOverlay(); }

function runAnalysis(recommendRequest=null) {
  if(!recommendRequest&&!workspace.hasEdits)return toast('请先提出需要分析的调整',true);
  worker?.terminate();lastFocus=document.activeElement;
  const revision=workspace.revision,requestId=crypto.randomUUID();
  ui.recommendRequest=recommendRequest?clone(recommendRequest):null;ui.drawer=null;ui.modal={type:'compare'};ui.analysis=null;ui.busy=true;ui.requestId=requestId;render();
  const complete=(result,error)=>{
    if(ui.requestId!==requestId)return;
    worker?.terminate();worker=null;ui.busy=false;
    if(workspace.revision!==revision){ui.modal=null;ui.analysis=null;render();return toast('试排已变化，请重新分析');}
    if(error){ui.modal.error=error;ui.analysis=null;}else{ui.analysis=result;}
    render();
  };
  try{worker=new Worker(new URL('./solver.worker.js',import.meta.url),{type:'module'});worker.onmessage=event=>complete(event.data.result,event.data.error);worker.onerror=()=>{worker?.terminate();worker=null;setTimeout(()=>{if(ui.requestId!==requestId)return;try{complete(recommendRequest?recommendAdjustments(ctx,clone(workspace.plan),recommendRequest):analyzeCurrentPlan(ctx,clone(workspace.plan)));}catch(error){complete(null,error.message);}},0);};worker.postMessage({data,fixtureId:ctx.fixtureId,requestId,plan:clone(workspace.plan),recommendationRequest:recommendRequest});}
  catch{setTimeout(()=>{if(ui.requestId!==requestId)return;try{complete(recommendRequest?recommendAdjustments(ctx,clone(workspace.plan),recommendRequest):analyzeCurrentPlan(ctx,clone(workspace.plan)));}catch(error){complete(null,error.message);}},0);}
}

function invalidateAnalysis() { ui.recommendRequest=null;worker?.terminate();worker=null;ui.requestId=null;ui.busy=false;ui.analysis=null;ui.modal=null;ui.location=null; }

function handleIntent(intent) {
  const result=workspace.attempt(intent);
  if(result.noop){toast('安排未变化');return;}
  if(result.accepted){invalidateAnalysis();ui.drawer=null;render();toast(result.report.status==='CONDITIONAL'?'已加入试排 · 老班调整待协调':result.report.ok?'试排已更新':result.delta?.introduced.length===0?`本次已加入试排 · 原有${result.report.issues.length}项冲突仍未解决`:`已加入试排 · ${result.report.issues[0].title}`);}
  else{ui.modal=null;ui.drawer={type:'issues',attempt:result};render();toast(result.report.issues[0]?.title??'本次调整未接收',true);}
  if(workspace.storageWarning)toast(workspace.storageWarning,true);
}

function handleAction(event) {
  const control=event.target.closest('[data-action]');
  if(!control){if(event.target.matches('[data-close-backdrop]'))closeOverlay();return;}
  if(control.disabled)return;
  const action=control.dataset.action,id=control.dataset.id;
  if(action==='toggle-subject-stats'){ui.subjectStatsExpanded=!ui.subjectStatsExpanded;render();document.querySelector('[data-action=toggle-subject-stats]')?.focus({preventScroll:true});return;}
  if(action==='teacher-stats'){openDrawer({type:'teaching-stats',subject:id||'ALL'});return;}
  if(action==='close'){closeOverlay();return;}
  if(action==='clear-search'){ui.draftFilters.query='';render();document.querySelector('#filter-query')?.focus();return;}
  if(action==='check-node'){ui.draftCheckDays=Number(id);render();document.querySelector(`[data-action="check-node"][data-id="${id}"]`)?.focus();return;}
  if(action==='locate-check'){const cls=ctx.sourceView.byId[id];if(cls)locateClass(id,comparableClasses(cls).map(c=>c.id));return;}
  if(action==='locate-class'){locateClass(id);return;}
  if(action==='clear-location'){ui.location=null;render();return;}
  if(action==='suggest-merge'){runAnalysis({kind:'merge',classId:id});return;}
  if(action==='suggest-class'){runAnalysis({kind:'class',classId:id});return;}
  if(action==='suggest-lesson'){const [classId,lessonId]=id.split('|'),cls=workspace.report.view.byId[classId],lesson=cls?.lessons.find(l=>l.id===lessonId);if(lesson)runAnalysis({kind:'lesson',origin:'lesson',intent:{kind:'lesson',classId,lessonId,slot:lesson.slot_id,roomId:lesson.room_id??cls.room_id}});return;}
  if(action==='suggest-attempt'){const attempt=ui.drawer?.attempt;if(!attempt){runAnalysis({kind:'current'});return;}if(attempt?.intent){if(attempt.intent.kind==='joint')runAnalysis({kind:'joint',moves:clone(attempt.intent.moves)});else if(attempt.intent.kind==='merge')runAnalysis({kind:'merge',classId:attempt.intent.classId});else runAnalysis({kind:attempt.intent.kind,intent:clone(attempt.intent)});}return;}
  if(action==='back-joint'){worker?.terminate();worker=null;ui.requestId=null;ui.busy=false;ui.jointDraft=clone(ui.recommendRequest?.moves??[]);ui.jointPreview=null;ui.modal=null;ui.drawer={type:'joint'};renderOverlay();return;}
  if(action==='suggest-joint'){runAnalysis({kind:'joint',moves:readJointForm()});return;}
  if(action==='suggest-current'){runAnalysis({kind:'current'});return;}
  if(action==='suggest-retry'){runAnalysis(ui.recommendRequest);return;}
  if(action==='retry-move'){const attempt=ui.drawer?.attempt??workspace.lastAttempt;if(attempt?.intent?.kind==='lesson'){openDrawer({type:'lesson',classId:id,lessonId:attempt.intent.lessonId,targetSlot:attempt.intent.slot});return;}openDrawer({type:'class',classId:id,targetSlot:attempt?.intent?.slot});requestAnimationFrame(()=>{document.querySelector(attempt?.report.issues.some(i=>i.type==='CAPACITY')?'#move-room':'#move-slot')?.focus({preventScroll:true});document.querySelector('#move-form')?.scrollIntoView({block:'center'});});return;}
  if(action==='record-issues'){openDrawer({type:'issues',recordId:id});return;}
  if(action==='details'){openDrawer({type:'class',classId:id});return;}
  if(action==='lesson-details'){const [classId,lessonId]=id.split('|');openDrawer({type:'lesson',classId,lessonId});return;}
  if(action==='student'){openDrawer({type:'student',studentId:id});return;}
  if(action==='current-issues'){openDrawer({type:'issues'});return;}
  if(action==='history'){openDrawer({type:'history'});loadArchives();return;}
  if(action==='reload-archives'){ui.archives=null;loadArchives();return;}
  if(action==='archive'){openDrawer({type:'archive',archiveIndex:id});return;}
  if(action==='joint'){openJoint();return;}
  if(action==='apply-joint'){if(ui.jointPreview?.accepted)handleIntent({kind:'joint',moves:clone(ui.jointDraft)});return;}
  if(action==='back-comparison'){ui.modal={type:'compare'};renderOverlay();return;}
  if(action==='confirm-candidate'){const candidate=ui.analysis?.candidates.find(c=>c.id===id);if(!candidate)return;const result=workspace.useCandidate(candidate,candidate.title);if(!result.ok){ui.modal=null;ui.analysis=null;render();toast(result.message,true);return;}const fromSuggestion=!!ui.recommendRequest;if(fromSuggestion){const focusId=candidate.changes.map(c=>c.targetId??c.classId).find(id=>result.report.view.byId[id]);const focus=focusId?result.report.view.byId[focusId]:null;if(focus&&!focus.lessons.some(l=>l.weekday===ui.day))ui.day=focus.lessons[0].weekday;}invalidateAnalysis();ui.drawer=null;render();toast(fromSuggestion?(result.report.conditions.length?'建议已应用 · 老班仍待协调':'建议已应用到当前课表'):(result.report.conditions.length?'已加入试排 · 老班仍待协调':'已加入试排'));return;}
  if(action==='analyze'){runAnalysis();return;}
  if(action==='save'){lastFocus=document.activeElement;ui.drawer=null;ui.modal={type:'save'};renderOverlay();setTimeout(()=>{const input=document.querySelector('#plan-name');input?.focus();input?.select();},0);return;}
  if(action==='undo'){if(workspace.undo()){invalidateAnalysis();ui.drawer=null;render();toast('已撤销最近调整');}return;}
  if(action==='reset'){workspace.reset();invalidateAnalysis();ui.drawer=null;render();toast('已恢复起始课表');return;}
  if(action==='withdraw-merge'){workspace.withdrawMerge();invalidateAnalysis();ui.drawer=null;render();toast('已撤回合班');return;}
  if(action==='cancel-coordination'){workspace.cancelCoordination();invalidateAnalysis();ui.drawer=null;render();toast('已撤回老班调时');return;}
  if(action==='restore-saved'){if(workspace.restoreSaved(id)){invalidateAnalysis();ui.drawer=null;render();toast('已载入保存方案');}return;}
  if(action==='use-candidate'){const candidate=ui.analysis?.candidates.find(c=>c.id===id);if(!candidate)return;ui.modal={type:'candidate',id};renderOverlay();return;}
}



function dropIntent(element) {
  const card=element.closest('.class-card');
  if(ui.dragLessonId){const cell=element.closest('.time-cell[data-drop-slot][data-drop-room]');return cell?{kind:'lesson',classId:ui.dragId,lessonId:ui.dragLessonId,slot:Number(cell.dataset.dropSlot),roomId:cell.dataset.dropRoom,day:ui.day}:null;}
  if(card&&card.dataset.classId!==ui.dragId&&!card.dataset.reference&&ctx.classes[ui.dragId].subject===ctx.classes[card.dataset.classId].subject)return {kind:'merge',classId:ui.dragId,targetId:card.dataset.classId};
  const cell=element.closest('.time-cell[data-drop-slot][data-drop-room]');
  return cell?{kind:'move',classId:ui.dragId,slot:Number(cell.dataset.dropSlot),roomId:cell.dataset.dropRoom,day:ui.day}:null;
}

function dragPreview(intent) {
  const key=JSON.stringify(intent);
  if(ui.dragCache.has(key))return ui.dragCache.get(key);
  const result=attemptIntent(ctx,workspace.plan,intent);
  let message='当前安排',good=true;
  if(!result.noop){
    good=result.report.ok;
    if(intent.kind==='merge'){
      const target=workspace.report.view.byId[intent.targetId];
      message=result.accepted?`拟合入${target.label} · ${result.report.view.byId[target.id].count}人${result.report.ok?'':` · ${result.report.issues[0].title}`}`:result.report.issues[0].type==='CAPACITY'?`拟${result.report.issues[0].count}人，容量${result.report.issues[0].classCapacity}人`:result.report.issues[0].title;
    }else {const cls=workspace.report.view.byId[intent.classId],single=intent.kind==='lesson'?cls.lessons.find(l=>l.id===intent.lessonId):null,prior=single?{...cls,normal_slot:single.slot_id,roomName:ctx.rooms[single.room_id??cls.room_id].display_name}:cls,room=ctx.rooms[intent.roomId]?.display_name??prior.roomName;message=`${single?`${dateText(single.start)} · 仅1次 · `:''}${winForHint(prior.normal_slot)} → ${winForHint(intent.slot)} · ${prior.roomName} → ${room}${result.accepted?' · 可加入试排':` · ${result.report.issues[0]?.title??'待核对'}`}`;}
  }
  const preview={message,good,result};ui.dragCache.set(key,preview);return preview;
}

function clearDropPreview() {
  document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target','blocked','merge-target'));
  document.querySelector('#drag-hint').className='drag-hint';
}
function clearDrag() {
  ui.dragId=null;ui.dragLessonId=null;ui.dragCache.clear();document.body.classList.remove('drag-in-progress');
  document.querySelectorAll('.dragging,.drop-target').forEach(el=>el.classList.remove('dragging','drop-target','blocked','merge-target'));
  clearDropPreview();document.querySelectorAll('[data-merge-target]').forEach(el=>delete el.dataset.mergeTarget);
}


function winForHint(slot){const t=ctx.data.time_window_templates.find(t=>t.slot_id===slot);return `时点${slot} ${t.start}—${t.end}`;}
function readJointForm(){const form=document.querySelector('#joint-form');if(!form)return [];const values=new FormData(form);return workspace.report.view.classes.filter(c=>values.has(`include:${c.id}`)).map(c=>({classId:c.id,slot:Number(values.get(`slot:${c.id}`)),roomId:values.get(`room:${c.id}`),seriesMode:values.get(`mode:${c.id}`),day:'Saturday'}));}
function openJoint(){
  const attempt=ui.drawer?.attempt??workspace.lastAttempt;ui.jointDraft=[];ui.jointPreview=null;
  if(attempt?.intent?.kind==='move'){const m=attempt.intent,prior=workspace.report.view.byId[m.classId];ui.jointDraft=[{...m,seriesMode:m.seriesMode??'PRESERVE'}];const teacher=attempt.report.issues.find(i=>i.type==='TEACHER_CONFLICT'&&i.classIds.includes(m.classId)),otherId=teacher?.classIds.find(id=>id!==m.classId),other=workspace.report.view.byId[otherId];if(other&&prior)ui.jointDraft.push({classId:other.id,slot:prior.normal_slot,roomId:other.room_id,seriesMode:'PRESERVE'});}
  openDrawer({type:'joint'});
}
async function loadArchives(){
  if(ui.archives!==null&&!ui.archiveError)return;
  ui.archiveError=null;const rows=[];
  try{for(const item of data.predecessor_versions??[]){const response=await fetch(new URL(item.path,import.meta.url));if(!response.ok)throw new Error('历史版本资料暂时无法读取');const old=await response.json(),oldCtx=createContext(old,ctx.fixtureId);let storage;try{storage=window.localStorage;}catch{throw new Error('浏览器历史存储不可用');}if(storage.getItem(`campus-planner:v1:${oldCtx.fingerprint}`)){const state=new Workspace(oldCtx,storage);if(state.storageWarning)throw new Error('部分历史记录无法读取，原数据未修改');rows.push({version:old.version,ctx:oldCtx,state});}}ui.archives=rows;}
  catch(error){ui.archives=[];ui.archiveError=error.message;}
  if(ui.drawer?.type==='history'){const open=document.querySelector('.archive-entry')?.open;renderOverlay();const entry=document.querySelector('.archive-entry');if(entry)entry.open=!!open;}
}

function bindEvents() {
  app.addEventListener('click',event=>{
    if(event.target.closest('[data-action]'))return handleAction(event);
    const card=event.target.closest('.class-card');if(card&&!ui.dragId)openDrawer({type:card.dataset.lessonId?'lesson':'class',classId:card.dataset.classId,lessonId:card.dataset.lessonId});
  });
  overlays.addEventListener('click',handleAction);
  app.addEventListener('input',event=>{if(event.target.id==='filter-query')ui.draftFilters.query=event.target.value;});
  app.addEventListener('change',event=>{
    if(event.target.id==='filter-track'){ui.draftFilters.track=event.target.value;return;}
    else if(event.target.id==='filter-grade'){ui.draftFilters.grade=event.target.value;return;}
    else if(event.target.id==='filter-day'){ui.day=event.target.value;ui.location=null;clearDrag();}
    else return;
    render({preserveFocus:true});
  });
  app.addEventListener('submit',event=>{if(event.target.id==='query-form'){event.preventDefault();queryTimetable();}});
  overlays.addEventListener('submit',event=>{
    if(event.target.id==='save-form'){
      event.preventDefault();const result=workspace.save(new FormData(event.target).get('name'));
      if(!result.ok){document.querySelector('#save-error').textContent=result.message;return;}
      ui.modal=null;render();toast('已保存至当前浏览器');
    }else if(event.target.id==='lesson-form'){event.preventDefault();const form=new FormData(event.target);handleIntent({kind:'lesson',classId:event.target.dataset.classId,lessonId:event.target.dataset.lessonId,slot:Number(form.get('slot')),roomId:form.get('room'),day:'Saturday'});
    }else if(event.target.id==='joint-form'){event.preventDefault();ui.jointDraft=readJointForm();const result=attemptIntent(ctx,workspace.plan,{kind:'joint',moves:ui.jointDraft});if(result.noop)result.report=workspace.report;ui.jointPreview=result;renderOverlay();
    }else if(event.target.id==='merge-form'){event.preventDefault();handleIntent({kind:'merge',classId:event.target.dataset.classId,targetId:new FormData(event.target).get('target')});
    }else if(event.target.id==='move-form'){
      event.preventDefault();const id=event.target.dataset.classId;
      const form=new FormData(event.target);
      handleIntent({kind:'move',classId:id,slot:Number(form.get('slot')),roomId:form.get('room'),seriesMode:form.get('seriesMode'),day:'Saturday'});
    }
  });
  overlays.addEventListener('change',event=>{if(event.target.id==='stats-subject'){ui.drawer.subject=event.target.value;renderOverlay();requestAnimationFrame(()=>document.querySelector('#stats-subject')?.focus());return;}if(event.target.closest('#joint-form')){const row=event.target.closest('[data-joint-id]');if(row&&event.target.tagName==='SELECT')row.querySelector('input[type=checkbox]').checked=true;ui.jointDraft=readJointForm();ui.jointPreview=null;document.querySelector('.joint-result')?.remove();const apply=document.querySelector('[data-action=apply-joint]');if(apply)apply.disabled=true;}});
  app.addEventListener('keydown',event=>{const card=event.target.closest('.class-card');if(card&&['Enter',' '].includes(event.key)){event.preventDefault();openDrawer({type:card.dataset.lessonId?'lesson':'class',classId:card.dataset.classId,lessonId:card.dataset.lessonId});}});
  app.addEventListener('dragstart',event=>{
    const card=event.target.closest('.class-card[draggable="true"]');if(!card){event.preventDefault();return;}
    ui.dragId=card.dataset.classId;ui.dragLessonId=card.dataset.lessonId??null;app.querySelectorAll('.class-card[draggable=true]').forEach(el=>el.dataset.mergeTarget=String(!ui.dragLessonId&&!el.dataset.lessonId&&el.dataset.classId!==ui.dragId&&ctx.classes[el.dataset.classId].subject===ctx.classes[ui.dragId].subject));ui.dragCache.clear();card.classList.add('dragging');document.body.classList.add('drag-in-progress');
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',ui.dragId);
  });
  app.addEventListener('dragover',event=>{
    if(!ui.dragId)return;const intent=dropIntent(event.target);if(!intent){event.dataTransfer.dropEffect='none';clearDropPreview();return;}
    event.preventDefault();event.dataTransfer.dropEffect='move';
    const target=intent.kind==='merge'?event.target.closest('.class-card'):event.target.closest('.time-cell[data-drop-slot][data-drop-room]');
    document.querySelectorAll('.drop-target').forEach(el=>{if(el!==target)el.classList.remove('drop-target','blocked','merge-target');});
    const preview=dragPreview(intent);target.classList.add('drop-target');target.classList.toggle('blocked',!preview.good);target.classList.toggle('merge-target',intent.kind==='merge');
    const hint=document.querySelector('#drag-hint');hint.textContent=preview.message;hint.className=`drag-hint visible${preview.good?'':' error'}`;hint.style.left=`${Math.max(8,Math.min(event.clientX+15,window.innerWidth-360))}px`;hint.style.top=`${Math.min(event.clientY+18,window.innerHeight-80)}px`;
  });
  app.addEventListener('drop',event=>{
    if(!ui.dragId)return;event.preventDefault();event.stopPropagation();const intent=dropIntent(event.target);clearDrag();if(intent)handleIntent(intent);
  });
  app.addEventListener('dragend',clearDrag);
  document.addEventListener('dragover',event=>{if(ui.dragId&&!app.contains(event.target)){event.dataTransfer.dropEffect='none';clearDropPreview();}});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(ui.modal||ui.drawer)closeOverlay();else clearDrag();}
    if(event.key==='Tab'&&(ui.modal||ui.drawer)){
      const items=[...overlays.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')].filter(el=>el.offsetParent!==null);
      if(!items.length)return;const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
}

async function start() {
  try{
    const response=await fetch(new URL('./demo-data.json',import.meta.url));
    if(!response.ok)throw new Error('课表数据读取失败');data=await response.json();
    const fixtureId=new URL(location.href).searchParams.get('fixture')??'S1';
    ctx=createContext(data,fixtureId);
    let storage;try{storage=window.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{throw new Error('浏览器存储不可用');}};}
    workspace=new Workspace(ctx,storage);ui.readAt=new Date().toISOString();
    document.querySelector('#current-operator').textContent=`${workspace.actor.name} · ${workspace.actor.role}`;
    bindEvents();render();
    if(workspace.storageWarning)toast(workspace.storageWarning,true);
  }catch(error){app.inert=false;app.setAttribute('aria-busy','false');app.innerHTML=`<section class="fatal"><h1>课表暂时无法载入</h1><p>${esc(error.message)}</p><a href="${esc(location.pathname)}">重新载入</a></section>`;}
}
start();
