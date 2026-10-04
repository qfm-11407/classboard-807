import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createScoreFixture } from './game-score-test-fixture.mjs';
const scoreService = createScoreFixture();

function element() {
  const classes = new Set(), selectors = new Map(), attributes = new Map();
  return {
    dataset: {}, children: [], listeners: {}, style: { setProperty() {} },
    classList: {
      add: name => classes.add(name),
      toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
      contains: name => classes.has(name),
    },
    append(child) { this.children.push(child); },
    setAttribute: (name, value) => attributes.set(name, value),
    addEventListener(name, listener) { this.listeners[name] = listener; },
    querySelector(selector) { if (!selectors.has(selector)) selectors.set(selector, element()); return selectors.get(selector); },
  };
}

const elements = new Map(), posts = [], back = element();
const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
const parent = { postMessage: (data, origin) => posts.push({ data, origin }) };
const source = fs.readFileSync(new URL('../games/tic-tac-toe.js', import.meta.url), 'utf8');
const game = vm.runInNewContext(`${source}\n({tables,winningLines,playAt:(table,cell)=>play(tables[table],cell),resetAt:index=>reset(tables[index]),snapshot:()=>tables.map(table=>table.state)})`, {
  document: { getElementById: get, createElement: element, fullscreenEnabled: false,
    querySelector: () => back, body: element(), addEventListener() {} },
  window: { ClassroomGameScores:scoreService, parent, location: { search: '?embedded=1', protocol: 'https:', origin: 'https://example.test' } },
  URLSearchParams, ResizeObserver: class { observe() {} },
});
const snapshot = () => JSON.parse(JSON.stringify(game.snapshot()));
const touch = (table, cell, isPrimary = true) => game.tables[table].buttons[cell].listeners.pointerdown({ button: 0, isPrimary, preventDefault() {}, stopPropagation() {} });
assert.equal(get('tables').children.length, 4);
assert(game.tables.every(table => table.buttons.length === 9));
assert(snapshot().every(state => state.turn === 'O' && !state.finished));

// Interleaved touch events must alternate only the table that received each event.
touch(0, 0);
touch(1, 4, false);
touch(0, 1);
touch(2, 8, false);
touch(3, 2, false);
touch(1, 3);
let states = snapshot();
assert.deepEqual(states.map(state => state.turn), ['O', 'O', 'X', 'X']);
assert.deepEqual(states.map(state => state.cells.filter(Boolean).length), [2, 2, 1, 1]);
assert.equal(states[1].cells[4], 'O', 'Secondary touch points are accepted');
const beforeDuplicate = snapshot();
game.tables[1].buttons[3].listeners.click({ detail: 1 });
touch(1, 3);
game.tables[1].buttons[0].listeners.pointerdown({ button: 2 });
assert.deepEqual(snapshot(), beforeDuplicate, 'Occupied cells, synthesized clicks and right-clicks do not change turns');
game.tables[3].buttons[0].listeners.click({ detail: 0 });
assert.equal(snapshot()[3].cells[0], 'X', 'Keyboard/assistive activation works');
const others = snapshot().slice(1);
game.tables[0].root.querySelector('.table-reset').listeners.click();
assert.deepEqual(snapshot().slice(1), others, 'Resetting one table leaves the other three untouched');
assert(snapshot()[0].cells.every(cell => cell === null));

// Verify every horizontal, vertical and diagonal win for both players.
const lines = JSON.parse(JSON.stringify(game.winningLines));
for (const mark of ['O', 'X']) {
  for (const line of lines) {
    game.resetAt(0);
    const available = Array.from({ length: 9 }, (_, index) => index).filter(index => !line.includes(index));
    const safeTriple = [];
    for (let a = 0; a < available.length && !safeTriple.length; a++) {
      for (let b = a + 1; b < available.length && !safeTriple.length; b++) {
        for (let c = b + 1; c < available.length && !safeTriple.length; c++) {
          const triple = [available[a], available[b], available[c]];
          if (!lines.some(indices => indices.every(index => triple.includes(index)))) safeTriple.push(...triple);
        }
      }
    }
    const sequence = mark === 'O'
      ? [line[0], available[0], line[1], available[1], line[2]]
      : [safeTriple[0], line[0], safeTriple[1], line[1], safeTriple[2], line[2]];
    for (const cell of sequence) assert(game.playAt(0, cell));
    const winner = snapshot()[0];
    assert.equal(winner.winner, mark);
    assert.equal(winner.finished, true);
    assert.deepEqual(winner.winning, line);
    assert(game.tables[0].buttons.every(button => button.disabled), 'Finished boards lock further moves');
    assert.equal(game.tables[0].buttons.filter(button => button.classList.contains('winning')).length, 3);
    assert.equal(game.playAt(0, available.at(-1)), false);
    assert.deepEqual(snapshot()[0], winner, 'A finished game cannot score twice');
    assert.deepEqual(snapshot().slice(1), others, 'Winning one table never changes another table');
  }
}
assert.deepEqual(snapshot()[0].scores, { O: 8, X: 8, draw: 0 });
assert.equal(scoreService.completed.length,16,'Each real victory updates daily wins once');
assert.equal(get('best').textContent,8);
game.resetAt(0);
for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) assert(game.playAt(0, cell));
assert.equal(snapshot()[0].finished, true);
assert.equal(snapshot()[0].winner, null);
assert.equal(snapshot()[0].scores.draw, 1);
assert.equal(scoreService.completed.length,16,'A draw is not counted as a victory');
assert.equal(game.tables[0].status.textContent, '平手，再來一局！');
const scores = snapshot()[0].scores;
game.resetAt(0);
assert.deepEqual(snapshot()[0].scores, scores, 'A new round preserves only that table’s own scores');
for (const index of [-1, 9, 1.5]) assert.equal(game.playAt(0, index), false);
assert.equal(back.textContent, '← 互動區');
back.listeners.click({ preventDefault() {} });
assert.equal(posts.at(-1).data.type, 'classroom-interaction-back');
assert.equal(posts.at(-1).origin, 'https://example.test');
console.log('OX tests: passed (four independent 3x3 boards, interleaved multi-touch, per-table turns/reset/scores, keyboard, all 16 winning cases, draw, game locking, embedded back).');
