const STATE_ID = 'class-807';
const MAX_STATE_SIZE = 750000;
const ALLOWED_KEYS = new Set([
  'classroomTotalStudents', 'classroomStudentNames', 'classroomStudentRoster', 'classSeating', 'classroomSeatingLayout',
  'classTimetable', 'classTimeSlots', 'examSchedule', 'examScheduleDays', 'examDayCount', 'examActiveDay', 'subjectData',
  'dailyTasks', 'todayTasks', 'tomorrowTasks', 'taskHistory', 'taskDate', 'cleaningTasks', 'cleaningTaskConfig',
  'cleaningAssignments', 'dutyAssignments', 'lunchAssignments', 'lunchCategoryLimits', 'monthlyMenus', 'notebookCheckins',
]);

function cors(request, env) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : allowed),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Classroom-Submit-Password',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Vary': 'Origin',
  };
}
function json(request, env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request, env), ...extra } });
}
function parseJSON(value, fallback) { try { const parsed = JSON.parse(value); return parsed ?? fallback; } catch { return fallback; } }
function taipeiDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); }
function decodeBasic(value) {
  if (!value?.startsWith('Basic ')) return null;
  try { const decoded = atob(value.slice(6)); const at = decoded.indexOf(':'); return at < 0 ? null : [decoded.slice(0, at), decoded.slice(at + 1)]; } catch { return null; }
}
function hasValidCredentials(request, env) {
  const credentials = decodeBasic(request.headers.get('authorization'));
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD && credentials && credentials[0] === env.ADMIN_USERNAME && credentials[1] === env.ADMIN_PASSWORD);
}
function hasSubmitPassword(request, env) { return Boolean(env.SUBMIT_PASSWORD || env.ADMIN_PASSWORD) && request.headers.get('x-classroom-submit-password') === (env.SUBMIT_PASSWORD || env.ADMIN_PASSWORD); }
function unauthorized(request, env) { return json(request, env, { error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Basic realm="Classroom Admin"' }); }
function sanitizeData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const clean = {}; let size = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_KEYS.has(key) || typeof value !== 'string') continue;
    size += value.length; if (size > MAX_STATE_SIZE) return null; clean[key] = value;
  }
  return clean;
}
function rollTasks(data) {
  const next = { ...data }, today = taipeiDate(), savedDate = parseJSON(next.taskDate, '');
  const legacy = Array.isArray(parseJSON(next.dailyTasks, [])) ? parseJSON(next.dailyTasks, []) : [];
  const current = Array.isArray(parseJSON(next.todayTasks, legacy)) ? parseJSON(next.todayTasks, legacy) : legacy;
  if (!savedDate) { next.todayTasks = JSON.stringify(current); next.taskDate = JSON.stringify(today); return next; }
  if (savedDate === today) return next;
  const history = parseJSON(next.taskHistory, {}); if (current.length) history[savedDate] = current;
  const tomorrow = parseJSON(next.tomorrowTasks, []);
  next.todayTasks = JSON.stringify(Array.isArray(tomorrow) ? tomorrow : []); next.tomorrowTasks = '[]';
  next.taskHistory = JSON.stringify(history); next.taskDate = JSON.stringify(today); return next;
}
async function readState(env) {
  const row = await env.DB.prepare('SELECT data, updated_at FROM classroom_state WHERE id = ?1').bind(STATE_ID).first();
  return { data: parseJSON(row?.data, {}), updatedAt: row?.updated_at || null };
}
async function saveState(env, data, updatedAt = new Date().toISOString()) {
  await env.DB.prepare('INSERT INTO classroom_state (id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(STATE_ID, JSON.stringify(data), updatedAt).run();
  return updatedAt;
}
async function currentState(env) {
  const state = await readState(env), data = rollTasks(state.data);
  if (JSON.stringify(data) !== JSON.stringify(state.data)) state.updatedAt = await saveState(env, data);
  return { data, updatedAt: state.updatedAt };
}
async function readJson(request, env) { try { return await request.json(); } catch { throw json(request, env, { error: 'Invalid JSON' }, 400); } }
async function registerLunchApi(request, env) {
  if (!hasValidCredentials(request, env)) return unauthorized(request, env);
  const body = await readJson(request, env), account = String(body?.account || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || account.length > 254) return json(request, env, { error: 'Valid email is required' }, 400);
  try {
    const response = await fetch('https://fatraceschool.k12ea.gov.tw/cateringservice/openapi/v1/accountReg/', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ account }),
    });
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await response.json() : { message: await response.text() };
    if (!response.ok) return json(request, env, { error: String(payload?.message || 'Registration request failed').slice(0, 300) }, response.status);
    return json(request, env, { ok: true, message: String(payload?.message || '申請已送出，請至信箱收取存取碼。').slice(0, 300) });
  } catch { return json(request, env, { error: 'Unable to contact the school food platform' }, 502); }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
    const url = new URL(request.url), action = url.searchParams.get('action'), admin = url.searchParams.get('admin') === '1';
    if (url.pathname !== '/api/classroom') return json(request, env, { error: 'Not found' }, 404);
    try {
      if (request.method === 'GET') {
        if (admin && !hasValidCredentials(request, env)) return unauthorized(request, env);
        const state = await currentState(env);
        return json(request, env, { hasData: Object.keys(state.data).length > 0, data: state.data, updatedAt: state.updatedAt });
      }
      if (request.method === 'PUT') {
        if (!hasValidCredentials(request, env)) return unauthorized(request, env);
        const body = await readJson(request, env), data = sanitizeData(body.data);
        if (!data) return json(request, env, { error: 'Invalid classroom data' }, 400);
        return json(request, env, { ok: true, updatedAt: await saveState(env, rollTasks(data)) });
      }
      if (request.method === 'POST' && action === 'lunch-api-register') return registerLunchApi(request, env);
      if (request.method === 'POST' && action === 'tomorrow') {
        if (!hasSubmitPassword(request, env)) return json(request, env, { error: 'Unauthorized' }, 401);
        const body = await readJson(request, env), text = String(body?.text || '').trim().slice(0, 500);
        if (!text) return json(request, env, { error: 'Task text is required' }, 400);
        const state = await currentState(env), tomorrow = parseJSON(state.data.tomorrowTasks, []);
        if (!Array.isArray(tomorrow)) return json(request, env, { error: 'Invalid task data' }, 400);
        const handwriting = typeof body?.handwriting === 'string' && body.handwriting.startsWith('data:image/png;base64,') && body.handwriting.length <= 160000 ? body.handwriting : '';
        tomorrow.push({ id: crypto.randomUUID(), text, author: String(body?.author || '').trim().slice(0, 100), subject: String(body?.subject || '其他').trim().slice(0, 40), handwriting, createdAt: new Date().toISOString() });
        state.data.tomorrowTasks = JSON.stringify(tomorrow); const clean = sanitizeData(state.data);
        if (!clean) return json(request, env, { error: 'Task data is too large' }, 400);
        return json(request, env, { ok: true, updatedAt: await saveState(env, clean) });
      }
      if (request.method === 'POST' && action === 'course') {
        const body = await readJson(request, env), subject = String(body?.subject || '').trim().slice(0, 40), operation = body?.operation;
        if (!subject || !['create', 'toggle'].includes(operation)) return json(request, env, { error: 'Invalid course request' }, 400);
        if (operation === 'create' && !hasSubmitPassword(request, env)) return json(request, env, { error: 'Unauthorized' }, 401);
        const state = await currentState(env), subjectData = parseJSON(state.data.subjectData, {});
        if (!subjectData || typeof subjectData !== 'object' || Array.isArray(subjectData)) return json(request, env, { error: 'Invalid course data' }, 400);
        if (!Array.isArray(subjectData[subject])) subjectData[subject] = [];
        const roster = parseJSON(state.data.classroomStudentRoster, []), maxSeat = Array.isArray(roster) ? Math.max(0, ...roster.map(student => Number(student?.seat) || 0)) : 0;
        if (operation === 'create') {
          const name = String(body?.name || '').trim().slice(0, 200); if (!name) return json(request, env, { error: 'Task name is required' }, 400);
          subjectData[subject].push({ id: crypto.randomUUID(), name, records: Array(maxSeat).fill(false) });
        } else {
          const seat = Number(body?.seat), task = subjectData[subject].find(item => item?.id === body?.taskId);
          if (!task || !Number.isInteger(seat) || seat < 1 || seat > maxSeat) return json(request, env, { error: 'Invalid completion request' }, 400);
          const records = Array.isArray(task.records) ? task.records : [];
          task.records = Array.from({ length: maxSeat }, (_, index) => index === seat - 1 ? !Boolean(records[index]) : Boolean(records[index]));
        }
        state.data.subjectData = JSON.stringify(subjectData); const clean = sanitizeData(state.data);
        if (!clean) return json(request, env, { error: 'Course data is too large' }, 400);
        return json(request, env, { ok: true, subjectData: clean.subjectData, updatedAt: await saveState(env, clean) });
      }
      if (request.method === 'POST' && action === 'notebook') {
        const body = await readJson(request, env), seat = Number(body?.seat), date = String(body?.date || '');
        if (!Number.isInteger(seat) || seat < 1 || seat > 60 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(request, env, { error: 'Invalid check-in' }, 400);
        const state = await currentState(env), roster = parseJSON(state.data.classroomStudentRoster, []);
        if (!Array.isArray(roster) || !roster.some(student => Number(student?.seat) === seat)) return json(request, env, { error: 'Student not found' }, 404);
        const checkins = parseJSON(state.data.notebookCheckins, {}); if (!checkins[date]) checkins[date] = {};
        if (checkins[date][seat]) return json(request, env, { error: 'Already checked in' }, 409);
        checkins[date][seat] = new Date().toISOString(); state.data.notebookCheckins = JSON.stringify(checkins); const clean = sanitizeData(state.data);
        if (!clean) return json(request, env, { error: 'Data is too large' }, 400);
        return json(request, env, { ok: true, timestamp: checkins[date][seat], updatedAt: await saveState(env, clean) });
      }
      return json(request, env, { error: 'Method not allowed' }, 405, { Allow: 'GET, POST, PUT' });
    } catch (error) {
      if (error instanceof Response) return error;
      console.error(error); return json(request, env, { error: 'Server configuration error. Confirm the D1 binding and schema.' }, 500);
    }
  },
};
