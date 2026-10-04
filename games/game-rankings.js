// Shared classroom rankings with local backup and reconnect-safe uploads.
(() => {
  const listeners = new Set();
  const dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' });
  const day = (time = Date.now()) => {
    const parts = dateFormatter.formatToParts(new Date(time));
    const get = type => parts.find(part => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  const cache = new Map();
  const memoryOnly = new Set();
  const key = (game, mode) => `classroom-game-ranking-v1:${game}:${mode}`;
  const valid = row => row && Number.isFinite(row.score) && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && typeof row.id === 'string' && Number.isFinite(row.time);
  const sort = rows => [...rows].sort((a,b) => b.score - a.score || a.time - b.time).slice(0,10);
  const notify = () => listeners.forEach(listener => listener());
  const cloudStates = new Map();
  const queueKey = 'classroom-game-ranking-pending-v1';
  let device, pending = [], sending = false;
  try { device = localStorage.getItem('classroom-game-ranking-device-v1'); pending = JSON.parse(localStorage.getItem(queueKey) || '[]'); } catch { /* Memory backup still works. */ }
  if (!device || !/^[a-zA-Z0-9_-]{8,80}$/.test(device)) {
    device = `d${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem('classroom-game-ranking-device-v1',device); } catch { /* No persistent storage. */ }
  }
  const allowedBucket = bucket => /^(mole-pop|moving-dot)-(30|60|90)$/.test(bucket) || bucket === 'tic-tac-toe-wins';
  if (!Array.isArray(pending)) pending = [];
  pending = pending.filter(item => item && allowedBucket(item.bucket) && valid(item.row) && typeof item.row.client === 'string');
  const saveQueue = (acknowledged = null) => {
    try {
      const stored = JSON.parse(localStorage.getItem(queueKey) || '[]');
      const merged = new Map();
      for (const item of [...(Array.isArray(stored) ? stored : []),...pending]) {
        if (!item || !allowedBucket(item.bucket) || !valid(item.row) || typeof item.row.client !== 'string') continue;
        const id = `${item.bucket}/${item.row.id}`, previous = merged.get(id);
        if (!previous || !item.row.participant || previous.row.score <= item.row.score) merged.set(id,item);
      }
      if (acknowledged) {
        const id = `${acknowledged.bucket}/${acknowledged.row.id}`, item = merged.get(id);
        if (item && item.row.score <= acknowledged.row.score) merged.delete(id);
      }
      pending = [...merged.values()];
      localStorage.setItem(queueKey,JSON.stringify(pending));
      return true;
    } catch { return false; /* Keep pending scores in memory. */ }
  };
  const enqueue = (bucket,row) => {
    const participant = bucket === 'tic-tac-toe-wins' ? (row.participant || row.id.match(/^\d{4}-\d{2}-\d{2}:([0-3]:[OX])$/)?.[1] || '') : '';
    const upload = { ...row, participant, id:`${device}_${row.id.replace(/[^a-zA-Z0-9:_-]/g,'_')}`, client:device };
    const existing = pending.find(item => item.bucket === bucket && item.row.id === upload.id);
    if (existing) existing.row = upload; else pending.push({ bucket,row:upload });
    return saveQueue();
  };
  async function flush() {
    if (sending || !window.ClassroomGameCloud || !pending.length) return;
    sending = true;
    try {
      while (pending.length) {
        const item = pending[0], row = item.row, itemBucket = item.bucket;
        try {
          await window.ClassroomGameCloud.write(item.bucket,row);
          // A new OX win may replace this row while its older score is uploading.
          const index = pending.findIndex(item => item.bucket === itemBucket && item.row.id === row.id && item.row.score <= row.score);
          if (index >= 0) pending.splice(index,1);
          saveQueue({ bucket:itemBucket,row });
          const state = cloudStates.get(item.bucket); if (state) state.error = false;
        } catch {
          const state = cloudStates.get(item.bucket); if (state) state.error = true;
          break;
        }
      }
    } finally { sending = false; notify(); }
  }
  function localRead(game, mode) {
    const storage = key(game, mode);
    let data = cache.get(storage) || {};
    try { const raw = localStorage.getItem(storage); if (raw !== null || !memoryOnly.has(storage)) data = JSON.parse(raw || '{}'); } catch { /* Storage can be disabled; use the in-memory records. */ }
    if (!data || typeof data !== 'object') data = {};
    return { top:sort(Array.isArray(data.top) ? data.top.filter(valid) : []), today:Array.isArray(data.today) ? data.today.filter(valid).filter(row => row.date === day()) : [] };
  }
  function cloudState(game,mode) {
    const transport = window.ClassroomGameCloud, bucket = `${game}-${mode}`;
    if (!transport || !allowedBucket(bucket)) return null;
    let state = cloudStates.get(bucket);
    if (!state) {
      state = { top:[], today:[], ready:false, error:false, date:'' };
      cloudStates.set(bucket,state);
      // Import only dated local records; identical IDs make repeated attempts safe.
      const marker = `classroom-game-ranking-imported-v1:${bucket}`;
      try {
        if (!localStorage.getItem(marker)) {
          const local = localRead(game,mode), unique = new Map([...local.top,...local.today].map(row => [row.id,row]));
          let saved = true;
          unique.forEach(row => { if (!enqueue(bucket,row)) saved = false; });
          if (saved) localStorage.setItem(marker,'1');
        }
      } catch { /* Storage can be disabled. New scores still upload. */ }
    }
    if (state.date !== day()) {
      state.stop?.(); state.date = day(); state.today = []; state.ready = false;
      const date = state.date;
      state.stop = transport.watch(bucket,date,update => {
        if (state.date !== date) return;
        Object.assign(state,update); notify();
      });
      void flush();
    }
    return state;
  }
  function read(game,mode) {
    const local = localRead(game,mode), state = cloudState(game,mode);
    if (!state) return local;
    const waiting = pending.filter(item => item.bucket === `${game}-${mode}`).map(item => item.row);
    const merge = (rows,today = false) => sort([...new Map([...rows,...waiting].filter(valid).filter(row => !today || row.date === day()).map(row => [row.id,row])).values()]);
    if (!state.ready) return { top:merge([...state.top,...local.top.map(row => ({...row,id:`${device}_${row.id}`}))]), today:merge([...state.today,...local.today.map(row => ({...row,id:`${device}_${row.id}`}))],true) };
    return { top:merge(state.top), today:merge(state.today,true) };
  }
  function syncNote(game,mode) {
    const state = cloudState(game,mode);
    if (!state) return '紀錄保存在此裝置';
    if (state.error) return '暫無法同步 · 本機保留，稍後重試';
    if (pending.some(item => item.bucket === `${game}-${mode}`)) return '成績同步中…';
    return state.ready ? '雲端已同步 · 跨裝置共用' : '讀取雲端排行中…';
  }
  function record(game, mode, score, options = {}) {
    if (!Number.isFinite(score)) return false;
    const time = Date.now(), date = day(time), data = localRead(game, mode);
    const id = options.id ? `${date}:${options.id}` : `${time}:${Math.random().toString(36).slice(2)}`;
    const row = { id, date, time, score, label:String(options.label || '').slice(0,40), participant:String(options.id || '') };
    data.top = sort([...data.top.filter(item => item.id !== id), row]);
    data.today = sort([...data.today.filter(item => item.id !== id), row]);
    cache.set(key(game, mode), data);
    try { localStorage.setItem(key(game, mode), JSON.stringify(data)); memoryOnly.delete(key(game, mode)); } catch { memoryOnly.add(key(game, mode)); /* Never interrupt a game for a storage failure. */ }
    if (cloudState(game,mode)) { enqueue(`${game}-${mode}`,row); void flush(); }
    notify();
    return true;
  }
  function dailyBest(game, mode) { return read(game, mode).today[0]?.score ?? null; }
  function increment(game, mode, participant, label) {
    const id = `${day()}:${participant}`;
    const score = (localRead(game, mode).today.find(row => row.id === id)?.score || 0) + 1;
    record(game, mode, score, { id:participant, label });
    return score;
  }
  function attach({ trigger, game, mode, title, modeLabel, unit = '分', beforeOpen = () => {}, onChange = () => {} }) {
    if (!trigger) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'game-rank-dialog';
    const headingId = `game-ranking-title-${game}`;
    dialog.setAttribute('aria-labelledby', headingId);
    dialog.innerHTML = `<div class="game-rank-head"><div><h2 id="${headingId}"></h2><p class="game-rank-mode"></p></div><button type="button" class="game-rank-close" aria-label="關閉排行榜" autofocus>✕</button></div><ol class="game-rank-list"></ol><p class="game-rank-note">歷史前十名 · 台灣日期 · 紀錄保存在此裝置</p>`;
    const list = dialog.querySelector('.game-rank-list');
    const render = () => {
      onChange();
      if (!dialog.open) return;
      dialog.querySelector('h2').textContent = `${title}｜前十名`;
      dialog.querySelector('.game-rank-mode').textContent = modeLabel();
      dialog.querySelector('.game-rank-note').textContent = `歷史前十名 · 台灣日期 · ${syncNote(game,mode())}`;
      list.replaceChildren();
      const rows = read(game, mode()).top;
      if (!rows.length) {
        const empty = document.createElement('li');
        empty.className = 'game-rank-empty'; empty.textContent = '尚無成績，完成一局後即可登榜。'; list.append(empty);
      }
      rows.forEach((row, index) => {
        const li = document.createElement('li');
        li.className = 'game-rank-row';
        const rank = document.createElement('span'); rank.className = 'game-rank-number'; rank.textContent = String(index + 1).padStart(2,'0');
        const content = document.createElement('span'); content.className = 'game-rank-value';
        const score = document.createElement('strong'); score.textContent = `${row.score} ${unit}`;
        const date = document.createElement('span'); date.className = 'game-rank-date'; date.textContent = `（${row.date.replaceAll('-','/')}）`;
        content.append(score,date);
        if (row.label) { const label = document.createElement('small'); label.textContent = row.label; content.append(label); }
        li.append(rank,content); list.append(li);
      });
    };
    trigger.addEventListener('click', () => {
      beforeOpen();
      if (!dialog.open) dialog.showModal();
      render();
    });
    dialog.querySelector('.game-rank-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => trigger.focus({ preventScroll:true }));
    // The dialog is inside the game so it also works in browser fullscreen.
    (document.getElementById('game') || document.body).append(dialog);
    listeners.add(render);
    return dialog;
  }
  window.addEventListener('storage', event => {
    if (event.key === queueKey) { saveQueue(); void flush(); }
    if (!event.key || event.key.startsWith('classroom-game-ranking-v1:') || event.key === queueKey) notify();
  });
  document.addEventListener('visibilitychange', () => { notify(); void flush(); });
  window.addEventListener('online', () => { void flush(); });
  // A page left open overnight updates "today" without reloading or clearing history.
  setInterval(() => { notify(); void flush(); }, 30000);
  window.ClassroomGameScores = { day, read, record, dailyBest, increment, attach };
})();
