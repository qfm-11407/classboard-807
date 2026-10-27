import { InkPad } from './canvas.js';
import { client, GASClient, saveBackend } from './transport.js';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const studentId = p => escape(p.studentId || '');
const storage = { get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} } };
let toastTimer, offset = 0, liveState = null;
function toast(message, error = false) { if (!$('toast')) return; $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
async function api(url,data,token) { return client.request(url,data,token); }
function connect(code,receive) {
  return client.subscribe(code,state=>{offset=state.serverTime-Date.now();liveState=state;receive(state);},(ok,message)=>{connection(ok);if(!ok&&message)toast(message,true);},document.body.dataset.page==='screen');
}
function connection(connected) { const el = $('connection'); if (!el) return; el.textContent = connected ? '已連線' : '重新連線中'; el.className = `connection ${connected ? 'connected' : 'offline'}`; }
function remaining(round) { return round?.phase === 'writing' ? Math.max(0, Math.ceil((round.deadline - Date.now() - offset) / 1000)) : null; }
function timerText(round) { const left = remaining(round); return left !== null ? String(left).padStart(2, '0') : round?.phase === 'revealed' ? '✓' : round?.phase === 'closed' ? '00' : '—'; }
function phaseLabel(round) { return !round ? '等待出題' : ({ writing:'作答進行中', closed:'作答已截止', revealed:'結果已揭曉' })[round.phase]; }
function rankRows(players, max = 60) {
  return [...players].sort((a, b) => b.score - a.score || a.studentId.localeCompare(b.studentId, 'en', { numeric: true })).slice(0, max).map((p, i) => `<div class="rank-row"><span class="rank-number">${i + 1}</span><span class="rank-name"><small>${studentId(p)}</small>${escape(p.name)}</span><strong>${p.score}<small>分</small></strong></div>`).join('') || '<p class="list-empty">參賽者加入後顯示排名</p>';
}
function bindDialogs() {
  document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
}
bindDialogs();
const page = document.body.dataset.page;

if (page === 'teacher') {
  let room, admin, refreshing = false, bank = [], previousPhase, workers = 0;
  function pumpWorkers() { if (!room?.round?.pending) return; const count=Math.min(admin.settings.concurrency,room.round.pending); while(workers<count) { workers++; client.rpc('worker',{room:room.code}).catch(error=>toast(error.message,true)).finally(()=>{workers--;}); } }
  $('help-button').onclick = () => $('help-dialog').showModal();
  async function refresh() {
    if (!client.backend || !client.token || refreshing) return; refreshing = true;
    try {
      const data = await api('/api/admin/state'); admin = data;
      $('login-panel').hidden = true; $('teacher-app').hidden = false; $('settings-button').hidden = false;
      if (!bank.length) { bank = data.questions; $('question-bank').innerHTML = '<option value="custom">自行出題</option>' + bank.map((q, i) => `<option value="${i}">${String(i + 1).padStart(2,'0')}　${escape(q.prompt)}</option>`).join(''); $('question-bank').value = '0'; fillQuestion(0); }
      $('key-status').textContent = data.settings.configured ? '已設定金鑰（不顯示內容）' : '尚未設定 API 金鑰';
      room = data.room; liveState = room; if (room) offset = room.serverTime - Date.now(); renderTeacher(); pumpWorkers();
    } catch (error) { if (error.status === 401) { client.token=''; $('login-error').textContent=error.message; $('login-panel').hidden = false; $('teacher-app').hidden = true; $('settings-button').hidden = true; } else toast(error.message, true); }
    finally { refreshing = false; }
  }
  function fillQuestion(index) { const q = bank[index]; if (!q) return; $('question-prompt').value = q.prompt; $('answer').value = q.answer; $('seconds').value = q.seconds; $('accepted').value = ''; }
  function renderTeacher() {
    $('welcome-panel').hidden = Boolean(room); $('room-dashboard').hidden = !room; if (!room) return;
    const round = room.round, writing = round?.phase === 'writing', ready = !round || round.phase === 'revealed';
    $('practice-banner').hidden = room.mode !== 'practice'; $('room-title').textContent = room.title; $('room-code').textContent = room.code;
    $('open-screen').href = client.pageURL('screen.html',room.code); $('open-play').href = client.pageURL('student.html',room.code); $('export-link').href = '#';
    updateJoinLink();
    $('round-label').textContent = round ? `第 ${round.number} 題` : '尚未開始'; $('phase-pill').textContent = phaseLabel(round); $('phase-pill').className = `pill ${writing ? 'active-pill' : 'neutral'}`;
    $('teacher-countdown').textContent = timerText(round); $('submitted-count').textContent = `${round?.submitted || 0} / ${room.players.length}`; $('judged-count').textContent = round?.judged || 0; $('player-count').textContent = `${room.players.length} 人`;
    $('close-button').disabled = !writing; $('reveal-button').disabled = !round || round.phase !== 'closed' || round.pending > 0; $('retry-button').hidden = !round || !round.unresolved || round.phase === 'revealed';
    $('start-button').disabled = !ready || !room.players.length; $('start-button').textContent = round?.phase === 'revealed' ? '開始下一題 →' : '開始作答 →';
    ['question-bank','question-prompt','answer','seconds','accepted'].forEach(id => { $(id).disabled = !ready; });
    document.querySelectorAll('[data-step]').forEach(el => el.classList.toggle('current', el.dataset.step === round?.phase));
    $('judge-summary').textContent = !round ? '交卷後即在背景判讀，結果暫時隱藏。' : round.pending ? `${round.pending} 份正在排隊或判讀中，${round.judged} 份已完成。` : round.unresolved ? `${round.unresolved} 份未完成判讀，可先重試；揭曉後這些答案標示「無法判定」，不判錯。` : round.phase === 'revealed' ? '結果已揭曉並計分，可準備下一題。' : round.submitted ? '目前交卷均已判讀完成，截止後即可揭曉。' : '等待參賽者交卷。';
    const status = { uploading:'保存中', 'upload-error':'上傳待重試', queued:'排隊', judging:'判讀中', done:'已判讀', error:'判讀失敗', uncertain:'辨識不明', waiting:'待交卷' };
    $('teacher-players').innerHTML = room.players.map(p => `<div class="player-chip ${p.submitted ? 'submitted' : ''}" title="${escape(p.error)}"><span class="seat-number">${studentId(p)}</span><span class="player-name">${escape(p.name)}</span><span class="player-status ${p.judgeStatus === 'error' ? 'failed' : ''}">${round?.phase === 'revealed' && p.status === 'done' ? p.correct ? '✓' : '✗' : status[p.judgeStatus] || '待交卷'}</span></div>`).join('') || '<p class="list-empty">分享平板網址，等待第一位參賽者加入。</p>';
    $('leaderboard').innerHTML = rankRows(room.players, 8); const u = room.usage;
    $('usage-info').textContent = room.mode === 'practice' ? '流程演練・API 用量為 0' : `${u.calls} 次有效判讀回應 · 輸入 ${u.input.toLocaleString()} / 輸出 ${u.output.toLocaleString()} tokens`;
    if (round?.phase === 'revealed' && previousPhase && previousPhase !== 'revealed') { const index = Number($('question-bank').value); if (Number.isInteger(index) && bank[index + 1]) { $('question-bank').value = String(index + 1); fillQuestion(index + 1); } }
    previousPhase = round?.phase;
  }
  function updateJoinLink() { if (room) $('join-url').value = client.pageURL('student.html',room.code); }
  $('export-link').onclick=async event=>{event.preventDefault();if(!room)return;try{const result=await api(`/api/admin/rooms/${room.code}/export`);const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=result.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message,true);}};
  $('question-bank').onchange = event => { if (event.target.value !== 'custom') fillQuestion(Number(event.target.value)); };
  async function login(pin) { await api('/api/login', { pin }); $('pin').value = ''; $('login-error').textContent = ''; await refresh(); }
  $('login-form').onsubmit = async event => { event.preventDefault(); try { await login($('pin').value); } catch (error) { $('login-error').textContent = error.message; } };
  refresh();
  if(!client.backend)$('login-error').textContent='請先回首頁設定 GAS 後端連線。';
  const createDialog = () => { $('room-dialog').showModal(); $('new-mode').value = admin?.settings.configured ? 'live' : 'practice'; updateModeNote(); };
  $('new-room-button').onclick = createDialog; $('welcome-create').onclick = createDialog;
  function updateModeNote() { const live = $('new-mode').value === 'live'; $('mode-note').textContent = live ? 'AI 會自動判定單字對錯，使用您的 API 額度。' : '演練不辨識筆跡，對錯為預設測試結果。'; $('mode-note').className = `notice ${live ? '' : 'amber'}`; }
  $('new-mode').onchange = updateModeNote;
  $('room-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/admin/rooms', { title: $('new-title').value, mode: $('new-mode').value }); $('room-dialog').close(); previousPhase = undefined; await refresh(); toast('房間已建立，請讓平板加入'); } catch (error) { toast(error.message, true); } };
  $('settings-button').onclick = () => { $('api-model').value = admin.settings.model; $('concurrency').value = admin.settings.concurrency; $('settings-dialog').showModal(); };
  $('settings-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/admin/settings', { key: $('api-key').value.trim(), model: $('api-model').value.trim(), concurrency: Number($('concurrency').value) }); $('api-key').value = ''; $('settings-dialog').close(); await refresh(); toast('AI 設定已套用；可建立 AI 正式比賽'); } catch (error) { toast(error.message, true); } };
  $('question-form').onsubmit = async event => {
    event.preventDefault(); if (!room) return;
    try { await api(`/api/admin/rooms/${room.code}/start`, { prompt: $('question-prompt').value, answer: $('answer').value.trim(), seconds: Number($('seconds').value), accepted: $('accepted').value.split(/[,，、\s]+/).filter(Boolean) }); await refresh(); }
    catch (error) { toast(error.message, true); }
  };
  for (const action of ['close','reveal','retry']) $(action + '-button').onclick = async () => { if (!room) return; try { $(action + '-button').disabled = true; await api(`/api/admin/rooms/${room.code}/${action}`, {}); await refresh(); } catch (error) { toast(error.message, true); renderTeacher(); } };
  $('copy-link').onclick = async () => { const url = $('join-url').value; try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(url); toast('已複製平板作答網址'); } catch { $('join-url').focus(); $('join-url').select(); toast('已選取網址，請按 Ctrl+C 或長按複製'); } };
  setInterval(refresh, 3500); setInterval(() => { if (room) $('teacher-countdown').textContent = timerText(room.round); }, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

if (page === 'play') {
  const params = new URLSearchParams(location.search), code = params.get('room')?.toUpperCase() || '';
  $('join-code').value = code;
  if(!client.backend)$('join-error').textContent='請使用教師分享的完整作答網址，或回首頁設定 GAS 後端。';
  let identity = null, stream = null, state = null, activeRound = null, submitted = false, sending = false;
  let pad; pad = new InkPad($('handwriting'), () => { if (!pad) return; $('canvas-hint').hidden = pad.strokes.length > 0; if (state?.round && identity) storage.set(`oneword:${client.backend}:draft:${state.code}`, { round: activeRound, strokes: pad.strokes }); });
  function renderPlay(next) {
    state = next; const round = state.round, own = state.players.find(p => p.id === identity?.player.id);
    if (!own) return;
    if (activeRound !== round?.id) {
      activeRound = round?.id; const draft = storage.get(`oneword:${client.backend}:draft:${state.code}`); pad.clear();
      if (draft && draft.round === activeRound && Array.isArray(draft.strokes)) { pad.strokes = draft.strokes; pad.render(); }
    }
    submitted = own.submitted;
    $('play-practice').hidden = state.mode !== 'practice'; $('player-identity').textContent = `學號 ${own.studentId} · ${own.name}`; $('play-room').textContent = `房號 ${state.code}`;
    $('play-round').textContent = round ? `第 ${String(round.number).padStart(2,'0')} 題 · 只寫一個字` : '等待教師出題'; $('play-prompt').textContent = round?.prompt || '好好握筆，準備上場。';
    $('play-countdown').textContent = timerText(round);
    const writing = round?.phase === 'writing' && remaining(round) > 0;
    pad.enabled = Boolean(writing && !submitted && !sending); $('submit-button').disabled = !pad.enabled;
    ['undo','eraser','clear'].forEach(id => { $(id).disabled = !pad.enabled; });
    const lock = !writing || submitted;
    $('canvas-lock').hidden = !lock;
    $('lock-symbol').textContent = !round ? '✦' : submitted ? '✓' : '⌛';
    $('lock-message').textContent = !round ? '等待出題' : submitted ? '已交卷' : '作答已截止';
    $('lock-detail').textContent = !round ? '教師開始後，就可以在這裡寫字。' : submitted ? '答案已鎖定，等待統一揭曉。' : '本題沒有送出答案，等待下一題。';
    $('write-state').textContent = !round ? '等待開始' : submitted ? '答案已送出' : writing ? '作答中' : '已截止';
    $('submit-button').textContent = sending ? '正在送出…' : submitted ? '✓ 已送出答案' : '送出答案 →';
    $('own-result').hidden = round?.phase !== 'revealed';
    if (round?.phase === 'revealed') {
      const done = own.status === 'done';
      $('own-result').textContent = !own.submitted ? '本題未交卷' : done ? own.correct ? `✓ 答對了！＋${state.points} 分` : '✗ 本題答錯' : '無法判定';
      $('own-result').className = `own-result ${done && !own.correct ? 'wrong' : ''}`;
      $('lock-message').textContent = '本題已揭曉'; $('lock-detail').textContent = '等待教師開始下一題。';
    }
  }
  async function join(data) {
    const result = await api('/api/join', data); identity = result; storage.set(`oneword:${client.backend}:player:${data.room}`, result);
    $('join-panel').hidden = true; $('writing-panel').hidden = false; if (stream) stream.close(); stream = connect(data.room, renderPlay);
    history.replaceState(null, '', client.pageURL('student.html',data.room));
  }
  $('join-form').onsubmit = async event => { event.preventDefault(); try { const room = $('join-code').value.trim().toUpperCase(); await join({ room, studentId: $('join-student-id').value.trim(), name: $('join-name').value }); } catch (error) { $('join-error').textContent = error.message; } };
  const saved = storage.get(`oneword:${client.backend}:player:${code}`);
  if (saved?.token) join({ room: code, token: saved.token }).catch(error => { $('join-error').textContent = error.message; });
  $('undo').onclick = () => pad.undo(); $('clear').onclick = () => { if (pad.enabled) pad.clear(); };
  $('eraser').onclick = () => { pad.eraser = !pad.eraser; $('eraser').setAttribute('aria-pressed', String(pad.eraser)); $('eraser').textContent = pad.eraser ? '✎ 改用黑筆' : '▱ 橡皮擦'; };
  $('submit-button').onclick = async () => {
    if (!pad.enabled || sending || submitted) return;
    if (!pad.hasInk()) return toast('請先在格內寫一個字', true);
    const roundId = state.round.id, image = pad.export(); sending = true; renderPlay(state);
    try { await api('/api/submit', { room: state.code, roundId, image }, identity.token); submitted = true; client.rpc('studentWorker',{room:state.code,roundId},identity.token).catch(()=>{}); toast('圖片已保存，等待統一揭曉'); }
    catch (error) { toast(error.message, true); }
    finally { sending = false; try { const latest = await api(`/api/room?room=${state.code}`); liveState = latest; renderPlay(latest); } catch { renderPlay(state); } }
  };
  setInterval(() => { if (!state?.round) return; $('play-countdown').textContent = timerText(state.round); $('play-countdown').classList.toggle('urgent', remaining(state.round) !== null && remaining(state.round) <= 5); if (state.round.phase === 'writing' && remaining(state.round) === 0) { pad.enabled = false; $('submit-button').disabled = true; ['undo','eraser','clear'].forEach(id => { $(id).disabled = true; }); $('write-state').textContent = '時間到'; } }, 200);
}

if (page === 'screen') {
  const code = new URLSearchParams(location.search).get('room')?.toUpperCase(); let state, rankings = false;
  const render = next => {
    state = next; const round = state.round, shown = round && round.phase !== 'writing', revealed = round?.phase === 'revealed';
    $('screen-practice').hidden = state.mode !== 'practice'; $('screen-mode').textContent = state.mode === 'practice' ? '流程演練' : 'AI 正式判讀';
    $('screen-room').textContent = state.code; $('screen-title').textContent = state.title; $('screen-round').textContent = round ? `第 ${String(round.number).padStart(2,'0')} 題` : '等待參賽者加入';
    $('screen-phase').textContent = phaseLabel(round); $('screen-prompt').textContent = round?.prompt || '每一筆，都是你的實力。'; $('screen-countdown').textContent = timerText(round);
    $('screen-timer-label').textContent = !round ? '準備落筆' : round.phase === 'writing' ? '秒後截止' : round.phase === 'closed' ? '作答已截止' : '結果已揭曉';
    $('screen-subtitle').textContent = revealed ? `本題正解：${round.answer}` : shown ? '全班的筆跡已到齊。等待教師統一揭曉對錯。' : round ? '只寫一個字，寫好後請在平板按下送出。' : '請在平板開啟作答頁，輸入房號加入。';
    $('screen-progress').textContent = round ? `${round.submitted} / ${state.players.length} 人已交卷` : `${state.players.length} 人已加入`;
    $('screen-footer-hint').textContent = revealed ? '答對加 10 分 · 原始筆跡保留' : shown ? '點選筆跡圖片，可以放大查看' : '作答期間不公開筆跡與結果';
    $('screen-grid').innerHTML = state.players.map(p => {
      const done = revealed && p.status === 'done', correct = done && p.correct;
      const paper = shown && p.imageUrl ? `<img src="${p.imageUrl}" alt="${studentId(p)} 的手寫答案" data-image="${p.imageUrl}" data-label="${escape(`${studentId(p)} · ${p.name}`)}">` : shown ? '<span class="empty-ink">未交卷</span>' : `<div class="paper-state"><b>${p.submitted ? '✓' : '✎'}</b><span>${p.submitted ? '已交卷・答案保密' : round ? '專心作答中' : '準備就緒'}</span></div>`;
      return `<article class="answer-card ${revealed ? 'revealed' : ''} ${done ? correct ? 'correct' : 'wrong' : ''}"><div class="answer-card-head"><span class="answer-seat">${studentId(p)}</span><span class="answer-name">${escape(p.name)}</span><span class="answer-score">${p.score} 分</span></div><div class="answer-paper">${paper}</div><div class="answer-foot"><span>${revealed ? done ? correct ? '+10 分' : '+0 分' : p.submitted ? '無法判定' : '未交卷' : shown ? '等待揭曉' : p.submitted ? '答案已鎖定' : '一人一字'}</span><span class="${done ? 'answer-verdict' : 'pending-verdict'}">${done ? correct ? '✓' : '✗' : revealed && p.submitted ? '—' : '·'}</span></div></article>`;
    }).join('') || '<div class="screen-empty"><span>筆</span><h2>擂台已準備就緒</h2><p>參賽者加入後，會依座號出現在這裡。</p></div>';
    $('screen-ranking').innerHTML = rankRows(state.players); $('screen-grid').hidden = rankings; $('screen-ranking').hidden = !rankings;
  };
  if (code) connect(code, render); else { $('screen-subtitle').textContent = '請從教師控制台按「開啟大螢幕」進入。'; connection(false); }
  $('ranking-toggle').onclick = () => { rankings = !rankings; $('ranking-toggle').textContent = rankings ? '回到答案牆 ↗' : '查看排行榜 ↗'; if (state) render(state); };
  $('fullscreen-button').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('此瀏覽器無法啟用全螢幕'); } };
  $('screen-grid').onclick = event => { const img = event.target.closest('[data-image]'); if (!img) return; $('enlarged-image').src = img.dataset.image; $('enlarged-label').textContent = img.dataset.label; $('image-dialog').showModal(); };
  setInterval(() => { if (state) { $('screen-countdown').textContent = timerText(state.round); $('screen-countdown').classList.toggle('urgent', remaining(state.round) !== null && remaining(state.round) <= 5); } }, 200);
}

if(page==='home') {
  $('backend-url').value=client.backend; $('site-origin').textContent=location.origin;
  const entryLinks=Array.from(document.querySelectorAll('a[href="./teacher.html"],a[href="./student.html"]'),a=>({node:a,file:a.getAttribute('href').includes('teacher')?'teacher.html':'student.html'}));
  function updateEntryLinks(){entryLinks.forEach(item=>{item.node.href=client.pageURL(item.file);});}
  updateEntryLinks();
  $('backend-form').onsubmit=async event=>{event.preventDefault();const button=$('backend-form').querySelector('button');button.disabled=true;let tester;try{const url=saveBackend($('backend-url').value.trim());tester=new GASClient(url);$('backend-status').textContent='正在連接 GAS…';await tester.rpc('ping',{},'',0);$('backend-status').textContent='連線成功。現在可以進入教師控制台或學生作答頁。';client.dispose();client.backend=url;updateEntryLinks();}catch(error){$('backend-status').textContent=error.message;}finally{tester?.dispose();button.disabled=false;}};
}
