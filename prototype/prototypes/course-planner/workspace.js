import { clone, freshPlan, normalizePlan, signature, evaluatePlan, attemptIntent,compareIssues,hasMerges } from './domain.js';
import {captureClassFacts} from './conflict-view.js';
import {operationKind,planChanges} from './planner.js';

export class Workspace {
  constructor(ctx, storage, now = () => new Date().toISOString(), actor = ctx.data.demo_operator??{id:'DEMO-ACADEMIC-01',name:'周敏',role:'教务'}) {
    this.ctx = ctx; this.storage = storage; this.now = now;
    this.actor=clone(actor);
    this.key = `campus-planner:v1:${ctx.fingerprint}`;
    this.plan = freshPlan(); this.undoStack = []; this.logs = []; this.saved = [];
    this.revision = 0; this.storageWarning = ''; this.lastAttempt = null;
    this.hydrate();
  }
  get report() { const key=signature(this.plan);if(this._reportKey!==key){this._reportKey=key;this._report=evaluatePlan(this.ctx,this.plan);}return this._report; }
  get hasEdits() { return signature(this.plan) !== signature(freshPlan()); }
  get savedCurrent() { return this.saved.find(row => signature(row.plan) === signature(this.plan)) ?? null; }
  get isSaved() { return !!this.savedCurrent; }
  event(label, outcome, detail = '',extra={}) {
    this.logs.push({ id: crypto.randomUUID(), at: this.now(), actor:clone(this.actor), label, outcome, detail,...extra });
    this.logs = this.logs.slice(-100);
  }
  hydrate() {
    try {
      const raw = this.storage.getItem(this.key); if (!raw) return;
      const value = JSON.parse(raw);
      if (value.schema !== 1 || value.fingerprint !== this.ctx.fingerprint) throw new Error('版本不匹配');
      const plan = normalizePlan(this.ctx, value.plan);
      const undo = (value.undoStack ?? []).slice(-50).map(p => normalizePlan(this.ctx, p));
      const saved = (value.saved ?? []).map(row => {
        if (!row || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.at !== 'string') throw new Error('保存记录无效');
        return { id: row.id, name: row.name.slice(0, 40), at: row.at, actor:row.actor??null, plan: normalizePlan(this.ctx, row.plan),basis:row.basis??null,changes:row.changes??null,conditions:row.conditions??null };
      });
      this.plan = plan; this.undoStack = undo; this.saved = saved;
      this.logs = (value.logs ?? []).filter(row => row && typeof row.id === 'string' && typeof row.at === 'string' && typeof row.label === 'string' && typeof row.outcome === 'string').slice(-100);
    } catch { this.storageWarning = '本地工作状态无法读取，已载入起始课表'; }
  }
  persist() {
    try {
      this.storage.setItem(this.key, JSON.stringify({ schema: 1, fingerprint: this.ctx.fingerprint,
        plan: this.plan, undoStack: this.undoStack, logs: this.logs, saved: this.saved }));
      this.storageWarning = ''; return true;
    } catch { this.storageWarning = '浏览器未能保存数据，当前调整仅在本页保留'; return false; }
  }
  checkpoint() { this.undoStack.push(clone(this.plan)); this.undoStack = this.undoStack.slice(-50); }
  attempt(intent) {
    const result = attemptIntent(this.ctx, this.plan, intent);
    if (result.noop) return result;
    result.intent=clone(intent);
    result.delta??=compareIssues(result.currentReport?.issues??this.report.issues,result.report.issues);
    const affectedIds=[intent.classId,intent.targetId,...(intent.moves??[]).map(m=>m.classId),...result.report.issues.flatMap(issue=>issue.classIds??[])].filter(Boolean);
    result.beforeFacts=captureClassFacts(result.currentReport?.view??this.report.view,affectedIds);
    result.classFacts={...result.beforeFacts,...Object.fromEntries(Object.entries(captureClassFacts(result.report.view,affectedIds)).filter(([,c])=>c))};
    result.studentFacts=Object.fromEntries([...new Set(result.report.issues.flatMap(i=>i.studentIds??[]))].map(id=>[id,{id,name:this.ctx.students?.[id]?.display_name??null}]));
    if(intent.kind==='move'||intent.kind==='lesson'){
      const base=result.beforeFacts[intent.classId],single=intent.kind==='lesson'?base?.lessons.find(l=>l.id===intent.lessonId):null,prior=single?{...base,normal_slot:single.slot_id,room_id:single.room_id??base.room_id,roomName:this.ctx.rooms[single.room_id??base.room_id].display_name}:base,from=this.ctx.data.time_window_templates.find(t=>t.slot_id===prior?.normal_slot),to=this.ctx.data.time_window_templates.find(t=>t.slot_id===intent.slot);
      if(prior&&from&&to){result.transition={fromSlot:prior.normal_slot,toSlot:intent.slot,fromStart:from.start,fromEnd:from.end,toStart:to.start,toEnd:to.end,fromRoom:prior.roomName,toRoom:this.ctx.rooms[intent.roomId]?.display_name??prior.roomName};
        if(single)Object.assign(result.transition,{scope:'LESSON',lessonId:intent.lessonId,date:single.start.slice(0,10)});
        result.operation=single?'单次调课':operationKind(prior,{normal_slot:intent.slot,room_id:intent.roomId??prior.room_id});
        result.label=`${result.operation}：${prior.label}${single?` · ${single.start.slice(0,10)}（1次）`:''} · ${result.operation==='换教室'?`${result.transition.fromRoom} → ${result.transition.toRoom}`:`时点${prior.normal_slot} → 时点${intent.slot}`}${result.operation==='调时并换教室'||single?` · ${result.transition.fromRoom} → ${result.transition.toRoom}`:''}`;
      }
    }
    const evidence={accepted:result.accepted,issues:clone(result.report.issues),delta:clone(result.delta),classFacts:clone(result.classFacts),beforeFacts:clone(result.beforeFacts),studentFacts:clone(result.studentFacts),intent:clone(intent),operation:result.operation??(intent.kind==='joint'?'联合调整':intent.kind==='merge'?'合班':null),transition:result.transition??null};
    if (result.accepted && result.changed) {
      this.checkpoint(); this.plan = clone(result.plan); this.revision++; this.lastAttempt = null;
      this.event(result.label, result.report.ok ? (result.report.status === 'CONDITIONAL' ? '待协调' : '核查通过') : '已接收，存在冲突','',evidence);
    } else {
      this.lastAttempt = result;
      const cls = this.ctx.classes[intent.classId];
      const label=result.label??`${intent.kind==='merge'?'合班':'调时'}：${cls?.label??''}${intent.kind==='merge'?` → ${this.ctx.classes[intent.targetId]?.label??''}`:` → 时点${intent.slot}`}`;
      this.event(label,'未接收',result.report.issues[0]?.title??'',evidence);
    }
    this.persist(); return result;
  }
  useCandidate(candidate, label) {
    if(this.ctx.scope.general_merges){if(!candidate.basis||candidate.basis.fingerprint!==this.ctx.fingerprint||candidate.basis.signature!==signature(this.plan)||candidate.basis.ruleVersion!==(this.ctx.data.rule_version??this.ctx.data.version))return {ok:false,message:'草案或数据已变化，请重新分析'};}
    else if (!this.plan.merge) return { ok: false, message: '请先提出合班' };
    const plan = normalizePlan(this.ctx, candidate.plan), report = evaluatePlan(this.ctx, plan);
    if (!report.ok) return { ok: false, message: '该方案仍存在冲突', report };
    if (signature(plan) === signature(this.plan)) return { ok: true, unchanged: true, report };
    const changes=planChanges(this.ctx,this.report.view,report.view);
    this.checkpoint(); this.plan = clone(plan); this.revision++; this.lastAttempt = null;
    this.event(label, report.status === 'CONDITIONAL' ? '待协调' : '核查通过','',{basis:candidate.basis??null,changes}); this.persist();
    return { ok: true, report };
  }
  cancelCoordination() {
    if (!['SIMULATE_X_TO_2','SIMULATE_OLD_CHANGE'].includes(this.plan.profile)) return;
    this.checkpoint();const previous=this.plan.profile;this.plan=clone(this.plan);this.plan.profile='CURRENT';
    for(const c of this.ctx.data.classes.filter(c=>c.protected)){delete this.plan.slots[c.id];delete this.plan.rooms?.[c.id];for(const [id,m]of Object.entries(this.plan.lessonMoves??{}))if(m.classId===c.id)delete this.plan.lessonMoves[id];}
    if(previous==='SIMULATE_X_TO_2')delete this.plan.slots[this.ctx.scope.partial_math_destinations[0]];
    this.revision++;
    this.lastAttempt = null; this.event('撤回老班调时', '已恢复老班保护'); this.persist();
  }
  undo() {
    const previous = this.undoStack.pop(); if (!previous) return false;
    this.plan = clone(previous); this.revision++; this.lastAttempt = null;
    this.event('撤销最近调整', '已还原'); this.persist(); return true;
  }
  reset() {
    this.plan = freshPlan(); this.undoStack = []; this.revision++; this.lastAttempt = null;
    this.event('恢复起始课表', '已恢复'); this.persist();
  }
  withdrawMerge() {
    if (!hasMerges(this.plan)) return;
    // Keep ordinary pre-merge changes when their accepted checkpoint is available.
    const previous = [...this.undoStack].reverse().find(plan => !hasMerges(plan)) ?? freshPlan();
    this.checkpoint(); this.plan = clone(previous); this.revision++; this.lastAttempt = null;
    this.event('撤回合班', '已还原'); this.persist();
  }
  save(name) {
    const cleaned = String(name ?? '').trim().slice(0, 40);
    if (!cleaned) return { ok: false, message: '请输入方案名称' };
    if (!this.hasEdits) return { ok: false, message: '当前没有需要保存的调整' };
    const prior = this.saved, oldLogs = clone(this.logs);
    const row = { id: crypto.randomUUID(), name: cleaned, at: this.now(), actor:clone(this.actor), plan: clone(this.plan),basis:{fingerprint:this.ctx.fingerprint,ruleVersion:this.ctx.data.rule_version??this.ctx.data.version},changes:planChanges(this.ctx,this.ctx.sourceView,this.report.view),conditions:clone(this.report.conditions) };
    this.saved = [row, ...prior]; this.event(`保存方案：${cleaned}`, '已保存');
    if (!this.persist()) { this.saved = prior; this.logs = oldLogs; return { ok: false, message: this.storageWarning }; }
    return { ok: true, record: row };
  }
  restoreSaved(id) {
    const row = this.saved.find(record => record.id === id); if (!row) return false;
    if (signature(row.plan) !== signature(this.plan)) { this.checkpoint(); this.plan = clone(row.plan); this.revision++; }
    this.lastAttempt = null; this.event(`载入方案：${row.name}`, '已载入'); this.persist(); return true;
  }
}
