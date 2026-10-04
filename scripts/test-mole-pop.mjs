import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function element() {
  const classes = new Set();
  const attributes = new Map();
  const listeners = {};
  return {
    dataset: {}, children: [], listeners, style: { setProperty() {} },
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    addEventListener: (name, handler) => { listeners[name] = handler; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    focus() {},
  };
}

const elements = new Map(), docEvents = {}, windowEvents = {}, saved = new Map(), posts = [];
const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
const back = element(), selectedDuration = { value: '60' };
const parent = { postMessage: (data, origin) => posts.push({ data, origin }) };
const document = {
  getElementById: get, createElement: element, createTextNode: value => value,
  querySelector: selector => selector === '.back-link' ? back : selectedDuration,
  querySelectorAll: () => [], body: element(), hidden: false, fullscreenEnabled: false,
  addEventListener: (name, handler) => { docEvents[name] = handler; },
};
let now = 0, seed = 123;
const seededMath = Object.create(Math);
seededMath.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
const source = fs.readFileSync(new URL('../games/mole-pop.js', import.meta.url), 'utf8');
const game = vm.runInNewContext(`${source}\n({startGame,hit,advance,pauseGame,resumeGame,snapshot:()=>({state,score,misses,remaining,active:[...active.keys()]})})`, {
  document, Math: seededMath, URLSearchParams,
  window: { parent, location: { search: '?embedded=1', origin: 'https://example.test', protocol: 'https:' },
    addEventListener: (name, handler) => { windowEvents[name] = handler; } },
  localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
  performance: { now: () => now }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  ResizeObserver: class { observe() {} },
});
const advance = seconds => { now += seconds * 1000; game.advance(now); };
const holes = get('field').children;
assert.equal(holes.length, 30, 'Exactly 30 distinct playable positions');
assert.equal(new Set(holes.map(hole => hole.dataset.index)).size, 30);
assert.equal(back.textContent, '← 互動區');
game.startGame();
assert.equal(game.snapshot().active.length, 1);
assert.equal(get('field').inert, false);
const first = game.snapshot().active[0];
holes[first].listeners.pointerdown({ button: 0, preventDefault() {} });
holes[first].listeners.click({ detail: 1 });
game.hit(first);
assert.equal(game.snapshot().score, 1, 'Pointer and synthesized click never double-score');
const blank = holes.findIndex((_, index) => index !== first);
game.hit(blank);
assert.equal(game.snapshot().score, 1, 'Empty holes do not score or penalize');
advance(.2);
assert.notEqual(game.snapshot().active[0], first, 'Next mole uses a different hole');
const expired = game.snapshot().active[0];
advance(3);
game.hit(expired);
assert.equal(game.snapshot().score, 1, 'Expired moles cannot score');
assert(game.snapshot().misses > 0);

game.pauseGame();
const paused = game.snapshot();
assert.equal(get('field').inert, true);
advance(100);
assert.equal(game.snapshot().remaining, paused.remaining, 'Pause freezes the round');
assert.deepEqual(game.snapshot().active, paused.active, 'Pause preserves visible moles');
game.resumeGame();
advance(.1);
assert(Math.abs(game.snapshot().remaining - paused.remaining + .1) < 1e-8, 'Resume excludes paused wall-clock time');

game.startGame();
for (let count = 0; count < 20; count++) {
  if (!game.snapshot().active.length) advance(.2);
  assert(game.snapshot().active.length > 0);
  holes[game.snapshot().active[0]].listeners.click({ detail: 0 });
  advance(.2);
}
assert.equal(game.snapshot().score, 20, 'Keyboard/assistive button activation scores');
let maximum = 0;
for (let count = 0; count < 120; count++) {
  advance(.06);
  maximum = Math.max(maximum, game.snapshot().active.length);
  assert(game.snapshot().active.length <= 3, 'No more than three concurrent moles');
  assert.equal(new Set(game.snapshot().active).size, game.snapshot().active.length);
}
assert.equal(maximum, 3, 'Higher difficulty allows three simultaneous moles');
windowEvents.message({ source: parent, origin: 'https://other.test', data: { type: 'classroom-game-pause' } });
assert.equal(game.snapshot().state, 'running', 'Reject cross-origin control messages');
windowEvents.message({ source: {}, origin: 'https://example.test', data: { type: 'classroom-game-pause' } });
assert.equal(game.snapshot().state, 'running', 'Reject unrelated message senders');
windowEvents.message({ source: parent, origin: 'https://example.test', data: { type: 'classroom-game-pause' } });
assert.equal(game.snapshot().state, 'paused', 'Closing the embedded game pauses it');
back.listeners.click({ preventDefault() {} });
assert.equal(posts.at(-1).data.type, 'classroom-interaction-back');
game.resumeGame();
advance(60);
assert.equal(game.snapshot().state, 'finished');
assert.equal(game.snapshot().remaining, 0);
assert.equal(holes.filter(hole => hole.classList.contains('up')).length, 0);
assert.equal(JSON.parse(saved.get('classroom-mole-pop-best-v1'))['60'], 20);
game.hit(0);
assert.equal(game.snapshot().score, 20, 'Scoring stops at the end of the round');
selectedDuration.value = '30';
game.startGame();
assert.equal(game.snapshot().score, 0);
assert.equal(game.snapshot().misses, 0);
assert.equal(game.snapshot().remaining, 30);
assert.equal(get('best').textContent, 0, 'Best records are separate for each duration');
document.hidden = true;
docEvents.visibilitychange();
assert.equal(game.snapshot().state, 'paused', 'Switching tabs pauses the round');
game.resumeGame();
assert.equal(game.snapshot().state, 'paused', 'A hidden document cannot resume');
console.log('Mole game tests: passed (30 positions, touch/keyboard scoring, no duplicate hits, expiry, difficulty, pause/resume, embedded navigation, finish, records, restart).');
