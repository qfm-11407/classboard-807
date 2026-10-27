import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const source=await readFile(new URL('../gas/Code.gs',import.meta.url),'utf8');
function fixture(){
  const properties=new Map([['ALLOWED_ORIGINS','https://school.github.io']]),cache=new Map(),files=new Map(),folders=new Map(),logs=[],state={locked:false,aiCalls:0,now:Date.now(),fetchBody:null,fetchHook:null,createHook:null};
  const signed=bytes=>Array.from(bytes,n=>n>127?n-256:n);
  function blob(data,type='text/plain',name=''){const bytes=typeof data==='string'?Buffer.from(data):Buffer.from(data.map(n=>(n+256)%256));return {getBytes:()=>signed(bytes),getDataAsString:()=>bytes.toString('utf8'),getName:()=>name,getContentType:()=>type};}
  function folder(name){const id='folder-'+randomUUID();const f={id,getId:()=>id,getUrl:()=>`https://drive.google.com/drive/folders/${id}`,getSharingAccess:()=> 'PRIVATE',createFolder:child=>folder(child),createFile:(data,text,type)=>{const b=typeof data==='string'?blob(text,type,data):data;const fileId='file-'+randomUUID();const file={id:fileId,name:typeof data==='string'?data:b.getName(),parent:id,value:b,getId:()=>fileId,getBlob(){return this.value},setContent(value){this.value=blob(value,'application/json',this.name);return this}};files.set(fileId,file);if(file.name.endsWith('.png')&&state.createHook)state.createHook(file);return file}};folders.set(id,f);return f;}
  const p={getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>{properties.set(k,String(v));return p},getProperties:()=>Object.fromEntries(properties),setProperties:o=>{Object.entries(o).forEach(([k,v])=>properties.set(k,String(v)));return p}};
  const c={get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,String(v)),remove:k=>cache.delete(k)};
  class Clock extends Date{constructor(...args){super(...(args.length?args:[state.now]))}static now(){return state.now}}
  const context=vm.createContext({Date:Clock,console,PropertiesService:{getScriptProperties:()=>p},CacheService:{getScriptCache:()=>c},LockService:{getScriptLock:()=>({tryLock(){if(state.locked)return false;state.locked=true;return true},releaseLock(){state.locked=false}})},DriveApp:{Access:{PRIVATE:'PRIVATE'},createFolder:folder,getFolderById:id=>{assert.ok(folders.has(id),'Unknown folder');return folders.get(id)},getFileById:id=>{assert.ok(files.has(id),'Unknown file');return files.get(id)}},Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(algo,s)=>signed(createHash('sha256').update(s).digest()),newBlob:blob,base64Decode:s=>signed(Buffer.from(s,'base64')),base64Encode:bytes=>Buffer.from(bytes.map(n=>(n+256)%256)).toString('base64'),formatDate:()=> '20261027-120000'},Logger:{log:s=>logs.push(s)},UrlFetchApp:{fetch:(url,options)=>{assert.equal(state.locked,false,'AI request must not hold the shared lock');assert.equal(url,'https://api.openai.com/v1/responses');state.aiCalls++;state.fetchBody=JSON.parse(options.payload);if(state.fetchHook)return state.fetchHook(options);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:'{"correct":true}'}]}],usage:{input_tokens:20,output_tokens:4}})}}}});
  vm.runInContext(source,context,{filename:'Code.gs'});context.setup_();
  const call=(action,data={},token='')=>JSON.parse(JSON.stringify(context.rpc(action,data,token)));
  const auth=call('login',{pin:properties.get('TEACHER_PIN')}).data.token;
  function room(mode='practice'){return call('createRoom',{title:'學號測試',mode},auth).data.room;}
  function admin(){return call('adminState',{},auth).data.room;}
  function start(code){return call('start',{room:code,prompt:'請寫一字',answer:'冶',seconds:30},auth);}
  return {context,call,auth,room,admin,start,properties,cache,files,folders,state};
}
function png(){const b=Buffer.alloc(64);Buffer.from('89504e470d0a1a0a','hex').copy(b);Buffer.from('IHDR').copy(b,12);b.writeUInt32BE(512,16);b.writeUInt32BE(512,20);return 'data:image/png;base64,'+b.toString('base64');}
const image=png();
function join(f,code,id='0000123'){return f.call('join',{room:code,studentId:id,name:'同學'}).data;}
function submit(f,code,p){return f.call('submit',{room:code,roundId:f.admin().round.id,image},p.token);}

test('GAS setup creates a private folder; API keys, private file IDs and tokens stay out of public snapshots',()=>{
  const f=fixture();assert.ok(f.properties.get('DRIVE_FOLDER_ID'));assert.equal(f.call('adminState').status,401);assert.equal(f.call('createRoom',{mode:'live'},f.auth).status,400);
  const r=f.room(),p=join(f,r.code);assert.equal(p.player.studentId,'0000123');assert.equal(f.call('join',{room:r.code,studentId:'0000123'}).status,409);assert.equal(f.call('join',{room:r.code,studentId:123}).status,400);assert.equal(f.call('join',{room:r.code,token:p.token}).data.player.id,p.player.id);
  f.start(r.code);assert.equal(submit(f,r.code,p).ok,true);const publicData=f.call('room',{room:r.code}).data;
  assert.equal(publicData.round.answer,null);assert.equal(publicData.players[0].imageUrl,null);assert.equal(publicData.players[0].correct,null);assert.equal(JSON.stringify(publicData).includes(p.token),false);assert.equal(JSON.stringify(publicData).includes('file-'),false);
  assert.equal(f.call('images',{room:r.code,roundId:publicData.round.id}).status,403);
});

