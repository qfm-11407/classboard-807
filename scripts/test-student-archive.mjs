import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const source=fs.readFileSync(new URL('../firebase-classroom.js',import.meta.url),'utf8');
const path='classrooms/classboard-807',store=new Map(),copy=value=>structuredClone(value);
class Ref {
  constructor(path){this.path=path;}
  collection(name){return new Collection(`${this.path}/${name}`);}
  doc(name){return new Ref(`${this.path}/${name}`);}
  async get(){const value=copy(store.get(this.path));return {exists:value!==undefined,data:()=>value,id:this.path.split('/').at(-1)};}
  async set(value){store.set(this.path,copy(value));}
  async delete(){store.delete(this.path);}
}
class Collection extends Ref {
  constructor(path,filters=[]){super(path);this.filters=filters;}
  where(key,op,value){return new Collection(this.path,[...this.filters,[key,op,value]]);}
  async get(){const docs=[];for(const key of store.keys())if(key.startsWith(`${this.path}/`)&&key.split('/').length===this.path.split('/').length+1){const doc=await new Ref(key).get();if(this.filters.every(([field,op,value])=>op==='=='?doc.data()[field]===value:op==='>='?doc.data()[field]>=value:doc.data()[field]<=value))docs.push(doc);}return {docs,forEach:fn=>docs.forEach(fn)};}
}
let failCommit=false;
const db={collection:name=>new Collection(name),runTransaction:async fn=>{
  const writes=[];let writing=false;
  const result=await fn({get:ref=>{assert(!writing,'Reads must precede writes');return ref.get();},set:(ref,value,options)=>{writing=true;writes.push([ref.path,copy(value),options]);}});
  if(failCommit)throw new Error('Simulated failure');
  for(const [key,value,options] of writes)store.set(key,options?.mergeFields?{...store.get(key),...value}:value);
  return result;
}};
function session(email='teacher@qfm.kh.edu.tw') {
  const auth=()=>({currentUser:email?{email}:null}),firestore=()=>db;firestore.FieldValue={serverTimestamp:()=>null};
  const firebase={apps:[],initializeApp:()=>({}),auth,firestore};
  const window={firebase,fetch:async()=>{},location:{href:'https://example.test/'}};
  vm.runInNewContext(source,{firebase,window,Response,URL,Intl,Date,crypto:{randomUUID}});return {api:window.FirebaseClassroom,window};
}
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const roster=[{seat:1,name:'轉出同學',openid:'old',id:'old-student'},{seat:3,name:'在校同學',id:'stay'}];
const raw={taskDate:JSON.stringify(day),classroomStudentRoster:JSON.stringify(roster),classroomStudentNames:'["轉出同學","","在校同學"]',classroomTotalStudents:'3',
  cleaningAssignments:'{"female":["01","03"]}',cleaningTaskConfig:'[{"id":"female","limit":2}]',lunchAssignments:'{"a":["01","03"]}',lunchWeeklyGroups:'[{"id":"a","limit":8,"seats":[1,3]}]',lunchHelperSeats:'[1]',classCadres:'{"leader":[1,3]}',dutyAssignments:'[1,3]',
  leaveRecords:JSON.stringify({[day]:[1,3]}),leaveHalfDayRecords:'{"2026-09-01":{"morning":[1]},"2026-09-02":{"morning":[1],"afternoon":[1]}}',
  classSeating:'[1,0,2]',classroomSeatingLayout:'[1,3,null]',subjectData:'{"國文":[{"id":"t1","name":"習作","records":[false,false,true]}]}',notebookCheckins:'{"2026-09-01":{"1":"2026-09-01T00:00:00Z"}}',extraFutureSetting:'keep'};
