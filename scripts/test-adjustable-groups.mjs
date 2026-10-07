import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const shared=fs.readFileSync(new URL('../classroom-groups.js',import.meta.url),'utf8');
const teacher=fs.readFileSync(new URL('../teacher.html',import.meta.url),'utf8');
const board=fs.readFileSync(new URL('../board.html',import.meta.url),'utf8');
const context={};vm.runInNewContext(shared,context);
const G=context.ClassroomGroups,plain=value=>JSON.parse(JSON.stringify(value));
const roster=Array.from({length:28},(_,i)=>({seat:i+1,name:`學生${i+1}`})).filter(student=>![2,5].includes(student.seat));
const groups=plain(G.lunchGroups(roster,null,null));
assert.deepEqual(groups.map(group=>group.seats.length),[8,8,8]);
assert.deepEqual(plain(G.helperSeats(roster,null)),[14,24]);
assert.deepEqual(plain(G.lunchGroups(roster,[null],null)),groups,'Invalid old configuration falls back safely');
const edited=G.resizeLunchGroup(groups,'group-1',10);
assert.equal(edited[0].limit,10);assert.equal(groups[0].limit,8);
const expanded=[...roster,{seat:29,name:'新同學'}];
assert.deepEqual(plain(G.lunchGroups(expanded,edited,[14,24])),plain(edited),'A new roster member never fills a hole implicitly');
assert.deepEqual(plain(G.unassignedSeats(expanded,edited,[14,24])),[29]);
const moved=G.moveLunchSeat(edited,29,'group-1');
assert.equal(moved[0].seats.length,9);assert.deepEqual(plain(moved[1]),groups[1]);
assert.deepEqual(plain(G.moveLunchSeat(moved,29,null)),plain(edited));
const before=JSON.stringify(moved);
assert.throws(()=>G.resizeLunchGroup(moved,'group-1',8),/先移出/);
assert.throws(()=>G.moveLunchSeat(moved,29,'group-2'),/已滿/);
assert.equal(JSON.stringify(moved),before,'Rejected changes are atomic');
for(const value of [0,-1,1.5,61,''])assert.throws(()=>G.resizeLunchGroup(groups,'group-1',value),/整數/);
const deleted=expanded.filter(student=>student.seat!==3);
const pruned=G.lunchGroups(deleted,moved,[14,24]);
assert.deepEqual(plain(pruned[0].seats),[1,4,6,7,8,9,10,29]);
assert.equal(pruned[0].limit,10);assert.deepEqual(plain(pruned.slice(1)),groups.slice(1));
const helpers=G.helperSeats(deleted,[1,1,999]);assert.deepEqual(plain(helpers),[1]);
assert(!G.lunchGroups(deleted,pruned,helpers)[0].seats.includes(1));
assert.deepEqual(plain(G.helperSeats(roster,[])),[],'Zero helpers is supported');
const fullRoster=Array.from({length:60},(_,i)=>({seat:i+1}));
const large=G.lunchGroups(fullRoster,[{id:'all',limit:40,seats:Array.from({length:40},(_,i)=>i+1)}],[]);
assert.equal(large[0].seats.length,40,'There is no hardcoded eight-person cap');
assert.equal(G.lunchGroups(roster,[{id:'keep',limit:1,seats:[1,3,4]}],[])[0].seats.length,3,'Legacy limits cannot silently discard assignments');
assert.deepEqual(plain(G.dutySeats(roster,[1,4,6],3,0)),[1,4,6]);
assert.deepEqual(plain(G.dutySeats(roster,[1,4,6],3,1)),[6,7,8]);
assert.deepEqual(plain(G.dutySeats(roster,[28],1,1)),[1]);
assert.deepEqual(plain(G.dutySeats([{seat:1},{seat:3}],[1],8,1)),[1,3]);

// Exercise the real teacher UI handlers against a small in-memory DOM/store.
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this.queries=new Map();this.value='';this.hidden=false;this._html='';this.textContent='';this.classList={add(){},remove(){}};}
  set innerHTML(value){this._html=value;this.children=[];}get innerHTML(){return this._html;}
  append(...children){this.children.push(...children);}setAttribute(key,value){this.attrs[key]=value;}
  querySelector(key){if(!this.queries.has(key))this.queries.set(key,new Element());return this.queries.get(key);}
  remove(){this.removed=true;}focus(){}
}
const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const store=new Map(),readJSON=(key,fallback)=>store.has(key)?JSON.parse(store.get(key)):fallback;
const writeJSON=(key,value)=>store.set(key,JSON.stringify(value));
const document={createElement:tag=>new Element(tag),body:new Element('body')};
const ui={ClassroomGroups:G,roster:()=>expanded,readJSON,writeJSON,$,document,
  escapeHTML:value=>String(value),message:(id,text)=>$(id).textContent=text,taipeiDay:()=> '2026-10-08',
  activeLunchWeeklyGroupId:()=> 'group-1',renderSeatPicker:(grid,make)=>{grid.children=[];expanded.forEach(student=>grid.append(make(student)));},
  storedDutyRotationStartDate:()=> '2026-10-08',dutyWeekdaySteps:()=>0};
