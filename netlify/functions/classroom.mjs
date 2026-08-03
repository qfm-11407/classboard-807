import { getStore } from '@netlify/blobs'

const STORE_NAME = 'classroom-data'
const STATE_KEY = 'current'
const ALLOWED_KEYS = new Set([
  'classroomTotalStudents',
  'classroomStudentNames',
  'classroomStudentRoster',
  'classSeating',
  'classroomSeatingLayout',
  'classTimetable',
  'classTimeSlots',
  'examSchedule',
  'examScheduleDays',
  'examDayCount',
  'examActiveDay',
  'subjectData',
  'dailyTasks',
  'todayTasks',
  'tomorrowTasks',
  'taskHistory',
  'taskDate',
  'cleaningTasks',
  'cleaningTaskConfig',
  'cleaningAssignments',
  'dutyAssignments',
  'lunchAssignments',
  'lunchCategoryLimits',
  'monthlyMenus',
  'notebookCheckins',
])

const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
})

function hasValidCredentials(request) {
  const expectedUsername = process.env.ADMIN_USERNAME
  const expectedPassword = process.env.ADMIN_PASSWORD
  if (!expectedUsername || !expectedPassword) return false

  const authorization = request.headers.get('authorization') || ''
  if (!authorization.startsWith('Basic ')) return false

  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator < 0) return false
    const username = decoded.slice(0, separator)
    const password = decoded.slice(separator + 1)
    return username === expectedUsername && password === expectedPassword
  } catch {
    return false
  }
}

function unauthorized() {
  return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Basic realm="Classroom Admin"' })
}

function hasSubmitPassword(request) {
  const expected = process.env.SUBMIT_PASSWORD || process.env.ADMIN_PASSWORD
  const received = request.headers.get('x-classroom-submit-password') || ''
  return Boolean(expected) && received === expected
}

const parseJSON = (value, fallback) => {
  try { const parsed = JSON.parse(value); return parsed ?? fallback } catch { return fallback }
}
const taipeiDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())

function rollTasks(data) {
  const next = { ...data }
  const today = taipeiDate()
  const savedDate = parseJSON(next.taskDate, '')
  const legacyTasks = Array.isArray(parseJSON(next.dailyTasks, [])) ? parseJSON(next.dailyTasks, []) : []
  const currentTasks = Array.isArray(parseJSON(next.todayTasks, legacyTasks)) ? parseJSON(next.todayTasks, legacyTasks) : legacyTasks

  if (!savedDate) {
    next.todayTasks = JSON.stringify(currentTasks)
    next.taskDate = JSON.stringify(today)
    return next
  }
  if (savedDate === today) return next

  const history = parseJSON(next.taskHistory, {})
  if (currentTasks.length) history[savedDate] = currentTasks
  const tomorrow = parseJSON(next.tomorrowTasks, [])
  next.todayTasks = JSON.stringify(Array.isArray(tomorrow) ? tomorrow : [])
  next.tomorrowTasks = '[]'
  next.taskHistory = JSON.stringify(history)
  next.taskDate = JSON.stringify(today)
  return next
}

function sanitizeData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const clean = {}
  let size = 0

  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_KEYS.has(key) || typeof value !== 'string') continue
    size += value.length
    if (size > 750000) return null
    clean[key] = value
  }
  return clean
}

