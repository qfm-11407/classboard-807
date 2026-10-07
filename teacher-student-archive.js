/* Teacher-only transfer/archive UI. No production mutations run on page load. */
let archivedStudentEntries=[];
function setRosterView(archived) {
  $('active-roster-card').classList.toggle('hidden',archived);
  $('archived-roster-card').classList.toggle('hidden',!archived);
  for(const [id,on] of [['roster-show-active',!archived],['roster-show-archived',archived]]){
    $(id).classList.toggle('light',!on);$(id).setAttribute('aria-pressed',String(on));
  }
  if(archived)loadArchivedStudents();
}
async function loadArchivedStudents() {
  const target=$('archived-roster-list'),status=$('archived-roster-message');status.textContent='正在載入封存資料…';
  try{
    archivedStudentEntries=await FirebaseClassroom.getArchivedStudents();target.innerHTML='';
    archivedStudentEntries.forEach(entry=>{
      const row=document.createElement('section');row.className='archived-student-row';
      const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small');
      title.textContent=`${String(entry.student.seat).padStart(2,'0')} ${entry.student.name}`;
      const total=(entry.records?.leaves||[]).reduce((sum,item)=>sum+Number(item.days||0),0);
      detail.textContent=`轉出日期 ${entry.transferDate}｜累計請假 ${total} 日`;info.append(title,detail);
      const actions=document.createElement('div');actions.className='row';
      const view=document.createElement('button');view.type='button';view.className='btn light';view.textContent='查看紀錄';view.onclick=()=>openArchivedStudentDetails(entry);
      const restore=document.createElement('button');restore.type='button';restore.className='btn light';restore.textContent='恢復在校';restore.onclick=()=>openRestoreArchivedStudent(entry);
      actions.append(view,restore);row.append(info,actions);target.append(row);
    });
    status.textContent=archivedStudentEntries.length?`共 ${archivedStudentEntries.length} 位封存學生`:'目前沒有封存學生。';
  }catch(error){status.textContent=`載入失敗：${error.message}，可按「重新載入」重試。`;}
}
function studentArchiveSheet(title) {
  const modal=document.createElement('div');modal.className='schedule-editor-modal student-archive-modal';
  modal.innerHTML='<section class="schedule-editor-sheet" role="dialog" aria-modal="true" aria-labelledby="student-archive-title"><div class="row" style="justify-content:space-between"><h3 id="student-archive-title" style="margin:0"></h3><button class="btn light" type="button" data-close aria-label="關閉">✕</button></div><div data-body></div><p class="notice" data-status role="status"></p></section>';
  modal.querySelector('h3').textContent=title;const trigger=document.activeElement;
  modal.close=()=>{if(modal.busy)return;modal.remove();trigger?.focus();};
  modal.querySelector('[data-close]').onclick=modal.close;
  modal.onclick=event=>{if(event.target===modal)modal.close();};
  modal.onkeydown=event=>{if(event.key==='Escape')modal.close();};
  document.body.append(modal);modal.querySelector('[data-close]').focus();return modal;
}
function rosterHasUnsavedChanges() {
  const fields=student=>[Number(student.seat),String(student.name||'').trim(),String(student.openid||'').trim()];
  return JSON.stringify(rosterDraft.map(fields).sort((a,b)=>a[0]-b[0]))!==JSON.stringify(roster().map(fields));
}
function openStudentArchiveDialog(seat) {
  if(rosterHasUnsavedChanges())return message('class-message','名單有尚未儲存的修改，請先儲存名單，再轉出／封存。');
  const student=roster().find(student=>student.seat===seat);if(!student)return;
  const modal=studentArchiveSheet('轉出／封存學生'),body=modal.querySelector('[data-body]');
  body.innerHTML=`<p><strong>${escapeHTML(String(seat).padStart(2,'0'))} ${escapeHTML(student.name)}</strong></p><p class="hint">請假、課程繳交與聯絡簿紀錄會封存保留。學生端不再顯示，工作名額會釋出；其他同學的分配不變。</p><label for="student-transfer-date">轉出日期</label><input id="student-transfer-date" type="date" max="${taipeiDay()}" value="${taipeiDay()}"><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn light" type="button" data-cancel>取消</button><button class="btn" type="button" data-submit>確認封存</button></div>`;
  body.querySelector('[data-cancel]').onclick=modal.close;
  body.querySelector('[data-submit]').onclick=async()=>{
    if(modal.busy)return;
    const date=body.querySelector('input').value,status=modal.querySelector('[data-status]');
    if(!date||date>taipeiDay()){status.textContent='請選擇轉出日期，不可晚於今天。';return;}
    modal.busy=true;body.querySelector('[data-submit]').disabled=true;status.textContent='正在保存歷史資料並封存…';
    try{
      await syncCloudNow();
      const payload=await FirebaseClassroom.archiveStudent({seat,studentId:student.id||'',name:student.name,transferDate:date});
      restoreCloudData(payload.data);loadClass();modal.busy=false;modal.close();setRosterView(true);
      message('class-message','已封存學生並釋出工作名額，歷史紀錄已保留。');
    }catch(error){status.textContent=`封存未完成或尚未確認：${error.message}。請先重新載入雲端名單確認，勿重複新增學生。`;}
    finally{modal.busy=false;body.querySelector('[data-submit]').disabled=false;}
  };
}
function openArchivedStudentDetails(entry) {
  const modal=studentArchiveSheet(`${String(entry.student.seat).padStart(2,'0')} ${entry.student.name}｜封存紀錄`),body=modal.querySelector('[data-body]');
  const leaves=entry.records?.leaves||[],tasks=entry.records?.tasks||[],notebook=entry.records?.notebook||{};
  const info=document.createElement('p');info.className='hint';info.textContent=`轉出日期 ${entry.transferDate}｜以下紀錄唯讀`;body.append(info);
  const heading=document.createElement('h4');heading.textContent=`請假紀錄｜累計 ${leaves.reduce((sum,item)=>sum+Number(item.days||0),0)} 日`;body.append(heading);
  const months=new Map();leaves.slice().sort((a,b)=>b.date.localeCompare(a.date)).forEach(item=>{const month=item.date.slice(0,7);if(!months.has(month))months.set(month,[]);months.get(month).push(item);});
  if(!months.size){const empty=document.createElement('p');empty.textContent='沒有請假紀錄。';body.append(empty);}
  months.forEach((items,month)=>{const group=document.createElement('details'),summary=document.createElement('summary');group.className='archived-record-month';summary.textContent=`${month}｜累積 ${items.reduce((sum,item)=>sum+Number(item.days),0)} 日`;group.append(summary);items.forEach(item=>{const row=document.createElement('p');row.className='archived-leave-row';const date=document.createElement('strong'),status=document.createElement('span');date.textContent=item.date;status.textContent=`${item.status}請假`;status.className=`leave-status-${item.status==='全天'?'all':item.status==='上午'?'morning':'afternoon'}`;row.append(date,status);group.append(row);});body.append(group);});
  const course=document.createElement('details'),courseSummary=document.createElement('summary');course.className='archived-record-month';courseSummary.textContent=`課程任務（已完成 ${tasks.filter(task=>task.completed).length}／${tasks.length}）`;course.append(courseSummary);
  tasks.forEach(task=>{const line=document.createElement('p');line.textContent=`${task.subject}｜${task.name}｜${task.completed?'已完成':'未完成'}`;course.append(line);});body.append(course);
  const book=document.createElement('details'),bookSummary=document.createElement('summary');book.className='archived-record-month';bookSummary.textContent=`聯絡簿繳交紀錄（${Object.keys(notebook).length} 筆）`;book.append(bookSummary);
  Object.entries(notebook).sort(([a],[b])=>b.localeCompare(a)).forEach(([date,time])=>{const line=document.createElement('p');line.textContent=`${date}｜${new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}).format(new Date(time))}`;book.append(line);});body.append(book);
}
function openRestoreArchivedStudent(entry) {
  if(rosterHasUnsavedChanges())return message('archived-roster-message','在校名單有尚未儲存的修改，請先儲存再恢復學生。');
  const modal=studentArchiveSheet('恢復在校學生'),body=modal.querySelector('[data-body]');
  body.innerHTML=`<p><strong>${escapeHTML(entry.student.name)}</strong></p><p class="hint">保留原有請假與繳交紀錄。請選擇未使用的座號；午餐、打掃與幹部職務需重新安排。</p><label for="student-restore-seat">恢復座號</label><input id="student-restore-seat" type="number" min="1" max="60" value="${Number(entry.student.seat)}"><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn light" type="button" data-cancel>取消</button><button class="btn" type="button" data-submit>確認恢復在校</button></div>`;
  body.querySelector('[data-cancel]').onclick=modal.close;
  body.querySelector('[data-submit]').onclick=async()=>{
    if(modal.busy)return;modal.busy=true;body.querySelector('[data-submit]').disabled=true;const status=modal.querySelector('[data-status]');status.textContent='正在恢復學生與歷史紀錄…';
    try{await syncCloudNow();const payload=await FirebaseClassroom.restoreArchivedStudent(entry.id,Number(body.querySelector('input').value));restoreCloudData(payload.data);loadClass();modal.busy=false;modal.close();setRosterView(false);message('class-message','已恢復在校；請重新安排工作與職務。');}
    catch(error){status.textContent=error.message;}
    finally{modal.busy=false;body.querySelector('[data-submit]').disabled=false;}
  };
}
$('roster-show-active').onclick=()=>setRosterView(false);
$('roster-show-archived').onclick=()=>setRosterView(true);
$('reload-archived-roster').onclick=loadArchivedStudents;