vm.createContext(ui);
const extract=(html,name)=>{
  const start=html.indexOf(`    function ${name}(`);assert(start>=0,name);
  const remaining=html.slice(start),boundary=remaining.slice(1).search(/\n    (?:function |const |let |\$\()/);
  return boundary<0?remaining:remaining.slice(0,boundary+1);
};
for(const name of ['lunchHelperSeats','lunchWeeklyGroups','lunchHelperMembers','lunchWeeklyMembers'])vm.runInContext(extract(teacher,name),ui);
vm.runInContext('let lunchSwapSeat=null;',ui);
vm.runInContext(teacher.slice(teacher.indexOf('    function renderLunchWeeklyGroups('),teacher.indexOf('    let selectedSubjectArea')),ui);
writeJSON('lunchWeeklyGroups',groups);writeJSON('lunchHelperSeats',[14,24]);
ui.renderLunchWeeklyGroups();ui.renderLunchSwapGroups();
const card=$('lunch-swap-groups').children[0],controls=card.children[1];
controls.children[1].value=9;controls.children[2].onclick();
assert.equal(readJSON('lunchWeeklyGroups')[0].limit,9,'Actual save button persists the new capacity');
$('lunch-unassigned').children[0].onclick();
let first=$('lunch-swap-groups').children[0];first.children.at(-1).onclick();
assert(readJSON('lunchWeeklyGroups')[0].seats.includes(29),'Actual move button assigns a newly added student');
first=$('lunch-swap-groups').children[0];first.children[2].children.at(-1).onclick();
$('lunch-unassign').onclick();assert(!readJSON('lunchWeeklyGroups')[0].seats.includes(29));
const originals=readJSON('lunchWeeklyGroups');
$('lunch-swap-groups').children[0].children[2].children[0].onclick();
$('lunch-swap-groups').children[1].children[2].children[0].onclick();
assert.equal(readJSON('lunchWeeklyGroups')[0].seats[0],11);assert.equal(readJSON('lunchWeeklyGroups')[1].seats[0],1);
assert.deepEqual(readJSON('lunchWeeklyGroups').map(group=>group.seats.length),originals.map(group=>group.seats.length));
$('edit-lunch-helpers').onclick();
const modal=document.body.children.at(-1),helperGrid=modal.querySelector('[data-grid]');
helperGrid.children.find(button=>button.textContent.startsWith('14 ')).onclick();
modal.querySelector('[data-save]').onclick();
assert.deepEqual(readJSON('lunchHelperSeats'),[24]);
assert($('lunch-unassigned').children.some(button=>button.textContent.startsWith('14 ')),'Removed helper becomes unassigned');

vm.runInContext(teacher.slice(teacher.indexOf('    function dutyCount('),teacher.indexOf('    const CADRE_DEFAULTS')),ui);
writeJSON('dutyAssignments',[1,4]);$('duty-count').value=3;$('save-duty-count').onclick();
assert.equal(readJSON('dutyCount'),3);assert.deepEqual(plain(ui.dutySeatsForToday()),[1,4]);
const boardContext={ClassroomGroups:G,studentRoster:expanded,localStorage:{getItem:key=>store.get(key)??null},
  readTaskList:(key,fallback=[])=>{const value=readJSON(key,null);return Array.isArray(value)?value:fallback;},
  dateKey:()=> '2026-10-08',storedDutyRotationStartDate:()=> '2026-10-08',dutyWeekdaySteps:()=>0};
vm.createContext(boardContext);
for(const name of ['lunchHelperSeats','lunchWeeklyGroups','dutySeatsForDate'])vm.runInContext(extract(board,name),boardContext);
assert.deepEqual(plain(ui.lunchWeeklyGroups()),plain(boardContext.lunchWeeklyGroups()),'Teacher and board use identical saved membership/capacity/helper settings');
assert.deepEqual(plain(boardContext.dutySeatsForDate()),[1,4]);
writeJSON('dutyAssignments',[1,4,6]);assert.deepEqual(plain(boardContext.dutySeatsForDate()),[1,4,6],'Student view reads numeric dutyCount, not array-only parser');
for(const html of [teacher,board]){
  assert(html.includes('classroom-groups.js?v=1'));
  const keys=html.match(/const CLOUD_KEYS = (\[[^;]+\])/)[1];
  for(const key of ['dutyCount','lunchHelperSeats','lunchWeeklyGroups'])assert(keys.includes(`'${key}'`));
  assert(!html.includes('const LUNCH_HELPER_SEATS'));
}
for(const html of [teacher,board])for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
console.log('Adjustable groups: passed (capacity edits, moves, swaps, helpers, roster additions/deletions, legacy preservation, duty counts and teacher/student parity).');
