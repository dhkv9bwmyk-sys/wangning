(function (root) {
  'use strict';
  const U = root.DeskUI, R = root.DeskRecords, D = root.PrepDesk;
  const store = 'fulltimeTasks';
  const activeKey = 'desk-planning-v1:fulltime-active';
  const legacyKey = 'desk-planning-v1:fulltime', legacyId = 'FT-LEGACY';
  const samples = {
    walk: '全日制排课_选科走班示例.xlsx',
    missing: '全日制排课_缺教师示例.xlsx'
  };
  let tasks = new Map();
  let active = '';
  let loaded = false;

  const current = () => tasks.get(active);
  function stage(progress) {
    if (progress?.running) return '排课中';
    if (progress?.blocked) return '待处理异常';
    if (!progress?.reviewStage && progress?.sourceReady) return '待核对资料';
    return ['待录入资料', '待确认班量', '待核对课表', '已确认课表'][progress?.reviewStage ?? 0];
  }
  function select(id) {
    if (!tasks.has(id)) return false;
    active = id;
    try { localStorage.setItem(activeKey, id); } catch {}
    return true;
  }
  async function load() {
    if (loaded) return;
    const records = await R.all(store);
    tasks = new Map(records.filter(task => !task.deleted).map(task => [task.id, task]));
    let previous, priorId;
    try {
      previous = JSON.parse(localStorage.getItem(legacyKey));
      priorId = localStorage.getItem(activeKey);
    } catch {}
    if (previous?.inputs && !records.some(task => task.id === legacyId)) {
      const task = { id: legacyId, name: '原全日制排课任务', updated: new Date().toISOString(), progress: previous };
      await R.put(store, task);
      tasks.set(task.id, task);
    }
    const first = U.list(tasks)[0];
    if (first) select(tasks.has(priorId) ? priorId : first.id);
    loaded = true;
  }
  function entries() {
    return U.list(tasks).map(task => `<div class="session-row ${task.id === active ? 'active' : ''}">
      <button type="button" class="session task-entry" data-act="fulltime-task" data-id="${U.esc(task.id)}"
        ${task.id === active ? 'aria-current="true"' : ''}>
        <span>${U.esc(task.name)}</span><span class="task-entry-meta">${U.esc(task.id)} · ${U.esc(stage(task.progress))}</span>
      </button>
      ${U.recordOptions(task.id,task.name,'remove-fulltime-task','删除任务')}
    </div>`).join('');
  }
  function assertIdle(task) {
    if (task?.progress?.running) throw Error('正在排课，请在本次处理结束后删除。');
  }
  function forRemoval(id) {
    const task = tasks.get(id);
    if (!task) throw Error('这项任务已删除。');
    assertIdle(task);
    return task;
  }
  function forget(id) {
    tasks.delete(id);
    if (active !== id) return;
    const next = U.list(tasks)[0];
    if (next) select(next.id);
    else {
      active = '';
      try { localStorage.removeItem(activeKey); } catch {}
    }
  }
  async function remove(id) {
    forRemoval(id);
    await R.changeTask(store,id,task=>{
      assertIdle(task);
      // Keep just the migration marker so the original draft cannot appear again.
      return id===legacyId ? {id,deleted:true} : null;
    });
    if (id===legacyId) {
      try { localStorage.removeItem(legacyKey); } catch {}
    }
    forget(id);
  }
  function newTaskDialog() {
    const defaultName = '全日制任务 ' + String(tasks.size + 1).padStart(2, '0');
    U.panel('new-fulltime', '新建全日制任务', '', `<form id="fulltime-create-form">
      <label for="fulltime-name">任务名称</label>
      <input id="fulltime-name" name="name" value="${U.esc(defaultName)}" maxlength="48" required>
    </form>`, U.btn('取消', 'close') +
      '<button class="btn primary" id="fulltime-create-submit" type="submit" form="fulltime-create-form">创建任务</button>', {narrow:true});
    const name = document.getElementById('fulltime-name');
    name.focus();
    name.select();
  }
  async function createTask(form) {
    const submit = document.getElementById('fulltime-create-submit');
    if (!submit || submit.disabled) return false;
    const name = String(form.elements.name.value).trim();
    if (!name) { form.elements.name.focus(); return false; }
    submit.disabled = true;
    try {
      const task = { id: D.uid('FT'), name: name.slice(0, 48), updated: new Date().toISOString(), progress: null };
      await R.put(store, task);
      tasks.set(task.id, task);
      select(task.id);
      return true;
    } finally {
      submit.disabled = false;
    }
  }
  function render(view) {
    const task = current();
    if (!task) {
      view.innerHTML = `<div class="page plan-page">
        <div class="plan-title">${U.badge('规划中', 'warm')}<h1>全日制排课</h1></div>
        <p class="lead">新建任务后，可导入资料、推演班量和核对课表。</p>
        ${U.btn('新建全日制任务', 'new-fulltime', '', 'primary')}
      </div>`;
      return;
    }
    if (view.querySelector('#fulltime-prototype')?.dataset.taskId === task.id) return;
    const frame = document.createElement('iframe');
    frame.id = 'fulltime-prototype';
    frame.title = '全日制排课';
    frame.dataset.taskId = task.id;
    frame.setAttribute('sandbox', 'allow-scripts allow-downloads');
    if (root.OFFLINE_FULLTIME) frame.srcdoc = root.OFFLINE_FULLTIME;
    else frame.src = 'prototypes/fulltime.html?v=intake-planner-1123';
    const loading = document.createElement('p');
    loading.id = 'fulltime-loading';
    loading.className = 'loading';
    loading.setAttribute('role', 'status');
    loading.textContent = '正在打开任务…';
    frame.addEventListener('load', () => loading.remove(), {once: true});
    view.replaceChildren(loading, frame);
  }
  root.addEventListener('message', event => {
    const frame = document.getElementById('fulltime-prototype');
    if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
    const task = tasks.get(frame.dataset.taskId);
    if (!task) return;
    const {type, progress, sample} = event.data || {};
    if (type === 'fulltime-ready') {
      document.getElementById('fulltime-loading')?.remove();
      frame.contentWindow.postMessage({type: 'fulltime-restore', progress: task.progress}, '*');
    } else if (type === 'fulltime-progress' && progress?.inputs) {
      const changed = stage(task.progress) !== stage(progress);
      const next = {...task, progress, updated: new Date().toISOString()};
      tasks.set(task.id, next);
      R.changeTask(store,task.id,saved=>({...saved,progress,updated:next.updated})).catch(error=>{
        if (!error.missingTask) {
          U.toast('无法保存任务进度，请检查浏览器存储空间。');
          return;
        }
        if (!tasks.has(task.id)) return;
        forget(task.id);
        if (root.DeskState.page==='fulltime') U.renderMain();
        U.toast(error.message);
      });
      if (changed && root.DeskState.page === 'fulltime') U.renderMain();
    } else if (type === 'fulltime-sample-download' && Object.hasOwn(samples, sample)) {
      const name = samples[sample], link = document.createElement('a');
      link.href = U.asset(name);
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
    }
  });
  root.DeskFulltime = {load, entries, newTaskDialog, createTask, select, current, render, forRemoval, remove};
})(window);
