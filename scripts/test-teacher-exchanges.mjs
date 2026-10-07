import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const teacher=fs.readFileSync(new URL('../teacher.html',import.meta.url),'utf8');
const extract=name=>{const start=teacher.lastIndexOf('    function '+name+'(');assert(start>=0,name);const tail=teacher.slice(start),end=tail.slice(1).search(/\n    (?:function |const |let |\$\()/);return end<0?tail:tail.slice(0,end+1);};
const nodes=new Map();
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.style={};this.listeners={};this.textContent='';this.classList={add(){},remove(){}};}
  set id(value){this._id=value;nodes.set(value,this);}
  get id(){return this._id;}
  set innerHTML(value){this.html=value;this.children=[];}
  get innerHTML(){return this.html||'';}
  append(...children){this.children.push(...children);}
  before(node){this.beforeNode=node;}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(type,fn){this.listeners[type]=fn;}
}
const $=id=>nodes.get(id)||null;
for(const id of ['seating-layout','seating-count','unassigned-students','seating-message']){const node=new Element('div');node.id=id;}
const roster=[{seat:1,name:'學生甲'},{seat:3,name:'學生乙'},{seat:14,name:'學生丙'}];
const originalLayout=[14,null,1,3,...Array(26).fill(null)];
const data={classroomSeatingLayout:[...originalLayout],leaveRecords:{'2026-10-08':[14]},leaveHalfDayRecords:{'2026-10-08':{morning:[3]}},classSeating:[0,0,1],classSeatingSession:'morning'};
const snapshot=value=>JSON.stringify(value),writes=[];
let messages=[];
const context={$,document:{createElement:tag=>new Element(tag)},roster:()=>roster,
  readJSON:(key,fallback)=>data[key]??fallback,writeJSON:(key,value)=>{data[key]=JSON.parse(JSON.stringify(value));writes.push(key);},
  seatingInteractionMode:'attendance',selectedSeatingSeat:null,
  normalizedSeatingLayout:()=>[...data.classroomSeatingLayout],settleDailyLeaves(){},currentAbsentSeats:()=>new Set([3,14]),
  leaveDayClosed:()=>false,renderSeatingVersions(){},taipeiDay:()=> '2026-10-08',currentLeaveSession:()=> 'morning',
  leaveRecords:()=>JSON.parse(JSON.stringify(data.leaveRecords)),leaveHalfDayRecords:()=>JSON.parse(JSON.stringify(data.leaveHalfDayRecords)),
  temporaryAbsentSeats:()=>[],maxSeat:()=>14,leaveSessionLabel:()=> '上午',message:(id,text)=>messages.push([id,text])};
vm.createContext(context);
for(const name of ['createSeatCard','ensureSeatingExchangeControls','selectSeatingStudent','moveSeatingStudent','renderSeatingGrid','renderSeating'])vm.runInContext(extract(name),context);
context.renderSeating();
const event={stopPropagation(){}};
assert.equal($('seating-mode-attendance').attributes['aria-pressed'],'true');
assert.equal($('seating-mode-swap').attributes['aria-pressed'],'false');
$('seating-mode-swap').onclick();assert.equal(context.seatingInteractionMode,'swap');
const beforeLeave=snapshot([data.leaveRecords,data.leaveHalfDayRecords,data.classSeating,data.classSeatingSession]);
$('seating-layout').children[2].children[0].onclick(event);
assert.equal(context.selectedSeatingSeat,1);assert.equal(writes.length,0);
assert.equal($('seating-cancel-selection').hidden,false);
assert($('seating-layout').children[2].children[0].className.includes('exchange-selected'));
$('seating-layout').children[0].children[0].onclick(event);
assert.deepEqual(data.classroomSeatingLayout.slice(0,4),[1,null,14,3]);
assert.deepEqual(writes,['classroomSeatingLayout']);
assert.equal(snapshot([data.leaveRecords,data.leaveHalfDayRecords,data.classSeating,data.classSeatingSession]),beforeLeave,'Swapping even an absent student must not touch attendance');
assert.equal(context.selectedSeatingSeat,null);
// Empty-slot moves use the visible layout, not seat number order.
$('seating-layout').children[2].children[0].onclick(event);
$('seating-layout').children[1].onclick();
assert.deepEqual(data.classroomSeatingLayout.slice(0,4),[1,14,null,3]);
const beforeCancel=writes.length;
$('seating-layout').children[0].children[0].onclick(event);
$('seating-layout').children[0].children[0].onclick(event);
assert.equal(context.selectedSeatingSeat,null);assert.equal(writes.length,beforeCancel);
$('seating-layout').children[0].children[0].onclick(event);$('seating-cancel-selection').onclick();
assert.equal(context.selectedSeatingSeat,null);assert.equal(writes.length,beforeCancel);
// Dragging still swaps the exact slot and never changes leave records.
$('seating-layout').children[3].listeners.drop({preventDefault(){},dataTransfer:{getData:()=> '14'}});
assert.deepEqual(data.classroomSeatingLayout.slice(0,4),[1,3,null,14]);
assert.equal(snapshot([data.leaveRecords,data.leaveHalfDayRecords,data.classSeating,data.classSeatingSession]),beforeLeave);
const beforeInvalid=snapshot(data);
context.moveSeatingStudent(999,1);context.moveSeatingStudent(1,-1);context.moveSeatingStudent(1,30);
assert.equal(snapshot(data),beforeInvalid,'Invalid or stale drag payloads do not evict students');
// Returning to attendance preserves the original half-day registration action.
$('seating-mode-attendance').onclick();assert.equal(context.seatingInteractionMode,'attendance');
const beforeAttendanceLayout=snapshot(data.classroomSeatingLayout);
$('seating-layout').children[0].children[0].onclick(event);
assert(data.leaveHalfDayRecords['2026-10-08'].morning.includes(1));
assert.equal(snapshot(data.classroomSeatingLayout),beforeAttendanceLayout);
assert.equal(writes.at(-3),'leaveHalfDayRecords');
// Leaving either workspace clears pending selections; returning to seats defaults to attendance.
Object.assign(context,{selectedCleaningSeat:'01',seatingInteractionMode:'swap',selectedSeatingSeat:14,
  cleanupDeletedStudentLinks(){},renderScheduledTasks(){},document:{...context.document,querySelectorAll:()=>[]}});
vm.runInContext(extract('showPanel'),context);context.showPanel('scheduled');
assert.equal(context.selectedCleaningSeat,'');assert.equal(context.selectedSeatingSeat,null);assert.equal(context.seatingInteractionMode,'attendance');
for(const match of teacher.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
console.log('Teacher exchanges: passed (two-tap exact seat swaps, mode isolation, empty seats, drag parity, cancel, stale input protection, attendance unchanged and restored attendance action).');
