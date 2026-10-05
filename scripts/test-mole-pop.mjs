import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createScoreFixture } from './game-score-test-fixture.mjs';
const scoreService = createScoreFixture();

function element() {
  const classes = new Set();
  const attributes = new Map();
  const listeners = {};
  return {
    dataset: {}, children: [], listeners, style: { setProperty() {} },
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    addEventListener: (name, handler) => { listeners[name] = handler; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    focus() {},
  };
}

const elements = new Map(), docEvents = {}, windowEvents = {}, saved = new Map([['classroom-mole-pop-best-v1', '{"60":99}'], ['classroom-mole-pop-best-v2', '{"60":80}']]), posts = [];
const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
const back = element(), selectedDuration = { value: '30' };
const radios = ['30', '60', '90'].map(value => Object.assign(element(), { value }));
const parent = { postMessage: (data, origin) => posts.push({ data, origin }) };
const document = {
  getElementById: get, createElement: element, createTextNode: value => value,
  querySelector: selector => selector === '.back-link' ? back : selectedDuration,
  querySelectorAll: () => radios, body: element(), hidden: false, fullscreenEnabled: false,
  addEventListener: (name, handler) => { docEvents[name] = handler; },
};
let now = 0, seed = 123, forcedRandom = null;
const seededMath = Object.create(Math);
seededMath.random = () => { if (forcedRandom !== null) return forcedRandom; seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
const source = fs.readFileSync(new URL('../games/mole-pop.js', import.meta.url), 'utf8');
const game = vm.runInNewContext(`${source}\n({startGame,hit,advance,pauseGame,resumeGame,finish,snapshot:()=>({state,score,hits,errors,wrongMoles,misses,duration,remaining,active:[...active.keys()],targets:[...active].map(([index,mole])=>({index,decoy:mole.decoy,remaining:mole.expires-elapsed})),lifetimes:[...active.values()].map(mole=>mole.expires-elapsed)})})`, {
  document, Math: seededMath, URLSearchParams,
  window: { ClassroomGameScores:scoreService, parent, location: { search: '?embedded=1', origin: 'https://example.test', protocol: 'https:' },
    addEventListener: (name, handler) => { windowEvents[name] = handler; } },
  localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
  performance: { now: () => now }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  ResizeObserver: class { observe() {} },
});
const advance = seconds => { now += seconds * 1000; game.advance(now); };
const select = value => { selectedDuration.value = String(value); radios.find(input => input.value === String(value)).listeners.change(); };
const backgroundTap = () => get('arena').listeners.pointerdown({ button: 0, target: { closest: () => null }, preventDefault() {} });
const holes = get('field').children;
function earnHits(count) {
  forcedRandom = .99;
  for (let hitCount = 0; hitCount < count; hitCount++) {
    let regular = game.snapshot().targets.find(mole => !mole.decoy);
    for (let wait = 0; !regular && wait < 100; wait++) {
      advance(.05);
      regular = game.snapshot().targets.find(mole => !mole.decoy);
    }
    assert(regular);
    game.hit(regular.index);
    advance(.3);
  }
  forcedRandom = null;
}
assert.equal(holes.length, 30, 'Exactly 30 distinct playable positions');
assert.equal(new Set(holes.map(hole => hole.dataset.index)).size, 30);
assert.equal(back.textContent, '← 互動區');
game.startGame();
assert.equal(game.snapshot().active.length, 1);
assert.equal(get('field').inert, false);
const first = game.snapshot().active[0];
holes[first].listeners.pointerdown({ button: 0, isPrimary: false, preventDefault() {}, stopPropagation() {} });
holes[first].listeners.click({ detail: 1 });
assert.equal(game.snapshot().errors, 0, 'A synthesized click never creates a second penalty');
game.hit(first);
assert.equal(game.snapshot().score, 1, 'Pointer and synthesized click never double-score');
const blank = holes.findIndex((_, index) => index !== first);
game.hit(blank);
assert.equal(game.snapshot().score, 1, 'Empty holes do not score or penalize');
forcedRandom = .99;
advance(.3);
assert.notEqual(game.snapshot().active[0], first, 'Next mole uses a different hole');
const expired = game.snapshot().active[0];
advance(3);
assert.equal(game.snapshot().score, 1, 'Expiry does not deduct points');
game.hit(expired);
assert.equal(game.snapshot().score, 1, 'Expired moles cannot score');
assert(game.snapshot().misses > 0);
forcedRandom = null;

game.pauseGame();
const paused = game.snapshot();
assert.equal(get('field').inert, true);
backgroundTap();
assert.equal(game.snapshot().errors, paused.errors, 'Paused taps do not count');
advance(100);
assert.equal(game.snapshot().remaining, paused.remaining, 'Pause freezes the round');
assert.deepEqual(game.snapshot().active, paused.active, 'Pause preserves visible moles');
game.resumeGame();
advance(.1);
assert(Math.abs(game.snapshot().remaining - paused.remaining + .1) < 1e-8, 'Resume excludes paused wall-clock time');

select(90);
game.startGame();
for (let count = 0; count < 20; count++) {
  let regular = game.snapshot().targets.find(mole => !mole.decoy);
  for (let wait = 0; !regular && wait < 100; wait++) {
    advance(.1);
    regular = game.snapshot().targets.find(mole => !mole.decoy);
  }
  assert(regular, 'A regular target appears while red targets are avoided');
  holes[regular.index].listeners.click({ detail: 0 });
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
assert.equal(maximum, 3, 'The 90-second challenge allows three simultaneous moles');
windowEvents.message({ source: parent, origin: 'https://other.test', data: { type: 'classroom-game-pause' } });
assert.equal(game.snapshot().state, 'running', 'Reject cross-origin control messages');
windowEvents.message({ source: {}, origin: 'https://example.test', data: { type: 'classroom-game-pause' } });
assert.equal(game.snapshot().state, 'running', 'Reject unrelated message senders');
windowEvents.message({ source: parent, origin: 'https://example.test', data: { type: 'classroom-game-pause' } });
assert.equal(game.snapshot().state, 'paused', 'Closing the embedded game pauses it');
back.listeners.click({ preventDefault() {} });
assert.equal(posts.at(-1).data.type, 'classroom-interaction-back');
game.resumeGame();
advance(90);
assert.equal(game.snapshot().state, 'finished');
assert.equal(game.snapshot().remaining, 0);
assert.equal(holes.filter(hole => hole.classList.contains('up')).length, 0);
assert.equal(JSON.parse(saved.get('classroom-mole-pop-best-v3'))['90'], 20);
assert.deepEqual(scoreService.completed.at(-1), { game:'mole-pop', mode:'90', score:20 });
assert.equal(saved.get('classroom-mole-pop-best-v1'), '{"60":99}', 'Preserve the old hit-count records');
assert.equal(saved.get('classroom-mole-pop-best-v2'), '{"60":80}', 'Preserve pre-decoy score records');
game.hit(0);
assert.equal(game.snapshot().score, 20, 'Scoring stops at the end of the round');
select(30);
game.startGame();
assert.equal(game.snapshot().score, 0);
assert.equal(game.snapshot().misses, 0);
assert.equal(game.snapshot().remaining, 30);
assert.equal(get('best').textContent, '—', 'Today records are separate for each duration, and undated legacy records are not imported');
document.hidden = true;
docEvents.visibilitychange();
assert.equal(game.snapshot().state, 'paused', 'Switching tabs pauses the round');
game.resumeGame();
assert.equal(game.snapshot().state, 'paused', 'A hidden document cannot resume');
document.hidden = false;
game.resumeGame();
advance(30);

// Test signed records before this mode has saved any other score.
select(60);
game.startGame();
game.hit((game.snapshot().active[0] + 1) % 30);
assert.equal(game.snapshot().score, -1);
assert.equal(game.snapshot().state, 'finished', 'Negative scores end immediately without waiting for the timer');
assert.equal(game.snapshot().remaining, 60);
advance(60);
assert.equal(JSON.parse(saved.get('classroom-mole-pop-best-v3'))['60'], -1);
assert.equal(get('best').textContent, -1);
game.startGame();
backgroundTap();
backgroundTap();
advance(60);
assert.equal(JSON.parse(saved.get('classroom-mole-pop-best-v3'))['60'], -1, 'Taps after game over cannot change the saved score');
game.startGame();
game.hit(game.snapshot().active[0]);
advance(60);
assert.equal(JSON.parse(saved.get('classroom-mole-pop-best-v3'))['60'], 2);

for (const settings of [
  { duration: 30, name: '簡易', reward: 1, penalty: 0, capacity: 1, lifetime: [1.7, 2.5], decoyLifetime: [2.7, 3.6] },
  { duration: 60, name: '正常', reward: 2, penalty: 1, capacity: 2, lifetime: [1.15, 1.75], decoyLifetime: [1.9, 2.7] },
  { duration: 90, name: '挑戰', reward: 1, penalty: 2, capacity: 3, lifetime: [.7, 1.15], decoyLifetime: [1.3, 1.9] },
]) {
  select(settings.duration);
  game.startGame();
  assert.equal(get('mode').textContent, settings.name);
  assert.equal(game.snapshot().duration, settings.duration);
  assert.equal(game.snapshot().targets[0].decoy, false, 'Each round starts with a regular brown mole');
  assert(game.snapshot().lifetimes.every(lifetime => lifetime >= settings.lifetime[0] && lifetime <= settings.lifetime[1]));
  earnHits(6);
  const bank = settings.reward * 6;
  const moleIndex = game.snapshot().active[0];
  holes[moleIndex].listeners.pointerdown({ button: 0, preventDefault() {}, stopPropagation() {} });
  holes[moleIndex].listeners.click({ detail: 1 });
  assert.equal(game.snapshot().score, bank + settings.reward);
  assert.equal(game.snapshot().hits, 7);
  assert.equal(game.snapshot().errors, 0);
  get('arena').listeners.pointerdown({ button: 0, target: { closest: () => holes[moleIndex] } });
  assert.equal(game.snapshot().errors, 0, 'A hole tap is never penalized again by the background handler');
  backgroundTap();
  assert.equal(game.snapshot().score, bank + settings.reward - settings.penalty, 'Arena gaps and background obey the selected penalty');
  game.hit((moleIndex + 1) % 30);
  assert.equal(game.snapshot().score, bank + settings.reward - settings.penalty * 2, 'Empty holes also deduct points');
  assert.equal(game.snapshot().errors, 2);
  // Force subsequent random spawns to red, exercising real spawn/expiry/hit paths.
  forcedRandom = 0;
  advance(.3);
  const red = game.snapshot().targets.find(mole => mole.decoy);
  assert(red, 'Colored decoys appear in every mode');
  assert(Math.abs(red.remaining - settings.decoyLifetime[0]) < 1e-8, 'Decoys use their own longer lifetime');
  assert(holes[red.index].classList.contains('decoy'));
  assert(holes[red.index].getAttribute('aria-label').includes('紅色地鼠，避開'));
  assert(get('decoy-rules').textContent.includes(settings.penalty ? `−${settings.penalty}` : '不加分'));
  game.pauseGame();
  const redPaused = game.snapshot();
  advance(10);
  assert.deepEqual(game.snapshot().targets, redPaused.targets, 'Pause preserves regular and decoy identities');
  game.resumeGame();
  const beforeAvoid = game.snapshot();
  advance(settings.lifetime[1] + .05);
  assert(game.snapshot().active.includes(red.index), 'Red stays visible beyond the longest brown lifetime');
  const lingeringRed = game.snapshot().targets.find(mole => mole.index === red.index);
  advance(lingeringRed.remaining + .01);
  assert(!game.snapshot().active.includes(red.index), 'The lingering red target eventually expires on its own');
  assert.equal(game.snapshot().misses, beforeAvoid.misses, 'Avoiding red moles is never a missed regular mole');
  assert.equal(game.snapshot().score, beforeAvoid.score, 'Ignoring red moles never deducts points');
  let nextRed = game.snapshot().targets.find(mole => mole.decoy);
  for (let wait = 0; !nextRed && wait < 20; wait++) {
    advance(.1);
    nextRed = game.snapshot().targets.find(mole => mole.decoy);
  }
  assert(nextRed);
  holes[nextRed.index].listeners.pointerdown({ button: 0, isPrimary: false, preventDefault() {}, stopPropagation() {} });
  holes[nextRed.index].listeners.click({ detail: 1 });
  assert.equal(game.snapshot().score, bank + settings.reward - settings.penalty * 3, 'Hitting red obeys the mode penalty and gives no reward');
  assert.equal(game.snapshot().hits, 7, 'A red hit does not count as a regular hit');
  assert.equal(game.snapshot().errors, 2, 'Red hits and blank taps are counted separately');
  assert.equal(game.snapshot().wrongMoles, 1, 'Touch followed by click counts one red hit');
  assert(!game.snapshot().active.includes(nextRed.index), 'The hit decoy disappears');
  assert(holes[nextRed.index].classList.contains('wrong'));
  assert(get('feedback').textContent.includes('紅色要避開'));
  forcedRandom = .99;
  let modeMaximum = 0;
  const scoreBeforeExpiry = game.snapshot().score;
  for (let count = 0; count < 100; count++) {
    advance(.05);
    modeMaximum = Math.max(modeMaximum, game.snapshot().active.length);
    assert(game.snapshot().active.length <= settings.capacity);
  }
  assert.equal(modeMaximum, settings.capacity, 'Difficulty is fixed by duration');
  assert.equal(game.snapshot().score, scoreBeforeExpiry, 'Missed moles are counted without point deductions');
  assert(game.snapshot().misses > 0);
  assert.equal(get('mode').textContent, settings.name, 'The single stage never changes difficulty');
  forcedRandom = null;
  advance(settings.duration);
  const end = game.snapshot();
  backgroundTap();
  game.hit(0);
  assert.equal(game.snapshot().score, end.score);
  assert.equal(game.snapshot().errors, end.errors);
  assert.equal(game.snapshot().wrongMoles, end.wrongMoles);
  assert.equal(holes.filter(hole => hole.classList.contains('decoy')).length, 0, 'Finish clears colored target styling');
}

// Each penalty source must end a negative round and stop all subsequent activity.
for (const settings of [{ duration:60, reward:2, penalty:1 }, { duration:90, reward:1, penalty:2 }]) {
  select(settings.duration);
  assert(get('dialog-note').textContent.includes('負分立即結束'));
  for (const cause of ['blank', 'background', 'red']) {
    game.startGame();
    const recordsBefore = scoreService.completed.length;
    if (cause === 'red') {
      earnHits(2);
      const tapsToZero = settings.reward * 2 / settings.penalty;
      for (let tap = 0; tap < tapsToZero; tap++) backgroundTap();
      assert.equal(game.snapshot().score, 0);
      assert.equal(game.snapshot().state, 'running', 'Exactly zero remains playable');
      forcedRandom = 0;
      let red = game.snapshot().targets.find(mole => mole.decoy);
      for (let wait = 0; !red && wait < 100; wait++) {
        advance(.05);
        red = game.snapshot().targets.find(mole => mole.decoy);
      }
      assert(red);
      holes[red.index].listeners.pointerdown({ button:0, preventDefault() {}, stopPropagation() {} });
      holes[red.index].listeners.click({ detail:1 });
      assert.equal(game.snapshot().wrongMoles, 1);
      forcedRandom = null;
    } else if (cause === 'blank') {
      game.hit((game.snapshot().active[0] + 1) % 30);
    } else {
      backgroundTap();
    }
    const ended = game.snapshot();
    assert.equal(ended.state, 'finished', `${cause} causes immediate game over`);
    assert.equal(ended.score, -settings.penalty);
    assert(ended.remaining > 0, 'Early game over preserves the stopped countdown');
    assert.equal(ended.active.length, 0);
    assert.equal(get('field').inert, true);
    assert.equal(get('overlay').hidden, false);
    assert.equal(get('pause').disabled, true);
    assert.equal(get('dialog-title').textContent, '負分了，遊戲結束！');
    assert.equal(get('dialog-tag').textContent, 'GAME OVER', 'A first negative record is never celebrated as a win');
    assert.equal(scoreService.completed.length, recordsBefore + 1, 'Early final scores are recorded once');
    assert.equal(scoreService.completed.at(-1).score, ended.score);
    game.hit(0);
    backgroundTap();
    game.pauseGame();
    game.resumeGame();
    advance(100);
    game.finish();
    assert.deepEqual(game.snapshot(), ended, 'No input, timer, or resume can revive a finished round');
    assert.equal(scoreService.completed.length, recordsBefore + 1);
  }
}

select(30);
assert.equal(get('mode').textContent, '簡易');
assert(get('mode-rules').textContent.includes('打空不扣分'), 'The picker previews the selected scoring rules');
assert(!get('dialog-note').textContent.includes('低於 0'), 'Easy mode does not describe negative scores');
game.startGame();
assert.equal(game.snapshot().hits, 0);
assert.equal(game.snapshot().errors, 0);
assert.equal(game.snapshot().wrongMoles, 0, 'Restart clears wrong-colored hits');
for (let tap = 0; tap < 20; tap++) backgroundTap();
assert.equal(game.snapshot().score, 0);
assert.equal(game.snapshot().state, 'running', 'Easy mode remains playable after mistakes at zero');
select(90);
assert.equal(game.snapshot().duration, 30, 'Hidden mode changes cannot change a live round');
assert.equal(get('mode').textContent, '簡易');
console.log('Mole game tests: passed (30 positions, longer red lifetimes, scoring, negative game over for blank/background/red, zero continues, easy without deductions, stopped clock/input, final score recorded once, pause/resume, embedded navigation, restart).');
