import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../board.html', import.meta.url), 'utf8');
const start = source.indexOf('function dayBatteryState(');
const end = source.indexOf('function updateClocks(', start);
assert(start >= 0 && end > start);
const elements = {
  'day-battery': {dataset:{}, setAttribute(key, value) {this[key] = value;}},
  'day-battery-fill': {style:{}},
  'day-battery-percent': {},
};
const api = vm.runInNewContext(`${source.slice(start,end)}\n({dayBatteryState, updateDayBattery})`, {
  Intl, Date, document:{getElementById:id => elements[id]},
});
const at = time => new Date(`2026-10-02T${time}+08:00`);
const cases = [
  ['00:00:00',100,'normal'], ['07:29:59',100,'normal'], ['07:30:00',100,'normal'],
  ['12:15:00',51,'normal'], ['12:20:00',50,'medium'], ['15:30:00',17,'low'],
  ['16:59:59',2,'low'], ['17:00:00',1,'low'], ['23:59:59',1,'low'],
];
for (const [time,percent,level] of cases) {
  const actual = api.dayBatteryState(at(time));
  assert.equal(actual.percent,percent,time);
  assert.equal(actual.level,level,time);
}
assert.equal(api.dayBatteryState(new Date('2026-10-02T09:00:00Z')).percent,1, 'Use Taipei time, not device timezone');
assert.equal(api.dayBatteryState(new Date('2026-10-03T07:30:00+08:00')).percent,100, 'Reset the following day');
let previous=100;
for(let minute=450;minute<=1020;minute++) {
  const percent = api.dayBatteryState(at(`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00`)).percent;
  assert(percent <= previous && percent >= 1 && percent <= 100, 'Battery must decrease without exceeding bounds');
  previous=percent;
}
api.updateDayBattery(at('15:30:00'));
assert.equal(elements['day-battery'].dataset.level,'low');
assert.equal(elements['day-battery']['aria-label'],'時間進度電量 17%');
assert.equal(elements['day-battery-percent'].textContent,'17%');
assert.equal(elements['day-battery-fill'].style.width,'17%');
assert(source.includes('updateDayBattery(now);') && source.includes('setInterval(updateClocks, 1000)'), 'Update through the existing clock; do not reload the page');
console.log('Day battery tests: passed (daily bounds, gradual decrease, colors, Taipei timezone, midnight reset, display update).');
