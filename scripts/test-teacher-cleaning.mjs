import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const teacher=read('teacher.html'),board=read('board.html');
const extract=name=>{
  const start=teacher.lastIndexOf('    function '+name+'(');assert(start>=0,`Missing ${name}`);
  const tail=teacher.slice(start),end=tail.slice(1).search(/\n    (?:function |const |let |\$\()/);
  return end<0?tail:tail.slice(0,end+1);
};
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.style={};this.textContent='';this.listeners={};this.classList={add(){},remove(){}};}
  append(...children){this.children.push(...children);}
  set innerHTML(value){this.html=value;this.children=[];}
  get innerHTML(){return this.html||'';}
  addEventListener(event,handler){this.listeners[event]=handler;}
  setAttribute(name,value){this[name]=value;}
  set id(value){this._id=value;elements.set(value,this);}
  get id(){return this._id;}
  remove(){this.removed=true;}
}
const students=Array.from({length:25},(_,index)=>({seat:index+1,name:'學生'+(index+1)}));
const tasks=[{id:'class',name:'(教室) 黑板與講桌',limit:1},{id:'stairs',name:'(樓梯) 樓梯間',limit:2},
  ...['馬桶組 1（3間）','馬桶組 2（3間）','小便斗組 1（4個）','小便斗組 2（4個）','地板','洗手台'].map((name,index)=>({id:'male-'+index,name:'(男廁) '+name,limit:1})),
  ...[1,2,3].map(groupIndex=>({id:'female-'+groupIndex,name:`(女廁) 共同清潔第 ${groupIndex} 組`,kind:'female-group',groupIndex,limit:2,description:'整理垃圾\n馬桶清潔'})),
  {id:'wash',name:'(女廁) 洗手台',kind:'female-wash',limit:1},{id:'floor',name:'(女廁) 地板',kind:'female-floor',limit:2}];
const assignments=Object.fromEntries(tasks.map((task,index)=>[task.id,[String(index+1).padStart(2,'0')]]));
assignments.floor.push('14');assignments['female-1']=[];
const initial=JSON.stringify({tasks,assignments}),data={cleaningTaskConfig:tasks,cleaningAssignments:assignments},elements=new Map();
const $=id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);};
let writes=0;
const context={console,$,document:{createElement:tag=>new Element(tag)},roster:()=>students,seatOrderedStudents:()=>students,
  readJSON:(key,fallback)=>data[key]??fallback,writeJSON:(key,value)=>{writes++;data[key]=value;},
  activeCleaningTask:'',cleaningAssignmentMode:false,selectedCleaningSeat:'',message(){},openCleaningTaskMenu(){},ensureFemaleRestroomTasks(){},ensureMaleRestroomTasks(){}};