export default async function classroom(request) {
  const url = new URL(request.url)
  const adminRequest = url.searchParams.get('admin') === '1'
  const action = url.searchParams.get('action')
  const store = getStore(STORE_NAME)

  if (request.method === 'GET') {
    if (adminRequest && !hasValidCredentials(request)) return unauthorized()
    const state = await store.get(STATE_KEY, { type: 'json' })
    const data = rollTasks(state?.data || {})
    const changed = JSON.stringify(data) !== JSON.stringify(state?.data || {})
    const updatedAt = changed ? new Date().toISOString() : state?.updatedAt || null
    if (changed) await store.setJSON(STATE_KEY, { data, updatedAt })
    return json({ hasData: Object.keys(data).length > 0, data, updatedAt })
  }

  if (request.method === 'POST' && action === 'tomorrow') {
    if (!hasSubmitPassword(request)) return json({ error: 'Unauthorized' }, 401)
    let body
    try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
    const text = String(body?.text || '').trim().slice(0, 500)
    const author = String(body?.author || '').trim().slice(0, 100)
    const subject = String(body?.subject || '其他').trim().slice(0, 40)
    const handwriting = typeof body?.handwriting === 'string' && body.handwriting.startsWith('data:image/png;base64,') && body.handwriting.length <= 160000 ? body.handwriting : ''
    if (!text) return json({ error: 'Task text is required' }, 400)

    const state = await store.get(STATE_KEY, { type: 'json' })
    const data = rollTasks(state?.data || {})
    const tomorrow = parseJSON(data.tomorrowTasks, [])
    if (!Array.isArray(tomorrow)) return json({ error: 'Invalid task data' }, 400)
    tomorrow.push({ id: crypto.randomUUID(), text, author, subject, handwriting, createdAt: new Date().toISOString() })
    data.tomorrowTasks = JSON.stringify(tomorrow)
    const clean = sanitizeData(data)
    if (!clean) return json({ error: 'Task data is too large' }, 400)
    const updatedAt = new Date().toISOString()
    await store.setJSON(STATE_KEY, { data: clean, updatedAt })
    return json({ ok: true, updatedAt })
  }

  if (request.method === 'POST' && action === 'course') {
    let body
    try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
    const subject = String(body?.subject || '').trim().slice(0, 40)
    const operation = body?.operation
    if (!subject || !['create', 'toggle'].includes(operation)) return json({ error: 'Invalid course request' }, 400)
    if (operation === 'create' && !hasSubmitPassword(request)) return json({ error: 'Unauthorized' }, 401)

    const state = await store.get(STATE_KEY, { type: 'json' })
    const data = rollTasks(state?.data || {})
    const subjectData = parseJSON(data.subjectData, {})
    if (!subjectData || typeof subjectData !== 'object' || Array.isArray(subjectData)) return json({ error: 'Invalid course data' }, 400)
    if (!Array.isArray(subjectData[subject])) subjectData[subject] = []
    const roster = parseJSON(data.classroomStudentRoster, [])
    const maxSeat = Array.isArray(roster) ? Math.max(0, ...roster.map(student => Number(student?.seat) || 0)) : 0

    if (operation === 'create') {
      const name = String(body?.name || '').trim().slice(0, 200)
      if (!name) return json({ error: 'Task name is required' }, 400)
      subjectData[subject].push({ id: crypto.randomUUID(), name, records: Array(maxSeat).fill(false) })
    } else {
      const seat = Number(body?.seat), task = subjectData[subject].find(item => item?.id === body?.taskId)
      if (!task || !Number.isInteger(seat) || seat < 1 || seat > maxSeat) return json({ error: 'Invalid completion request' }, 400)
      const records = Array.isArray(task.records) ? task.records : []
      task.records = Array.from({ length: maxSeat }, (_, index) => index === seat - 1 ? !Boolean(records[index]) : Boolean(records[index]))
    }

    data.subjectData = JSON.stringify(subjectData)
    const clean = sanitizeData(data)
    if (!clean) return json({ error: 'Course data is too large' }, 400)
    const updatedAt = new Date().toISOString()
    await store.setJSON(STATE_KEY, { data: clean, updatedAt })
    return json({ ok: true, subjectData: data.subjectData, updatedAt })
  }

  if (request.method === 'POST' && action === 'notebook') {
    let body
    try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
    const seat = Number(body?.seat), date = String(body?.date || '')
    if (!Number.isInteger(seat) || seat < 1 || seat > 60 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Invalid check-in' }, 400)
    const state = await store.get(STATE_KEY, { type: 'json' })
    const data = rollTasks(state?.data || {})
    const roster = parseJSON(data.classroomStudentRoster, [])
    if (!Array.isArray(roster) || !roster.some(student => Number(student?.seat) === seat)) return json({ error: 'Student not found' }, 404)
    const checkins = parseJSON(data.notebookCheckins, {})
    if (!checkins[date]) checkins[date] = {}
    if (checkins[date][seat]) return json({ error: 'Already checked in' }, 409)
    checkins[date][seat] = new Date().toISOString()
    data.notebookCheckins = JSON.stringify(checkins)
    const clean = sanitizeData(data)
    if (!clean) return json({ error: 'Data is too large' }, 400)
    const updatedAt = new Date().toISOString()
    await store.setJSON(STATE_KEY, { data: clean, updatedAt })
    return json({ ok: true, timestamp: checkins[date][seat], updatedAt })
  }

  if (request.method === 'POST' && action === 'lunch-api-register') {
    if (!hasValidCredentials(request)) return unauthorized()
    let body
    try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
    const account = String(body?.account || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || account.length > 254) return json({ error: 'Valid email is required' }, 400)

    try {
      const response = await fetch('https://fatraceschool.k12ea.gov.tw/cateringservice/openapi/v1/accountReg/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ account }),
      })
      const contentType = response.headers.get('content-type') || ''
      const payload = contentType.includes('application/json') ? await response.json() : { message: await response.text() }
      if (!response.ok) return json({ error: String(payload?.message || 'Registration request failed').slice(0, 300) }, response.status)
      return json({ ok: true, message: String(payload?.message || '申請已送出，請至信箱收取存取碼。').slice(0, 300) })
    } catch {
      return json({ error: 'Unable to contact the school food platform' }, 502)
    }
  }

  if (request.method === 'PUT') {
    if (!hasValidCredentials(request)) return unauthorized()
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    const data = sanitizeData(body.data)
    if (!data) return json({ error: 'Invalid classroom data' }, 400)

    const state = { data: rollTasks(data), updatedAt: new Date().toISOString() }
    await store.setJSON(STATE_KEY, state)
    return json({ ok: true, updatedAt: state.updatedAt })
  }

  return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST, PUT' })
}

export const config = { path: '/api/classroom' }
