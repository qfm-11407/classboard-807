// Completed scores stay on this device, separately for every game and mode.
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
  function read(game, mode) {
    const storage = key(game, mode);
    let data = cache.get(storage) || {};
    try { const raw = localStorage.getItem(storage); if (raw !== null || !memoryOnly.has(storage)) data = JSON.parse(raw || '{}'); } catch { /* Storage can be disabled; use the in-memory records. */ }
    if (!data || typeof data !== 'object') data = {};
    return { top:sort(Array.isArray(data.top) ? data.top.filter(valid) : []), today:Array.isArray(data.today) ? data.today.filter(valid).filter(row => row.date === day()) : [] };
  }
  function record(game, mode, score, options = {}) {
    if (!Number.isFinite(score)) return false;
    const time = Date.now(), date = day(time), data = read(game, mode);
    const id = options.id ? `${date}:${options.id}` : `${time}:${Math.random().toString(36).slice(2)}`;
    const row = { id, date, time, score, label:String(options.label || '').slice(0,40) };
    data.top = sort([...data.top.filter(item => item.id !== id), row]);
    data.today = sort([...data.today.filter(item => item.id !== id), row]);
    cache.set(key(game, mode), data);
    try { localStorage.setItem(key(game, mode), JSON.stringify(data)); memoryOnly.delete(key(game, mode)); } catch { memoryOnly.add(key(game, mode)); /* Never interrupt a game for a storage failure. */ }
    listeners.forEach(listener => listener());
    return true;
  }
  function dailyBest(game, mode) { return read(game, mode).today[0]?.score ?? null; }
  function increment(game, mode, participant, label) {
    const id = `${day()}:${participant}`;
    const score = (read(game, mode).today.find(row => row.id === id)?.score || 0) + 1;
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
  window.addEventListener('storage', event => { if (!event.key || event.key.startsWith('classroom-game-ranking-v1:')) listeners.forEach(listener => listener()); });
  document.addEventListener('visibilitychange', () => listeners.forEach(listener => listener()));
  // A page left open overnight updates "today" without reloading or clearing history.
  setInterval(() => listeners.forEach(listener => listener()), 30000);
  window.ClassroomGameScores = { day, read, record, dailyBest, increment, attach };
})();