vm.createContext(context);vm.runInContext(read('classroom-groups.js'),context);
for(const name of ['CLEANING_AREAS','femaleRestroomSlots','maleRestroomSlots']){
  const match=teacher.match(new RegExp('    const '+name+'=[^\\r\\n]+'));
  if(match)vm.runInContext(match[0],context);
}
for(const name of ['cleaningConfig','cleaningTaskMeta','cleaningTaskGroups','cleanFemaleTaskLabel','femaleRestroomTaskMap',
  'maleRestroomTaskMap','normalizeMaleRestroomTaskNames','normalizeFemaleCleaningConfig','cleanupObsoleteMappedTasks',
  'createTeacherAreaTaskCard','createTeacherClassroomPlan','createTeacherStairPlan','createTeacherFemaleRestroomPlan',
  'createTeacherMaleRestroomPlan','renderCleaningAssignmentWorkspace','renderDaily']){
  // cleanFemaleTaskLabel is a const arrow rather than a function declaration.
  if(name==='cleanFemaleTaskLabel')vm.runInContext(teacher.match(/    const cleanFemaleTaskLabel=[^\r\n]+/)[0],context);
  else vm.runInContext(extract(name),context);
}
for(const name of ['bindCleaningStudentCard','updateCleaningSelectionStatus','selectCleaningStudent','moveCleaningStudent'])vm.runInContext(extract(name),context);
assert.doesNotThrow(()=>context.renderDaily(),'Opening the full teacher cleaning page must not stop before rendering work buttons');
const walk=element=>[element,...element.children.flatMap(walk)];
const headings=$('cleaning-task-buttons').children.map(group=>group.children[0].textContent);
assert.deepEqual(headings,['教室 (1)','樓梯 (2)','男廁 (6)','女廁 (9)']);
assert.equal(walk($('cleaning-task-buttons')).filter(node=>node.tag==='button').length,tasks.length);
assert($('cleaning-workload-count').textContent.includes('共需 18／25'));
assert($('cleaning-total-count').textContent.includes('13／25'));
context.cleaningAssignmentMode=true;
assert.doesNotThrow(()=>context.renderDaily(),'Assignment mode must render all four floor plans');
const nodes=walk($('cleaning-grid'));
for(const className of ['teacher-classroom-map','teacher-stair-map','teacher-restroom-map male','teacher-restroom-map female-communal female-split-crews'])assert(nodes.some(node=>node.className===className),className);
const male=nodes.find(node=>node.className==='teacher-restroom-map male');
assert.equal(walk(male).filter(node=>node.tag==='i').length,14,'Male restroom must show 6 toilets and 8 urinals');
const female=nodes.find(node=>node.className==='teacher-restroom-map female-communal female-split-crews');
assert.equal(walk(female).filter(node=>node.tag==='i').length,12);
assert.equal(walk(female).filter(node=>node.className==='female-crew-panel group').length,3);
context.renderDaily();
assert.equal(writes,0,'Viewing current-version work must not rewrite assignments');
assert.equal(JSON.stringify(data),JSON.stringify({cleaningTaskConfig:tasks,cleaningAssignments:assignments}));
assert.equal(JSON.stringify({tasks,assignments}),initial);
// Click a precise target in a multi-person job: it must not swap the first person.
const clone=value=>JSON.parse(JSON.stringify(value));
const baseline=clone(data),assignmentWrites=[];
context.writeJSON=(key,value)=>{assignmentWrites.push(key);data[key]=clone(value);};
context.selectCleaningStudent('01');assert.equal(assignmentWrites.length,0);
assert.equal($('cancel-cleaning-selection').hidden,false);
context.selectCleaningStudent('14');
assert.deepEqual(data.cleaningAssignments.class,['14']);
assert.deepEqual(data.cleaningAssignments.floor,['13','01']);
assert.deepEqual(assignmentWrites,['cleaningAssignments']);
assert.equal(context.selectedCleaningSeat,'');
Object.assign(data,clone(baseline));assignmentWrites.length=0;
context.moveCleaningStudent('01','floor');
assert.equal(assignmentWrites.length,0,'Dropping onto a full work panel must not pick a random occupant');
assert.equal(context.selectedCleaningSeat,'01');
const floorCard=walk($('cleaning-grid')).find(node=>node.className?.startsWith('cleaning-assignment-chip')&&node.textContent==='14 學生14');
assert(floorCard);floorCard.onclick({stopPropagation(){}});
assert.deepEqual(data.cleaningAssignments.floor,['13','01']);
Object.assign(data,clone(baseline));assignmentWrites.length=0;context.selectedCleaningSeat='';
context.selectCleaningStudent('01');context.selectCleaningStudent('25');
assert.deepEqual(data.cleaningAssignments.class,['25'],'An unassigned student can replace the selected worker');
assert(!Object.values(data.cleaningAssignments).flat().includes('01'));
Object.assign(data,clone(baseline));assignmentWrites.length=0;context.selectedCleaningSeat='';
context.selectCleaningStudent('01');context.selectCleaningStudent('01');assert.equal(assignmentWrites.length,0,'Selecting the same card cancels');
context.selectCleaningStudent('13');context.selectCleaningStudent('14');assert.equal(assignmentWrites.length,0,'Selecting within one job only changes the selection');
context.moveCleaningStudent('14','female-1');assert.deepEqual(data.cleaningAssignments['female-1'],['14']);
assert.deepEqual(data.cleaningAssignments.floor,['13']);
context.moveCleaningStudent('14',null);assert.deepEqual(data.cleaningAssignments['female-1'],[]);
Object.assign(data,clone(baseline));assignmentWrites.length=0;context.selectedCleaningSeat='';
data.cleaningTaskConfig.find(task=>task.id==='female-1').limit=0;
context.moveCleaningStudent('01','female-1');assert.equal(assignmentWrites.length,0,'Zero capacity is protected');
Object.assign(data,clone(baseline));context.selectedCleaningSeat='';
// Every floor-plan label uses the same precise click/drop binding as the list.
for(const [className,source,target] of [['teacher-area-person','02','14'],['teacher-restroom-name','03','14'],['cleaning-assignment-chip','10','14']]){
  Object.assign(data,clone(baseline));assignmentWrites.length=0;context.selectedCleaningSeat='';context.renderDaily();
  const first=walk($('cleaning-grid')).find(node=>node.className?.split(' ').includes(className)&&node.textContent.startsWith(source+' '));
  assert(first,`Missing ${className} ${source}`);first.onclick({stopPropagation(){}});
  const second=walk($('cleaning-grid')).find(node=>node.className?.split(' ').includes('cleaning-assignment-chip')&&node.textContent.startsWith(target+' '));
  second.listeners.drop({preventDefault(){},stopPropagation(){},dataTransfer:{getData:()=>source}});
  assert.deepEqual(data.cleaningAssignments.floor,['13',source]);
  assert.deepEqual(assignmentWrites,['cleaningAssignments']);
}
Object.assign(data,clone(baseline));context.selectedCleaningSeat='';
const slotLiteral=html=>html.match(/const maleRestroomSlots=(\[[^\r\n]+?\]);/)[1];
const teacherSlots=JSON.parse(JSON.stringify(vm.runInNewContext(slotLiteral(teacher))));
const boardSlots=JSON.parse(JSON.stringify(vm.runInNewContext(slotLiteral(board))));
assert.deepEqual(teacherSlots,boardSlots,'Teacher and student male slots must match');
console.log('Teacher cleaning: passed (full-page render, all four plans, fixture counts, shared slot definitions, repeat render without data writes).');
