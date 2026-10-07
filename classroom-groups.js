/* Shared roster-aware group rules. Teacher and board must normalize identically. */
(function (root) {
  'use strict';
  const defaults = [
    {id:'group-1',label:'第 1 組',limit:8,seats:[1,3,4,6,7,8,9,10]},
    {id:'group-2',label:'第 2 組',limit:8,seats:[11,12,13,15,16,17,18,19]},
    {id:'group-3',label:'第 3 組',limit:8,seats:[20,21,22,23,25,26,27,28]},
  ];
  const capacity = (value, fallback=1) => Number.isInteger(Number(value)) && Number(value)>=1 && Number(value)<=60 ? Number(value) : fallback;
  const rosterSeats = roster => [...new Set(roster.map(student=>Number(student.seat)).filter(seat=>Number.isInteger(seat)&&seat>=1&&seat<=60))].sort((a,b)=>a-b);
  function helperSeats(roster, saved) {
    const valid = new Set(rosterSeats(roster));
    return [...new Set((Array.isArray(saved)?saved:[14,24]).map(Number).filter(seat=>valid.has(seat)))];
  }
  function lunchGroups(roster, saved, helpers) {
    const valid = new Set(rosterSeats(roster)), excluded = new Set(helperSeats(roster, helpers)), used = new Set(), ids = new Set();
    const configured = Array.isArray(saved) ? saved.filter(group=>group&&typeof group==='object') : [];
    const source = configured.length ? configured : defaults;
    return source.filter(group=>group&&typeof group==='object').map((group,index)=>{
      let id=String(group.id||`group-${index+1}`);
      while(ids.has(id))id+='-copy';ids.add(id);
      const seats=[...new Set((Array.isArray(group.seats)?group.seats:[]).map(Number))].filter(seat=>valid.has(seat)&&!excluded.has(seat)&&!used.has(seat));
      seats.forEach(seat=>used.add(seat));
      // Never discard real assignments merely because an old limit was smaller.
      return {id,label:String(group.label||`第 ${index+1} 組`).trim().slice(0,30)||`第 ${index+1} 組`,limit:Math.max(capacity(group.limit,8),seats.length),seats};
    });
  }
  function unassignedSeats(roster,groups,helpers) {
    const used=new Set([...helperSeats(roster,helpers),...groups.flatMap(group=>group.seats)]);
    return rosterSeats(roster).filter(seat=>!used.has(seat));
  }
  function dutySeats(roster,base,count,steps) {
    const seats=rosterSeats(roster),valid=new Set(seats),selected=[...new Set((Array.isArray(base)?base:[]).map(Number))].filter(seat=>valid.has(seat));
    const size=Math.min(capacity(count,2),seats.length);
    if(!size||!selected.length)return [];
    if(!steps)return selected.slice(0,size);
    const start=seats.indexOf(selected[0]),offset=((steps*size)%seats.length+seats.length)%seats.length;
    return Array.from({length:size},(_,index)=>seats[(start+offset+index)%seats.length]);
  }
  // Work on copies; a rejected edit must not change the current assignment.
  function resizeLunchGroup(groups,id,limit) {
    const next=groups.map(group=>({...group,seats:[...group.seats]})),target=next.find(group=>group.id===id);
    if(!target)throw new Error('找不到小組，請重新開啟午餐設定。');
    if(!Number.isInteger(Number(limit))||Number(limit)<1||Number(limit)>60)throw new Error('人數請輸入 1 到 60 的整數。');
    if(Number(limit)<target.seats.length)throw new Error(`目前已編入 ${target.seats.length} 人，請先移出人員再減少人數。`);
    target.limit=Number(limit);return next;
  }
  function moveLunchSeat(groups,seat,targetId) {
    const next=groups.map(group=>({...group,seats:[...group.seats]})),target=targetId===null?null:next.find(group=>group.id===targetId);
    if(targetId!==null&&!target)throw new Error('找不到目標小組。');
    seat=Number(seat);
    if(target?.seats.includes(seat))return next;
    if(target&&target.seats.length>=target.limit)throw new Error('這組已滿，請先增加人數、移出學生，或交換人員。');
    next.forEach(group=>group.seats=group.seats.filter(value=>value!==seat));
    if(target)target.seats.push(seat);
    return next;
  }
  const femaleCleaningDescription='整理垃圾\n馬桶清潔\n洗手台清潔\n地板掃拖';
  function femaleCleaning(tasks,assignments,roster) {
    const female=tasks.filter(task=>/女[廁厠厕]/.test(String(task.name))),ids=new Set(female.map(task=>task.id));
    if(!female.length)return {tasks,assignments,task:null};
    const valid=new Set(rosterSeats(roster)),seats=[...new Set(female.flatMap(task=>Array.isArray(assignments[task.id])?assignments[task.id]:[]).map(Number))].filter(seat=>valid.has(seat)).map(seat=>String(seat).padStart(2,'0'));
    const existing=female.find(task=>task.kind==='female-communal'),base=existing||female[0];
    const task={...base,name:existing?base.name:'(女廁) 女廁共同清潔',kind:'female-communal',limit:Math.max(seats.length,Math.min(60,female.reduce((sum,item)=>sum+capacity(item.limit,1),0))),description:existing&&typeof base.description==='string'?base.description:femaleCleaningDescription};
    const nextTasks=[];let inserted=false;
    tasks.forEach(item=>{if(ids.has(item.id)){if(!inserted){nextTasks.push(task);inserted=true;}}else nextTasks.push(item);});
    const nextAssignments=Object.fromEntries(Object.entries(assignments).filter(([id])=>!ids.has(id)));nextAssignments[task.id]=seats;
    return {tasks:nextTasks,assignments:nextAssignments,task};
  }
  root.ClassroomGroups={capacity,helperSeats,lunchGroups,unassignedSeats,dutySeats,resizeLunchGroup,moveLunchSeat,femaleCleaning,femaleCleaningDescription};
}(typeof window==='undefined'?globalThis:window));
