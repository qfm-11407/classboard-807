// All game state stays on this device; no account or network connection is needed.
const $ = (id) => document.getElementById(id);
const arena = $('arena');
const dot = $('dot');
const overlay = $('overlay');
const storageKey = 'classroom-moving-dot-best-v1';
const random = (min, max) => min + Math.random() * (max - min);
let records = {};
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) records = saved;
} catch { /* Games also work when browser storage is unavailable. */ }

let state = 'ready';
let duration = 60;
let score = 0;
let misses = 0;
let remaining = duration;
let frame = 0;
let lastTime = 0;
let generation = 0;
let target = null;

function best() {
  const value = Number(records[duration]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function updateStats() {
  $('score').textContent = score;
  $('time').textContent = Math.max(0, Math.ceil(remaining));
  $('level').textContent = String(1 + Math.floor(score / 5)).padStart(2, '0');
  $('best').textContent = best();
  $('misses').textContent = `逾時 ${misses} 次`;
}

function bounds(size) {
  return {
    x: Math.max(0, arena.clientWidth - size),
    y: Math.max(0, arena.clientHeight - size),
  };
}

function drawTarget() {
  if (!target) return;
  dot.style.width = `${target.size}px`;
  dot.style.height = `${target.size}px`;
  dot.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
  dot.style.setProperty('--life', Math.max(0, target.life / target.lifetime));
}

function spawnTarget() {
  // Every successful hit changes difficulty, with limits that remain touchable.
  const size = Math.min(Math.max(40, 104 - score * 3), arena.clientWidth, arena.clientHeight);
  const limits = bounds(size);
  const speed = Math.min(420, 95 + score * 10);
  const angle = random(0, Math.PI * 2);
  const lifetime = random(2, 4) / Math.min(1.7, 1 + score * .025);
  target = {
    size, x: random(0, limits.x), y: random(0, limits.y),
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    lifetime, life: lifetime,
  };
  generation += 1;
  drawTarget();
  dot.hidden = false;
}

// Reflect at the arena edges, even if a frame crosses multiple boundaries.
function reflect(position, velocity, seconds, limit) {
  if (limit <= 0) return [0, velocity];
  const raw = position + velocity * seconds;
  const wrapped = ((raw % (2 * limit)) + 2 * limit) % (2 * limit);
  return wrapped < limit ? [wrapped, velocity] : [2 * limit - wrapped, -velocity];
}

function advance(now) {
  if (state !== 'running') return;
  const elapsed = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  remaining = Math.max(0, remaining - elapsed);
  if (remaining <= 0) {
    finish();
    return;
  }
  target.life -= elapsed;
  if (target.life <= 0) {
    misses += 1;
    spawnTarget();
  } else {
    const limits = bounds(target.size);
    [target.x, target.vx] = reflect(target.x, target.vx, elapsed, limits.x);
    [target.y, target.vy] = reflect(target.y, target.vy, elapsed, limits.y);
    drawTarget();
  }
  updateStats();
}

function tick(now) {
  advance(now);
  if (state === 'running') frame = requestAnimationFrame(tick);
}

function showDialog(tag, title, description, button) {
  $('dialog-tag').textContent = tag;
  $('dialog-title').textContent = title;
  $('dialog-description').textContent = description;
  $('start').textContent = button;
  overlay.hidden = false;
  dot.hidden = true;
  $('start').focus({ preventScroll: true });
}

function startGame() {
  cancelAnimationFrame(frame);
  duration = Number(document.querySelector('input[name="duration"]:checked').value);
  remaining = duration;
  score = 0;
  misses = 0;
  state = 'running';
  $('results').hidden = true;
  $('restart').hidden = true;
  $('feedback').classList.remove('show');
  overlay.hidden = true;
  $('pause').disabled = false;
  $('pause').textContent = '暫停';
  spawnTarget();
  updateStats();
  lastTime = performance.now();
  frame = requestAnimationFrame(tick);
  $('announcement').textContent = `挑戰開始，共 ${duration} 秒。`;
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
  $('dialog-note').textContent = '時間與圓點都已暫停';
  showDialog('TAKE A BREATH', '休息一下，再繼續。', `已點中 ${score} 次，還有 ${Math.ceil(remaining)} 秒。`, '繼續挑戰');
  $('announcement').textContent = '遊戲已暫停。';
}

function resumeGame() {
  if (state !== 'paused' || document.hidden) return;
  state = 'running';
  overlay.hidden = true;
  dot.hidden = false;
  $('pause').textContent = '暫停';
  lastTime = performance.now();
  frame = requestAnimationFrame(tick);
  $('announcement').textContent = '遊戲繼續。';
}

function finish() {
  state = 'finished';
  cancelAnimationFrame(frame);
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
  showDialog(newBest ? 'NEW PERSONAL BEST' : 'NICE PLAY', newBest ? '刷新自己的紀錄！' : '挑戰完成！', `圓點逾時 ${misses} 次。再試一次，挑戰自己的反應力。`, '再玩一次');
  updateStats();
  $('announcement').textContent = `挑戰完成，點中 ${score} 次，逾時 ${misses} 次。`;
}

function hit() {
  if (state !== 'running') return;
  const previousGeneration = generation;
  advance(performance.now());
  // An expired circle cannot score a hit on its replacement.
  if (state !== 'running' || previousGeneration !== generation) return;
  score += 1;
  $('feedback').textContent = '+1 點中！';
  $('feedback').classList.remove('show');
  void $('feedback').offsetWidth;
  $('feedback').classList.add('show');
  spawnTarget();
  updateStats();
}

dot.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  hit();
});
// Keyboard and assistive technology activate buttons through click.
dot.addEventListener('click', (event) => { if (event.detail === 0) hit(); });
$('start').addEventListener('click', () => state === 'paused' ? resumeGame() : startGame());
$('restart').addEventListener('click', startGame);
$('pause').addEventListener('click', () => state === 'running' ? pauseGame() : resumeGame());
document.querySelectorAll('input[name="duration"]').forEach((input) => {
  input.addEventListener('change', () => {
    duration = Number(input.value);
    if (state === 'ready') remaining = duration;
    updateStats();
  });
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state === 'running') pauseGame();
});

new ResizeObserver(() => {
  if (!target) return;
  target.size = Math.min(target.size, arena.clientWidth, arena.clientHeight);
  const limits = bounds(target.size);
  target.x = Math.max(0, Math.min(target.x, limits.x));
  target.y = Math.max(0, Math.min(target.y, limits.y));
  drawTarget();
}).observe(arena);

$('fullscreen').hidden = !document.fullscreenEnabled;
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('game').requestFullscreen();
  } catch {
    $('announcement').textContent = '目前瀏覽器無法開啟全螢幕，仍可繼續遊戲。';
  }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').textContent = document.fullscreenElement ? '離開全螢幕' : '全螢幕';
});
function configureEmbeddedGame() {
  if (!new URLSearchParams(window.location.search).has('embedded') || window.parent === window) return;
  document.body.classList.add('embedded');
  const back = document.querySelector('.back-link');
  back.textContent = '← 互動區';
  back.addEventListener('click', event => {
    event.preventDefault();
    pauseGame();
    window.parent.postMessage({type:'classroom-interaction-back'}, window.location.protocol === 'file:' ? '*' : window.location.origin);
  });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (event.data?.type === 'classroom-game-pause') pauseGame();
  });
}
configureEmbeddedGame();
updateStats();
