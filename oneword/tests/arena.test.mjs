import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createArena } from '../server.mjs';
import { judgeCharacter } from '../ai.mjs';

function png() {
  const crc = b => { let c = 0xffffffff; for (const byte of b) { c ^= byte; for (let i=0;i<8;i++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const header=Buffer.alloc(4), sum=Buffer.alloc(4), name=Buffer.from(type); header.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name,data]))); return Buffer.concat([header,name,data,sum]); };
  const header=Buffer.alloc(13); header.writeUInt32BE(64); header.writeUInt32BE(64,4); header[8]=8; header[9]=6;
  const pixels=Buffer.alloc(64*(1+64*4),255); for(let y=0;y<64;y++){pixels[y*257]=0; for(let x=27;x<37;x++)for(let c=0;c<3;c++)pixels[y*257+1+x*4+c]=0;}
  return 'data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const image=png(), sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn) { for(let i=0;i<100;i++){ const r=await fn();if(r)return r;await sleep(20);}throw new Error('Timed out'); }
// Exercise the real HTTP handlers in-process. No network socket is needed by tests.
function localFetch(app, port) {
  return async (url, options = {}) => new Promise((resolve, reject) => {
    const address = new URL(url, 'http://127.0.0.1:' + port);
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    req.method = options.method || 'GET'; req.url = address.pathname + address.search;
    req.headers = Object.fromEntries(new Headers(options.headers || {})); req.headers.host ||= address.host;
    req.socket = { remoteAddress: '127.0.0.1' };
    const res = new EventEmitter(), headers = new Headers(); let status = 200; const chunks=[];
    res.headersSent = false;
    res.setHeader = (k,v) => headers.set(k,String(v));
    res.writeHead = (code, values={}) => { status=code; for(const [k,v] of Object.entries(values)) headers.set(k,String(v)); res.headersSent=true; };
    res.write = value => { chunks.push(Buffer.from(value)); return true; };
    res.end = value => { if(value)chunks.push(Buffer.from(value));resolve(new Response(Buffer.concat(chunks), {status,headers})); };
    req.on('error',reject); app.server.emit('request',req,res);
  });
}

