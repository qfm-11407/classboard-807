// Browser integration uses fake audio only: no microphone permission or classroom writes.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

let chromium;
try { ({chromium}=await import('playwright')); }
catch (_) { ({chromium}=createRequire(path.join(process.env.USERPROFILE||'','.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright')); }
const workspace=fileURLToPath(new URL('../',import.meta.url));
const adapter=`
window.firebase={};
localStorage.setItem('classroomStudentRoster',JSON.stringify(Array.from({length:25},(_,i)=>({seat:i+1,name:'測試學生'+(i+1)}))));
window.FirebaseClassroom={ready:Promise.resolve(),isTeacher:()=>false,onTeacherChanged:callback=>{callback(null);return()=>{};},onPublicChanged:()=>()=>{},getState:async()=>({hasData:false,data:{}})};
const realFetch=window.fetch.bind(window);window.fetch=(input,init)=>String(input).startsWith('http')?Promise.resolve(new Response('{}')):realFetch(input,init);
window.__fakeMic={requests:0,streams:[],contexts:[],signal:0,error:null};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(){__fakeMic.requests++;if(__fakeMic.error){const error=new Error(__fakeMic.error);error.name=__fakeMic.error;throw error;}const track={stopped:false,stop(){this.stopped=true;},addEventListener(){}};const stream={getTracks:()=>[track],getAudioTracks:()=>[track],track};__fakeMic.streams.push(stream);return stream;}}});
window.AudioContext=class {constructor(){this.state='suspended';__fakeMic.contexts.push(this);}async resume(){this.state='running';}async close(){this.state='closed';}createAnalyser(){return{fftSize:2048,getFloatTimeDomainData:array=>array.fill(__fakeMic.signal)};}createMediaStreamSource(){return{connect(){},disconnect(){}};}};
`;
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/__adapter.js'){response.setHeader('Content-Type','application/javascript');response.end(adapter);return;}
  if(url.pathname==='/doodle.html'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Unrelated app isolated</title>');return;}
  const file=path.resolve(workspace,`.${decodeURIComponent(url.pathname)}`);
  if(!file.startsWith(workspace)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
  let body=fs.readFileSync(file);
  if(/\.(html|js|css)$/.test(file))body=body.toString();
  if(file.endsWith('board.html'))body=body.replace(/<script src="https:\/\/www.gstatic.com\/firebasejs[^>]*><\/script>/g,'').replace(/src="firebase-classroom.js[^\"]*"/,'src="/__adapter.js"');
  if(file.endsWith('deadline-tasks.js'))body+=';DeadlineTasks.createService=()=>({isTeacher:()=>false});';
  response.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');response.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:process.env.CLASSBOARD_TEST_BROWSER||'msedge'});
const output=process.env.CLASSBOARD_TEST_OUTPUT;if(output)fs.mkdirSync(output,{recursive:true});
try {
  for(const size of [{width:1920,height:1080},{width:3840,height:2160},{width:1280,height:720}]) {
    const context=await browser.newContext({viewport:size}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('https://cdn.tailwindcss.com')?route.continue():route.fulfill({status:200,body:'',contentType:'text/plain'}));
    await page.goto(`${base}/board.html`,{waitUntil:'networkidle'});
    assert.equal(await page.evaluate(()=>__fakeMic.requests),0,'Loading the board never opens the microphone');
    await page.locator('[onclick="openApp(\'wheel\')"]').click();
    await page.getByRole('button',{name:'🐱 小貓音量偵測',exact:true}).click();
    const cat=page.locator('.noise-cat');await cat.waitFor({state:'visible'});
    assert.equal(await page.locator('#class-tool-noise-cat-tab').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#class-tool-wheel-tab').getAttribute('aria-pressed'),'false');
    assert.equal(await page.evaluate(()=>__fakeMic.requests),0,'Opening the cat tab never opens the microphone');
    assert.equal(await cat.getAttribute('data-running'),'false');
    const geometry=await cat.evaluate(element=>{const rect=element.getBoundingClientRect(),container=element.closest('#app-content-wheel').getBoundingClientRect();return{right:rect.right,bottom:rect.bottom,containerRight:container.right,containerBottom:container.bottom};});
    assert(geometry.right<=geometry.containerRight+1&&geometry.bottom<=geometry.containerBottom+1,`Cat tool stays inside the app at ${size.width}`);
    if(output)await page.screenshot({path:path.join(output,`noise-cat-${size.width}.png`),animations:'disabled'});
    await cat.getByRole('button',{name:'開始守護小貓',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.noise-cat').dataset.running==='true');
    assert.equal(await page.evaluate(()=>__fakeMic.requests),1);
    await cat.getByRole('button',{name:'安靜自習',exact:true}).click();
    assert.equal(await cat.locator('#nc-threshold-value').textContent(),'38');
    await cat.getByRole('button',{name:'一般課堂',exact:true}).click();
    if(size.width===1920) {
      await page.evaluate(()=>{__fakeMic.signal=.1;});
      await page.waitForFunction(()=>document.querySelector('.noise-cat').dataset.state==='awake',null,{timeout:10000});
      assert.equal(await cat.locator('#nc-wakes').textContent(),'1');
      await page.evaluate(()=>{__fakeMic.signal=0;});
      await page.waitForFunction(()=>document.querySelector('.noise-cat').dataset.state==='sleeping',null,{timeout:10000});
    }
    await page.getByRole('button',{name:'計時碼表',exact:true}).click();
    assert.equal(await page.evaluate(()=>__fakeMic.streams.every(stream=>stream.track.stopped)),true,'Switching tools stops every audio track');
    assert.equal(await page.evaluate(()=>__fakeMic.contexts.every(audio=>audio.state==='closed')),true);
    await page.getByRole('button',{name:'🐱 小貓音量偵測',exact:true}).click();
    await cat.getByRole('button',{name:'繼續守護小貓',exact:true}).click();
    await page.waitForFunction(()=>__fakeMic.streams.length===2);
    await page.getByRole('button',{name:'關閉目前視窗',exact:true}).click();
    assert.equal(await page.evaluate(()=>__fakeMic.streams.every(stream=>stream.track.stopped)),true,'Closing the app stops capture');
    assert.equal(await page.evaluate(()=>currentActiveApp),null);
    await page.locator('[onclick="openApp(\'wheel\')"]').click();
    await page.getByRole('button',{name:'🐱 小貓音量偵測',exact:true}).click();
    await page.evaluate(()=>{__fakeMic.error='NotAllowedError';});
    await cat.getByRole('button',{name:'繼續守護小貓',exact:true}).click();
    await cat.getByRole('alert').waitFor({state:'visible'});
    assert((await cat.getByRole('alert').textContent()).includes('麥克風權限'));
    assert.equal(await page.evaluate(()=>__fakeMic.contexts.every(audio=>audio.state==='closed')),true);
    assert.deepEqual(errors,[],`No page errors at ${size.width}`);
    await context.close();
  }
  console.log('Noise cat browser: passed (real tool entry, 720p/1080p/4K, no automatic microphone access, fake sound wakes/sleeps, presets, tab/close cleanup, retry and permission-denied feedback).');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
