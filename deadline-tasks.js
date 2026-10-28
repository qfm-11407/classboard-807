/* Deadline tasks are isolated from legacy subjectData and use server-enforced deadlines. */
(function (root) {
  'use strict';
  const millis = value => value && typeof value.toMillis === 'function' ? value.toMillis() : NaN;
  const closed = (task, now = Date.now()) => !task || !Number.isFinite(millis(task.deadline)) || now >= millis(task.deadline);
  const dateInput = value => {
    const time = value && typeof value.getTime === 'function' ? value.getTime() : millis(value);
    return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 16) : '';
  };
  function parseDeadline(value) {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) throw new Error('請完整選擇截止日期與時間。');
    const date = new Date(`${text}:00+08:00`);
    if (!Number.isFinite(+date) || dateInput(date) !== text) throw new Error('截止日期與時間不正確。');
    return date;
  }
  const formatDate = value => Number.isFinite(millis(value)) ? new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(millis(value))) : '時間不正確';
  function participantsFromRoster(roster) {
    const participants = {};
    (Array.isArray(roster) ? roster : []).forEach(student => {
      const seat = Number(student?.seat);
      if (Number.isInteger(seat) && seat >= 1 && seat <= 60 && String(student?.name || '').trim()) {
        participants[String(seat)] = { name: String(student.name).trim().slice(0, 80), identity: String(student.recordSince || '') };
      }
    });
    return participants;
  }
  function createService(firebase, classroom = 'classboard-807') {
    const app = firebase.app(), db = firebase.firestore(app), auth = firebase.auth(app);
    const classRef = db.collection('classrooms').doc(classroom), tasks = classRef.collection('deadlineTasks');
    const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
    const teacher = () => Boolean(auth.currentUser?.email?.toLowerCase().endsWith('@qfm.kh.edu.tw'));
    const requireTeacher = () => { if (!teacher()) throw new Error('請先登入教師帳號。'); };
    function taskFields(name, deadlineInput) {
      const title = String(name || '').trim();
      if (!title || title.length > 200) throw new Error('請輸入 1～200 字的任務名稱。');
      return { name: title, deadline: firebase.firestore.Timestamp.fromDate(parseDeadline(deadlineInput)) };
    }
    async function create(name, deadlineInput) {
      requireTeacher();
      const fields = taskFields(name, deadlineInput);
      if (closed(fields)) throw new Error('截止時間必須晚於現在。');
      const snapshot = await classRef.get({ source: 'server' });
      let roster;
      try { roster = JSON.parse(snapshot.data()?.data?.classroomStudentRoster || '[]'); } catch (_) { roster = []; }
      const participants = participantsFromRoster(roster);
      if (!Object.keys(participants).length) throw new Error('請先設定班級名單。');
      const ref = tasks.doc();
      // Transactions fail offline: never leave a task queued for an unintended later publish.
      await db.runTransaction(async transaction => {
        await transaction.get(ref);
        transaction.set(ref, { ...fields, participants, hidden: false, version: 1, createdAt: stamp(), updatedAt: stamp() });
      });
      return ref.id;
    }
    async function update(task, changes) {
      requireTeacher();
      const ref = tasks.doc(task.id);
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref), current = snapshot.data();
        if (!snapshot.exists) throw new Error('此任務已不存在。');
        if (current.version !== task.version) throw new Error('另一台裝置已修改任務，請重新開啟後再試。');
        let fields = {};
        if ('name' in changes || 'deadlineInput' in changes) {
          fields = taskFields(changes.name ?? current.name, changes.deadlineInput ?? dateInput(current.deadline));
          if (millis(fields.deadline) !== millis(current.deadline) && closed(fields)) throw new Error('新的截止時間必須晚於現在。');
        }
        if ('hidden' in changes) fields.hidden = Boolean(changes.hidden);
        transaction.update(ref, { ...fields, version: current.version + 1, updatedAt: stamp() });
      });
    }
    async function toggle(taskId, seat, identity = '') {
      if (!Number.isInteger(Number(seat)) || Number(seat) < 1 || Number(seat) > 60) throw new Error('學生資料不正確。');
      const ref = tasks.doc(taskId), record = ref.collection('records').doc(String(Number(seat)));
      await db.runTransaction(async transaction => {
        const taskSnapshot = await transaction.get(ref), recordSnapshot = await transaction.get(record);
        const task = taskSnapshot.data();
        if (!taskSnapshot.exists || task.hidden) throw new Error('此任務已隱藏或不存在。');
        if (closed(task)) throw new Error('已到截止時間，完成紀錄已鎖定。');
        const participant = task.participants?.[String(Number(seat))];
        if (!participant || participant.identity !== String(identity)) throw new Error('此學生不在這項任務的名單中，請重新開啟。');
        if (recordSnapshot.exists) transaction.delete(record);
        else transaction.set(record, { seat: Number(seat), identity: String(identity), completedAt: stamp() });
      });
    }
    const watchTasks = (next, error) => tasks.onSnapshot({ includeMetadataChanges: true }, snapshot => {
      const items = snapshot.docs.filter(doc => !doc.metadata?.hasPendingWrites).map(doc => ({ ...doc.data(), id: doc.id }));
      next(items.sort((a, b) => millis(b.createdAt) - millis(a.createdAt)), !snapshot.metadata.fromCache);
    }, error);
    const watchRecords = (id, next, error) => tasks.doc(id).collection('records').onSnapshot({ includeMetadataChanges: true }, snapshot => {
      const records = {};
      snapshot.docs.filter(doc => !doc.metadata?.hasPendingWrites).forEach(doc => { records[doc.id] = doc.data(); });
      next(records, !snapshot.metadata.fromCache);
    }, error);
    return { create, update, toggle, watchTasks, watchRecords, isTeacher: teacher };
  }
  root.DeadlineTasks = { millis, closed, parseDeadline, dateInput, formatDate, participantsFromRoster, createService };
}(typeof window === 'object' ? window : globalThis));
