const $ = id => document.getElementById(id);
const winningLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const symbols = {
  O: '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" stroke-width="6"/></svg>',
  X: '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="M12 12L52 52M52 12L12 52" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>',
};

function createTable(index) {
  // Each invocation owns new cells, scores and turn state; nothing is shared between tables.
  const state = { cells: Array(9).fill(null), turn: 'O', finished: false, winner: null, winning: [], scores: { O: 0, X: 0, draw: 0 } };
  const root = document.createElement('article');
  root.className = 'ox-table';
  root.dataset.table = index;
  root.setAttribute('aria-label', `第 ${index + 1} 桌`);
  root.innerHTML = `<header class="table-head"><h2><span class="table-number" aria-hidden="true">0${index + 1}</span>第 ${index + 1} 桌</h2><div class="turn-badge" role="status" aria-live="polite" aria-atomic="true"></div></header><div class="table-body"><div class="ox-board" role="group" aria-label="第 ${index + 1} 桌棋盤，3 欄 3 列"></div></div><footer class="table-footer"><div class="table-scores" aria-label="此桌戰績"><span class="score-o">O <b data-score="O">0</b></span><span class="score-x">X <b data-score="X">0</b></span><span>和 <b data-score="draw">0</b></span></div><button type="button" class="table-reset" aria-label="重開第 ${index + 1} 桌">重開此桌 ↻</button></footer>`;
  const board = root.querySelector('.ox-board');
  const status = root.querySelector('.turn-badge');
  const scoreLabels = Object.fromEntries(['O', 'X', 'draw'].map(mark => [mark, root.querySelector(`[data-score="${mark}"]`)]));
  const table = { index, state, root, board, status, scoreLabels, buttons: [] };
  table.buttons = Array.from({ length: 9 }, (_, cellIndex) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'ox-cell';
    cell.dataset.cell = cellIndex;
    cell.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      // Secondary touch points must work too: do not filter by isPrimary.
      event.preventDefault();
      event.stopPropagation();
      play(table, cellIndex);
    });
    // Pointer activation is handled above; only keyboard/assistive clicks use this path.
    cell.addEventListener('click', event => { if (event.detail === 0) play(table, cellIndex); });
    board.append(cell);
    return cell;
  });
  root.querySelector('.table-reset').addEventListener('click', () => reset(table));
  $('tables').append(root);
  new ResizeObserver(() => {
    const body = root.querySelector('.table-body');
    board.style.setProperty('--board-side', `${Math.min(body.clientWidth, body.clientHeight)}px`);
  }).observe(root.querySelector('.table-body'));
  render(table);
  return table;
}

function render(table) {
  const { state, index } = table;
  table.root.classList.toggle('finished', state.finished);
  table.status.dataset.mark = state.winner || (state.finished ? '' : state.turn);
  table.status.textContent = state.finished ? (state.winner ? `${state.winner} 獲勝！` : '平手，再來一局！') : `輪到 ${state.turn}`;
  table.buttons.forEach((button, cellIndex) => {
    const mark = state.cells[cellIndex];
    button.dataset.mark = mark || '';
    button.innerHTML = mark ? symbols[mark] : '';
    button.disabled = Boolean(mark) || state.finished;
    button.classList.toggle('winning', state.winning.includes(cellIndex));
    const row = Math.floor(cellIndex / 3) + 1;
    const column = cellIndex % 3 + 1;
    button.setAttribute('aria-label', `第 ${index + 1} 桌，第 ${row} 列第 ${column} 欄，${mark || '空格'}`);
  });
  for (const mark of ['O', 'X', 'draw']) table.scoreLabels[mark].textContent = state.scores[mark];
}

function play(table, cellIndex) {
  const { state } = table;
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8 || state.finished || state.cells[cellIndex]) return false;
  const mark = state.turn;
  state.cells[cellIndex] = mark;
  const line = winningLines.find(indices => indices.every(index => state.cells[index] === mark));
  if (line) {
    state.finished = true;
    state.winner = mark;
    state.winning = [...line];
    state.scores[mark] += 1;
    window.ClassroomGameScores.increment('tic-tac-toe', 'wins', `${table.index}:${mark}`, `第 ${table.index + 1} 桌 · ${mark}`);
  } else if (state.cells.every(Boolean)) {
    state.finished = true;
    state.scores.draw += 1;
  } else {
    state.turn = mark === 'O' ? 'X' : 'O';
  }
  render(table);
  return true;
}

function reset(table) {
  // Only this table's current round resets. Its scores and all other tables stay intact.
  table.state.cells = Array(9).fill(null);
  table.state.turn = 'O';
  table.state.finished = false;
  table.state.winner = null;
  table.state.winning = [];
  render(table);
}

const tables = Array.from({ length: 4 }, (_, index) => createTable(index));
const updateDailyBest = () => { $('best').textContent = window.ClassroomGameScores.dailyBest('tic-tac-toe', 'wins') ?? '—'; };
window.ClassroomGameScores.attach({ trigger:$('open-score-rank'), game:'tic-tac-toe', mode:()=>'wins', title:'圈叉對決', modeLabel:()=>'各裝置／桌 O／X 每日累積勝場', unit:'勝', onChange:updateDailyBest });
updateDailyBest();

$('fullscreen').hidden = !document.fullscreenEnabled;
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('game').requestFullscreen();
  } catch { $('announcement').textContent = '目前瀏覽器無法開啟全螢幕，仍可繼續遊戲。'; }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? '離開全螢幕' : '全螢幕'; });

if (new URLSearchParams(window.location.search).has('embedded') && window.parent !== window) {
  document.body.classList.add('embedded');
  const back = document.querySelector('.back-link');
  back.textContent = '← 互動區';
  back.addEventListener('click', event => {
    event.preventDefault();
    window.parent.postMessage({ type: 'classroom-interaction-back' }, window.location.protocol === 'file:' ? '*' : window.location.origin);
  });
}
