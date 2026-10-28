(function () {
  'use strict';
  const D = window.DeadlineTasks;
  const teacherPage = Boolean(document.getElementById('panel-tasks'));
  const host = document.getElementById(teacherPage ? 'panel-tasks' : 'app-content-courses');
  if (!host || !D || !window.firebase) return;
  const service = D.createService(window.firebase);
  const node = (tag, cls, text) => {
    const result = document.createElement(tag);
    if (cls) result.className = cls;
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const button = (text, handler, cls = 'deadline-button') => {
    const result = node('button', cls, text); result.type = 'button'; result.onclick = handler; return result;
  };
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const skin = `deadline-ui${teacherPage ? '' : ' deadline-board'}`;
  const heading = host.querySelector('h2'), legacy = node('div');
  legacy.id = 'deadline-legacy-panel';
  if (!teacherPage) legacy.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
  [...host.children].filter(child => child !== heading).forEach(child => legacy.append(child));
  const tabs = node('div', `${skin} deadline-category-tabs`);
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '課程任務分類');
  const panel = node('section', `${skin} deadline-panel`); panel.id = 'deadline-task-panel'; panel.hidden = true;
  legacy.setAttribute('role', 'tabpanel'); panel.setAttribute('role', 'tabpanel');
  host.append(tabs, legacy, panel);
  let items = [], filter = 'all', started = false, tasksOnline = false, tasksReady = false, recordsOnline = false;
  let selectedId = '', records = {}, recordsUnsubscribe = null, busy = false, timerState = '', lastFocus = null;
  const notice = node('p', 'deadline-message'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const filters = node('div', 'deadline-filters'), list = node('div', 'deadline-task-list');
  const say = (text, error = false) => { notice.textContent = text; notice.classList.toggle('error', error); };
  function selectCategory(category) {
    legacy.hidden = category !== 'subjects';
    // Legacy board uses inline flex styling; hidden is deliberately enforced here.
    legacy.style.display = category === 'subjects' ? (teacherPage ? '' : 'flex') : 'none';
    panel.hidden = category !== 'deadline';
    tabs.querySelectorAll('button').forEach(tab => { const active = tab.dataset.category === category; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    if (category === 'deadline') { start(); renderList(); }
  }
  for (const [category, label] of [['subjects', '科目任務'], ['deadline', '限時任務']]) {
    const tab = button(label, () => selectCategory(category), '');
    tab.dataset.category = category; tab.setAttribute('role', 'tab');
    tab.id = `course-category-${category}`; tab.setAttribute('aria-controls', category === 'subjects' ? legacy.id : panel.id);
    (category === 'subjects' ? legacy : panel).setAttribute('aria-labelledby', tab.id);
    tabs.append(tab);
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const all = [...tabs.querySelectorAll('button')], current = all.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (current + 1) % 2;
    all[index].click(); all[index].focus();
  });
  const toolbar = node('div', 'deadline-toolbar');
  toolbar.append(node('p', '', teacherPage ? '設定截止時間；到期自動鎖定，紀錄持續保留。' : '截止前可點選完成狀態；到期後僅供查看。'));
  if (teacherPage) toolbar.append(button('新增限時任務', () => editTask(), 'deadline-button primary'));
  for (const [value, label] of [['all', '全部'], ['open', '進行中'], ['closed', '已截止'], ...(teacherPage ? [['hidden', '已隱藏']] : [])]) {
    const tab = button(label, () => { filter = value; renderList(); }, '');
    tab.dataset.filter = value; filters.append(tab);
  }
  panel.append(toolbar, filters, list, notice);
  const dialog = node('dialog', `${skin} deadline-dialog`); dialog.id = 'deadline-task-dialog';
  dialog.setAttribute('aria-labelledby', 'deadline-detail-title');
  const shell = node('div', 'deadline-dialog-shell'), detailHead = node('div', 'deadline-dialog-head');
  const detailTitleBox = node('div'), detailTitle = node('h2'), detailDate = node('small'); detailTitle.id = 'deadline-detail-title';
  detailTitleBox.append(detailTitle, detailDate);
  const closeButton = button('✕ 關閉', () => dialog.close());
  detailHead.append(detailTitleBox, closeButton);
  const summary = node('div', 'deadline-summary'), detailActions = node('div', 'deadline-toolbar');
  const grid = node('div', 'deadline-seat-grid'), extraRecords = node('div', 'deadline-record-list');
  const detailMessage = node('p', 'deadline-message'); detailMessage.setAttribute('role', 'status'); detailMessage.setAttribute('aria-live', 'polite');
  shell.append(detailHead, summary, detailActions, node('div', 'deadline-front', '黑板／講台'), grid, extraRecords, detailMessage);
  dialog.append(shell); document.body.append(dialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { recordsUnsubscribe?.(); recordsUnsubscribe = null; selectedId = ''; lastFocus?.focus(); });
  function start() {
    if (started) return; started = true; say('正在載入限時任務…');
    service.watchTasks((next, online) => {
      items = next; tasksOnline = online; tasksReady = true;
      say(online ? '' : '目前未連線，顯示的是暫存紀錄，不能登記。');
      renderList(); if (dialog.open) renderDetail();
    }, error => {
      tasksOnline = false; tasksReady = true;
      say(error.code === 'permission-denied' ? '限時任務尚無法讀取，請確認雲端規則已更新。' : '限時任務載入失敗，請檢查網路後重新開啟頁面。', true);
      renderList(); if (dialog.open) renderDetail();
    });
  }
  function visibleItems() {
    return items.filter(task => (teacherPage || !task.hidden) && (filter === 'hidden' ? task.hidden : filter === 'open' ? !task.hidden && !D.closed(task) : filter === 'closed' ? D.closed(task) : true));
  }
  function renderList() {
    filters.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.filter === filter)));
    list.replaceChildren();
    const tasks = visibleItems();
    if (!tasks.length) list.append(node('p', 'deadline-empty', tasksReady ? '這個分類目前沒有任務。' : '讀取中…'));
    tasks.forEach(task => {
      const card = button('', () => openTask(task.id), 'deadline-task-card');
      card.dataset.taskId = task.id;
      card.append(node('span', `deadline-status${D.closed(task) ? ' closed' : ''}`, `${task.hidden ? '已隱藏 · ' : ''}${D.closed(task) ? '已截止 · 紀錄保留' : '進行中'}`), node('strong', '', task.name), node('small', '', `截止 ${D.formatDate(task.deadline)}`));
      list.append(card);
    });
    timerState = items.map(task => `${task.id}:${D.closed(task)}`).join('|');
  }
  function openTask(id) {
    selectedId = id; records = {}; recordsOnline = false; detailMessage.textContent = '';
    recordsUnsubscribe?.(); lastFocus = document.activeElement;
    recordsUnsubscribe = service.watchRecords(id, (next, online) => {
      if (selectedId !== id) return;
      records = next; recordsOnline = online; renderDetail();
    }, () => { recordsOnline = false; detailMessage.textContent = '繳交紀錄讀取失敗，請重新開啟。'; renderDetail(); });
    renderDetail(); dialog.showModal(); closeButton.focus();
  }
  function orderedParticipants(task) {
    const currentRoster = read('classroomStudentRoster', []);
    const current = new Map((Array.isArray(currentRoster) ? currentRoster : []).map(student => [Number(student.seat), student]));
    const layout = teacherPage && typeof window.normalizedSeatingLayout === 'function' ? window.normalizedSeatingLayout() : typeof window.getSeatingLayout === 'function' ? window.getSeatingLayout() : read('classroomSeatingLayout', []);
    const used = new Set();
    const seats = Array.from({ length: 30 }, (_, index) => {
      const seat = Number(layout?.[index]), participant = task.participants?.[seat];
      if (!participant || used.has(seat) || (current.get(seat) && String(current.get(seat).recordSince || '') !== participant.identity)) return null;
      used.add(seat); return seat;
    });
    const extra = Object.keys(task.participants || {}).map(Number).filter(seat => !used.has(seat)).sort((a, b) => a - b);
    return { seats, extra, current };
  }
  function renderDetail() {
    const task = items.find(item => item.id === selectedId);
    if (!task || (!teacherPage && task.hidden)) {
      detailTitle.textContent = '此任務目前不顯示'; detailDate.textContent = '';
      summary.replaceChildren(node('p', '', '請關閉視窗並選擇其他任務。')); grid.replaceChildren(); extraRecords.replaceChildren(); detailActions.replaceChildren(); return;
    }
    const done = seat => records[seat] && records[seat].identity === task.participants[seat]?.identity;
    const locked = D.closed(task), offline = !tasksOnline || !recordsOnline;
    const participants = Object.keys(task.participants || {}), completed = participants.filter(done).length;
    detailTitle.textContent = task.name; detailDate.textContent = `截止 ${D.formatDate(task.deadline)}（台灣時間）`;
    summary.replaceChildren(node('strong', '', locked ? '已截止 · 完成紀錄已鎖定' : '進行中'), node('p', '', `已完成 ${completed}／${participants.length} 人`));
    if (busy || offline) summary.append(node('p', '', busy ? '同步中，請稍候…' : '正在確認雲端紀錄，暫停點選'));
    detailActions.replaceChildren();
    if (teacherPage && service.isTeacher()) {
      detailActions.append(button('修改名稱／截止時間', () => editTask(task)), button(task.hidden ? '恢復學生端顯示' : '從學生端隱藏', () => hideTask(task)));
    }
    grid.replaceChildren(); extraRecords.replaceChildren();
    const { seats, extra, current } = orderedParticipants(task);
    seats.forEach(seat => {
      if (!seat) { const gap = node('div', 'deadline-student empty', '空位'); gap.setAttribute('aria-hidden', 'true'); grid.append(gap); return; }
      const participant = task.participants[seat], completedRecord = done(seat);
      const card = node(teacherPage ? 'div' : 'button', `deadline-student${completedRecord ? ' done' : ''}`);
      card.append(node('small', '', `${String(seat).padStart(2, '0')} 號`), node('strong', '', participant.name), node('small', '', completedRecord ? `已完成 ${timeLabel(records[seat].completedAt)}` : '未完成'));
      if (!teacherPage) {
        card.type = 'button'; card.setAttribute('aria-pressed', String(Boolean(completedRecord)));
        card.disabled = busy || locked || offline || !current.has(seat) || task.hidden;
        card.onclick = () => toggleRecord(task, seat);
      }
      grid.append(card);
    });
    extra.forEach(seat => {
      const participant = task.participants[seat], record = records[seat], label = node('span');
      label.append(node('strong', '', `${String(seat).padStart(2, '0')} ${participant.name}`), node('small', '', done(seat) ? `已完成 · ${D.formatDate(record.completedAt)}` : '未完成'));
      // Keep historical/removed participants visible without reassigning their identity to a new student.
      extraRecords.append(label);
    });
  }
  const timeLabel = value => Number.isFinite(D.millis(value)) ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(D.millis(value))) : '同步中';
  async function toggleRecord(task, seat) {
    if (busy || D.closed(task) || !tasksOnline || !recordsOnline) return;
    busy = true; detailMessage.textContent = '正在同步…'; renderDetail();
    try {
      await service.toggle(task.id, seat, task.participants[seat].identity);
      detailMessage.textContent = '完成狀態已同步。';
    } catch (error) {
      detailMessage.textContent = error.code === 'permission-denied' ? '此任務已截止或設定已更動，未儲存這次點選；請重新開啟查看。' : error.message || '同步失敗，請檢查網路。';
    } finally { busy = false; if (dialog.open) renderDetail(); }
  }
  async function hideTask(task) {
    if (busy || !confirm(task.hidden ? '確定恢復學生端顯示？截止時間不會變更。' : '確定從學生端隱藏？教師端仍保留完整紀錄。')) return;
    busy = true; renderDetail();
    try { await service.update(task, { hidden: !task.hidden }); detailMessage.textContent = '顯示設定已更新。'; }
    catch (error) { detailMessage.textContent = error.message || '設定未儲存，請重試。'; }
    finally { busy = false; if (dialog.open) renderDetail(); }
  }
  function editTask(task = null) {
    if (busy || !service.isTeacher()) return;
    const editor = node('dialog', `${skin} deadline-dialog deadline-form-dialog`), editorShell = node('div', 'deadline-dialog-shell');
    const title = node('h2', '', task ? '修改限時任務' : '新增限時任務'); title.id = 'deadline-form-title'; editor.setAttribute('aria-labelledby', title.id);
    const form = node('form', 'deadline-form'), nameLabel = node('label', '', '任務名稱'), name = node('input');
    name.type = 'text'; name.required = true; name.maxLength = 200; name.value = task?.name || ''; name.autocomplete = 'off';
    nameLabel.append(name);
    const dateLabel = node('label', '', '截止日期與時間（台灣時間）'), date = node('input');
    date.type = 'datetime-local'; date.required = true; date.step = '60'; date.value = task ? D.dateInput(task.deadline) : `${D.dateInput(new Date(Date.now() + 86400000)).slice(0, 10)}T12:00`; dateLabel.append(date);
    const hint = node('p', 'deadline-message', '到期即停止點選。截止後不會刪除紀錄，教師仍可查詢。');
    const status = node('p', 'deadline-message'); status.setAttribute('role', 'status');
    const actions = node('div', 'deadline-form-actions'), cancel = button('取消', () => editor.close()), save = button('儲存任務', null, 'deadline-button primary'); save.type = 'submit';
    actions.append(cancel, save); form.append(nameLabel, dateLabel, hint, status, actions); editorShell.append(title, form); editor.append(editorShell); document.body.append(editor);
    let saving = false;
    editor.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    editor.addEventListener('close', () => editor.remove());
    form.onsubmit = async event => {
      event.preventDefault(); if (saving) return;
      try {
        const nextDeadline = D.parseDeadline(date.value);
        if (task && D.closed(task) && +nextDeadline > Date.now() && !confirm('此任務已截止，延後時間會重新開放學生點選，確定繼續？')) return;
        saving = true; save.disabled = cancel.disabled = true; status.textContent = '儲存中…';
        if (task) await service.update(task, { name: name.value, deadlineInput: date.value });
        else await service.create(name.value, date.value);
        editor.close(); say(task ? '限時任務已更新。' : '限時任務已建立。');
      } catch (error) { status.textContent = error.code === 'permission-denied' ? '儲存失敗，請確認教師登入與截止時間。' : error.message || '儲存失敗，請檢查網路。'; }
      finally { saving = false; save.disabled = cancel.disabled = false; }
    };
    editor.showModal(); name.focus();
  }
  // Expiry updates locally without reload, navigation, deletion, cron jobs, or paid functions.
  setInterval(() => {
    if (!started) return;
    const nextState = items.map(task => `${task.id}:${D.closed(task)}`).join('|');
    if (nextState !== timerState) { renderList(); if (dialog.open) renderDetail(); }
  }, 1000);
  window.FirebaseClassroom?.onTeacherChanged(() => { if (dialog.open) renderDetail(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && started) { renderList(); if (dialog.open) renderDetail(); } });
  selectCategory('subjects');
}());
