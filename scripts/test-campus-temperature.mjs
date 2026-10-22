import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {parseTemperature,fetchTemperature,captureTemperature,SOURCE_URL} from './fetch-campus-temperature.mjs';
const page=({school='前峰國中',temp='29.6',flag='false'}={})=>`<input id="schoolName" name="schoolACDashboardBean.schoolName" value="${school}"><input id="reflashFlag" value="${flag}"><input id="customTime" value="2026/10/22 17:13:47"><img src="images/humidity.png"><h3>62.0<span>%</span></h3><img src="images/temperature.png"><div><h3>${temp}<span>°C</span></h3></div>`;
assert.equal(parseTemperature(page()).temperatureC,29.6);
assert.equal(parseTemperature(page({temp:'0'})).temperatureC,0);
for(const input of [page({school:'別校'}),page({temp:''}),page({temp:'99'}),page({temp:'abc'}),page()+page({temp:'30.0'})])assert.throws(()=>parseTemperature(input));
assert.equal(parseTemperature(page().replace('°C','&deg;C')).temperatureC,29.6);
let requests=[];
const replies=[page({school:'',temp:'',flag:''}),page({flag:'true'}),page()];
const fetchImpl=async(url,options)=>{requests.push([url,options]);return {ok:true,headers:{getSetCookie:()=>['JSESSIONID=public-test-session; Path=/; HttpOnly']},text:async()=>replies.shift()};};
const now=()=>new Date('2026-10-22T09:14:00Z'),snapshot=await fetchTemperature({fetchImpl,now});
assert.equal(snapshot.temperatureC,29.6);assert.equal(requests.length,3);assert.equal(requests[0][1].headers.Cookie,undefined);
assert.equal(requests[1][1].headers.Cookie,'JSESSIONID=public-test-session');assert.equal(requests[2][0],SOURCE_URL);
assert.equal(snapshot.fetchedAt,now().toISOString());assert.equal(snapshot.sourceClock,'2026/10/22 17:13:47');assert(!JSON.stringify(snapshot).includes('public-test-session'),'Session cookies never enter public JSON');
let failedRequests=0;
await assert.rejects(()=>fetchTemperature({maxRequests:2,fetchImpl:async()=>{failedRequests++;return {ok:false,status:503};}}));assert.equal(failedRequests,2);
const tempRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'campus-temperature-test-'));
try{
  const output=path.join(tempRoot,'campus-temperature.json');
  const failed=await captureTemperature(output,{now,fetchImpl:async()=>{throw Error('not exposed');}});assert.equal(failed.status,'unavailable');assert.equal(failed.temperatureC,null);assert(!fs.readFileSync(output,'utf8').includes('not exposed'));
  const ctx={Intl,Date,AbortSignal};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../campus-temperature.js',import.meta.url),'utf8'),ctx);
  const widget=ctx.CampusTemperature,stamp=now().getTime();
  assert.equal(widget.temperatureState(snapshot,stamp).value,'29.6°C');assert(widget.temperatureState(snapshot,stamp).note.includes('17:14'));
  assert.equal(widget.temperatureState({...snapshot,temperatureC:0},stamp).value,'0.0°C');
  assert.equal(widget.temperatureState(snapshot,stamp+31*60000).level,'stale');assert.equal(widget.temperatureState(snapshot,stamp+31*60000).value,'—');
  for(const data of [null,failed,{...snapshot,school:'別校'},{...snapshot,temperatureC:'29.6'},{...snapshot,temperatureC:NaN},{...snapshot,temperatureC:99},{...snapshot,fetchedAt:null},{...snapshot,fetchedAt:'bad'},{...snapshot,fetchedAt:new Date(stamp+10*60000).toISOString()}])assert.equal(widget.temperatureState(data,stamp).value,'—');
  const nodes=new Map(['campus-temperature','campus-temperature-value','campus-temperature-note'].map(id=>[id,{textContent:'',dataset:{}}]));let fetchCalls=0,clock=stamp,intervals=[],resolveFetch;
  const instance=widget.mount({document:{getElementById:id=>nodes.get(id)},now:()=>clock,setIntervalImpl:(fn,ms)=>intervals.push([fn,ms]),fetchImpl:async()=>{fetchCalls++;return await new Promise(resolve=>{resolveFetch=resolve;});}});
  assert.equal(fetchCalls,1);assert.deepEqual(intervals.map(([,ms])=>ms),[120000,30000]);
  await instance.refresh();assert.equal(fetchCalls,1,'Concurrent fetches are suppressed');
  resolveFetch({ok:true,json:async()=>snapshot});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(nodes.get('campus-temperature-value').textContent,'29.6°C');
  clock+=31*60000;instance.render();assert.equal(nodes.get('campus-temperature-value').textContent,'—');assert(nodes.get('campus-temperature-note').textContent.includes('資料逾時'));
  const second=widget.mount({document:{getElementById:id=>nodes.get(id)},now:()=>stamp,setIntervalImpl(){},fetchImpl:async()=>{throw Error('offline');}});await new Promise(resolve=>setTimeout(resolve,0));assert(nodes.get('campus-temperature-note').textContent.includes('連線異常'));assert(second);
  const source=fs.readFileSync(new URL('../campus-temperature.js',import.meta.url),'utf8');assert(!/openApp\(|closeApp\(|location\.reload|loadCloudData\(/.test(source),'Temperature updates cannot navigate or refresh classroom apps');
  const board=fs.readFileSync(new URL('../board.html',import.meta.url),'utf8');assert(board.indexOf('widget-date')<board.indexOf('id="campus-temperature"'));assert(board.includes('defer src="campus-temperature.js?v=1"'));assert(board.includes('校園溫度'));
  // Optional integration test needs permission to create isolated .git directories.
  if(process.argv.includes('--publish-git')){
  // Publish twice against an isolated local bare remote; main and its working files stay untouched.
  const remote=path.join(tempRoot,'remote.git'),repo=path.join(tempRoot,'repo');await fsp.mkdir(repo);
  const git=(args,cwd=repo)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  git(['init','--bare',remote],tempRoot);git(['init','-b','main']);git(['config','user.name','Local temperature test']);git(['config','user.email','test@example.invalid']);git(['config','commit.gpgsign','false']);
  await fsp.writeFile(path.join(repo,'main.txt'),'Classroom program stays unchanged\n');git(['add','main.txt']);git(['commit','-m','initial main']);git(['remote','add','origin',remote]);git(['push','origin','main']);
  const main=git(['rev-parse','HEAD']),publish=path.resolve('scripts/publish-campus-temperature.mjs');await fsp.writeFile(output,JSON.stringify(snapshot));
  for(let index=0;index<2;index++)execFileSync(process.execPath,[publish,output],{cwd:repo,stdio:'pipe'});
  assert.equal(git(['rev-parse','HEAD']),main);assert.equal(git(['status','--porcelain']),'');assert.equal(git(['symbolic-ref','--short','HEAD']),'main');
  git(['fetch','origin','refs/heads/codex/campus-temperature-data']);assert.equal(git(['ls-tree','--name-only','FETCH_HEAD']),'campus-temperature.json');assert.equal(JSON.parse(git(['show','FETCH_HEAD:campus-temperature.json'])).temperatureC,29.6);
  }
  const workflow=fs.readFileSync(new URL('../.github/workflows/campus-temperature.yml',import.meta.url),'utf8');assert(!/^\s{2}schedule:/m.test(workflow),'Do not schedule repeated failures while hosted runners cannot reach the source');assert(workflow.includes('contents: write'));assert(workflow.includes('workflow_dispatch'));assert(!workflow.includes('firebase'));assert(workflow.includes('steps.capture.outcome'));
}finally{
  const target=await fsp.realpath(tempRoot),parent=await fsp.realpath(os.tmpdir());if(path.dirname(target).toLowerCase()!==parent.toLowerCase()||!path.basename(target).startsWith('campus-temperature-test-'))throw Error('Unsafe test cleanup path');await fsp.rm(target,{recursive:true,force:true});
}
console.log('Campus temperature: passed (cookie/reload flow, correct school/value, blanks/ranges/errors, no session leakage, freshness/timezone, offline/concurrency, independent widget updates, isolated data branch publication and main unchanged).');
