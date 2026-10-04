const $ = (id) => document.getElementById(id);
const field = $('field');
const arena = $('arena');
const overlay = $('overlay');
// Color-decoy rounds keep separate records; all previous records are preserved.
const storageKey = 'classroom-mole-pop-best-v3';
const random = (min, max) => min + Math.random() * (max - min);
const modes = {
  30: { name: '簡易', reward: 1, penalty: 0, decoyRate: .2, capacity: 1, lifetime: [1.7, 2.5], decoyLifetime: [2.7, 3.6], spawn: [.9, 1.25], hitDelay: .28 },
  60: { name: '正常', reward: 2, penalty: 1, decoyRate: .25, capacity: 2, lifetime: [1.15, 1.75], decoyLifetime: [1.9, 2.7], spawn: [.55, .8], hitDelay: .22 },
  90: { name: '挑戰', reward: 1, penalty: 2, decoyRate: .35, capacity: 3, lifetime: [.7, 1.15], decoyLifetime: [1.3, 1.9], spawn: [.28, .48], hitDelay: .16 },
};
const moleArt = `<svg class="mole-character" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <circle cx="24" cy="37" r="12" fill="var(--mole-ear, #a76f46)"/><circle cx="76" cy="37" r="12" fill="var(--mole-ear, #a76f46)"/>
  <circle cx="24" cy="37" r="7" fill="#e8ad91"/><circle cx="76" cy="37" r="7" fill="#e8ad91"/>
  <path d="M18 100V59C18 11 82 11 82 59V100Z" fill="var(--mole-body, #bc8858)"/>
  <path d="M30 98V65C30 36 70 36 70 65V98Z" fill="var(--mole-face, #edc698)"/>
  <ellipse cx="32" cy="62" rx="8" ry="5" fill="#e9a38a"/><ellipse cx="68" cy="62" rx="8" ry="5" fill="#e9a38a"/>
  <ellipse cx="37" cy="51" rx="4" ry="5" fill="#32251f"/><ellipse cx="63" cy="51" rx="4" ry="5" fill="#32251f"/>
  <circle cx="38" cy="49" r="1.3" fill="#fff"/><circle cx="64" cy="49" r="1.3" fill="#fff"/>
  <ellipse cx="50" cy="62" rx="8" ry="6" fill="#694638"/>
  <path d="M50 68V72M40 72Q50 81 60 72" fill="none" stroke="#694638" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M37 29Q46 19 58 26" fill="none" stroke="var(--mole-face, #edc698)" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="23" cy="92" rx="12" ry="7" fill="var(--mole-feet, #d8a373)"/><ellipse cx="77" cy="92" rx="12" ry="7" fill="var(--mole-feet, #d8a373)"/>
</svg>`;

const holes = Array.from({ length: 30 }, (_, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mole-hole';
  button.dataset.index = index;
  button.innerHTML = `<span class="hole-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span class="mole-clip">${moleArt}</span><span class="mole-warning" aria-hidden="true">−</span>`;
  button.setAttribute('aria-label', `洞口 ${index + 1}，空洞`);
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    hit(index);
  });
  button.addEventListener('click', (event) => { if (event.detail === 0) hit(index); });
  field.append(button);
  return button;
});

let records = {};
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) records = saved;
} catch { /* Storage is optional. */ }

let state = 'ready';
let duration = 60;
let mode = modes[duration];
let score = 0;
let hits = 0;
let errors = 0;
let wrongMoles = 0;
let misses = 0;
let elapsed = 0;
let remaining = duration;
let nextSpawn = 0;
let previousHole = -1;
let lastTime = 0;
let frame = 0;
const active = new Map();
const effects = new Map();

