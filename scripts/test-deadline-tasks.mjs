import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../deadline-tasks.js', import.meta.url), 'utf8');
let now = +new Date('2026-10-28T03:00:00Z'), serverNow = now, teacher = true, offline = false, beforeCommit = null, sequence = 0;
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
class Timestamp { constructor(time) { this.time = +time; } toMillis() { return this.time; } static fromDate(value) { return new Timestamp(value); } }
const documents = new Map(), writes = [], watches = [];
const root = 'classrooms/classboard-807', collection = `${root}/deadlineTasks`;
const students = [{seat:1,name:'學生一'},{seat:3,name:'學生三',recordSince:'2026-09-01T00:00:00Z'}];
const originalClass = { data: { classroomStudentRoster:JSON.stringify(students),subjectData:'{"國文":[{"id":"old","name":"舊任務","records":[true,false,true]}]}' } };
documents.set(root, originalClass);
const snap = path => ({ id:path.split('/').at(-1), exists:documents.has(path), data:()=>documents.get(path), metadata:{hasPendingWrites:false,fromCache:false} });
class Ref {
  constructor(path) { this.path=path; this.id=path.split('/').at(-1); }
  doc(id = `task-${++sequence}`) { return new Ref(`${this.path}/${id}`); }
  collection(id) { return new Ref(`${this.path}/${id}`); }
  async get(options) { assert.equal(options.source,'server'); if(offline) throw new Error('offline'); return snap(this.path); }
  onSnapshot(options,next,error) { watches.push({path:this.path,next,error}); return ()=>{}; }
}
// The fake transaction models server denial at commit, including a client clock set in the past.
const db = { collection:name=>new Ref(name), runTransaction:async callback=>{
  if(offline) throw new Error('offline');
  const pending=[];
  const transaction={get:async ref=>snap(ref.path),set:(ref,data)=>pending.push(['set',ref.path,data]),update:(ref,data)=>pending.push(['update',ref.path,data]),delete:ref=>pending.push(['delete',ref.path])};
  await callback(transaction); beforeCommit?.(); beforeCommit=null;
  for(const [operation,path,data] of pending) {
    if(path.includes('/records/')) {
      const task=documents.get(path.split('/records/')[0]);
      if(task.hidden||serverNow>=task.deadline.toMillis()) { const error=new Error('server denied');error.code='permission-denied';throw error; }
    }
    if(data?.createdAt==='server-time') data.createdAt=new Timestamp(serverNow);
    if(data?.updatedAt==='server-time') data.updatedAt=new Timestamp(serverNow);
    if(data?.completedAt==='server-time') data.completedAt=new Timestamp(serverNow);
    if(operation==='delete')documents.delete(path);
    else documents.set(path,operation==='update'?{...documents.get(path),...data}:data);
    writes.push([operation,path]);
  }
}};
const firestore=()=>db;firestore.Timestamp=Timestamp;firestore.FieldValue={serverTimestamp:()=> 'server-time'};
const firebase={app:()=>({}),firestore,auth:()=>({get currentUser(){return teacher?{email:'teacher@qfm.kh.edu.tw'}:null;}})};
const context={Date:Clock,Intl,console};vm.runInNewContext(code,context);
const D=context.DeadlineTasks, api=D.createService(firebase);
const plain=value=>JSON.parse(JSON.stringify(value));
assert.equal(D.dateInput(new Date('2026-10-30T04:00:00Z')),'2026-10-30T12:00');
assert.equal(+D.parseDeadline('2026-10-30T12:00'),+new Date('2026-10-30T04:00:00Z'));
assert.throws(()=>D.parseDeadline('2026-02-30T12:00'),/不正確/);
assert.throws(()=>D.parseDeadline('2026-10-30'),/完整/);
assert(D.closed(null));assert(D.closed({deadline:'2099-12-31'}));
const id=await api.create('星期五交作業','2026-10-30T12:00');
let task={...documents.get(`${collection}/${id}`),id};
assert.equal(task.name,'星期五交作業');assert.equal(task.version,1);
assert.deepEqual(Object.keys(task.participants),['1','3']);
assert.equal(task.createdAt.toMillis(),serverNow);
assert.equal(D.closed(task,task.deadline.toMillis()-1),false);
assert.equal(D.closed(task,task.deadline.toMillis()),true,'Equality is closed, not one tick after');
assert.equal(D.closed(task,task.deadline.toMillis()+1),true);
assert.deepEqual(documents.get(root),originalClass,'Creation does not change legacy subjectData or the classroom document');
await assert.rejects(()=>api.create('','2026-10-30T12:00'),/任務名稱/);
await assert.rejects(()=>api.create('已過期','2026-10-28T10:00'),/晚於/);
teacher=false;await assert.rejects(()=>api.create('學生新增','2026-10-30T12:00'),/登入/);
await assert.rejects(()=>api.update(task,{hidden:true}),/登入/);
await assert.rejects(()=>api.toggle(id,2),/名單/);
await assert.rejects(()=>api.toggle(id,3,'wrong-person'),/名單/);
await assert.rejects(()=>api.toggle(id,61),/不正確/);
await api.toggle(id,1);
assert.equal(documents.get(`${collection}/${id}/records/1`).completedAt.toMillis(),serverNow);
await api.toggle(id,1);assert(!documents.has(`${collection}/${id}/records/1`));
await api.toggle(id,3,students[1].recordSince);
const saved=documents.get(`${collection}/${id}/records/3`);
offline=true;await assert.rejects(()=>api.toggle(id,1),/offline/);assert(!documents.has(`${collection}/${id}/records/1`));
offline=false;teacher=true;
await api.update(task,{name:'更新名稱',deadlineInput:'2026-10-30T12:00'});
assert.equal(documents.get(`${collection}/${id}`).version,2);
await assert.rejects(()=>api.update(task,{hidden:true}),/另一台裝置/);
task={...documents.get(`${collection}/${id}`),id};
await api.update(task,{hidden:true});teacher=false;
await assert.rejects(()=>api.toggle(id,1),/隱藏/);
teacher=true;task={...documents.get(`${collection}/${id}`),id};await api.update(task,{hidden:false});
task={...documents.get(`${collection}/${id}`),id};teacher=false;
now=task.deadline.toMillis();serverNow=now;
await assert.rejects(()=>api.toggle(id,1),/截止/);
await assert.rejects(()=>api.toggle(id,3,students[1].recordSince),/截止/);
assert.equal(documents.get(`${collection}/${id}/records/3`),saved,'Deadline leaves existing records intact');
now-=60000; // Spoofed device time cannot bypass the commit-time rules.
await assert.rejects(()=>api.toggle(id,1),error=>error.code==='permission-denied');
await assert.rejects(()=>api.toggle(id,3,students[1].recordSince),error=>error.code==='permission-denied');
serverNow=now;beforeCommit=()=>{serverNow=task.deadline.toMillis();};
await assert.rejects(()=>api.toggle(id,1),error=>error.code==='permission-denied','A request initiated before expiry cannot commit after expiry');
assert(!documents.has(`${collection}/${id}/records/1`));
teacher=true;offline=true;await assert.rejects(()=>api.create('斷網新增','2026-11-01T12:00'),/offline/);offline=false;
now=serverNow=task.deadline.toMillis();
await api.update(task,{name:'截止後更名'});task={...documents.get(`${collection}/${id}`),id};
await assert.rejects(()=>api.update(task,{deadlineInput:'2026-10-29T12:00'}),/晚於/);
await api.update(task,{deadlineInput:'2026-11-01T12:00'});task={...documents.get(`${collection}/${id}`),id};
assert(!D.closed(task),'Teacher can explicitly extend a deadline');
assert.equal(documents.get(`${collection}/${id}/records/3`),saved);
assert.deepEqual(documents.get(root),originalClass);
// Page-based idiom tasks preserve the inclusive start/end range and never mark a rounded 99.99% as complete.
now=serverNow=+new Date('2026-10-28T03:00:00Z');
const pageId=await api.create('成語典','2026-10-30T12:00',{startPage:179,endPage:182});
const pageTask={...documents.get(`${collection}/${pageId}`),id:pageId};
assert(D.isPageTask(pageTask));assert.equal(pageTask.subject,'成語典');
for(const [lastPage,percent] of [[178,0],[179,25],[180,50],[181,75],[182,100]]) {
  const progress=D.pageProgress(pageTask,{lastPage,identity:''});
  assert.equal(progress.percent,percent);assert.equal(progress.finished,percent===100);
  assert.equal(progress.completed,lastPage-178);
}
assert.equal(D.pageProgress(pageTask,null).percent,0);
assert.equal(D.pageProgress({...pageTask,startPage:1,endPage:9999},{lastPage:9998,identity:''}).percent,99);
assert.equal(D.pageProgress({...pageTask,startPage:1,endPage:1},{lastPage:1,identity:''}).percent,100);
assert.equal(D.pageProgress(task,null),null);
assert.throws(()=>D.pageFields(182,179),/範圍/);assert.throws(()=>D.pageFields(0,1),/範圍/);assert.throws(()=>D.pageFields(1,10000),/範圍/);
teacher=false;
await assert.rejects(()=>api.toggle(pageId,1),/登記完成/);
await api.savePageProgress(pageId,1,180,'',null);
const pagePath=`${collection}/${pageId}/records/1`;
assert.equal(documents.get(pagePath).lastPage,180);assert.equal(documents.get(pagePath).completedAt,null);
assert.equal(documents.get(pagePath).updatedAt.toMillis(),serverNow);
let previousUpdatedAt=serverNow;now+=1000;serverNow=now;
await api.savePageProgress(pageId,1,182,'',previousUpdatedAt);
assert.equal(documents.get(pagePath).completedAt.toMillis(),serverNow);
const fullRecord=documents.get(pagePath);previousUpdatedAt=serverNow;
await api.savePageProgress(pageId,1,182,'',previousUpdatedAt);
assert.equal(documents.get(pagePath),fullRecord,'Resaving the same page does not replace completion time');
await assert.rejects(()=>api.savePageProgress(pageId,1,179,'',previousUpdatedAt-1000),/另一台裝置/);
for(const value of [177,183,180.5,'not-a-page'])await assert.rejects(()=>api.savePageProgress(pageId,1,value),/請填寫/);
await assert.rejects(()=>api.savePageProgress(pageId,2,180),/名單/);
await assert.rejects(()=>api.savePageProgress(pageId,3,180,'wrong-person'),/名單/);
offline=true;await assert.rejects(()=>api.savePageProgress(pageId,1,181),/offline/);offline=false;
now+=1000;serverNow=now;
await api.savePageProgress(pageId,1,181,'',previousUpdatedAt);
assert.equal(documents.get(pagePath).completedAt,null,'Corrections below 100% remove the completion flag');
await api.savePageProgress(pageId,1,'');assert.equal(D.pageProgress(pageTask,documents.get(pagePath)).percent,0);
await api.savePageProgress(pageId,1,180);
const partial=documents.get(pagePath);
now=serverNow=pageTask.deadline.toMillis();
await assert.rejects(()=>api.savePageProgress(pageId,1,182),/截止/);
now-=60000;await assert.rejects(()=>api.savePageProgress(pageId,1,182),error=>error.code==='permission-denied');
assert.equal(documents.get(pagePath),partial,'Expiry preserves partial progress, not just fully completed records');
assert.deepEqual(documents.get(root),originalClass);
assert.deepEqual(plain(D.participantsFromRoster([{seat:0,name:'無效'},{seat:2,name:'第二位'},{seat:61,name:'無效'}])),{'2':{name:'第二位',identity:''}});
let taskResult,recordResult;
api.watchTasks((items,online)=>taskResult={items,online},()=>{});
const publicTask=documents.get(`${collection}/${id}`);
watches.at(-1).next({docs:[{id,data:()=>publicTask,metadata:{hasPendingWrites:false}}],metadata:{fromCache:false}});
assert.equal(taskResult.items[0].id,id);assert.equal(taskResult.online,true);
api.watchRecords(id,(items,online)=>recordResult={items,online},()=>{});
watches.at(-1).next({docs:[{id:'3',data:()=>saved,metadata:{hasPendingWrites:false}},{id:'1',data:()=>({}),metadata:{hasPendingWrites:true}}],metadata:{fromCache:true}});
assert.deepEqual(Object.keys(recordResult.items),['3']);assert.equal(recordResult.online,false);
const beforePending=recordResult;
watches.at(-1).next({docs:[],metadata:{fromCache:false,hasPendingWrites:true}});
assert.equal(recordResult,beforePending,'Pending deletes must not erase the last confirmed record');
const rules=fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const scoped=rules.split('match /deadlineTasks/{taskId}')[1].split('match /courseCompletions/{completionId}')[0];
assert(scoped.includes('request.time < task.deadline'));
assert(scoped.includes('completedAt == request.time'));
assert(scoped.includes('allow update: if acceptingRecords() && pageTask() && validSeat() && validPageRecord();'));
assert(scoped.includes('data.lastPage >= task.startPage - 1 && data.lastPage <= task.endPage'));
assert(scoped.includes('data.updatedAt == request.time'));
assert(scoped.includes('allow delete: if acceptingRecords()'));
assert(scoped.includes('allow delete: if false;'));
assert(scoped.includes('assignedIdentity()'));
assert(scoped.includes("['name','deadline','hidden','version','updatedAt']"));
for(const file of ['board.html','teacher.html']) {
  const html=fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  for(const asset of ['deadline-tasks.js?v=2','deadline-tasks-ui.js?v=3','deadline-tasks.css?v=3'])assert(html.includes(asset));
}
const ui=fs.readFileSync(new URL('../deadline-tasks-ui.js',import.meta.url),'utf8');
assert(!/location\.(reload|href)|subjectData.*setItem/.test(ui));
assert(ui.includes('getSeatingLayout')&&ui.includes('normalizedSeatingLayout'));
assert(ui.includes('if (busy || D.closed(task) || !tasksOnline || !recordsOnline) return;'));
assert(ui.includes("dialog.addEventListener('close'"));
assert(ui.includes('延後時間會重新開放學生點選'));
console.log('Deadline tasks: passed (inclusive idiom pages, 0/25/50/75/100%, partial corrections, reset, server timestamps, stale progress conflicts, exact expiry, spoofed/late writes denied, offline safety, pending-delete protection, retained partial/legacy records, and scoped rules).');
