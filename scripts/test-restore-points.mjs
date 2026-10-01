import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../firebase-classroom.js',import.meta.url),'utf8');
const path='classrooms/classboard-807',store=new Map();
const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'&&typeof value.toDate!=='function'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
class Ref {
  constructor(path){this.path=path;}
  collection(name){return new Collection(`${this.path}/${name}`);}
  doc(name){return new Ref(`${this.path}/${name}`);}
  async get(){const value=clone(store.get(this.path));return{exists:value!==undefined,data:()=>value,id:this.path.split('/').at(-1)};}
}
class Collection extends Ref {
  async get(){const docs=[];for(const key of store.keys())if(key.startsWith(`${this.path}/`)&&key.split('/').length===this.path.split('/').length+1)docs.push(await new Ref(key).get());return{docs,forEach:callback=>docs.forEach(callback)};}
}
let failCommit=false;
const db={collection:name=>new Collection(name),runTransaction:async callback=>{
  const writes=[];let writing=false;
  const result=await callback({get:ref=>{assert(!writing,'All transaction reads must precede writes');return ref.get();},set:(ref,data,options)=>{writing=true;writes.push([ref.path,clone(data),options]);}});
  if(failCommit)throw new Error('Simulated network failure');
  for(const [key,value,options] of writes){const previous=store.get(key)||{};store.set(key,options?.mergeFields?{...previous,...value}:value);}
  return result;
}};
function session(){
  const auth=()=>({currentUser:{email:'teacher@qfm.kh.edu.tw'}}),firestore=()=>db;
  firestore.FieldValue={serverTimestamp:()=>({toDate:()=>new Date()})};
  const firebase={apps:[],initializeApp:()=>({}),auth,firestore};
  const context={firebase,window:{firebase,fetch:async()=>{},location:{href:'https://example.test/'}},Response,URL,Intl,Date,crypto:{randomUUID:()=>Math.random().toString(36)}};
  vm.runInNewContext(source,context);return context.window.FirebaseClassroom;
}
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const initial={taskDate:JSON.stringify(day),scheduledTasks:JSON.stringify([{id:'old',targetDate:'2026-09-30',text:'original'}]),leaveRecords:'{}',classTimetable:'[]',classroomStudentRoster:JSON.stringify([{seat:1,name:'student'}]),extraFutureSetting:'keep'};
store.set(path,{data:initial});
const a=session(),b=session();
const av=(await a.getState()).data,bv=(await b.getState()).data;
await a.createRestorePoint('',true);await a.createRestorePoint('',true);
assert.equal((await a.getRestorePoints()).length,1,'Initial checkpoint is idempotent');
const newerSchedule=JSON.stringify([{id:'new',targetDate:day,text:'new content'}]);
await a.saveState({...av,scheduledTasks:newerSchedule});
await b.saveState({...bv,leaveRecords:JSON.stringify({[day]:[1]})});
assert.equal(store.get(path).data.scheduledTasks,newerSchedule,'Different-device leave edit must preserve new schedule');
assert.equal(store.get(path).data.extraFutureSetting,'keep');
const beforeConflict=JSON.stringify(store.get(path));
await assert.rejects(()=>b.saveState({...bv,leaveRecords:JSON.stringify({[day]:[1]}),scheduledTasks:'[]'}),error=>error.code==='classroom/conflict');
assert.equal(JSON.stringify(store.get(path)),beforeConflict,'Conflict must not change cloud state');
const reloaded=(await b.getState()).data;
failCommit=true;const countBefore=(await b.getRestorePoints()).length;
await assert.rejects(()=>b.saveState({...reloaded,classTimetable:'["changed"]'}));
failCommit=false;assert.equal((await b.getRestorePoints()).length,countBefore,'Failed commit must not leave a partial checkpoint');
await b.saveState({...reloaded,classTimetable:'["changed"]'});
const checkpoint=(await b.getRestorePoints()).find(point=>point.kind==='initial');
const stale=session();await stale.getState();
await b.restorePoint(checkpoint.id,'records',checkpoint.sequence);
assert.equal(store.get(path).data.scheduledTasks,initial.scheduledTasks);
assert.equal(store.get(path).data.leaveRecords,'{}');
assert.equal(store.get(path).data.classTimetable,'["changed"]','Records-only recovery must preserve timetable');
const recoveryBackup=(await b.getRestorePoints())[0];
assert.equal(recoveryBackup.kind,'before-restore');
await assert.rejects(()=>stale.saveState({...reloaded,classTimetable:'["stale"]'}),error=>error.code==='classroom/conflict');
await b.restorePoint(recoveryBackup.id,'records',recoveryBackup.sequence);
assert.equal(store.get(path).data.scheduledTasks,newerSchedule,'Recovery can be undone using its checkpoint');
assert.equal(store.get(path).data.leaveRecords,JSON.stringify({[day]:[1]}));
for(let index=0;index<35;index++)await b.createRestorePoint(`point ${index}`);
assert.equal((await b.getRestorePoints()).length,30,'Storage is bounded to 30 snapshots');
await assert.rejects(()=>b.restorePoint(checkpoint.id,'all',checkpoint.sequence));
const latest=(await b.getState()).data;delete latest.extraFutureSetting;
await b.saveState(latest,{managedKeys:['extraFutureSetting']});
assert(!Object.hasOwn(store.get(path).data,'extraFutureSetting'),'Managed-key deletion replaces the map without retaining removed fields');
console.log('Restore point tests: passed (cross-device edits, conflicts, atomic failure, scoped restore, undo, stale restore, 30-point limit).');
