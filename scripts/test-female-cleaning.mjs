import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),teacher=read('teacher.html'),board=read('board.html');
const context={};vm.runInNewContext(read('classroom-groups.js'),context);const G=context.ClassroomGroups,plain=value=>JSON.parse(JSON.stringify(value));
const roster=Array.from({length:12},(_,i)=>({seat:i+1,name:'學生'+(i+1)}));
const tasks=[{id:'class',name:'(教室) 黑板',limit:1},...Array.from({length:6},(_,i)=>({id:'f'+i,name:'(女廁) 馬桶組 '+(i+1),limit:1})),{id:'wash',name:'(女廁) 洗手台',limit:1},{id:'floor',name:'(女廁) 地板',limit:2},{id:'male',name:'(男廁) 馬桶組 1',limit:1}];
const assignments={class:['10'],f0:['01'],f1:['02'],f2:['03'],f3:['04'],f4:['05'],f5:['06'],wash:['07'],floor:['08','09'],male:['11']};
const before=JSON.stringify({tasks,assignments}),merged=G.femaleCleaning(tasks,assignments,roster);
assert.equal(merged.tasks.length,7);assert.deepEqual(plain(merged.groups.map(task=>task.limit)),[2,2,2]);assert.equal(merged.groups[0].id,'f0');
assert.deepEqual(plain(merged.groups.map(task=>merged.assignments[task.id])),[['01','02'],['03','04'],['05','06']]);
assert.equal(merged.wash.limit,1);assert.equal(merged.floor.limit,2);assert.deepEqual(plain(merged.assignments.wash),['07']);assert.deepEqual(plain(merged.assignments.floor),['08','09']);
assert.deepEqual(plain(merged.assignments.class),['10']);assert.deepEqual(plain(merged.assignments.male),['11']);assert.equal(before,JSON.stringify({tasks,assignments}));
assert.deepEqual(plain(G.femaleCleaning(merged.tasks,merged.assignments,roster)),plain(merged),'Migration is idempotent');
const edited=plain(merged);edited.tasks.find(task=>task.id==='f0').limit=4;edited.tasks.find(task=>task.id==='f0').name='(女廁) 垃圾清理';
assert.deepEqual(plain(G.femaleCleaning(edited.tasks,edited.assignments,roster).tasks),edited.tasks,'Edited capacities/names never rebalance on refresh');
const communal=G.femaleCleaning([{id:'all',kind:'female-communal',name:'(女廁) 女廁共同清潔',limit:9,description:G.femaleCleaningDescription}],{all:Array.from({length:9},(_,i)=>String(i+1).padStart(2,'0'))},roster);
assert.deepEqual(plain(communal.groups.map(task=>task.limit)),[3,3,3]);assert.equal(communal.wash.limit,0);assert.equal(communal.floor.limit,0);
assert.equal(Object.values(communal.assignments).flat().length,9);assert(!communal.groups[0].description.includes('洗手台'));
assert.deepEqual(plain(G.femaleCleaning(communal.tasks,communal.assignments,roster)),plain(communal),'Zero-capacity services are not re-filled');
const pruned=G.femaleCleaning(tasks,{...assignments,f1:['01','999'],wash:['07','01']},roster);const femaleCodes=[...pruned.groups.flatMap(task=>pruned.assignments[task.id]),...pruned.assignments[pruned.wash.id],...pruned.assignments[pruned.floor.id]];assert.equal(new Set(femaleCodes).size,femaleCodes.length);assert(!femaleCodes.includes('999'));assert(pruned.assignments.wash.includes('01'));
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.textContent='';this.style={};this.classList={add(){},remove(){}};}
  append(...children){this.children.push(...children);}
  addEventListener(event,fn){this.listeners[event]=fn;}
}
const extract=(html,name)=>{const start=html.indexOf('    function '+name+'(');assert(start>=0);const tail=html.slice(start),end=tail.slice(1).search(/\n    (?:function |const |let |\$\()/);return end<0?tail:tail.slice(0,end+1);};
const slots=[...Array.from({length:6},(_,i)=>({slot:'toilet-'+(i+1),label:'馬桶組 '+(i+1),kind:'toilet'})),{slot:'wash',label:'洗手台',kind:'wash'},{slot:'floor',label:'地板',kind:'floor'}];
const ui={ClassroomGroups:G,document:{createElement:tag=>new Element(tag)},roster:()=>roster,studentRoster:roster,femaleRestroomSlots:slots,selectedCleaningSeat:'',renderDaily(){},moveCleaningStudent(){},openCleaningTaskMenu(){},ensureFemaleRestroomTasks(){}};vm.createContext(ui);
for(const [html,name] of [[teacher,'cleaningTaskMeta'],[teacher,'createTeacherFemaleRestroomPlan'],[board,'createFemaleRestroomPlan']])vm.runInContext(extract(html,name),ui);
const walk=element=>[element,...element.children.flatMap(walk)],isName=node=>node.className==='female-common-name'||node.className?.startsWith('cleaning-assignment-chip');
for(const plan of [ui.createTeacherFemaleRestroomPlan(tasks,assignments),ui.createFemaleRestroomPlan(tasks,assignments)]){
  const nodes=walk(plan),fixturePlan=plan.children[0],crews=plan.children[1];
  assert.equal(walk(fixturePlan).filter(node=>node.tag==='i').length,12);assert.equal(crews.children.length,3);
  assert.deepEqual(crews.children.map(panel=>walk(panel).filter(isName).length),[2,2,2]);
  assert.equal(walk(fixturePlan.children.at(-2)).filter(isName).length,1);assert.equal(walk(fixturePlan.children.at(-1)).filter(isName).length,2);
  assert(!nodes.filter(node=>node.className?.includes('communal-fixture')).some(node=>walk(node).some(item=>item.textContent.includes('學生'))));
}
const teacherPlan=ui.createTeacherFemaleRestroomPlan(tasks,assignments);let configured=null;ui.openCleaningTaskMenu=task=>configured=task;
teacherPlan.children[1].children[1].children[0].children[1].onclick({stopPropagation(){}});assert.equal(configured.groupIndex,2);
let moved=null;ui.moveCleaningStudent=(code,id)=>moved=[code,id];teacherPlan.children[1].children[2].ondrop({preventDefault(){},dataTransfer:{getData:()=> '12'}});assert.equal(moved[1],merged.groups[2].id);
const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element('input'));return elements.get(id);};
let saved=plain(communal.tasks);Object.assign(ui,{$,cleaningTaskMenu:()=>new Element('div'),CLEANING_AREAS:['教室','樓梯','男廁','女廁'],cleaningConfig:()=>saved,readJSON:()=>plain(communal.assignments),writeJSON:(key,value)=>{if(key==='cleaningTaskConfig')saved=plain(value);},message:()=>{}});
vm.runInContext(extract(teacher,'openCleaningTaskEditor'),ui);ui.openCleaningTaskEditor(communal.wash);assert.equal($('edit-cleaning-task-limit').min,'0');
$('edit-cleaning-task-limit').value=2;$('edit-cleaning-task-name').value='洗手台清潔';$('edit-cleaning-task-description').value='洗手台整理';$('save-cleaning-task-edit').onclick();assert.equal(saved.find(task=>task.id===communal.wash.id).limit,2);
ui.openCleaningTaskEditor(saved.find(task=>task.id===communal.wash.id));$('edit-cleaning-task-limit').value=0;$('save-cleaning-task-edit').onclick();assert.equal(saved.find(task=>task.id===communal.wash.id).limit,0);
assert(teacher.includes('id="edit-cleaning-task-description"'));
const draws=[],canvas={fill(){},stroke(){},fillRect(){},strokeRect(){},fillText:(text,...args)=>draws.push([text,...args])};
ui.cleaningSummaryRoundRect=()=>{};vm.runInContext(extract(teacher,'drawFemaleCommunalExport'),ui);
ui.drawFemaleCommunalExport(canvas,{x:0,y:0,width:2188,height:884},merged,task=>(merged.assignments[task.id]||[]).map(code=>code+' 學生'+Number(code)));
assert.equal(draws.filter(([text])=>text.startsWith('馬桶組 ')).length,6);assert.equal(draws.filter(([text])=>text.includes('學生')).length,9);assert.equal(draws.filter(([text])=>text.startsWith('共同清潔第 ')).length,3);
for(const html of [teacher,board])for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
console.log('Female cleaning: passed (three configurable groups, wash/floor preservation, zero capacities, idempotent migration, independent settings, drag targets, teacher/student parity and A4 export).');