function best() {
  const value = records[duration];
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

function updateStats() {
  $('score').textContent = score;
  $('score').dataset.negative = String(score < 0);
  $('time').textContent = Math.max(0, Math.ceil(remaining));
  $('mode').textContent = mode.name;
  $('best').textContent = best();
  $('misses').textContent = `命中 ${hits} · 打空 ${errors} · 誤打 ${wrongMoles} · 漏掉 ${misses}`;
  $('target-rules').textContent = `棕色可打 +${mode.reward}`;
  $('decoy-rules').textContent = `紅色避開${mode.penalty ? ` −${mode.penalty}` : ' · 不加分'}`;
  $('rules').textContent = `${mode.name} · ${mode.penalty ? `打空或誤打紅色 −${mode.penalty}` : '打空與誤打紅色都不扣分'}`;
  $('mode-rules').textContent = `${mode.name}：棕色 +${mode.reward} 分，${mode.penalty ? `打空或紅色 −${mode.penalty} 分` : '打空不扣分，紅色不加分也不扣分'}`;
}

function removeMole(index) {
  active.delete(index);
  holes[index].classList.remove('up');
  holes[index].setAttribute('aria-label', `洞口 ${index + 1}，空洞`);
}

function spawnMole(forceRegular = false) {
  if (active.size >= mode.capacity) return;
  // A just-hit hole keeps its star briefly; new moles use other available holes.
  const available = holes.map((_, index) => index).filter(index => !active.has(index) && !effects.has(index) && index !== previousHole);
  if (!available.length) return;
  const index = available[Math.floor(Math.random() * available.length)];
  const decoy = !forceRegular && Math.random() < mode.decoyRate;
  // Decoys linger longer to tempt a tap while regular targets retain their pace.
  active.set(index, { decoy, expires: elapsed + random(...(decoy ? mode.decoyLifetime : mode.lifetime)) });
  previousHole = index;
  holes[index].classList.add('up');
  holes[index].classList.toggle('decoy', decoy);
  holes[index].setAttribute('aria-label', `洞口 ${index + 1}，${decoy ? '紅色地鼠，避開' : '棕色地鼠，可打'}`);
}

function advance(now) {
  if (state !== 'running') return;
  elapsed += Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  remaining = Math.max(0, duration - elapsed);
  if (remaining <= 0) { finish(); return; }
  for (const [index, mole] of active) {
    if (mole.expires <= elapsed) { removeMole(index); if (!mole.decoy) misses += 1; }
  }
  for (const [index, expires] of effects) {
    if (expires <= elapsed) { holes[index].classList.remove('hit', 'wrong'); effects.delete(index); }
  }
  if (elapsed >= nextSpawn) {
    spawnMole();
    nextSpawn = elapsed + random(...mode.spawn);
  }
  updateStats();
}

function tick(now) {
  advance(now);
  if (state === 'running') frame = requestAnimationFrame(tick);
}

function clearField() {
  active.clear();
  effects.clear();
  holes.forEach((hole, index) => {
    hole.classList.remove('up', 'hit', 'wrong', 'decoy');
    hole.setAttribute('aria-label', `洞口 ${index + 1}，空洞`);
  });
}

function showDialog(tag, title, description, button) {
  $('dialog-tag').textContent = tag;
  $('dialog-title').textContent = title;
  $('dialog-description').textContent = description;
  $('start').textContent = button;
  field.inert = true;
  overlay.hidden = false;
  $('start').focus({ preventScroll: true });
}

function startGame() {
  cancelAnimationFrame(frame);
  clearField();
  const selected = Number(document.querySelector('input[name="duration"]:checked').value);
  duration = modes[selected] ? selected : 60;
  mode = modes[duration];
  score = 0;
  hits = 0;
  errors = 0;
  wrongMoles = 0;
  misses = 0;
  elapsed = 0;
  remaining = duration;
  previousHole = -1;
  state = 'running';
  $('results').hidden = true;
  $('restart').hidden = true;
  $('feedback').classList.remove('show');
  overlay.hidden = true;
  field.inert = false;
  $('pause').disabled = false;
  $('pause').textContent = '暫停';
  spawnMole(true);
  nextSpawn = random(...mode.spawn);
  updateStats();
  lastTime = performance.now();
  frame = requestAnimationFrame(tick);
  $('announcement').textContent = `地鼠出沒，${duration} 秒${mode.name}模式，棕色可打，加 ${mode.reward} 分；紅色避開，打空或誤打紅色扣 ${mode.penalty} 分。`;
}

function showFeedback(message, negative = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('negative', negative);
  $('feedback').classList.remove('show');
  void $('feedback').offsetWidth;
  $('feedback').classList.add('show');
}

function registerError(index = null) {
  if (state !== 'running') return;
  errors += 1;
  score -= mode.penalty;
  if (index !== null && !active.has(index)) {
    holes[index].classList.remove('hit');
    holes[index].classList.add('wrong');
    effects.set(index, elapsed + .35);
  }
  showFeedback(mode.penalty ? `−${mode.penalty} 打空了！` : '打空了，不扣分', mode.penalty > 0);
  updateStats();
}

function hit(index) {
  if (state !== 'running' || !Number.isInteger(index) || index < 0 || index >= holes.length) return;
  const mole = active.get(index);
  advance(performance.now());
  // One mole scores only once, and expired moles cannot score late taps.
  if (state !== 'running') return;
  if (!mole || active.get(index) !== mole) { registerError(index); return; }
  removeMole(index);
  nextSpawn = Math.min(nextSpawn, elapsed + mode.hitDelay);
  effects.set(index, elapsed + .35);
  if (mole.decoy) {
    wrongMoles += 1;
    score -= mode.penalty;
    holes[index].classList.remove('hit');
    holes[index].classList.add('wrong');
    showFeedback(mode.penalty ? `−${mode.penalty} 紅色要避開！` : '紅色要避開，不加分也不扣分', mode.penalty > 0);
    updateStats();
    return;
  }
  hits += 1;
  score += mode.reward;
  holes[index].classList.remove('wrong');
  holes[index].classList.add('hit');
  showFeedback(`+${mode.reward} 抓到啦！`);
  updateStats();
}

// Tapping gaps and the arena background is also a miss. Hole events stop bubbling.
arena.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('.mole-hole, .overlay') || state !== 'running') return;
  event.preventDefault();
  advance(performance.now());
  registerError();
});

