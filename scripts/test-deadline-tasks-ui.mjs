// Real HTML and UI modules, but an in-memory service: never connects to classroom Firebase.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch (_) {
  const bundled = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
  ({ chromium } = createRequire(bundled)('playwright'));
}
const workspace = fileURLToPath(new URL('../', import.meta.url));
const roster = Array.from({length:28}, (_,i)=>({seat:i+1,name:`學生${String(i+1).padStart(2,'0')}`})).filter(student=>![2,5].includes(student.seat));
const layout = [...roster.map(student=>student.seat).reverse(),null,null,null,null];
const data = { classroomStudentRoster:JSON.stringify(roster),classroomSeatingLayout:JSON.stringify(layout),subjectData:JSON.stringify({'國文':[{id:'old-task',name:'原有科目任務',records:Array(28).fill(false)}]}),nonSchoolDays:'[]' };
const adapter = `
window.firebase={};
window.__teacher=location.pathname.includes('teacher');
window.__data=${JSON.stringify(data)};
for(const [key,value]of Object.entries(__data))localStorage.setItem(key,value);
window.FirebaseClassroom={ready:Promise.resolve(),isTeacher:()=>__teacher,onTeacherChanged:fn=>{setTimeout(()=>fn(__teacher?{email:'fixture@qfm.kh.edu.tw'}:null),0);return()=>{};},onPublicChanged:()=>()=>{},getState:async()=>({hasData:true,data:__data}),saveState:async()=>{},getDailyDeleteCode:async()=>'1234',getTomorrowSubmissions:async()=>[],getArchivedStudents:async()=>[],getRestorePoints:async()=>[],createRestorePoint:async()=>{},restorePoint:async()=>{},getStickyMessages:async()=>[]};
const realFetch=window.fetch.bind(window);window.fetch=(input,init)=>String(input).includes('/api/classroom')?Promise.resolve(new Response(JSON.stringify({ok:true,hasData:true,data:__data}))):String(input).startsWith('http')?Promise.resolve(new Response('{}')):realFetch(input,init);
`;
const mockService = `
;(()=>{
const stamp=value=>({toMillis:()=>value}), participants=DeadlineTasks.participantsFromRoster(${JSON.stringify(roster)});
let tasks=[{id:'open',name:'星期五中午前交作業',deadline:stamp(Date.now()+86400000*2),createdAt:stamp(Date.now()),version:1,hidden:false,participants},{id:'closed',name:'上週限時任務',deadline:stamp(Date.now()-86400000),createdAt:stamp(Date.now()-86400000*2),version:1,hidden:false,participants}];
let taskWatch,recordWatch;const records={open:{},closed:{'28':{seat:28,identity:'',completedAt:stamp(Date.now()-86400001)}}};
const emit=()=>taskWatch?.([...tasks],true);let calls=0;
window.__deadlineFixture={get calls(){return calls;},expire(){tasks[0].deadline=stamp(Date.now());},remote(){tasks=[...tasks];emit();},offline(){taskWatch?.([...tasks],false);},records};
DeadlineTasks.createService=()=>({isTeacher:()=>__teacher,watchTasks(next){taskWatch=next;emit();return()=>{};},watchRecords(id,next){recordWatch={id,next};next({...records[id]},true);return()=>{recordWatch=null;};},async toggle(id,seat,identity){calls++;await new Promise(resolve=>setTimeout(resolve,120));if(DeadlineTasks.closed(tasks.find(task=>task.id===id)))throw new Error('已截止');if(records[id][seat])delete records[id][seat];else records[id][seat]={seat,identity,completedAt:stamp(Date.now())};if(recordWatch?.id===id)recordWatch.next({...records[id]},true);},async create(name,date){tasks.push({id:'created',name,deadline:stamp(+DeadlineTasks.parseDeadline(date)),createdAt:stamp(Date.now()+1),version:1,hidden:false,participants});records.created={};emit();return'created';},async update(task,changes){const value=tasks.find(item=>item.id===task.id);if(changes.name)value.name=changes.name;if(changes.deadlineInput)value.deadline=stamp(+DeadlineTasks.parseDeadline(changes.deadlineInput));if('hidden'in changes)value.hidden=changes.hidden;value.version++;emit();}});
})();`;
const server = http.createServer((request,response)=>{
  const url = new URL(request.url,'http://localhost');
  if(url.pathname==='/doodle.html') {response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Unrelated app isolated for test</title>');return;}
  if(url.pathname==='/__fixture-adapter.js') {response.setHeader('Content-Type','application/javascript');response.end(adapter);return;}
  const file=path.resolve(workspace,`.${decodeURIComponent(url.pathname)}`);
  if(!file.startsWith(workspace)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
  let body=fs.readFileSync(file);
  if(/\.(html|js|css)$/.test(file))body=body.toString();
  if(/(board|teacher)\.html$/.test(file))body=body.replace(/<script src="https:\/\/www.gstatic.com\/firebasejs[^>]*><\/script>/g,'').replace(/src="firebase-classroom.js[^\"]*"/,'src="/__fixture-adapter.js"');
  if(file.endsWith('deadline-tasks.js'))body+=mockService;
  response.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');response.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:process.env.CLASSBOARD_TEST_BROWSER || 'msedge'});
const output=process.env.CLASSBOARD_TEST_OUTPUT;
if(output)fs.mkdirSync(output,{recursive:true});
try {
  for(const [file,size] of [['board.html',{width:1920,height:1080}],['board.html',{width:3840,height:2160}],['board.html',{width:1280,height:720}],['teacher.html',{width:1280,height:900}],['teacher.html',{width:390,height:844}]]) {
    const context=await browser.newContext({viewport:size});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith(base)||url.startsWith('https://cdn.tailwindcss.com'))return route.continue();
      return route.fulfill({status:200,body:'',contentType:'text/plain'});
    });
    await page.goto(`${base}/${file}`,{waitUntil:'networkidle'});
    const teacher=file==='teacher.html';
    if(teacher)await page.evaluate(()=>showPanel('tasks'));else await page.evaluate(()=>openApp('courses'));
    await page.getByRole('tab',{name:'限時任務',exact:true}).click();
    await page.locator('[data-task-id="open"]').click();
    const modal=page.locator('#deadline-task-dialog');await modal.waitFor({state:'visible'});
    assert.equal(await modal.locator('.deadline-student').count(),30);
    assert.equal(await modal.locator('.deadline-student strong').first().textContent(),'學生28','Uses the real reversed seating layout, not seat-number order');
    assert.equal(await modal.locator('button.deadline-student').count(),teacher?0:26);
    if(!teacher) {
      const fit=await modal.evaluate(element=>({scroll:element.scrollHeight,client:element.clientHeight,grid:element.querySelector('.deadline-seat-grid').getBoundingClientRect().height}));
      assert.equal(fit.scroll>fit.client+1,false,`Full seating grid fits on one screen ${size.width}: ${JSON.stringify(fit)}`);
      await modal.locator('button.deadline-student').first().dblclick();
      await page.waitForTimeout(220);
      assert.equal(await page.evaluate(()=>__deadlineFixture.calls),1,'Busy flag prevents duplicate toggles');
      assert.equal(await modal.locator('.deadline-student.done').count(),1);
      await page.evaluate(()=>__deadlineFixture.remote());
      assert.equal(await modal.isVisible(),true,'Remote updates keep the current detail dialog open');
      await page.evaluate(()=>__deadlineFixture.expire());
      await page.waitForTimeout(1150);
      assert.equal(await modal.locator('button.deadline-student:not(:disabled)').count(),0,'Open detail locks automatically on expiry');
      assert((await modal.locator('.deadline-summary').textContent()).includes('已截止'));
    }
    if(output)await page.screenshot({path:path.join(output,`${teacher?'teacher':'board'}-${size.width}-detail.png`)});
    await modal.getByRole('button',{name:'✕ 關閉',exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:'限時任務',exact:true}).getAttribute('aria-selected'),'true','Closing returns to timed task list');
    if(teacher) {
      await page.getByRole('button',{name:'新增限時任務',exact:true}).click();
      const editor=page.locator('.deadline-form-dialog');
      await editor.getByLabel('任務名稱',{exact:true}).fill('建立測試任務');
      await editor.getByLabel('截止日期與時間（台灣時間）',{exact:true}).fill('2099-10-30T12:00');
      const overflow=await editor.evaluate(element=>{const input=element.querySelector('input[type="datetime-local"]');return input.getBoundingClientRect().right>element.getBoundingClientRect().right;});
      assert.equal(overflow,false,'Date input stays inside mobile dialog');
      if(output)await page.screenshot({path:path.join(output,`teacher-${size.width}-editor.png`)});
      await editor.getByRole('button',{name:'儲存任務',exact:true}).click();
      await editor.waitFor({state:'detached'});
      assert.equal(await page.locator('[data-task-id="created"] strong').textContent(),'建立測試任務');
      await page.locator('[data-task-id="closed"]').click();
      assert.equal(await modal.locator('.deadline-student.done').count(),1,'Closed task history remains queryable');
      await modal.getByRole('button',{name:'✕ 關閉',exact:true}).click();
    } else {
      assert.equal(await page.evaluate(()=>currentActiveApp),'courses');
      await page.getByRole('tab',{name:'科目任務',exact:true}).click();
      assert.equal(await page.locator('#course-folders > div').count(),19);
      await page.locator('#course-folders > div').first().click();
      assert.equal(await page.evaluate(()=>currentActiveApp),'subject');
      assert.equal(await page.locator('#task-title').count(),0); // No timed task markup leaks into legacy task view.
    }
    assert.deepEqual(errors,[],`${file} ${size.width}: no page exceptions`);
    await context.close();
  }
  console.log('Deadline UI: passed (real board/teacher HTML, desktop/mobile, actual seating order, 30 preserved slots, teacher read-only records, duplicate click guard, live updates stay open, automatic lock, retained history, nested editor, date containment and legacy subject navigation).');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
