import {readFile,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),source=new URL('../public/',import.meta.url);
for(const file of ['style.css','canvas.js'])await copyFile(new URL(file,source),new URL(file,root));
for(const [from,to] of [['index.html','index.html'],['teacher.html','teacher.html'],['play.html','student.html'],['screen.html','screen.html']]){
  let s=await readFile(new URL(from,source),'utf8');
  s=s.replaceAll('href="/style.css"','href="./style.css"').replaceAll('src="/app.js"','src="./app.js"').replaceAll('href="/teacher"','href="./teacher.html"').replaceAll('href="/play"','href="./student.html"').replaceAll('href="/"','href="./index.html"');
  s=s.replaceAll('輸入啟動視窗顯示的教師登入碼。','輸入 GAS 初始化時產生的教師登入碼。').replaceAll('8 位教師登入碼','教師登入碼');
  s=s.replace('<label>選擇教室連線網址<select id="network-base"></select></label>','');
  s=s.replaceAll('平板連上同一個教室網路，再開啟上方網址。房號會自動帶入。','學生開啟上方網頁即可加入，房號與後端連線會自動帶入。').replaceAll('只傳送單字圖片與允許答案，不傳送學號、暱稱；只回傳判定。','圖片由 GAS 保存在教師的 Drive 資料夾；AI 只收到圖片與允許答案，不收到學號、暱稱。');
  s=s.replaceAll('金鑰僅保留於教師電腦的程式記憶體，重啟後需重新輸入。模型需有帳號使用權限，判讀效果須實測。','金鑰保存在 GAS 的私人 Script Properties，不會寫入 GitHub 或回傳給學生。模型需有帳號使用權限，判讀效果須實測。');
  s=s.replace('id="concurrency" type="number" min="1" max="6" value="3"','id="concurrency" type="number" min="1" max="3" value="2"');
  s=s.replace('教師控制台請留在教師電腦；上課期間保持啟動視窗開啟。','上課期間保持教師控制頁開啟。大螢幕建議另開視窗，避免控制頁長時間被瀏覽器暫停。');
  if(from==='index.html')s=s.replace('<footer class="page-footer">',`<section class="backend-setup card"><div><span class="kicker">CLOUD CONNECTION</span><h2>連接教室的雲端後端</h2><p class="muted">首次使用請設定已部署的 GAS 網頁應用程式網址。這不是 API 金鑰。</p></div><form id="backend-form"><label>GAS 部署網址<input id="backend-url" type="url" placeholder="https://script.google.com/macros/s/…/exec" required></label><button class="button primary" type="submit">儲存並測試連線</button></form><p id="backend-status" class="muted" role="status"></p><p class="muted">GAS 的 ALLOWED_ORIGINS 請設定為 <strong id="site-origin"></strong>。<a class="setup-doc-link" href="./DEPLOY_GAS.md" target="_blank" rel="noopener">部署步驟 ↗</a></p></section><footer class="page-footer">`);
  await writeFile(new URL(to,root),s);
}
let s=await readFile(new URL('app.js',source),'utf8');
s=s.replace("import { InkPad } from './canvas.js';", "import { InkPad } from './canvas.js';\nimport { client, GASClient, saveBackend } from './transport.js';");
const begin=s.indexOf('async function api('),end=s.indexOf('function connection(',begin);
if(begin<0||end<0)throw new Error('Cannot locate transport adapter');
s=s.slice(0,begin)+`async function api(url,data,token) { return client.request(url,data,token); }
function connect(code,receive) {
  return client.subscribe(code,state=>{offset=state.serverTime-Date.now();liveState=state;receive(state);},(ok,message)=>{connection(ok);if(!ok&&message)toast(message,true);},document.body.dataset.page==='screen');
}
`+s.slice(end);
s=s.replace("let room, admin, refreshing = false, bank = [], selectedNetwork = '', previousPhase;", "let room, admin, refreshing = false, bank = [], previousPhase, workers = 0;\n  function pumpWorkers() { if (!room?.round?.pending) return; const count=Math.min(admin.settings.concurrency,room.round.pending); while(workers<count) { workers++; client.rpc('worker',{room:room.code}).catch(error=>toast(error.message,true)).finally(()=>{workers--;}); } }");
s=s.replace('if (refreshing || document.hidden) return; refreshing = true;', 'if (!client.backend || !client.token || refreshing) return; refreshing = true;');
s=s.replace('renderTeacher();\n    } catch (error)', 'renderTeacher(); pumpWorkers();\n    } catch (error)');
s=s.replace("if (error.status === 401) { $('login-panel')", "if (error.status === 401) { client.token=''; $('login-error').textContent=error.message; $('login-panel')");
s=s.replace("$('open-screen').href = `/screen?room=${room.code}`; $('open-play').href = `/play?room=${room.code}`; $('export-link').href = `/api/admin/rooms/${room.code}/export`;", "$('open-screen').href = client.pageURL('screen.html',room.code); $('open-play').href = client.pageURL('student.html',room.code); $('export-link').href = '#';");
const networkStart=s.indexOf('    const addresses = admin.addresses'),networkEnd=s.indexOf("    $('round-label')",networkStart);
if(networkStart<0||networkEnd<0)throw new Error('Cannot locate LAN controls');s=s.slice(0,networkStart)+"    updateJoinLink();\n"+s.slice(networkEnd);
const joinStart=s.indexOf('  function updateJoinLink()'),joinEnd=s.indexOf("  $('question-bank').onchange",joinStart);
s=s.slice(0,joinStart)+"  function updateJoinLink() { if (room) $('join-url').value = client.pageURL('student.html',room.code); }\n  $('export-link').onclick=async event=>{event.preventDefault();if(!room)return;try{const result=await api(`/api/admin/rooms/${room.code}/export`);const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=result.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message,true);}};\n"+s.slice(joinEnd);
const hashStart=s.indexOf('  const hash = new URLSearchParams(location.hash'),hashEnd=s.indexOf('  const createDialog',hashStart);
s=s.slice(0,hashStart)+"  refresh();\n  if(!client.backend)$('login-error').textContent='請先回首頁設定 GAS 後端連線。';\n"+s.slice(hashEnd);
s=s.replace('setInterval(refresh, 1600)','setInterval(refresh, 3500)');
s=s.replace("queued:'排隊'", "uploading:'保存中', 'upload-error':'上傳待重試', queued:'排隊'");
s=s.replaceAll('`word-arena-player:${','`oneword:${client.backend}:player:${').replaceAll('`word-arena-draft:${','`oneword:${client.backend}:draft:${');
s=s.replace("history.replaceState(null, '', `/play?room=${data.room}`)", "history.replaceState(null, '', client.pageURL('student.html',data.room))");
s=s.replace("submitted = true; toast('已交卷，等待統一揭曉');", "submitted = true; client.rpc('studentWorker',{room:state.code,roundId},identity.token).catch(()=>{}); toast('圖片已保存，等待統一揭曉');");
s=s.replace("  $('join-code').value = code;", "  $('join-code').value = code;\n  if(!client.backend)$('join-error').textContent='請使用教師分享的完整作答網址，或回首頁設定 GAS 後端。';");
s += `
if(page==='home') {
  $('backend-url').value=client.backend; $('site-origin').textContent=location.origin;
  const entryLinks=Array.from(document.querySelectorAll('a[href="./teacher.html"],a[href="./student.html"]'),a=>({node:a,file:a.getAttribute('href').includes('teacher')?'teacher.html':'student.html'}));
  function updateEntryLinks(){entryLinks.forEach(item=>{item.node.href=client.pageURL(item.file);});}
  updateEntryLinks();
  $('backend-form').onsubmit=async event=>{event.preventDefault();const button=$('backend-form').querySelector('button');button.disabled=true;let tester;try{const url=saveBackend($('backend-url').value.trim());tester=new GASClient(url);$('backend-status').textContent='正在連接 GAS…';await tester.rpc('ping',{},'',0);$('backend-status').textContent='連線成功。現在可以進入教師控制台或學生作答頁。';client.dispose();client.backend=url;updateEntryLinks();}catch(error){$('backend-status').textContent=error.message;}finally{tester?.dispose();button.disabled=false;}};
}
`;
await writeFile(new URL('app.js',root),s);
await writeFile(new URL('.nojekyll',root),'');
let css=await readFile(new URL('style.css',root),'utf8');css+='\n.backend-setup{max-width:1000px;margin:0 auto 40px;padding:28px}.backend-setup h2{margin:7px 0}.backend-setup form{display:flex;align-items:end;gap:15px;margin:20px 0}.backend-setup label{flex:1}.backend-setup p{overflow-wrap:anywhere}.setup-doc-link{color:var(--green);text-decoration:underline;margin-left:12px}@media(max-width:700px){.backend-setup{margin:0 20px 30px}.backend-setup form{flex-direction:column;align-items:stretch}.home-main{min-height:initial;padding-top:45px;padding-bottom:45px}}\n';await writeFile(new URL('style.css',root),css);
console.log('Web pages prepared in oneword/ (relative URLs; GitHub Pages ready).');