store.set(path,{data:raw,revision:1});
const oldCompletion=`${path}/courseCompletions/${encodeURIComponent('國文')}__t1__1`,oldCheckin=`${path}/notebookCheckins/2026-09-02_1`;
store.set(oldCompletion,{subject:'國文',taskId:'t1',seat:1,createdAt:'2026-09-01T00:00:00Z'});
store.set(oldCheckin,{seat:1,date:'2026-09-02',timestamp:'2026-09-02T00:00:00Z'});
const {api}=session(),stale=session().api;await api.getState();const baseline=(await stale.getState()).data;
await assert.rejects(()=>session(null).api.getArchivedStudents(),/登入/);
await assert.rejects(()=>session(null).api.archiveStudent({seat:1,transferDate:day}),/登入/);
await assert.rejects(()=>api.archiveStudent({seat:1,name:'轉出同學',transferDate:'2026-02-31'}),/有效/);
failCommit=true;const before=JSON.stringify([...store]);await assert.rejects(()=>api.archiveStudent({seat:1,studentId:'old-student',transferDate:day}));assert.equal(JSON.stringify([...store]),before,'Archive must be atomic on failure');failCommit=false;
const archivedState=await api.archiveStudent({seat:1,studentId:'old-student',transferDate:day});
const parse=key=>JSON.parse(store.get(path).data[key]);
assert.deepEqual(parse('classroomStudentRoster').map(student=>student.seat),[3]);
for(const key of ['cleaningAssignments','lunchAssignments','classCadres'])assert(!Object.values(parse(key)).flat().some(seat=>Number(seat)===1));
assert.deepEqual(parse('dutyAssignments'),[3]);assert.deepEqual(parse('lunchHelperSeats'),[]);
assert.deepEqual(parse('lunchWeeklyGroups')[0].seats,[3]);assert.equal(parse('lunchWeeklyGroups')[0].limit,8);
assert.equal(parse('classroomSeatingLayout')[0],null);assert.equal(parse('classSeating')[0],0);
assert.deepEqual(parse('leaveRecords')[day],[3]);assert.deepEqual(parse('leaveHalfDayRecords'),{});
assert.equal(parse('cleaningTaskConfig')[0].limit,2,'Vacancy releases a student, not the planned capacity');
assert.equal(store.get(path).data.extraFutureSetting,'keep');assert(store.has(oldCompletion)&&store.has(oldCheckin));
assert(!JSON.stringify(archivedState.data).includes('轉出同學'),'Active public state does not contain archived names');
const archived=await api.getArchivedStudents();assert.equal(archived.length,1);
assert.equal(archived[0].records.leaves.reduce((sum,item)=>sum+item.days,0),2.5);
assert.equal(archived[0].records.tasks[0].completed,true);assert.equal(Object.keys(archived[0].records.notebook).length,2);
assert.equal((await api.getRestorePoints())[0].kind,'before-student-archive');
await assert.rejects(()=>stale.saveState({...baseline,classTimetable:'[]'}),error=>error.code==='classroom/conflict');
await assert.rejects(()=>api.archiveStudent({seat:1,studentId:'old-student',transferDate:day}),/變更/);
await assert.rejects(()=>api.restoreArchivedStudent(archived[0].id,3),/已有學生/);

// Reusing a seat must not inherit public subcollection records from its old owner.
const newStudent={seat:1,name:'新同學',id:'new-student',recordSince:new Date().toISOString()};
const nextRoster=[newStudent,...parse('classroomStudentRoster')];store.get(path).data.classroomStudentRoster=JSON.stringify(nextRoster);
let payload=await api.getState();assert.equal(JSON.parse(payload.data.subjectData)['國文'][0].records[0],false);
assert.equal(JSON.stringify(await api.getNotebookMonth('2026-09')),'{}');
const client=session(null);const response=await client.window.fetch('/api/classroom?action=course',{method:'POST',body:JSON.stringify({operation:'toggle',subject:'國文',taskId:'t1',seat:1})});
assert.equal(response.status,200);assert(store.has(oldCompletion),'New student toggles must not delete old records');
payload=await api.getState();assert.equal(JSON.parse(payload.data.subjectData)['國文'][0].records[0],true);
await client.api.addNotebookCheckin({seat:1,date:'2026-09-02'});assert(store.has(oldCheckin));
assert.equal(Object.keys(await api.getNotebookMonth('2026-09')).length,1);
await assert.rejects(()=>client.api.addNotebookCheckin({seat:2,date:day}),/不在目前名單/);

// Restore to a different free seat, preserving history without reclaiming work.
await api.getState();payload=await api.restoreArchivedStudent(archived[0].id,4);
const restored=parse('classroomStudentRoster').find(student=>student.seat===4);assert.equal(restored.id,'old-student');assert(restored.recordSince);
assert(parse('leaveRecords')[day].includes(4));assert.deepEqual(parse('leaveHalfDayRecords')['2026-09-01'].morning,[4]);
assert.equal(JSON.parse(payload.data.subjectData)['國文'][0].records[3],true);
assert.equal((await api.getNotebookMonth('2026-09'))['2026-09-01'][4],'2026-09-01T00:00:00Z');
assert(!Object.values(parse('cleaningAssignments')).flat().includes('04'));
assert.equal((await api.getArchivedStudents()).length,0);await assert.rejects(()=>api.restoreArchivedStudent(archived[0].id,6),/已恢復/);
const rules=fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');const archiveRules=rules.slice(rules.indexOf('match /archivedStudents'),rules.indexOf('match /courseCompletions'));
assert(archiveRules.includes('allow read: if isTeacher()'));assert(archiveRules.includes('allow delete: if false'));
console.log('Student archive: passed (atomic failure, staffing release, private history, stale-device conflict, seat reuse, safe restoration).');
