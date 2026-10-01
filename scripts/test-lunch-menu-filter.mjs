import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function loadFunction(file, name, nextName, context) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end = source.indexOf(`function ${nextName}(`, start);
  assert(start >= 0 && end > start);
  const body = source.slice(start, end).replace(/async\s*$/, '').trim();
  return vm.runInNewContext(`(${body})`, context);
}

const expected = ['燕麥飯', '紅蘿蔔炒蛋', '雙花燴豆包', '枸杞空心菜', '冬瓜檸檬愛玉', '全脂鮮奶'];
const names = [...expected, '調味料', ' 調味料(1) ', '調味料（2）', '調味料(1)調味料(1)', '午餐調味料', '調味雞肉', '', null, expected[0]];
// A name without the requested keyword remains intact; do not filter all ingredients.
const retained = [...expected, '調味雞肉'];
const dishes = names.map(DishName => ({ DishName }));

const automated = loadFunction('scripts/import-lunch-menu.mjs', 'dishesForDate', 'readExisting', {
  SCHOOL_ID: '64736678',
  api: async path => path === '/offered/meal' ? [{ BatchDataId: 'batch' }] : dishes,
});
assert.deepEqual(Array.from(await automated('2026-10-01', ['1'])), retained);

const menus = { '2026-10': { '2026-10-02': '既有菜單' } }, button = {}, feedback = [];
const manual = loadFunction('teacher.html', 'importPublicMonthlyMenu', 'ensureMenuImportButton', {
  $: () => button, menuMonth: () => '2026-10', MENU_SCHOOL_ID: '64736678',
  publicMenuApi: async (path, params) => path === '/offering/service' ? [{ label: '午餐', ServiceId: 1 }]
    : path === '/offered/meal' ? (params.period === '2026-10-01' ? [{ BatchDataId: 'batch' }] : []) : dishes,
  readJSON: () => menus, writeJSON: (key, data) => { assert.equal(key, 'monthlyMenus'); assert.equal(data, menus); },
  renderMonthlyMenu: () => {}, showMenuFeedback: text => feedback.push(text),
});
await manual();
assert.equal(menus['2026-10']['2026-10-01'], retained.join('、'));
assert.equal(menus['2026-10']['2026-10-02'], '既有菜單');
assert.equal(button.disabled, false);
assert(feedback.at(-1).includes('已匯入 1 天'));

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const element = {};
let storedMenu = names.filter(Boolean).join('、'), importedMenu = '';
const display = loadFunction('board.html', 'renderLunchMenu', 'renderLunchGrid', {
  document: { getElementById: () => element },
  localStorage: { getItem: () => JSON.stringify({ [today.slice(0, 7)]: { [today]: storedMenu } }) },
  publicMenuDish: () => importedMenu, escapeHTML: text => text, renderLunchGrid: () => {}, Intl, Date,
});
display();
assert(!element.innerHTML.includes('調味料'), 'Legacy stored menus must also hide seasonings');
expected.forEach(name => assert(element.innerHTML.includes(name)));
storedMenu = ''; importedMenu = '燕麥飯、調味料（1）'; display();
assert(element.innerHTML.includes('燕麥飯') && !element.innerHTML.includes('調味料'));
storedMenu = '調味料(1)、調味料（2）'; display();
assert(element.innerHTML.includes('今日菜單<br>尚未設定'), 'A seasoning-only menu must not leave an empty display');
console.log('Lunch menu filter tests: passed (manual import, automatic import, stored/public display, empty fallback).');
