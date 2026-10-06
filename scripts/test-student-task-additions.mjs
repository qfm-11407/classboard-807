import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../firebase-classroom.js', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const board = fs.readFileSync(new URL('../board.html', import.meta.url), 'utf8');
const root = 'classrooms/classboard-807', store = new Map();
let now = new Date('2026-10-07T04:00:00Z'), teacher = false, failCommit = false, sequence = 0;
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
class Timestamp { constructor(date) { this.value = +date; } toMillis() { return this.value; } static fromDate(date) { return new Timestamp(date); } }
class Ref {
  constructor(path) { this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Collection(`${this.path}/${name}`); }
  doc(name) { return new Ref(`${this.path}/${name}`); }
  async get() { return {exists:store.has(this.path), data:()=>store.get(this.path), id:this.id}; }
  async set(value) { store.set(this.path, value); }
  async update(value) { store.set(this.path, {...store.get(this.path), ...value}); }
  async delete() { store.delete(this.path); }
}
class Collection extends Ref {
  async get() {
    const docs = [];
    for (const path of store.keys()) if (path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1) docs.push(await new Ref(path).get());
    return {docs, forEach:fn=>docs.forEach(fn)};
  }
}
const writes = [];
const db = {collection:name=>new Collection(name), batch:()=>{
  const pending = [];
  return {set:(ref,value)=>pending.push([ref.path,value]), commit:async()=>{
    if (failCommit) { const error = new Error('Missing or insufficient permissions.'); error.code = 'permission-denied'; throw error; }
    for (const [path,value] of pending) store.set(path,value);
    writes.push(pending);
  }};
}};
const auth = {get currentUser() { return teacher ? {email:'teacher@qfm.kh.edu.tw'} : null; }};
const firestore = ()=>db;
firestore.Timestamp = Timestamp;
firestore.FieldValue = {serverTimestamp:()=>new Timestamp(now)};
const firebase = {apps:[], initializeApp:()=>({}), auth:()=>auth, firestore};
const context = {firebase, window:{firebase, fetch:async()=>{}, location:{href:'https://example.test/'}}, Response, URL, Intl, Date:Clock, Uint32Array, crypto:{randomUUID:()=>`student-${++sequence}`, getRandomValues:value=>{value[0]=1234;}}};
vm.runInNewContext(source,context);
const api = context.window.FirebaseClassroom;
const initial = {taskDate:'"2026-10-07"', scheduledTasks:JSON.stringify([{id:'teacher-task',text:'教師第一點\n教師第二點',targetDate:'2026-10-07'}]), nonSchoolDays:'[]'};
store.set(root,{data:initial});
const original = JSON.stringify(store.get(root));
await assert.rejects(()=>api.addTomorrowTask({text:'學生事項'},''),/四位數/);
await assert.rejects(()=>api.addTomorrowTask({text:'x'.repeat(501)},'1234'),/500/);
assert.equal(writes.length,0);
failCommit=true;
await assert.rejects(()=>api.addTomorrowTask({text:'未授權'},'9999'),error=>error.code==='permission-denied');
assert.equal(writes.length,0,'Rejected authorization leaves no partial request or content');
failCommit=false;
const {id}=await api.addTomorrowTask({text:'學生第三點\n學生第四點',targetDate:'2020-01-01',author:'老師'},'1234');
assert.equal(writes.length,1);assert.equal(writes[0].length,2,'Authorization and content commit atomically');
assert.equal(JSON.stringify(store.get(root)),original,'Appending never overwrites the teacher document');
const addition=store.get(`${root}/tomorrowSubmissions/${id}`), authorization=store.get(`${root}/addTaskRequests/${id}`);
assert.equal(addition.targetDate,'2026-10-07');assert.equal(addition.entryMode,'daily');assert.equal(addition.author,'學生');
assert(!('code' in addition),'The public record never contains the confirmation code');
assert.equal(authorization.code,'1234');assert.equal(authorization.taskId,id);
let state=(await api.getState()).data;
assert.deepEqual(JSON.parse(state.tomorrowTasks).map(item=>item.text),['教師第一點','教師第二點','學生第三點','學生第四點']);
assert(JSON.parse(state.tomorrowTasks).every(item=>!item.deletable));
// A derived copy from a previous teacher save must not duplicate the live student record.
store.get(root).data.tomorrowTasks=state.tomorrowTasks;
state=(await api.getState()).data;assert.equal(JSON.parse(state.tomorrowTasks).length,4);
await assert.rejects(()=>api.editTomorrowSubmission(id,{text:'改掉'},'1234'),/教師/);
await assert.rejects(()=>api.deleteTomorrowSubmission(id,'1234'),/教師/);
await assert.rejects(()=>api.teacherDeleteTomorrowSubmission(id),/教師/);
assert.equal(store.get(`${root}/tomorrowSubmissions/${id}`).text,'學生第三點\n學生第四點');
now=new Date('2026-10-08T04:00:00Z');state=(await api.getState()).data;
assert.deepEqual(JSON.parse(state.todayTasks).map(item=>item.text),['教師第一點','教師第二點','學生第三點','學生第四點']);
now=new Date('2026-10-09T04:00:00Z');state=(await api.getState()).data;
assert(JSON.parse(state.taskHistory)['2026-10-07'].some(item=>item.text==='學生第三點'));
now=new Date('2026-10-10T04:00:00Z');await assert.rejects(()=>api.addTomorrowTask({text:'週六'},'1234'),/假日/);
now=new Date('2026-10-12T04:00:00Z');store.get(root).data.nonSchoolDays='["2026-10-12"]';
await assert.rejects(()=>api.addTomorrowTask({text:'自定假日'},'1234'),/假日/);
teacher=true;
const code=await api.getDailyDeleteCode();assert.equal(code,'1234');
const daily=store.get(`${root}/teacherPrivate/dailyConfirmation`);
assert.equal(daily.validUntil.toMillis(),+new Date('2026-10-12T16:00:00Z'),'Confirmation expires at Taipei midnight');
assert.equal(await api.getDailyDeleteCode(),code);
// Existing daily codes are upgraded without changing the number the teacher already shared.
delete daily.validUntil;daily.code='5678';assert.equal(await api.getDailyDeleteCode(),'5678');
assert(store.get(`${root}/teacherPrivate/dailyConfirmation`).validUntil instanceof Timestamp);
await api.editTomorrowSubmission(id,{text:'教師修改'});assert.equal(store.get(`${root}/tomorrowSubmissions/${id}`).text,'教師修改');
await api.teacherDeleteTomorrowSubmission(id);assert(!store.has(`${root}/tomorrowSubmissions/${id}`));
const submissionRules=rules.split('match /tomorrowSubmissions/{submissionId}')[1].split('match /addTaskRequests/{submissionId}')[0];
assert.match(submissionRules,/allow update, delete: if isTeacher\(\);/);
assert.match(submissionRules,/getAfter\(/);assert.match(submissionRules,/requestedAt == request.time/);
assert(!submissionRules.includes('editRequests')&&!submissionRules.includes('deleteRequests'));
assert.match(rules,/request.time < daily.validUntil/);assert.match(rules,/allow read, update, delete: if false;/);
for(const collection of ['deleteRequests','editRequests'])assert.match(rules.split(`match /${collection}/{submissionId}`)[1],/^\s*\{\s*allow read, write: if false;/);
assert(board.includes('onclick="openStudentTaskForm()"'));assert(board.includes('type="password" inputmode="numeric"'));
const ui=board.split('let studentTaskSubmitting = false;')[1].split("document.getElementById('course-submit-password')")[0];
assert(!ui.includes('reload(')&&!ui.includes('editTomorrowSubmission')&&!ui.includes('deleteTomorrowSubmission'));
assert(ui.includes('if (studentTaskSubmitting) return;')&&ui.includes('await loadCloudData()'));
for(const html of ['board.html','teacher.html','book.html','doodle.html'])assert(fs.readFileSync(new URL(`../${html}`,import.meta.url),'utf8').includes('firebase-classroom.js?v=student-add-only-1'));
// Parse inline scripts so removed legacy form references cannot hide a syntax regression.
for(const html of ['board.html','teacher.html'])for(const match of fs.readFileSync(new URL(`../${html}`,import.meta.url),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
console.log('Student task tests: passed (append-only atomic writes, private code, date/holiday limits, teacher content preserved, line splitting, rollover/history, duplicate protection, student edit/delete blocked, midnight expiry, legacy code upgrade, teacher management, scoped rule guards and UI syntax).');
