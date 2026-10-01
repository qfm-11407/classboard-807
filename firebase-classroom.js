/* Firebase classroom data adapter. The configuration object only contains public web identifiers. */
(function () {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyB-BwDBWaAMM7_-dHQui78cntZ4fi_ydxY',
    authDomain: 'colabprogram-c8014.firebaseapp.com',
    projectId: 'colabprogram-c8014',
    storageBucket: 'colabprogram-c8014.firebasestorage.app',
    messagingSenderId: '900230173526',
    appId: '1:900230173526:web:91277f640ea00893b33cf7',
    measurementId: 'G-0LWM5RLK1T',
  };
  const CLASSROOM_ID = 'classboard-807';
  const TEACHER_DOMAIN = '@qfm.kh.edu.tw';

  if (!window.firebase) {
    throw new Error('Firebase SDK failed to load.');
  }

  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth(app);
  const db = firebase.firestore(app);
  const classroomRef = db.collection('classrooms').doc(CLASSROOM_ID);
  const completionRef = classroomRef.collection('courseCompletions');
  const checkinRef = classroomRef.collection('notebookCheckins');
  const tomorrowRef = classroomRef.collection('tomorrowSubmissions');
  const stickyMessagesRef = classroomRef.collection('stickyMessages');
  const dailyConfirmationRef = classroomRef.collection('teacherPrivate').doc('dailyConfirmation');
  const deleteRequestRef = classroomRef.collection('deleteRequests');
  const editRequestRef = classroomRef.collection('editRequests');
  const restorePointsRef = classroomRef.collection('restorePoints');
  const restoreMetaRef = classroomRef.collection('teacherPrivate').doc('restoreMeta');
  const RESTORE_POINT_LIMIT = 30;
  let stateBaseline = null;

  const parseJSON = (value, fallback) => {
    try { const parsed = JSON.parse(value); return parsed ?? fallback; } catch (_) { return fallback; }
  };
  const taipeiDate = () => { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()), pick = type => parts.find(part => part.type === type)?.value || ''; return `${pick('year')}-${pick('month')}-${pick('day')}`; };
  const nextDate = date => {
    const [year, month, day] = String(date).split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  };
  const nonSchoolDays = data => Array.isArray(parseJSON(data?.nonSchoolDays, [])) ? parseJSON(data.nonSchoolDays, []).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)) : [];
  const isSchoolDay = (date, data = {}) => { const [year, month, day] = String(date).split('-').map(Number); const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); return weekday > 0 && weekday < 6 && !nonSchoolDays(data).includes(date); };
  const nextSchoolDate = (date, data = {}) => { let value = nextDate(date); while (!isSchoolDay(value, data)) value = nextDate(value); return value; };
  const previousSchoolDate = (date, data = {}) => {
    let [year, month, day] = String(date).split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    do { value.setUTCDate(value.getUTCDate() - 1); } while (!isSchoolDay(value.toISOString().slice(0, 10), data));
    return value.toISOString().slice(0, 10);
  };
  const normalizedEmail = account => {
    const text = String(account || '').trim().toLowerCase();
    return text.includes('@') ? text : `${text}${TEACHER_DOMAIN}`;
  };
  const isTeacher = user => Boolean(user?.email && user.email.toLowerCase().endsWith(TEACHER_DOMAIN));

  function rollTasks(data) {
    const next = { ...data };
    const today = taipeiDate();
    const savedDate = parseJSON(next.taskDate, '');
    const legacy = Array.isArray(parseJSON(next.dailyTasks, [])) ? parseJSON(next.dailyTasks, []) : [];
    const current = Array.isArray(parseJSON(next.todayTasks, legacy)) ? parseJSON(next.todayTasks, legacy) : legacy;

    if (!savedDate) {
      next.todayTasks = JSON.stringify(current);
      next.taskDate = JSON.stringify(today);
      return next;
    }
    if (savedDate === today || !isSchoolDay(today, next)) return next;

    const history = parseJSON(next.taskHistory, {});
    if (current.length) history[savedDate] = current;
    const tomorrow = parseJSON(next.tomorrowTasks, []);
    next.todayTasks = JSON.stringify(Array.isArray(tomorrow) ? tomorrow : []);
    next.tomorrowTasks = '[]';
    next.taskHistory = JSON.stringify(history);
    next.taskDate = JSON.stringify(today);
    return next;
  }

  async function readCoreState() {
    const snapshot = await classroomRef.get({ source: 'server' });
    const raw = snapshot.exists && snapshot.data()?.data && typeof snapshot.data().data === 'object' ? snapshot.data().data : {};
    return { raw, data: rollTasks(raw), restoreEpoch: snapshot.data()?.restoreEpoch || 0 };
  }
  async function coreState() { return (await readCoreState()).data; }

  async function publicState() {
    const [core, completionSnapshot, checkinSnapshot, tomorrowSnapshot] = await Promise.all([readCoreState(), completionRef.get(), checkinRef.get(), tomorrowRef.get()]);
    const data = core.data;
    const subjectData = parseJSON(data.subjectData, {});
    const roster = parseJSON(data.classroomStudentRoster, []);
    const activeSeats = new Set(Array.isArray(roster) ? roster.map(student => Number(student?.seat)).filter(seat => Number.isInteger(seat) && seat > 0) : []);
    const highestSeat = activeSeats.size ? Math.max(...activeSeats) : 0;

    if (subjectData && typeof subjectData === 'object' && !Array.isArray(subjectData)) {
      Object.values(subjectData).forEach(tasks => {
        if (!Array.isArray(tasks)) return;
        tasks.forEach(task => { task.records = Array.from({ length: highestSeat }, (_, index) => activeSeats.has(index + 1) && Boolean(task.records?.[index])); });
      });
      completionSnapshot.forEach(document => {
        const item = document.data();
        const task = subjectData[item.subject]?.find(candidate => candidate?.id === item.taskId);
        if (task && Number.isInteger(item.seat) && activeSeats.has(item.seat)) task.records[item.seat - 1] = true;
      });
      data.subjectData = JSON.stringify(subjectData);
    }

    const checkins = parseJSON(data.notebookCheckins, {});
    checkinSnapshot.forEach(document => {
      const item = document.data();
      if (!checkins[item.date]) checkins[item.date] = {};
      checkins[item.date][item.seat] = item.timestamp;
    });
    data.notebookCheckins = JSON.stringify(checkins);

    const today = taipeiDate();
    const tomorrow = nextSchoolDate(today, data);
    const scheduledTasks = parseJSON(data.scheduledTasks, []);
    const scheduledIds = new Set((Array.isArray(scheduledTasks) ? scheduledTasks : []).map(item => String(item?.id || '')).filter(Boolean));
    const isScheduledCopy = id => { const value=String(id || ''); return [...scheduledIds].some(scheduledId => value === scheduledId || value.startsWith(`${scheduledId}::`)); };
    const withoutScheduledCopies = items => (Array.isArray(items) ? items : []).filter(item => !isScheduledCopy(item?.id));
    const todayTasks = withoutScheduledCopies(parseJSON(data.todayTasks, []));
    const tomorrowTasks = withoutScheduledCopies(parseJSON(data.tomorrowTasks, []));
    const taskHistory = parseJSON(data.taskHistory, {});
    if (taskHistory && typeof taskHistory === 'object') Object.keys(taskHistory).forEach(day => { taskHistory[day] = withoutScheduledCopies(taskHistory[day]); });
    const mergeTask = (item, fallbackId, deletable = false, scheduled = false) => {
      if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.targetDate || '')) || !String(item.text || '').trim()) return;
      if (scheduled && !isSchoolDay(today, data)) return;
      const tomorrowDisplayDate = scheduled ? today : tomorrow;
      const todayDisplayDate = scheduled ? previousSchoolDate(today, data) : today;
      const baseId=String(item.id || fallbackId), lines=scheduled ? String(item.text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean) : [String(item.text).trim()];
      lines.forEach((text,index) => {
        const task = { id: scheduled ? `${baseId}::${index}` : baseId, text: text.slice(0,500), author: String(item.author || '').slice(0,100), subject: String(item.subject || '其他').slice(0,40), handwriting: index===0 ? (item.handwriting || '') : '', createdAt: item.createdAt || '', deletable };
        if (item.targetDate === tomorrowDisplayDate) tomorrowTasks.push(task);
        else if (item.targetDate === todayDisplayDate) todayTasks.push(task);
        else if (item.targetDate < todayDisplayDate) {
          if (!Array.isArray(taskHistory[item.targetDate])) taskHistory[item.targetDate] = [];
          taskHistory[item.targetDate].push(task);
        }
      });
    };
    if (Array.isArray(scheduledTasks)) scheduledTasks.forEach((item,index) => mergeTask(item, `scheduled-${index}`, false, true));
    tomorrowSnapshot.forEach(document => {
      const item = document.data();
      mergeTask({ ...item, id: document.id }, document.id, true);
    });
    data.todayTasks = JSON.stringify(todayTasks);
    data.tomorrowTasks = JSON.stringify(tomorrowTasks);
    data.taskHistory = JSON.stringify(taskHistory);

    stateBaseline = { raw: { ...core.raw }, view: { ...data }, restoreEpoch: core.restoreEpoch };
    return { hasData: Object.keys(data).length > 0, data, updatedAt: null };
  }

  function requireTeacher() { if (!isTeacher(auth.currentUser)) throw new Error('請先以教師帳號登入。'); }
  function syncConflict(message) { const error = new Error(message); error.code = 'classroom/conflict'; return error; }
  function writeRestorePoint(transaction, meta, data, label, kind) {
    const sequence = Number(meta.sequence || 0) + 1;
    transaction.set(restorePointsRef.doc(`point-${(sequence - 1) % RESTORE_POINT_LIMIT}`), {
      data: { ...data }, label: String(label || '').slice(0, 60), kind, sequence,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(restoreMetaRef, { sequence });
  }
  async function saveState(data, options = {}) {
    requireTeacher();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('資料格式不正確。');
    const base = options.baseline || stateBaseline;
    if (!base) throw syncConflict('請先重新載入雲端資料後再儲存。');
    const requested = { ...data };
    const changed = (options.managedKeys || Object.keys(requested)).filter(key => requested[key] !== base.view[key]);
    if (!changed.length) return;
    const result = await db.runTransaction(async transaction => {
      const [snapshot, metaSnapshot] = await Promise.all([transaction.get(classroomRef), transaction.get(restoreMetaRef)]);
      const current = snapshot.data() || {}, remote = current.data || {};
      if ((current.restoreEpoch || 0) !== base.restoreEpoch) throw syncConflict('其他電腦已還原班級資料。您的修改仍在本機，請重新載入後再編輯。');
      const conflicts = changed.filter(key => remote[key] !== base.raw[key] && remote[key] !== requested[key]);
      if (conflicts.length) throw syncConflict('其他電腦已修改相同資料。您的修改仍在本機，請先下載本機資料，再重新載入雲端。');
      const merged = { ...remote };
      changed.forEach(key => { if (Object.hasOwn(requested, key)) merged[key] = requested[key]; else delete merged[key]; });
      const next = rollTasks(merged);
      writeRestorePoint(transaction, metaSnapshot.data() || {}, remote, '自動備份：儲存前', 'automatic');
      transaction.set(classroomRef, { data: next, syncVersion: 2, revision: Number(current.revision || 0) + 1, restoreEpoch: current.restoreEpoch || 0, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { mergeFields: ['data','syncVersion','revision','restoreEpoch','updatedAt'] });
      return next;
    });
    // Keep the original baseline for untouched fields to detect later edits from a stale screen.
    const raw = { ...base.raw };
    changed.forEach(key => { if (Object.hasOwn(result, key)) raw[key] = result[key]; else delete raw[key]; });
    if (!options.baseline) stateBaseline = { raw, view: requested, restoreEpoch: base.restoreEpoch };
  }
  async function createRestorePoint(label = '', initialOnly = false) {
    requireTeacher();
    await db.runTransaction(async transaction => {
      const [snapshot, metaSnapshot] = await Promise.all([transaction.get(classroomRef), transaction.get(restoreMetaRef)]);
      const meta = metaSnapshot.data() || {};
      if (initialOnly && meta.sequence) return;
      if (!snapshot.exists) throw new Error('尚無班級資料可備份。');
      writeRestorePoint(transaction, meta, snapshot.data().data || {}, label || (initialOnly ? '啟用還原點時的資料' : '手動還原點'), initialOnly ? 'initial' : 'manual');
    });
  }
  async function getRestorePoints() {
    requireTeacher();
    const snapshot = await restorePointsRef.get({ source: 'server' });
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt?.toDate()?.toISOString() || '' })).sort((a,b) => b.sequence - a.sequence);
  }
  async function restorePoint(id, scope = 'records', expectedSequence) {
    requireTeacher();
    if (!/^point-\d+$/.test(id) || !['records','all'].includes(scope)) throw new Error('還原點資料不正確。');
    const recordKeys = ['scheduledTasks','taskHistory','todayTasks','tomorrowTasks','dailyTasks','taskDate','leaveRecords','leaveHalfDayRecords','leaveSettlements'];
    await db.runTransaction(async transaction => {
      const [snapshot, pointSnapshot, metaSnapshot] = await Promise.all([transaction.get(classroomRef), transaction.get(restorePointsRef.doc(id)), transaction.get(restoreMetaRef)]);
      if (!pointSnapshot.exists || pointSnapshot.data().sequence !== expectedSequence) throw new Error('此還原點已被較新的備份取代，請重新載入清單。');
      const current = snapshot.data() || {}, saved = pointSnapshot.data().data || {}, next = scope === 'all' ? { ...saved } : { ...(current.data || {}) };
      if (scope === 'records') recordKeys.forEach(key => { if (Object.hasOwn(saved, key)) next[key] = saved[key]; else delete next[key]; });
      const roster = parseJSON(next.classroomStudentRoster, []), highestSeat = Math.max(0,...roster.map(student => Number(student.seat) || 0));
      next.classSeating = JSON.stringify(Array(highestSeat).fill(0));
      next.classSeatingSession = JSON.stringify('');
      writeRestorePoint(transaction, metaSnapshot.data() || {}, current.data || {}, '自動備份：還原前', 'before-restore');
      transaction.set(classroomRef, { data: next, syncVersion: 2, revision: Number(current.revision || 0) + 1, restoreEpoch: Number(current.restoreEpoch || 0) + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { mergeFields: ['data','syncVersion','revision','restoreEpoch','updatedAt'] });
    });
  }

  async function saveCourse(body) {
    const subject = String(body?.subject || '').trim().slice(0, 40);
    const operation = body?.operation;
    if (!subject || !['create', 'toggle'].includes(operation)) throw new Error('科目任務資料不正確。');

    const core = await readCoreState(), data = core.data;
    const courseBaseline = { raw: core.raw, view: { ...data }, restoreEpoch: core.restoreEpoch };
    const subjectData = parseJSON(data.subjectData, {});
    if (!subjectData || typeof subjectData !== 'object' || Array.isArray(subjectData)) throw new Error('找不到科目任務資料。');
    if (!Array.isArray(subjectData[subject])) subjectData[subject] = [];

    if (operation === 'create') {
      if (!isTeacher(auth.currentUser)) throw new Error('請先由教師端登入後再新增任務。');
      const name = String(body?.name || '').trim().slice(0, 200);
      if (!name) throw new Error('請輸入任務名稱。');
      const roster = parseJSON(data.classroomStudentRoster, []);
      const highestSeat = Array.isArray(roster) ? Math.max(0, ...roster.map(student => Number(student?.seat) || 0)) : 0;
      subjectData[subject].push({ id: crypto.randomUUID(), name, records: Array(highestSeat).fill(false) });
      data.subjectData = JSON.stringify(subjectData);
      await saveState(data, { baseline: courseBaseline, managedKeys: ['subjectData'] });
      return publicState();
    }

    const taskId = String(body?.taskId || '');
    const seat = Number(body?.seat);
    if (!taskId || !Number.isInteger(seat) || seat < 1 || seat > 60 || !subjectData[subject].some(task => task?.id === taskId)) throw new Error('完成狀態資料不正確。');
    const id = `${encodeURIComponent(subject)}__${taskId}__${seat}`;
    const ref = completionRef.doc(id);
    const existing = await ref.get();
    if (existing.exists) await ref.delete();
    else await ref.set({ subject, taskId, seat, createdAt: new Date().toISOString() });
    return publicState();
  }

  async function addNotebookCheckin(body) {
    const seat = Number(body?.seat);
    const date = String(body?.date || '');
    if (!Number.isInteger(seat) || seat < 1 || seat > 60 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('登記資料不正確。');
    const id = `${date}_${seat}`;
    const ref = checkinRef.doc(id);
    const existing = await ref.get();
    if (existing.exists) {
      const error = new Error('Already checked in');
      error.code = 'already-exists';
      throw error;
    }
    const timestamp = new Date().toISOString();
    await ref.set({ seat, date, timestamp });
    return { timestamp };
  }

  async function addTomorrowTask(body) {
    const text = String(body?.text || '').trim().slice(0, 500);
    if (!text) throw new Error('請填寫事項內容。');
    const handwriting = typeof body?.handwriting === 'string' && body.handwriting.startsWith('data:image/png;base64,') && body.handwriting.length <= 160000 ? body.handwriting : '';
    const createdAt = new Date().toISOString();
    const data = await coreState();
    await tomorrowRef.doc(crypto.randomUUID()).set({ text, author: String(body?.author || '').trim().slice(0, 100), subject: String(body?.subject || '其他').trim().slice(0, 40), handwriting, createdAt, targetDate: nextSchoolDate(taipeiDate(), data) });
  }

  async function getStickyMessages(day) {
    const date = String(day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式不正確。');
    const snapshot = await stickyMessagesRef.doc(date).collection('notes').get();
    return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
  }

  async function addStickyMessage(body) {
    const day = String(body?.day || '');
    const slot = String(body?.slot || '');
    const text = String(body?.text || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^slot-(0[1-9]|1[0-9]|2[0-8])$/.test(slot) || !text || [...text].length > 20) throw new Error('留言資料不正確。');
    // Web Firestore uses set() for a new document. Security rules reject updates,
    // so an already-used sticky note cannot be replaced.
    await stickyMessagesRef.doc(day).collection('notes').doc(slot).set({ day, slot, text, createdAt: new Date().toISOString() });
  }

  function onStickyMessagesChanged(day, callback) {
    const date = String(day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return () => {};
    return stickyMessagesRef.doc(date).collection('notes').onSnapshot(snapshot => callback(snapshot.docs.map(document => ({ id: document.id, ...document.data() }))), () => {});
  }

  function randomCode() {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return String(values[0] % 10000).padStart(4, '0');
  }

  async function getDailyDeleteCode() {
    if (!isTeacher(auth.currentUser)) throw new Error('請先登入教師端。');
    const today = taipeiDate();
    const snapshot = await dailyConfirmationRef.get();
    const saved = snapshot.data();
    if (snapshot.exists && saved?.date === today && /^\d{4}$/.test(String(saved.code || ''))) return saved.code;
    const code = randomCode();
    await dailyConfirmationRef.set({ date: today, code, generatedAt: new Date().toISOString() });
    return code;
  }

  async function deleteTomorrowSubmission(id, code) {
    const submissionId = String(id || '');
    const confirmationCode = String(code || '').trim();
    if (!submissionId || !/^\d{4}$/.test(confirmationCode)) throw new Error('請輸入四位數確認碼。');
    const today = taipeiDate();
    await deleteRequestRef.doc(submissionId).set({ taskId: submissionId, code: confirmationCode, date: today, requestedAt: new Date().toISOString() });
    await tomorrowRef.doc(submissionId).delete();
  }

  async function teacherDeleteTomorrowSubmission(id) {
    if (!isTeacher(auth.currentUser)) throw new Error('請先使用教師帳號登入。');
    await tomorrowRef.doc(String(id || '')).delete();
  }

  async function editTomorrowSubmission(id, changes, code) {
    const submissionId = String(id || '');
    const confirmationCode = String(code || '').trim();
    const text = String(changes?.text || '').trim().slice(0, 500);
    if (!submissionId || !text || !/^\d{4}$/.test(confirmationCode)) throw new Error('請填寫內容並輸入四位數確認碼。');
    const update = { text, author: String(changes?.author || '').trim().slice(0, 100), subject: String(changes?.subject || '其他').trim().slice(0, 40), handwriting: typeof changes?.handwriting === 'string' && changes.handwriting.startsWith('data:image/png;base64,') && changes.handwriting.length <= 160000 ? changes.handwriting : '', updatedAt: new Date().toISOString() };
    const today = taipeiDate();
    const request = editRequestRef.doc(submissionId);
    await request.set({ taskId: submissionId, code: confirmationCode, date: today, requestedAt: new Date().toISOString() });
    const batch = db.batch();
    batch.update(tomorrowRef.doc(submissionId), update);
    batch.delete(request);
    await batch.commit();
  }

  async function getTomorrowSubmissions() {
    if (!isTeacher(auth.currentUser)) throw new Error('請先登入教師端。');
    const snapshot = await tomorrowRef.get();
    return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
  }

  async function notebookMonth(month) {
    const text = String(month || '');
    if (!/^\d{4}-\d{2}$/.test(text)) throw new Error('月份格式不正確。');
    const end = `${text}-31`;
    const snapshot = await checkinRef.where('date', '>=', `${text}-01`).where('date', '<=', end).get();
    const records = {};
    snapshot.forEach(document => {
      const item = document.data();
      if (!records[item.date]) records[item.date] = {};
      records[item.date][item.seat] = item.timestamp;
    });
    return records;
  }

  function onPublicChanged(callback) {
    let timer = null;
    const notify = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(), 80);
    };
    const unsubs = [classroomRef, completionRef, checkinRef, tomorrowRef]
      .map(ref => ref.onSnapshot(notify, () => {}));
    return () => {
      clearTimeout(timer);
      unsubs.forEach(unsubscribe => unsubscribe());
    };
  }

  function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    const url = new URL(rawUrl, window.location.href);
    if (url.pathname !== '/api/classroom') return originalFetch(input, init);

    try {
      const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      const action = url.searchParams.get('action');
      const body = init.body ? JSON.parse(init.body) : {};
      if (method === 'GET') {
        if (url.searchParams.get('admin') === '1' && !isTeacher(auth.currentUser)) return jsonResponse({ error: 'Unauthorized' }, 401);
        return jsonResponse(await publicState());
      }
      if (method === 'PUT') { await saveState(body.data); return jsonResponse({ ok: true }); }
      if (method === 'POST' && action === 'course') {
        const state = await saveCourse(body);
        return jsonResponse({ ok: true, subjectData: state.data.subjectData });
      }
      if (method === 'POST' && action === 'notebook') return jsonResponse({ ok: true, ...(await addNotebookCheckin(body)) });
      if (method === 'POST' && action === 'tomorrow') { await addTomorrowTask(body); return jsonResponse({ ok: true }); }
      return jsonResponse({ error: '此 Firebase 版本不支援此請求。' }, 405);
    } catch (error) {
      const status = error?.code === 'already-exists' ? 409 : error?.code === 'permission-denied' ? 403 : 400;
      return jsonResponse({ error: error?.message || 'Firebase 資料同步失敗。' }, status);
    }
  };

  window.FirebaseClassroom = {
    ready: Promise.resolve(),
    teacherDomain: TEACHER_DOMAIN,
    isTeacher: () => isTeacher(auth.currentUser),
    teacherEmail: () => auth.currentUser?.email || '',
    signIn: async (account, password) => {
      const email = normalizedEmail(account);
      if (!email.endsWith(TEACHER_DOMAIN)) throw new Error(`請使用 ${TEACHER_DOMAIN} 教師帳號。`);
      await auth.signInWithEmailAndPassword(email, String(password || ''));
      if (!isTeacher(auth.currentUser)) { await auth.signOut(); throw new Error(`請使用 ${TEACHER_DOMAIN} 教師帳號。`); }
      return auth.currentUser;
    },
    changeTeacherPassword: async (currentPassword, newPassword) => {
      const user = auth.currentUser;
      if (!isTeacher(user)) throw new Error('請先登入教師帳號。');
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(newPassword);
    },
    signOut: () => auth.signOut(),
    getState: publicState,
    saveState,
    createRestorePoint,
    getRestorePoints,
    restorePoint,
    getNotebookMonth: notebookMonth,
    addNotebookCheckin,
    getStickyMessages,
    addStickyMessage,
    onStickyMessagesChanged,
    getDailyDeleteCode,
    deleteTomorrowSubmission,
    teacherDeleteTomorrowSubmission,
    editTomorrowSubmission,
    getTomorrowSubmissions,
    onPublicChanged,
    onTeacherChanged: callback => auth.onAuthStateChanged(user => callback(isTeacher(user) ? user : null)),
  };
}());