function pauseGame() {
  if (state !== 'running') return;
  advance(performance.now());
  if (state !== 'running') return;
  state = 'paused';
  cancelAnimationFrame(frame);
  $('pause').textContent = '繼續';
  $('duration-options').hidden = true;
  $('restart').hidden = false;
  $('dialog-note').textContent = '倒數與地鼠都已暫停';
  showDialog('TAKE A BREATH', '地鼠也休息一下。', `目前 ${score} 分，命中 ${hits} 次，還有 ${Math.ceil(remaining)} 秒。`, '繼續挑戰');
  $('announcement').textContent = '遊戲已暫停。';
}

function resumeGame() {
  if (state !== 'paused' || document.hidden) return;
  state = 'running';
  overlay.hidden = true;
  field.inert = false;
  $('pause').textContent = '暫停';
  lastTime = performance.now();
  frame = requestAnimationFrame(tick);
  $('announcement').textContent = '遊戲繼續。';
}

function finish() {
  state = 'finished';
  cancelAnimationFrame(frame);
  clearField();
  const newBest = score > best();
  if (!Number.isFinite(records[duration]) || newBest) {
    records[duration] = score;
    try { localStorage.setItem(storageKey, JSON.stringify(records)); } catch { /* Optional persistence. */ }
  }
  $('pause').disabled = true;
  $('pause').textContent = '暫停';
  $('duration-options').hidden = false;
  $('restart').hidden = true;
  $('results').replaceChildren(document.createTextNode(String(score)));
  const unit = document.createElement('small');
  unit.textContent = ' 分';
  $('results').append(unit);
  $('results').hidden = false;
  $('dialog-note').textContent = `最佳得分依模式分開儲存 · 本局 ${duration} 秒${mode.name}`;
  showDialog(newBest ? 'NEW PERSONAL BEST' : 'WELL PLAYED', newBest ? '抓出新紀錄！' : '挑戰完成！', `命中 ${hits} 次，打空 ${errors} 次，誤打紅色 ${wrongMoles} 次，漏掉棕色 ${misses} 隻。`, '再玩一次');
  updateStats();
  $('announcement').textContent = `挑戰完成，${score} 分，命中 ${hits} 次，打空 ${errors} 次，誤打紅色 ${wrongMoles} 次，漏掉棕色 ${misses} 隻。`;
}

$('start').addEventListener('click', () => state === 'paused' ? resumeGame() : startGame());
$('restart').addEventListener('click', startGame);
$('pause').addEventListener('click', () => state === 'running' ? pauseGame() : resumeGame());
document.querySelectorAll('input[name="duration"]').forEach(input => input.addEventListener('change', () => {
  if (state === 'running' || state === 'paused' || !modes[Number(input.value)]) return;
  duration = Number(input.value);
  mode = modes[duration];
  if (state === 'ready') remaining = duration;
  $('dialog-note').textContent = `單關固定難度 · 地鼠逾時不扣分${mode.penalty ? ' · 分數可低於 0' : ''}`;
  updateStats();
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') pauseGame(); });

new ResizeObserver(() => {
  const style = getComputedStyle(arena);
  const width = arena.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = arena.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const gridStyle = getComputedStyle(field);
  const columnGap = parseFloat(gridStyle.columnGap);
  const rowGap = parseFloat(gridStyle.rowGap);
  const size = Math.max(0, Math.min((width - columnGap * 5) / 6, (height - rowGap * 4) / 5));
  field.style.setProperty('--hole-size', `${size}px`);
  field.style.setProperty('--field-height', `${size * 5 + rowGap * 4}px`);
}).observe(arena);

$('fullscreen').hidden = !document.fullscreenEnabled;
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('game').requestFullscreen();
  } catch { $('announcement').textContent = '目前瀏覽器無法開啟全螢幕，仍可繼續遊戲。'; }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? '離開全螢幕' : '全螢幕'; });

function configureEmbeddedGame() {
  if (!new URLSearchParams(window.location.search).has('embedded') || window.parent === window) return;
  document.body.classList.add('embedded');
  const back = document.querySelector('.back-link');
  back.textContent = '← 互動區';
  back.addEventListener('click', event => {
    event.preventDefault();
    pauseGame();
    window.parent.postMessage({ type: 'classroom-interaction-back' }, window.location.protocol === 'file:' ? '*' : window.location.origin);
  });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (event.data?.type === 'classroom-game-pause') pauseGame();
  });
}
configureEmbeddedGame();
updateStats();
