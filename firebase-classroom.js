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
  const addRequestRef = classroomRef.collection('addTaskRequests');
  const restorePointsRef = classroomRef.collection('restorePoints');
  const restoreMetaRef = classroomRef.collection('teacherPrivate').doc('restoreMeta');
  const studentArchiveRef = classroomRef.collection('archivedStudents');
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
  const recordBelongsToStudent = (student, timestamp) => !student?.recordSince || (typeof timestamp === 'string' && timestamp >= student.recordSince);
  const studentRecordSuffix = student => student?.recordSince ? `__${encodeURIComponent(student.recordSince)}` : '';

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
    const studentsBySeat = new Map((Array.isArray(roster)?roster:[]).map(student=>[Number(student.seat),student]));
    const highestSeat = activeSeats.size ? Math.max(...activeSeats) : 0;

    if (subjectData && typeof subjectData === 'object' && !Array.isArray(subjectData)) {
      Object.values(subjectData).forEach(tasks => {
        if (!Array.isArray(tasks)) return;
        tasks.forEach(task => { task.records = Array.from({ length: highestSeat }, (_, index) => activeSeats.has(index + 1) && Boolean(task.records?.[index])); });
      });
      completionSnapshot.forEach(document => {
        const item = document.data();
        const task = subjectData[item.subject]?.find(candidate => candidate?.id === item.taskId);
        if (task && Number.isInteger(item.seat) && activeSeats.has(item.seat) && recordBelongsToStudent(studentsBySeat.get(item.seat),item.createdAt)) task.records[item.seat - 1] = true;
      });
      data.subjectData = JSON.stringify(subjectData);
    }

    const checkins = parseJSON(data.notebookCheckins, {});
    checkinSnapshot.forEach(document => {
      const item = document.data();
      if(!activeSeats.has(item.seat)||!recordBelongsToStudent(studentsBySeat.get(item.seat),item.timestamp))return;
      if (!checkins[item.date]) checkins[item.date] = {};
      checkins[item.date][item.seat] = item.timestamp;
    });
    data.notebookCheckins = JSON.stringify(checkins);

    const today = taipeiDate();
    const tomorrow = nextSchoolDate(today, data);
    const scheduledTasks = parseJSON(data.scheduledTasks, []);
    const scheduledIds = new Set([...(Array.isArray(scheduledTasks) ? scheduledTasks : []).map(item => String(item?.id || '')), ...tomorrowSnapshot.docs.map(document => document.id)].filter(Boolean));
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
      mergeTask({ ...item, id: document.id }, document.id, false, item.entryMode === 'daily');
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
      if ((current.restoreEpoch || 0) !== base.restoreEpoch) throw syncConflict('其他裝置已變更學生在校狀態或還原班級資料。您的修改仍在本機，請重新載入後再編輯。');
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
  function captureStudentRecords(data, student, completions=[], checkins=[]) {
    const seat=Number(student.seat),full=parseJSON(data.leaveRecords,{}),half=parseJSON(data.leaveHalfDayRecords,{});
    const dates=[...new Set([...Object.keys(full),...Object.keys(half)])].sort();
    const leaves=dates.map(date=>{
      const all=(full[date]||[]).map(Number).includes(seat),morning=(half[date]?.morning||[]).map(Number).includes(seat),afternoon=(half[date]?.afternoon||[]).map(Number).includes(seat);
      const fullDay=all||(morning&&afternoon);
      return {date,status:fullDay?'全天':morning?'上午':afternoon?'下午':'',days:fullDay?1:(morning||afternoon)?0.5:0};
    }).filter(item=>item.days);
    const tasks=[];Object.entries(parseJSON(data.subjectData,{})).forEach(([subject,items])=>{if(Array.isArray(items))items.forEach(task=>tasks.push({subject,id:String(task.id),name:String(task.name||''),completed:Boolean(task.records?.[seat-1])}));});
    completions.filter(item=>Number(item.seat)===seat&&recordBelongsToStudent(student,item.createdAt)).forEach(item=>{const task=tasks.find(task=>task.subject===item.subject&&task.id===item.taskId);if(task)task.completed=true;});
    const notebook={};Object.entries(parseJSON(data.notebookCheckins,{})).forEach(([date,records])=>{if(records?.[seat])notebook[date]=records[seat];});
    checkins.filter(item=>Number(item.seat)===seat&&recordBelongsToStudent(student,item.timestamp)).forEach(item=>notebook[item.date]=item.timestamp);
    return {leaves,tasks,notebook};
  }
  function releaseStudentLinks(data, seat) {
    const next={...data},without=values=>(Array.isArray(values)?values:[]).filter(value=>Number(value)!==seat);
    for(const key of ['cleaningAssignments','lunchAssignments','classCadres']){
      const current=parseJSON(next[key],{});next[key]=JSON.stringify(Object.fromEntries(Object.entries(current).map(([id,values])=>[id,without(Array.isArray(values)?values:[values])])));
    }
    for(const key of ['dutyAssignments','lunchHelperSeats'])if(next[key]!==undefined)next[key]=JSON.stringify(without(parseJSON(next[key],[])));
    if(next.lunchWeeklyGroups!==undefined)next.lunchWeeklyGroups=JSON.stringify(parseJSON(next.lunchWeeklyGroups,[]).map(group=>({...group,seats:without(group.seats)})));
    if(next.femaleRestroomLayout!==undefined)next.femaleRestroomLayout=JSON.stringify(Object.fromEntries(Object.entries(parseJSON(next.femaleRestroomLayout,{})).filter(([,value])=>Number(value)!==seat)));
    const full=parseJSON(next.leaveRecords,{});Object.keys(full).forEach(date=>{full[date]=without(full[date]);if(!full[date].length)delete full[date];});next.leaveRecords=JSON.stringify(full);
    const halves=parseJSON(next.leaveHalfDayRecords,{});Object.keys(halves).forEach(date=>{for(const session of ['morning','afternoon'])if(halves[date]?.[session]){halves[date][session]=without(halves[date][session]);if(!halves[date][session].length)delete halves[date][session];}if(!Object.keys(halves[date]||{}).length)delete halves[date];});next.leaveHalfDayRecords=JSON.stringify(halves);
    const subjects=parseJSON(next.subjectData,{});Object.values(subjects).forEach(tasks=>{if(Array.isArray(tasks))tasks.forEach(task=>{if(Array.isArray(task.records))task.records[seat-1]=false;});});next.subjectData=JSON.stringify(subjects);
    const notebook=parseJSON(next.notebookCheckins,{});Object.keys(notebook).forEach(date=>{if(notebook[date])delete notebook[date][seat];if(!Object.keys(notebook[date]||{}).length)delete notebook[date];});next.notebookCheckins=JSON.stringify(notebook);
    const seating=parseJSON(next.classSeating,[]);seating[seat-1]=0;next.classSeating=JSON.stringify(seating);
    next.classroomSeatingLayout=JSON.stringify(parseJSON(next.classroomSeatingLayout,[]).map(value=>Number(value)===seat?null:value));
    return next;
  }
  function updateRosterState(data, roster) {
    const next={...data},highest=Math.max(0,...roster.map(student=>Number(student.seat)));
    next.classroomStudentRoster=JSON.stringify(roster.sort((a,b)=>a.seat-b.seat));
    next.classroomTotalStudents=String(highest);
    next.classroomStudentNames=JSON.stringify(Array.from({length:highest},(_,i)=>roster.find(student=>Number(student.seat)===i+1)?.name||''));
    return next;
  }
  async function archiveStudent({seat,studentId='',name='',transferDate}={}) {
    requireTeacher();seat=Number(seat);
    const parsedDate=new Date(`${transferDate}T00:00:00Z`);
    if(!Number.isInteger(seat)||seat<1||seat>60||!/^\d{4}-\d{2}-\d{2}$/.test(String(transferDate))||transferDate>taipeiDate()||Number.isNaN(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==transferDate)throw new Error('請選擇有效的轉出日期，不可晚於今天。');
    const base=stateBaseline;if(!base)throw syncConflict('請先重新載入雲端名單。');
    const [completionSnapshot,checkinSnapshot]=await Promise.all([completionRef.where('seat','==',seat).get(),checkinRef.where('seat','==',seat).get()]);
    const archivedAt=new Date().toISOString(),archiveId=crypto.randomUUID(),archiveRef=studentArchiveRef.doc(archiveId);
    await db.runTransaction(async transaction=>{
      const [snapshot,metaSnapshot]=await Promise.all([transaction.get(classroomRef),transaction.get(restoreMetaRef)]);
      const current=snapshot.data()||{},raw=current.data||{};
      if((current.restoreEpoch||0)!==base.restoreEpoch||raw.classroomStudentRoster!==base.raw.classroomStudentRoster)throw syncConflict('雲端名單已變更，請重新載入後再封存。');
      const roster=parseJSON(raw.classroomStudentRoster,[]),student=roster.find(item=>Number(item.seat)===seat);
      if(!student||(studentId&&student.id!==studentId)||(!studentId&&student.name!==name))throw syncConflict('學生資料已變更，請重新載入名單。');
      const identity={...student,id:student.id||crypto.randomUUID()};
      const records=captureStudentRecords(raw,student,completionSnapshot.docs.map(doc=>doc.data()),checkinSnapshot.docs.map(doc=>doc.data()));
      // Save the private archive and remove active links in the same atomic transaction.
      const released=releaseStudentLinks(raw,seat),next=updateRosterState(released,roster.filter(item=>Number(item.seat)!==seat));
      const assignments={};for(const key of ['cleaningAssignments','lunchAssignments','classCadres'])assignments[key]=Object.fromEntries(Object.entries(parseJSON(raw[key],{})).filter(([,values])=>(Array.isArray(values)?values:[values]).some(value=>Number(value)===seat)));
      writeRestorePoint(transaction,metaSnapshot.data()||{},raw,`學生轉出前：${student.name}`,'before-student-archive');
      transaction.set(archiveRef,{student:identity,transferDate,archivedAt,status:'archived',records,assignments});
      transaction.set(classroomRef,{...current,data:next,syncVersion:2,revision:Number(current.revision||0)+1,restoreEpoch:(current.restoreEpoch||0)+1,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    });
    return publicState();
  }
  async function getArchivedStudents() {
    requireTeacher();const snapshot=await studentArchiveRef.get({source:'server'});
    return snapshot.docs.map(doc=>({id:doc.id,...doc.data()})).filter(item=>item.status==='archived').sort((a,b)=>String(b.archivedAt).localeCompare(String(a.archivedAt)));
  }
  async function restoreArchivedStudent(archiveId, seat) {
    requireTeacher();seat=Number(seat);
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(String(archiveId))||!Number.isInteger(seat)||seat<1||seat>60)throw new Error('請輸入有效的座號。');
    const base=stateBaseline;if(!base)throw syncConflict('請先重新載入雲端名單。');
    await db.runTransaction(async transaction=>{
      const archiveRef=studentArchiveRef.doc(archiveId),[snapshot,archiveSnapshot,metaSnapshot]=await Promise.all([transaction.get(classroomRef),transaction.get(archiveRef),transaction.get(restoreMetaRef)]);
      const current=snapshot.data()||{},raw=current.data||{},archived=archiveSnapshot.data();
      if((current.restoreEpoch||0)!==base.restoreEpoch||raw.classroomStudentRoster!==base.raw.classroomStudentRoster)throw syncConflict('雲端名單已變更，請重新載入後再恢復。');
      if(!archived||archived.status!=='archived')throw new Error('此學生已恢復在校，請重新載入名單。');
      const roster=parseJSON(raw.classroomStudentRoster,[]);
      if(roster.some(student=>Number(student.seat)===seat||student.id&&student.id===archived.student.id))throw new Error('此座號已有學生，或該學生已在校；請使用空的座號。');
      const restoredAt=new Date().toISOString(),student={...archived.student,seat,recordSince:restoredAt},next=updateRosterState(raw,[...roster,student]);
      const full=parseJSON(next.leaveRecords,{}),halves=parseJSON(next.leaveHalfDayRecords,{});
      (archived.records?.leaves||[]).forEach(item=>{if(item.status==='全天')full[item.date]=[...new Set([...(full[item.date]||[]),seat])];else{const session=item.status==='上午'?'morning':'afternoon';halves[item.date]={...(halves[item.date]||{}),[session]:[...new Set([...(halves[item.date]?.[session]||[]),seat])]};}});
      next.leaveRecords=JSON.stringify(full);next.leaveHalfDayRecords=JSON.stringify(halves);
      const subjects=parseJSON(next.subjectData,{});(archived.records?.tasks||[]).forEach(record=>{const task=subjects[record.subject]?.find(task=>String(task.id)===record.id);if(task){if(!Array.isArray(task.records))task.records=[];task.records[seat-1]=record.completed;}});next.subjectData=JSON.stringify(subjects);
      const notebook=parseJSON(next.notebookCheckins,{});Object.entries(archived.records?.notebook||{}).forEach(([date,time])=>{notebook[date]={...(notebook[date]||{}),[seat]:time};});next.notebookCheckins=JSON.stringify(notebook);
      // Staffing is intentionally not restored: those vacancies may already be reassigned.
      writeRestorePoint(transaction,metaSnapshot.data()||{},raw,`學生恢復前：${student.name}`,'before-student-restore');
      transaction.set(archiveRef,{...archived,status:'restored',restoredAt,restoredSeat:seat});
      transaction.set(classroomRef,{...current,data:next,syncVersion:2,revision:Number(current.revision||0)+1,restoreEpoch:(current.restoreEpoch||0)+1,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    });
    return publicState();
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
    const student=parseJSON(data.classroomStudentRoster,[]).find(item=>Number(item.seat)===seat);
    if(!student)throw new Error('此學生已不在目前名單中，請重新開啟頁面。');
    const id = `${encodeURIComponent(subject)}__${taskId}__${seat}${studentRecordSuffix(student)}`;
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
    const student=parseJSON((await coreState()).classroomStudentRoster,[]).find(item=>Number(item.seat)===seat);
    if(!student)throw new Error('此學生已不在目前名單中，請重新開啟頁面。');
    const id = `${date}_${seat}${studentRecordSuffix(student)}`;
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

  async function addTomorrowTask(body, code) {
    const text = String(body?.text || '').trim();
    const confirmationCode = String(code || '').trim();
    if (!text || text.length > 500) throw new Error('請填寫事項內容，最多 500 字。');
    if (!/^\d{4}$/.test(confirmationCode)) throw new Error('請輸入今日四位數確認碼。');
    const today = taipeiDate(), data = await coreState();
    if (!isSchoolDay(today, data)) throw new Error('假日不能從學生端新增事項。');
    const id = crypto.randomUUID(), batch = db.batch();
    // The private authorization and public content commit together. No code is exposed in public records.
    batch.set(addRequestRef.doc(id), { taskId:id, code:confirmationCode, date:today, requestedAt:firebase.firestore.FieldValue.serverTimestamp() });
    batch.set(tomorrowRef.doc(id), { text, author:'學生', subject:'其他', handwriting:'', createdAt:new Date().toISOString(), targetDate:today, entryMode:'daily' });
    await batch.commit();
    return { id };
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
    const currentCode = snapshot.exists && saved?.date === today && /^\d{4}$/.test(String(saved.code || ''));
    if (currentCode && saved.validUntil?.toMillis?.() === new Date(`${nextDate(today)}T00:00:00+08:00`).getTime()) return saved.code;
    const code = currentCode ? saved.code : randomCode();
    await dailyConfirmationRef.set({ date: today, code, generatedAt: new Date().toISOString(), validUntil:firebase.firestore.Timestamp.fromDate(new Date(`${nextDate(today)}T00:00:00+08:00`)) });
    return code;
  }

  async function deleteTomorrowSubmission(id, code) {
    requireTeacher();
    await teacherDeleteTomorrowSubmission(id);
  }

  async function teacherDeleteTomorrowSubmission(id) {
    if (!isTeacher(auth.currentUser)) throw new Error('請先使用教師帳號登入。');
    await tomorrowRef.doc(String(id || '')).delete();
  }

  async function editTomorrowSubmission(id, changes, code) {
    requireTeacher();
    const submissionId = String(id || '');
    const text = String(changes?.text || '').trim().slice(0, 500);
    if (!submissionId || !text) throw new Error('請填寫事項內容。');
    const update = { text, author: String(changes?.author || '').trim().slice(0, 100), subject: String(changes?.subject || '其他').trim().slice(0, 40), handwriting: typeof changes?.handwriting === 'string' && changes.handwriting.startsWith('data:image/png;base64,') && changes.handwriting.length <= 160000 ? changes.handwriting : '', updatedAt: new Date().toISOString() };
    await tomorrowRef.doc(submissionId).update(update);
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
    const [snapshot,data] = await Promise.all([checkinRef.where('date', '>=', `${text}-01`).where('date', '<=', end).get(),coreState()]);
    const roster=new Map(parseJSON(data.classroomStudentRoster,[]).map(student=>[Number(student.seat),student]));
    const records = {};
    Object.entries(parseJSON(data.notebookCheckins,{})).forEach(([date,seats])=>{
      if(!date.startsWith(`${text}-`))return;
      Object.entries(seats||{}).forEach(([seat,timestamp])=>{if(roster.has(Number(seat))){if(!records[date])records[date]={};records[date][seat]=timestamp;}});
    });
    snapshot.forEach(document => {
      const item = document.data();
      if(!roster.has(Number(item.seat))||!recordBelongsToStudent(roster.get(Number(item.seat)),item.timestamp))return;
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
    archiveStudent,
    getArchivedStudents,
    restoreArchivedStudent,
    getNotebookMonth: notebookMonth,
    addNotebookCheckin,
    getStickyMessages,
    addStickyMessage,
    onStickyMessagesChanged,
    getDailyDeleteCode,
    addTomorrowTask,
    deleteTomorrowSubmission,
    teacherDeleteTomorrowSubmission,
    editTomorrowSubmission,
    getTomorrowSubmissions,
    onPublicChanged,
    onTeacherChanged: callback => auth.onAuthStateChanged(user => callback(isTeacher(user) ? user : null)),
  };
}());
