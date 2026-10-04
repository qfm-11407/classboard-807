// Gameplay tests use this small score service; the real service has its own tests.
export function createScoreFixture() {
  const completed = [], listeners = [], counts = new Map();
  return {
    completed,
    dailyBest(game, mode) { const rows = completed.filter(row => row.game === game && row.mode === String(mode)); return rows.length ? Math.max(...rows.map(row => row.score)) : null; },
    record(game, mode, score) { completed.push({ game, mode:String(mode), score }); listeners.forEach(fn=>fn()); },
    increment(game, mode, participant, label) { const key = `${game}:${mode}:${participant}`; const score = (counts.get(key)||0)+1; counts.set(key,score); this.record(game,mode,score); return score; },
    attach({ beforeOpen, onChange }) { listeners.push(onChange); this.beforeOpen = beforeOpen; },
  };
}