test('30 submissions are saved once; workers keep results hidden, close exposes images, reveal scores only once',()=>{
  const f=fixture(),r=f.room(),players=Array.from({length:30},(_,i)=>join(f,r.code,String(i+1).padStart(7,'0')));f.start(r.code);
  for(const p of players){assert.equal(submit(f,r.code,p).ok,true);assert.equal(submit(f,r.code,p).data.duplicate,true);}
  assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,30);
  for(let i=0;i<30;i++)assert.equal(f.call('worker',{room:r.code},f.auth).data.processed,true);
  const secret=f.call('room',{room:r.code}).data;assert.ok(secret.players.every(p=>p.score===0&&p.correct===null&&p.status==='submitted'));assert.equal(secret.round.answer,null);assert.equal(f.state.aiCalls,0);
  assert.equal(f.call('reveal',{room:r.code},f.auth).status,409);f.call('close',{room:r.code},f.auth);
  const images=f.call('images',{room:r.code,roundId:secret.round.id}).data;assert.equal(Object.keys(images).length,30);assert.ok(Object.values(images).every(s=>s.startsWith('data:image/png;base64,')));
  f.call('reveal',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);const done=f.call('room',{room:r.code}).data;assert.equal(done.players.reduce((n,p)=>n+p.score,0),200);assert.equal(done.players.filter(p=>p.correct===true).length,20);
  assert.ok(f.call('export',{room:r.code},f.auth).data.csv.includes('0000001'));assert.equal(f.call('retry',{room:r.code},f.auth).status,409);
});

test('upload reservation is idempotent and image creation happens outside the global lock',()=>{
  const f=fixture(),r=f.room(),p=join(f,r.code);f.start(r.code);let nested;
  f.state.createHook=()=>{assert.equal(f.state.locked,false);nested=submit(f,r.code,p);};
  assert.equal(submit(f,r.code,p).ok,true);assert.equal(nested.status,429);assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,1);assert.equal(submit(f,r.code,p).data.duplicate,true);
});

test('AI is full automatic, outputs only correct, does not receive the student ID and cannot score before reveal',()=>{
  const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);
  const r=f.room('live'),p=join(f,r.code);f.start(r.code);submit(f,r.code,p);
  assert.equal(f.call('studentWorker',{room:r.code,roundId:f.admin().round.id},p.token).data.processed,true);
  assert.equal(f.state.aiCalls,1);assert.deepEqual(Object.keys(f.state.fetchBody.text.format.schema.properties),['correct']);assert.equal(JSON.stringify(f.state.fetchBody).includes('0000123'),false);assert.equal(f.state.fetchBody.store,false);
  assert.equal(f.call('room',{room:r.code}).data.players[0].correct,null);assert.equal(f.admin().usage.calls,1);
  f.call('worker',{room:r.code},f.auth);assert.equal(f.state.aiCalls,1);
});

test('service failure is not a wrong answer; retry repairs only unresolved work',()=>{
  const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);const r=f.room('live'),p=join(f,r.code);f.start(r.code);submit(f,r.code,p);
  f.state.fetchHook=()=>({getResponseCode:()=>429,getContentText:()=> '{}'});f.call('worker',{room:r.code},f.auth);assert.equal(f.admin().players[0].judgeStatus,'error');assert.equal(f.admin().players[0].correct,null);
  f.state.fetchHook=null;f.call('retry',{room:r.code},f.auth);f.call('worker',{room:r.code},f.auth);assert.equal(f.admin().round.judged,1);f.call('retry',{room:r.code},f.auth);f.call('worker',{room:r.code},f.auth);assert.equal(f.state.aiCalls,2);
});

test('unknown handwriting gets two passes and stays unscored; deadlined rounds reject new answers',()=>{
  const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);const r=f.room('live'),p=join(f,r.code),late=join(f,r.code,'0000456');f.start(r.code);submit(f,r.code,p);
  f.state.fetchHook=()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:'{"correct":null}'}]}]})});f.call('worker',{room:r.code},f.auth);assert.equal(f.state.aiCalls,2);assert.equal(f.admin().players[0].judgeStatus,'uncertain');
  f.state.now+=31000;assert.equal(f.call('room',{room:r.code}).data.round.phase,'closed');assert.equal(submit(f,r.code,late).status,409);
  f.call('reveal',{room:r.code},f.auth);assert.equal(f.admin().players[0].correct,null);assert.equal(f.admin().players[0].score,0);
});

test('history is archived to Drive, scores carry to the next question, and settings never echo keys',()=>{
  const f=fixture(),r=f.room(),p=join(f,r.code);assert.equal(f.call('start',{room:r.code,prompt:'test',answer:'陶冶',seconds:30},f.auth).status,400);f.start(r.code);submit(f,r.code,p);f.call('worker',{room:r.code},f.auth);f.call('close',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);f.start(r.code);
  assert.ok([...f.files.values()].some(file=>file.name==='round-1-results.json'));assert.equal(f.admin().players[0].score,10);assert.ok(f.call('export',{room:r.code},f.auth).data.csv.includes('0000123'));
  f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:3},f.auth);assert.equal(JSON.stringify(f.call('adminState',{},f.auth)).includes('sk-test'),false);assert.equal(f.call('settings',{model:'x',concurrency:4},f.auth).status,400);
});

test('only the owning student may trigger their queued work and a new room cannot abandon the active round',()=>{
  const f=fixture(),r=f.room(),p=join(f,r.code);f.start(r.code);submit(f,r.code,p);assert.equal(f.call('studentWorker',{room:r.code,roundId:f.admin().round.id},'bad-token').status,401);assert.equal(f.call('createRoom',{mode:'practice'},f.auth).status,409);
});
