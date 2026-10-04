const $ = (id) => document.getElementById(id);
const field = $('field');
const arena = $('arena');
const overlay = $('overlay');
const storageKey = 'classroom-mole-pop-best-v1';
const random = (min, max) => min + Math.random() * (max - min);
const moleArt = `<svg class="mole-character" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <circle cx="24" cy="37" r="12" fill="#a76f46"/><circle cx="76" cy="37" r="12" fill="#a76f46"/>
  <circle cx="24" cy="37" r="7" fill="#e8ad91"/><circle cx="76" cy="37" r="7" fill="#e8ad91"/>
  <path d="M18 100V59C18 11 82 11 82 59V100Z" fill="#bc8858"/>
  <path d="M30 98V65C30 36 70 36 70 65V98Z" fill="#edc698"/>
  <ellipse cx="32" cy="62" rx="8" ry="5" fill="#e9a38a"/><ellipse cx="68" cy="62" rx="8" ry="5" fill="#e9a38a"/>
  <ellipse cx="37" cy="51" rx="4" ry="5" fill="#32251f"/><ellipse cx="63" cy="51" rx="4" ry="5" fill="#32251f"/>
  <circle cx="38" cy="49" r="1.3" fill="#fff"/><circle cx="64" cy="49" r="1.3" fill="#fff"/>
  <ellipse cx="50" cy="62" rx="8" ry="6" fill="#694638"/>
  <path d="M50 68V72M40 72Q50 81 60 72" fill="none" stroke="#694638" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M37 29Q46 19 58 26" fill="none" stroke="#edc698" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="23" cy="92" rx="12" ry="7" fill="#d8a373"/><ellipse cx="77" cy="92" rx="12" ry="7" fill="#d8a373"/>
</svg>`;

const holes = Array.from({ length: 30 }, (_, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mole-hole';
  button.dataset.index = index;
  button.innerHTML = `<span class="hole-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span class="mole-clip">${moleArt}</span>`;
  button.setAttribute('aria-label', `洞口 ${index + 1}，空洞`);
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
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
let score = 0;
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
  const value = Number(records[duration]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function updateStats() {
  $('score').textContent = score;
  $('time').textContent = Math.max(0, Math.ceil(remaining));
  $('level').textContent = String(1 + Math.floor(score / 5)).padStart(2, '0');
  $('best').textContent = best();
  $('misses').textContent = `漏掉 ${misses} 隻`;
}

function removeMole(index) {
  active.delete(index);
  holes[index].classList.remove('up');
  holes[index].setAttribute('aria-label', `洞口 ${index + 1}，空洞`);
}

function spawnMole() {
  const capacity = Math.min(3, 1 + Math.floor(score / 10));
  if (active.size >= capacity) return;
  // A just-hit hole keeps its star briefly; new moles use other available holes.
  const available = holes.map((_, index) => index).filter(index => !active.has(index) && !effects.has(index) && index !== previousHole);
  if (!available.length) return;
  const index = available[Math.floor(Math.random() * available.length)];
  const difficulty = Math.min(2.3, 1 + score * .035);
  active.set(index, { expires: elapsed + random(1.3, 2.1) / difficulty });
  previousHole = index;
  holes[index].classList.add('up');
  holes[index].setAttribute('aria-label', `洞口 ${index + 1}，地鼠出現`);
}

function advance(now) {
  if (state !== 'running') return;
  elapsed += Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  remaining = Math.max(0, duration - elapsed);
  if (remaining <= 0) { finish(); return; }
  for (const [index, mole] of active) {
    if (mole.expires <= elapsed) { removeMole(index); misses += 1; }
  }
  for (const [index, expires] of effects) {
    if (expires <= elapsed) { holes[index].classList.remove('hit'); effects.delete(index); }
  }
  if (elapsed >= nextSpawn) {
    spawnMole();
    nextSpawn = elapsed + random(.6, .95) / Math.min(2, 1 + score * .03);
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
    hole.classList.remove('up', 'hit');
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
  duration = Number(document.querySelector('input[name="duration"]:checked').value);
  score = 0;
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
  spawnMole();
  nextSpawn = random(.6, .95);
  updateStats();
  lastTime = performance.now();
  frame = requestAnimationFrame(tick);
  $('announcement').textContent = `地鼠出沒開始，共 ${duration} 秒，6 欄 5 列。`;
}

function hit(index) {
  if (state !== 'running') return;
  const mole = active.get(index);
  advance(performance.now());
  // One mole scores only once, and expired moles cannot score late taps.
  if (state !== 'running' || !mole || active.get(index) !== mole) return;
  removeMole(index);
  score += 1;
  holes[index].classList.add('hit');
  effects.set(index, elapsed + .35);
  nextSpawn = Math.min(nextSpawn, elapsed + .18);
  $('feedback').textContent = '+1 抓到啦！';
  $('feedback').classList.remove('show');
  void $('feedback').offsetWidth;
  $('feedback').classList.add('show');
  updateStats();
}

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
  showDialog('TAKE A BREATH', '地鼠也休息一下。', `點中 ${score} 次，還有 ${Math.ceil(remaining)} 秒。`, '繼續挑戰');
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
  if (newBest) {
    records[duration] = score;
    try { localStorage.setItem(storageKey, JSON.stringify(records)); } catch { /* Optional persistence. */ }
  }
  $('pause').disabled = true;
  $('pause').textContent = '暫停';
  $('duration-options').hidden = false;
  $('restart').hidden = true;
  $('results').replaceChildren(document.createTextNode(String(score)));
  const unit = document.createElement('small');
  unit.textContent = ' 次點中';
  $('results').append(unit);
  $('results').hidden = false;
  $('dialog-note').textContent = `最佳紀錄依回合時間分開儲存 · 本回合 ${duration} 秒`;
  showDialog(newBest ? 'NEW PERSONAL BEST' : 'WELL PLAYED', newBest ? '抓出新紀錄！' : '挑戰完成！', `漏掉 ${misses} 隻地鼠，再試一次挑戰自己的反應力。`, '再玩一次');
  updateStats();
  $('announcement').textContent = `挑戰完成，點中 ${score} 次，漏掉 ${misses} 隻。`;
}

$('start').addEventListener('click', () => state === 'paused' ? resumeGame() : startGame());
$('restart').addEventListener('click', startGame);
$('pause').addEventListener('click', () => state === 'running' ? pauseGame() : resumeGame());
document.querySelectorAll('input[name="duration"]').forEach(input => input.addEventListener('change', () => {
  duration = Number(input.value);
  if (state === 'ready') remaining = duration;
  updateStats();
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') pauseGame(); });

new ResizeObserver(() => {
  const style = getComputedStyle(arena);
  const width = arena.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = arena.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  field.style.setProperty('--field-width', `${Math.max(0, Math.min(width, height * 6 / 5))}px`);
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
