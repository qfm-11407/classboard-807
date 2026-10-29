import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const teacher = fs.readFileSync(new URL('../teacher.html', import.meta.url), 'utf8');
const start = teacher.indexOf('    function printSeatingAndCadres() {');
const end = teacher.indexOf("    $('print-seating-cadres').addEventListener", start);
assert(start >= 0 && end > start);
const source = teacher.slice(start, end);
const students = [{ seat: 1, name: '學生甲' }, { seat: 3, name: '學生乙' }, { seat: 14, name: '學生丙' }];
const layout = [14, null, 1, 3, ...Array(26).fill(null)];
const leaveData = { fullDay: [14], morning: [3], afternoon: [1] };
const before = JSON.stringify({ students, layout, leaveData });
const config = [
  { id: 'class', name: '班級幹部', roles: [{ id: 'leader', name: '班長' }] },
  { id: 'subject', name: '各科小老師', roles: [{ id: 'chinese', name: '國文小老師' }, { id: 'english', name: '英文小老師' }] }
];
let html = '', closed = 0, focused = 0, printed = 0, blocked = false;
const messages = [];
const escapeHTML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const context = {
  roster: () => students,
  normalizedSeatingLayout: () => layout,
  cadreConfig: () => config,
  cadreAssignments: () => ({ leader: [14, 1], chinese: [3] }),
  currentAbsentSeats: () => { throw new Error('Printing must not read attendance'); },
  writeJSON: () => { throw new Error('Printing must not change classroom data'); },
  escapeHTML, taipeiDay: () => '2026-10-29',
  message: (id, text) => messages.push([id, text]),
  setTimeout: callback => callback(),
  window: { open: () => blocked ? null : {
    document: { write: value => { html = value; }, close: () => { closed++; } },
    focus: () => { focused++; }, print: () => { printed++; }
  } }
};
vm.createContext(context);
vm.runInContext(source, context);
context.printSeatingAndCadres();
const body = html.slice(html.indexOf('<body>'));
assert(!/absent|請假|缺席|leave-/.test(body), 'Printed cards have neither leave labels nor leave styling classes');
assert.equal((body.match(/class="seat"/g) || []).length, 3);
assert.equal((body.match(/class="seat empty"/g) || []).length, 27);
assert(body.indexOf('14 號') < body.indexOf('01 號'), 'Keep actual seating order');
assert(body.includes('14 學生丙、01 學生甲'));
assert(body.includes('03 學生乙'));
assert(body.includes('英文小老師</b><span>待指派'));
assert(html.includes('@page{size:A4 portrait'));
assert(html.includes('grid-template-rows:1fr 1fr'));
assert.deepEqual([closed, focused, printed], [1, 1, 1]);
assert.equal(JSON.stringify({ students, layout, leaveData }), before, 'Leave records and seat assignments remain untouched');
// Leave-independent output also handles names containing HTML characters safely.
students[0].name = '<學生&甲>';
context.printSeatingAndCadres();
assert(html.includes('&lt;學生&amp;甲&gt;'));
blocked = true;
context.printSeatingAndCadres();
assert.equal(messages.at(-1)[0], 'seating-message');
assert(messages.at(-1)[1].includes('允許瀏覽器彈出式視窗'));
for (const match of teacher.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if (match[1].trim()) new vm.Script(match[1]);
}
console.log('Seating print: passed (no attendance reads or labels, actual layout, cadre assignments, A4 half-page layout, escaping, popup feedback, no data mutations).');
