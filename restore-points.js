/* Teacher-only recovery controls. Passwords and student event collections are not part of snapshots. */
(function () {
  'use strict';
  let busy = false, modal = null;
  const byId = id => document.getElementById(id);
  const parse = (data, key, fallback) => { try { return JSON.parse(data[key]) ?? fallback; } catch (_) { return fallback; } };
  const timeText = value => value ? new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).format(new Date(value)) : '時間待確認';
  function drafts() { try {return JSON.parse(localStorage.getItem('classroomUnsyncedDrafts'))||[];}catch(_){return [];} }
  function retainDraft(data) { const entries=drafts();if(!entries.some(entry=>JSON.stringify(entry.data)===JSON.stringify(data)))entries.unshift({savedAt:new Date().toISOString(),data});localStorage.setItem('classroomUnsyncedDrafts',JSON.stringify(entries.slice(0,5))); }
  function syncStatus(kind, text) {
    byId('cloud-sync-status').className = `cloud-sync-status ${kind}`;
    byId('cloud-sync-text').textContent = text;
    byId('cloud-sync-recovery').classList.toggle('hidden', kind !== 'error' && !drafts().length);
  }
  window.TeacherRestoreUI = { syncStatus, retainDraft };
  function downloadLocal() {
    const blob = new Blob([JSON.stringify({savedAt:new Date().toISOString(), data:cloudData(), unsyncedDrafts:drafts()},null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href=url;link.download=`807-本機資料-${taipeiDay()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function showMessage(text, error=false) { const note=byId('restore-message');note.textContent=text;note.classList.toggle('error',error); }
  function setBusy(value) { busy=value;byId('admin').inert=value;modal?.querySelectorAll('button,input,select').forEach(element=>element.disabled=value); }
  function applyPayload(payload) {
    const active=document.querySelector('.panel.active')?.id.replace('panel-','')||'scheduled';
    restoreCloudData(payload.data||{});loadClass();showPanel(active);
  }
  async function reloadCloud() {
    if(busy||!confirm('將先下載本機目前資料，再重新載入雲端。尚未同步的修改可從下載檔案查閱，是否繼續？'))return;
    downloadLocal();busy=true;byId('admin').inert=true;clearTimeout(cloudSyncTimer);cloudSyncQueued=false;
    try { if(cloudSyncPromise)await cloudSyncPromise.catch(()=>{});applyPayload(await FirebaseClassroom.getState());syncStatus('success','已重新載入最新雲端資料。'); }
    catch(error) { syncStatus('error',error.message||'重新載入失敗。'); }
    finally {busy=false;byId('admin').inert=false;}
  }
  byId('export-local-state').onclick=downloadLocal;
  byId('reload-cloud-state').onclick=reloadCloud;
  function close() { if(busy)return;modal?.remove();modal=null;byId('open-restore-points').focus(); }
  async function loadList() {
    const points=await FirebaseClassroom.getRestorePoints(),list=byId('restore-list');list.innerHTML='';
    if(!points.length){list.textContent='尚無還原點。';return;}
    points.forEach(point=>{
      const row=document.createElement('article');row.className='restore-row';
      const head=document.createElement('div');head.className='restore-row-head';
      const info=document.createElement('div'),title=document.createElement('strong'),time=document.createElement('small');
      title.textContent=point.label||'還原點';time.textContent=`${timeText(point.createdAt)} · 第 ${point.sequence} 個還原點`;info.append(title,time);
      const button=document.createElement('button');button.type='button';button.className='btn light';button.textContent='還原';button.onclick=()=>restore(point);head.append(info,button);
      const summary=document.createElement('small'),scheduled=parse(point.data,'scheduledTasks',[]),full=parse(point.data,'leaveRecords',{}),half=parse(point.data,'leaveHalfDayRecords',{});
      const dates=[...new Set([...Object.keys(full),...Object.keys(half)])].sort();
      summary.textContent=`事項 ${scheduled.length} 日｜請假 ${dates.length} 日｜學生 ${parse(point.data,'classroomStudentRoster',[]).length} 人`;
      const details=document.createElement('details'),caption=document.createElement('summary'),body=document.createElement('div');caption.textContent='查看日期摘要';body.className='restore-detail';
      body.textContent=`事項日期：${scheduled.map(item=>item.targetDate).sort().join('、')||'無'}\n請假日期：${dates.join('、')||'無'}`;details.append(caption,body);row.append(head,summary,details);list.append(row);
    });
  }
  async function restore(point) {
    if(busy)return;const scope=byId('restore-scope').value,scopeText=scope==='all'?'全部教師設定':'事項與請假紀錄';
    if(!confirm(`確定將「${scopeText}」還原至 ${timeText(point.createdAt)} 的「${point.label}」？系統會先備份目前雲端資料。`))return;
    setBusy(true);showMessage('正在備份並還原…');
    try {await syncCloudNow();await FirebaseClassroom.restorePoint(point.id,scope,point.sequence);applyPayload(await FirebaseClassroom.getState());await loadList();showMessage('已還原；還原前的資料已另存，可再次還原。');syncStatus('success','已還原並載入雲端資料。');}
    catch(error){showMessage(error.message||'還原失敗。',true);}
    finally{setBusy(false);}
  }
  byId('open-restore-points').onclick=async()=>{
    if(modal)return;
    modal=document.createElement('div');modal.className='restore-modal';
    modal.innerHTML='<section class="restore-sheet" role="dialog" aria-modal="true" aria-labelledby="restore-title"><div class="restore-head"><h2 id="restore-title">資料還原點</h2><button class="btn light" id="restore-close" type="button" aria-label="關閉">✕</button></div><p class="hint">每次儲存前自動備份，保留最近 30 個還原點；超過時取代最舊一筆。從啟用後開始記錄。</p><div class="restore-controls"><input id="restore-label" maxlength="60" placeholder="還原點名稱（可留白）"><button class="btn" id="restore-create" type="button">建立還原點</button><button class="btn light" id="restore-refresh" type="button">重新載入</button></div><label for="restore-scope">還原範圍</label><select id="restore-scope"><option value="records">事項與請假紀錄</option><option value="all">全部教師設定</option></select><p class="hint" style="margin-top:8px">學生留言、個別繳交紀錄及帳號密碼另行保存，不會隨此功能還原。</p><p id="restore-message" class="restore-message" role="status" aria-live="polite"></p><div id="restore-list" class="restore-list"></div></section>';
    document.body.append(modal);byId('restore-close').onclick=close;modal.onclick=event=>{if(event.target===modal)close();};byId('restore-close').focus();
    byId('restore-create').onclick=async()=>{if(busy)return;setBusy(true);showMessage('建立中…');try{await syncCloudNow();await FirebaseClassroom.createRestorePoint(byId('restore-label').value.trim());byId('restore-label').value='';await loadList();showMessage('還原點已建立。');}catch(error){showMessage(error.message||'建立失敗。',true);}finally{setBusy(false);}};
    byId('restore-refresh').onclick=async()=>{if(busy)return;setBusy(true);try{await loadList();showMessage('已載入最新還原點。');}catch(error){showMessage(error.message,true);}finally{setBusy(false);}};
    setBusy(true);try{await loadList();}catch(error){showMessage(error.message||'載入失敗。',true);}finally{setBusy(false);}
  };
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal)close();});
  window.addEventListener('beforeunload',event=>{if(cloudSyncQueued||cloudSyncPromise){retainDraft(cloudData());event.preventDefault();event.returnValue='';}});
  if(drafts().length)syncStatus('error','本機保有先前未同步的資料備份，可下載查閱。');
  FirebaseClassroom.onTeacherChanged(user=>{if(user)FirebaseClassroom.createRestorePoint('',true).catch(error=>syncStatus('error',`初始還原點建立失敗：${error.message}`));});
}());
