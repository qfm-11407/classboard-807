import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=name=>fs.readFileSync(new URL(`../${name}`,import.meta.url),'utf8'),teacher=read('teacher.html'),board=read('board.html');
const context={};vm.runInNewContext(read('classroom-groups.js'),context);const G=context.ClassroomGroups,plain=value=>JSON.parse(JSON.stringify(value));
const roster=Array.from({length:12},(_,i)=>({seat:i+1,name:`學生${i+1}`}));
const tasks=[{id:'class',name:'(教室) 黑板',limit:1},...Array.from({length:6},(_,i)=>({id:`f${i}`,name:`(女廁) 馬桶組 ${i+1}`,limit:1})),{id:'wash',name:'(女廁) 洗手台',limit:1},{id:'floor',name:'(女廁) 地板',limit:2},{id:'male',name:'(男廁) 馬桶組 1',limit:1}];
const assignments={class:['10'],f0:['01'],f1:['02'],f2:['03'],f3:['04'],f4:['05'],f5:['06'],wash:['07'],floor:['08','09'],male:['11']};
const before=JSON.stringify({tasks,assignments}),merged=G.femaleCleaning(tasks,assignments,roster);
assert.equal(merged.tasks.length,3);assert.equal(merged.task.limit,9);assert.equal(merged.task.id,'f0');assert.deepEqual(plain(merged.assignments.f0),['01','02','03','04','05','06','07','08','09']);
assert.deepEqual(plain(merged.assignments.class),['10']);assert.deepEqual(plain(merged.assignments.male),['11']);assert.equal(before,JSON.stringify({tasks,assignments}),'Original data must not be mutated');
assert.deepEqual(plain(G.femaleCleaning(merged.tasks,merged.assignments,roster)),plain(merged),'Repeated conversion must be idempotent');
const pruned=G.femaleCleaning(tasks,{...assignments,f1:['01','999']},roster);assert.equal(pruned.assignments.f0.filter(code=>code==='01').length,1);assert(!pruned.assignments.f0.includes('999'));
const custom={...merged.task,limit:12,description:'整理垃圾\n共同清潔'};assert.equal(G.femaleCleaning([custom],merged.assignments,roster).task.description,custom.description);
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.textContent='';this.style={};}
  append(...children){this.children.push(...children);}
  addEventListener(event,fn){this.listeners[event]=fn;}
}
const extract=(html,name)=>{const start=html.indexOf(`    function ${name}(`);assert(start>=0);const tail=html.slice(start),end=tail.slice(1).search(/\n    (?:function |const |let |\$\()/);return end<0?tail:tail.slice(0,end+1);};
const slots=[...Array.from({length:6},(_,i)=>({slot:`toilet-${i+1}`,label:`馬桶組 ${i+1}`,kind:'toilet'})),{slot:'wash',label:'洗手台',kind:'wash'},{slot:'floor',label:'地板',kind:'floor'}];
const ui={ClassroomGroups:G,document:{createElement:tag=>new Element(tag)},roster:()=>roster,studentRoster:roster,femaleRestroomSlots:slots,selectedCleaningSeat:'',renderDaily(){},moveCleaningStudent(){}};vm.createContext(ui);
vm.runInContext(extract(teacher,'createTeacherFemaleRestroomPlan'),ui);vm.runInContext(extract(board,'createFemaleRestroomPlan'),ui);
const walk=element=>[element,...element.children.flatMap(walk)];
for(const plan of [ui.createTeacherFemaleRestroomPlan(tasks,assignments),ui.createFemaleRestroomPlan(tasks,assignments)]){
  const nodes=walk(plan),fixturePlan=plan.children[0],crew=plan.children[1];
  assert.equal(walk(fixturePlan).filter(node=>node.tag==='i').length,12,'Six groups must have exactly two fixtures each');
  assert.equal(nodes.filter(node=>node.className?.includes('communal-fixture')).length,8);
  assert(!walk(fixturePlan).some(node=>node.textContent.includes('學生')),'Student names must not appear in fixtures');
  assert.equal(crew.className,'female-common-crew');assert.equal(crew.children[2].children.length,9);
  assert(crew.children[1].textContent.includes('整理垃圾'));assert(crew.children[1].textContent.includes('地板掃拖'));
}
const draws=[],canvas={fill(){},stroke(){},fillRect(){},strokeRect(){},fillText:(text,...args)=>draws.push([text,...args])};
ui.cleaningSummaryRoundRect=()=>{};vm.runInContext(extract(teacher,'drawFemaleCommunalExport'),ui);
ui.drawFemaleCommunalExport(canvas,{x:0,y:0,width:2188,height:884},merged.task,roster.slice(0,9).map(student=>`${student.seat} ${student.name}`));
assert.equal(draws.filter(([text])=>text.startsWith('馬桶組 ')).length,6);assert.equal(draws.filter(([text])=>text.includes('學生')).length,9);assert(!draws.some(([text])=>text==='待分配'));
for(const html of [teacher,board])for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
console.log('Female cleaning: passed (idempotent merge, preserved capacity/staff, 12 fixtures, names below both plans and A4 export).');
