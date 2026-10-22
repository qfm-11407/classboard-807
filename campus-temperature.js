(function(root){
  'use strict';
  const DATA_URL='https://raw.githubusercontent.com/qfm-11407/classboard-807/refs/heads/codex/campus-temperature-data/campus-temperature.json';
  const MAX_AGE=30*60*1000;
  const taipeiTime=value=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  function temperatureState(snapshot,now=Date.now()){
    if(snapshot?.version!==1||snapshot.school!=='前峰國中'||snapshot.status!=='ok'||typeof snapshot.temperatureC!=='number'||!Number.isFinite(snapshot.temperatureC)||snapshot.temperatureC< -50||snapshot.temperatureC>60)return {level:'unavailable',value:'—',note:'暫無資料'};
    const fetched=typeof snapshot.fetchedAt==='string'?Date.parse(snapshot.fetchedAt):NaN;
    if(!Number.isFinite(fetched)||fetched>now+5*60*1000)return {level:'unavailable',value:'—',note:'資料時間異常'};
    if(now-fetched>MAX_AGE)return {level:'stale',value:'—',note:`資料逾時｜${taipeiTime(fetched)} 擷取`};
    return {level:'fresh',value:`${snapshot.temperatureC.toFixed(1)}°C`,note:`${taipeiTime(fetched)} 擷取`};
  }
  function mount({document=root.document,fetchImpl=root.fetch?.bind(root),now=()=>Date.now(),setIntervalImpl=root.setInterval?.bind(root)}={}){
    const panel=document.getElementById('campus-temperature'),value=document.getElementById('campus-temperature-value'),note=document.getElementById('campus-temperature-note');
    if(!panel||!value||!note||!fetchImpl)return;
    let snapshot=null,failed=false,busy=false;
    function render(){const state=temperatureState(snapshot,now());panel.dataset.state=state.level;value.textContent=state.value;note.textContent=failed?(state.level==='fresh'?`連線異常｜${state.note}`:'連線異常｜暫無資料'):state.note;panel.title='來源：學校校園能源資訊看板；非教室室內實測。擷取時間不代表感測器量測時間。'+(snapshot?.sourceClock?` 看板頁面時間：${snapshot.sourceClock}`:'');}
    async function refresh(){if(busy)return;busy=true;try{const response=await fetchImpl(`${DATA_URL}?t=${Math.floor(now()/120000)}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Temperature data unavailable');const next=await response.json();snapshot=next;failed=false;}catch(_){failed=true;}finally{busy=false;render();}}
    render();refresh();setIntervalImpl?.(refresh,120000);setIntervalImpl?.(render,30000);
    return {refresh,render};
  }
  root.CampusTemperature={temperatureState,mount,DATA_URL,MAX_AGE};
  if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>mount());else mount();}
})(typeof window!=='undefined'?window:globalThis);
