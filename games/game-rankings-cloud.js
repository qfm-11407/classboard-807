// Public, classroom-only fun scores. This named app never touches teacher auth.
(() => {
  if (!window.firebase) return;
  const app = firebase.apps.find(app => app.name === 'classroom-game-rankings') || firebase.initializeApp({
    apiKey:'AIzaSyB-BwDBWaAMM7_-dHQui78cntZ4fi_ydxY',
    authDomain:'colabprogram-c8014.firebaseapp.com', projectId:'colabprogram-c8014',
    appId:'1:900230173526:web:91277f640ea00893b33cf7',
  }, 'classroom-game-rankings');
  const db = firebase.firestore(app);
  const root = db.collection('classrooms').doc('classboard-807').collection('gameRankings');
  const rows = snapshot => snapshot.docs.map(doc => ({ id:doc.id, ...doc.data() }));
  window.ClassroomGameCloud = {
    watch(bucket, date, receive) {
      const state = { top:[], today:[], topReady:false, todayReady:false };
      const send = () => receive({ ...state, ready:state.topReady && state.todayReady });
      const listen = (query, field) => query.onSnapshot({ includeMetadataChanges:true }, snapshot => {
        state[field] = rows(snapshot);
        state[`${field}Ready`] = !snapshot.metadata.fromCache;
        send();
      }, () => receive({ ...state, ready:false, error:true }));
      const ref = root.doc(bucket);
      const stopTop = listen(ref.collection('scores').orderBy('score','desc').limit(10), 'top');
      const stopToday = listen(ref.collection('days').doc(date).collection('scores').orderBy('score','desc').limit(10), 'today');
      return () => { stopTop(); stopToday(); };
    },
    async write(bucket, row) {
      const ref = root.doc(bucket), scoreRef = ref.collection('scores').doc(row.id);
      const todayRef = ref.collection('days').doc(row.date).collection('scores').doc(row.id);
      // Atomic, deterministic IDs make reconnects/retries idempotent.
      await db.runTransaction(async transaction => {
        const previous = await transaction.get(scoreRef);
        if (previous.exists && (!row.participant || previous.data().score >= row.score)) return;
        const old = previous.exists ? previous.data() : null;
        const data = {
          score:row.score, date:row.date, time:old?.time ?? row.time,
          label:row.label || '', participant:row.participant || '', client:row.client,
          createdAt:old?.createdAt ?? firebase.firestore.FieldValue.serverTimestamp(),
        };
        transaction.set(scoreRef,data);
        transaction.set(todayRef,data);
      });
    },
  };
})();