async function removeTestDir(dir) { const root=path.resolve('oneword/.local/tests')+path.sep; if(!path.resolve(dir).startsWith(root))throw new Error('Unsafe test cleanup path');await rm(dir,{recursive:true,force:true}); }
async function fixture(opts={}) {
  const testRoot=path.resolve('oneword/.local/tests');await mkdir(testRoot,{recursive:true});
  const dataDir=await mkdtemp(path.join(testRoot,'run-'));
  const app=await createArena({dataDir,teacherPin:'TEST-ONLY',practiceDelay:5,...opts});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
  const fetchLocal=localFetch(app,app.server.address().port);
  let cookie='';
  async function call(route,data,token,auth=true) {
    const res=await fetchLocal(base+route,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(auth?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    if(route==='/api/login')cookie=res.headers.get('set-cookie')?.split(';')[0]||'';
    const text=await res.text();let body;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body};
  }
  await call('/api/login',{pin:'TEST-ONLY'});
  return {app,base,call,dataDir,fetch:fetchLocal,async cleanup(){await app.shutdown();await removeTestDir(dataDir);}};
}
const createRoom=async(f,mode='practice')=>(await f.call('/api/admin/rooms',{title:'測試單字',mode})).body.room;
const start=async(f,code,data={})=>f.call(`/api/admin/rooms/${code}/start`,{prompt:'請寫「陶ㄧㄝˇ」的第二個字',answer:'冶',seconds:10,...data});
const admin=async f=>(await f.call('/api/admin/state')).body.room;

test('30 simultaneous submissions stay secret until reveal; duplicate delivery and reveal never charge or score twice',async()=>{
  const f=await fixture();try{
    const room=await createRoom(f),code=room.code;
    const players=await Promise.all(Array.from({length:30},(_,i)=>f.call('/api/join',{room:code,studentId:String(i+1).padStart(7,'0'),name:`同學${i+1}`})));
    assert.ok(players.every(r=>r.status===201));const round=(await start(f,code)).body.room.round;
    const submitted=await Promise.all(players.map(p=>f.call('/api/submit',{room:code,roundId:round.id,image},p.body.token)));
    assert.ok(submitted.every(r=>r.status===201));
    await until(async()=>{const r=await admin(f);return r.round.pending===0&&r});
    let publicRoom=(await f.call(`/api/room?room=${code}`,undefined,undefined,false)).body;
    assert.equal(publicRoom.round.answer,null);assert.ok(publicRoom.players.every(p=>p.correct===null&&p.imageUrl===null&&p.score===0&&p.status==='submitted'));
    assert.equal((await f.call(`/api/image/${code}/${round.id}/${players[0].body.player.id}`,undefined,undefined,false)).status,403);
    assert.equal((await f.call('/api/submit',{room:code,roundId:round.id,image:'bad'},players[0].body.token)).body.duplicate,true);
    assert.equal((await f.call(`/api/admin/rooms/${code}/reveal`,{})).status,409);
    await f.call(`/api/admin/rooms/${code}/close`,{});
    publicRoom=(await f.call(`/api/room?room=${code}`)).body;assert.ok(publicRoom.players.every(p=>p.imageUrl&&p.correct===null&&p.score===0));
    assert.equal((await f.call(`/api/image/${code}/${round.id}/${players[0].body.player.id}`)).status,200);
    await f.call(`/api/admin/rooms/${code}/reveal`,{});await f.call(`/api/admin/rooms/${code}/reveal`,{});
    publicRoom=(await f.call(`/api/room?room=${code}`)).body;
    assert.equal(publicRoom.players.filter(p=>p.correct===true).length,20);assert.equal(publicRoom.players.reduce((s,p)=>s+p.score,0),200);
    assert.equal((await admin(f)).usage.calls,0);
    const csv=await f.call(`/api/admin/rooms/${code}/export`);assert.equal(csv.status,200);assert.ok(csv.body.includes('流程演練'));
  }finally{await f.cleanup();}
});

test('single-character validation, deadline close, authentication, PNG size and late submissions',async()=>{
  const f=await fixture();try{
    assert.equal((await f.call('/api/admin/state',undefined,undefined,false)).status,401);
    assert.equal((await f.call('/api/admin/rooms',{mode:'live'})).status,400);
    const room=await createRoom(f),code=room.code;
    assert.equal((await start(f,code)).status,409);
    const p=(await f.call('/api/join',{room:code,studentId:'0000007',name:'測試'})).body;
    assert.equal((await f.call('/api/join',{room:code,studentId:'0000007'})).status,409);
    assert.equal(p.player.studentId,'0000007');
    assert.equal((await f.call('/api/join',{room:code,studentId:7})).status,400);
    assert.equal((await start(f,code,{answer:'陶冶'})).status,400);
    assert.equal((await start(f,code,{answer:'A'})).status,400);
    const round=(await start(f,code)).body.room.round;
    assert.equal((await f.call('/api/submit',{room:code,roundId:round.id,image})).status,401);
    assert.equal((await f.call('/api/submit',{room:code,roundId:round.id,image:'data:image/png;base64,AAAA'},p.token)).status,400);
    await f.call(`/api/admin/rooms/${code}/close`,{});
    assert.equal((await f.call('/api/submit',{room:code,roundId:round.id,image},p.token)).status,409);
    assert.equal((await f.call('/api/join',{room:code,studentId:'0000008'})).status,409);
    assert.equal((await f.call('/api/join',{room:code,token:p.token})).body.player.id,p.player.id);
  }finally{await f.cleanup();}
});

test('AI service errors do not turn into wrong answers; retry only unresolved submissions',async()=>{
  let calls=0;const f=await fixture({judge:async()=>{calls++;if(calls===1)throw new Error('temporary failure');return {correct:true,usage:{input:30,output:4}};}});
  try{
    await f.call('/api/admin/settings',{key:'sk-test-not-a-real-key',model:'test-model',concurrency:2});
    const room=await createRoom(f,'live'),code=room.code,p=(await f.call('/api/join',{room:code,studentId:'0000001'})).body,round=(await start(f,code)).body.room.round;
    await f.call('/api/submit',{room:code,roundId:round.id,image},p.token);
    await until(async()=>{const r=await admin(f);return r.round.unresolved===1;});
    assert.equal((await admin(f)).players[0].judgeStatus,'error');
    await f.call(`/api/admin/rooms/${code}/close`,{});await f.call(`/api/admin/rooms/${code}/retry`,{});
    await until(async()=>{const r=await admin(f);return r.round.judged===1;});
    await f.call(`/api/admin/rooms/${code}/retry`,{});assert.equal(calls,2);
    const before=(await f.call(`/api/room?room=${code}`)).body;assert.equal(before.players[0].correct,null);assert.equal(before.players[0].score,0);
    await f.call(`/api/admin/rooms/${code}/reveal`,{});assert.equal((await admin(f)).players[0].score,10);assert.equal((await admin(f)).usage.calls,1);
  }finally{await f.cleanup();}
});

test('uncertain automatic second pass remains pending until it finishes',async()=>{
  let calls=0,resolve;const wait=new Promise(r=>{resolve=r});
  const f=await fixture({judge:async()=>{calls++;if(calls===1)return {correct:null};await wait;return {correct:true};}});
  try{
    await f.call('/api/admin/settings',{key:'sk-test-not-a-real-key',model:'test-model',concurrency:2});
    const room=await createRoom(f,'live'),code=room.code,p=(await f.call('/api/join',{room:code,studentId:'0000001'})).body,round=(await start(f,code)).body.room.round;
    await f.call('/api/submit',{room:code,roundId:round.id,image},p.token);await until(()=>calls===2);await f.call(`/api/admin/rooms/${code}/close`,{});
    assert.equal((await f.call(`/api/admin/rooms/${code}/reveal`,{})).status,409);
    assert.equal((await admin(f)).round.pending,1);resolve();await until(async()=>{const r=await admin(f);return r.round.judged===1;});
  }finally{resolve();await sleep(10);await f.cleanup();}
});

test('saved matches restore; already graded answers are not resubmitted to AI',async()=>{
  const f=await fixture();let next;
  try{
    const room=await createRoom(f),code=room.code,p=(await f.call('/api/join',{room:code,studentId:'0000001'})).body,round=(await start(f,code)).body.room.round;
    await f.call('/api/submit',{room:code,roundId:round.id,image},p.token);await until(async()=>{const r=await admin(f);return r.round.judged===1;});
    await f.app.shutdown();next=await createArena({dataDir:f.dataDir,teacherPin:'NEW-PIN'});await new Promise(r=>next.server.listen(0,'127.0.0.1',r));
    const nextFetch=localFetch(next,next.server.address().port);
    const res=await nextFetch(`http://127.0.0.1:${next.server.address().port}/api/room?room=${code}`);const state=await res.json();
    assert.equal(state.round.phase,'closed');assert.equal(state.round.answer,null);assert.equal(state.players[0].submitted,true);
    assert.equal((await nextFetch(`http://127.0.0.1:${next.server.address().port}/.local/matches.json`)).status,404);
  }finally{if(next)await next.shutdown();await removeTestDir(f.dataDir);}
});

test('AI adapter sends only image and allowed answer, requests a short structured verdict',async()=>{
  let payload;const output={output:[{content:[{type:'output_text',text:'{"correct":true}'}]}],usage:{input_tokens:123,output_tokens:5}};
  const result=await judgeCharacter({image,answer:'冶',accepted:[],model:'gpt-4.1-mini',key:'test',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');payload=JSON.parse(options.body);return {ok:true,json:async()=>output};}});
  assert.equal(result.correct,true);assert.deepEqual(result.usage,{input:123,output:5});assert.equal(payload.store,false);assert.deepEqual(Object.keys(payload.text.format.schema.properties),['correct']);assert.equal(payload.max_output_tokens,128);
  assert.equal(payload.input[0].content[1].image_url,image);assert.equal('tools' in payload,false);
  await assert.rejects(judgeCharacter({image,answer:'冶',key:'test',model:'test',fetchImpl:async()=>({ok:true,json:async()=>({output:[]})})}),/有效判讀/);
});

test('cross-origin writes are rejected and public pages expose no teacher settings or server files',async()=>{
  const f=await fixture();try{
    const r=await f.fetch(f.base+'/api/login',{method:'POST',headers:{Origin:'http://evil.invalid','Content-Type':'application/json'},body:JSON.stringify({pin:'TEST-ONLY'})});assert.equal(r.status,403);
    for(const route of ['/server.mjs','/ai.mjs','/.local/matches.json','/../server.mjs'])assert.equal((await f.fetch(f.base+route)).status,404);
    for(const route of ['/','/teacher','/play','/screen','/app.js','/style.css'])assert.equal((await f.fetch(f.base+route)).status,200);
  }finally{await f.cleanup();}
});
