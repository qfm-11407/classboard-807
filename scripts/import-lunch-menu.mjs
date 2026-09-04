import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const SCHOOL_ID = '64736678';
const SOURCE_URL = 'https://fatraceschool.k12ea.gov.tw/frontend/search.html?school=64736678';
const API_BASE = 'https://fatraceschool.k12ea.gov.tw';
const OUTPUT = resolve('data/monthly-menu.json');
const BROWSER_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  Referer: SOURCE_URL,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

function taipeiMonth() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const pick = type => parts.find(part => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}`;
}

function selectedMonth() {
  const value = String(process.argv[2] || process.env.INPUT_MONTH || taipeiMonth()).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('月份格式必須為 YYYY-MM。');
  return value;
}

function datesInMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

async function api(path, params) {
  const url = new URL(path, API_BASE);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: BROWSER_HEADERS });
  if (!response.ok) throw new Error(`${response.status} ${url.pathname}`);
  const payload = await response.json();
  if (!payload?.result) throw new Error(payload?.message || `公開菜單服務未回傳資料：${url.pathname}`);
  return Array.isArray(payload.data) ? payload.data : [];
}

async function lunchServiceIds(firstDate) {
  const services = await api('/offering/service', { SchoolId: SCHOOL_ID, period: firstDate });
  const ids = services.filter(service => /午餐/.test(String(service.label || '')) && !/設計/.test(String(service.label || ''))).map(service => String(service.ServiceId));
  return ids.length ? ids : ['1'];
}

async function dishesForDate(date, serviceIds) {
  // 公開搜尋頁使用 /offered/meal；meal2 是另一種登入後資料格式，會回傳空白資料。
  const meals = (await Promise.all(serviceIds.map(serviceId => api('/offered/meal', { SchoolId: SCHOOL_ID, period: date, MenuType: serviceId, KitchenId: 'all' })))).flat();
  const batches = [...new Set(meals.map(meal => meal?.BatchDataId).filter(Boolean))];
  if (!batches.length) return [];
  const collections = await Promise.all(batches.map(batchId => api('/dish', { BatchDataId: batchId })));
  return [...new Set(collections.flat().map(dish => String(dish?.DishName || '').trim()).filter(name => name && name !== '調味料'))];
}

async function readExisting() {
  try { return JSON.parse(await readFile(OUTPUT, 'utf8')); } catch (_) { return { monthlyMenus: {} }; }
}

const month = selectedMonth();
const days = datesInMonth(month);
const serviceIds = await lunchServiceIds(days[0]);
const imported = {};

for (const date of days) {
  const dishes = await dishesForDate(date, serviceIds);
  if (dishes.length) imported[date] = dishes.join('、');
}

const existing = await readExisting();
const output = {
  updatedAt: new Date().toISOString(),
  source: { name: '教育部校園食材登錄平臺', schoolId: SCHOOL_ID, url: SOURCE_URL },
  monthlyMenus: { ...(existing.monthlyMenus || {}), [month]: imported },
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`已更新 ${month}：${Object.keys(imported).length} 天有菜單。`);
