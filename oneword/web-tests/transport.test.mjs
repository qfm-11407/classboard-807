import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const raw=await readFile(new URL('../transport.js',import.meta.url),'utf8');
function fixture(){
  const listeners=new Set(),frames=[],posted=[],session=new Map();const peer={postMessage:(message,origin)=>posted.push({message,origin})};
  const sandbox={config:{gasUrl:'',pollMs:3500},location:{href:'https://school.github.io/classboard/oneword/teacher.html',search:'',origin:'https://school.github.io'},URL,URLSearchParams,crypto:webcrypto,Uint8Array,Map,Promise,setTimeout,clearTimeout,localStorage:{getItem:()=>''},sessionStorage:{getItem:k=>session.get(k),setItem:(k,v)=>session.set(k,v)},window:{addEventListener:(t,fn)=>listeners.add(fn),removeEventListener:(t,fn)=>listeners.delete(fn)},document:{createElement:()=>({remove(){}}),body:{append:frame=>frames.push(frame)}}};
  const code=raw.replace("import { config } from './config.js';",'').replace(/export /g,'').replace('{ validBackend, trustedGoogleOrigin };','')+'\nglobalThis.exports={GASClient,validBackend,trustedGoogleOrigin};';
  vm.runInNewContext(code,sandbox);const {GASClient,validBackend,trustedGoogleOrigin}=sandbox.exports;
  const client=new GASClient('https://script.google.com/macros/s/TEST_DEPLOYMENT/exec');
  const emit=(data,origin='https://abc-script.googleusercontent.com',source=peer)=>listeners.forEach(fn=>fn({data,origin,source}));
  const ready=()=>emit({type:'oneword:ready',channel:client.channel});
  const reply=(request,data,overrides={})=>emit({type:'oneword:response',channel:client.channel,id:request.id,reply:{ok:true,data},...overrides});
  return{client,frames,posted,emit,ready,reply,peer,session,validBackend,trustedGoogleOrigin};
}
const tick=()=>new Promise(r=>setImmediate(r));

test('bridge handshake pins the Google source, rejects forged origins/channels and returns the actual RPC result',async()=>{
  const f=fixture();try{
    const task=f.client.rpc('ping',{},'');assert.equal(f.frames.length,1);assert.equal(f.frames[0].hidden,true);f.ready();await tick();
    const request=f.posted[0].message;assert.equal(f.posted[0].origin,'https://abc-script.googleusercontent.com');
    f.emit({type:'oneword:response',channel:f.client.channel,id:request.id,reply:{ok:true,data:'forged'}},'https://evil.invalid');assert.equal(f.client.pending.size,1);
    f.emit({type:'oneword:response',channel:f.client.channel,id:request.id,reply:{ok:true,data:'forged'}},'https://abc-script.googleusercontent.com',{});assert.equal(f.client.pending.size,1);
    f.reply(request,{ready:true});assert.equal((await task).ready,true);
  }finally{f.client.dispose();}
});

test('page links preserve the GitHub repository/subfolder path and carry a non-secret GAS URL',()=>{
  const f=fixture();try{const u=new URL(f.client.pageURL('student.html','A1B2C3'));assert.equal(u.pathname,'/classboard/oneword/student.html');assert.equal(u.searchParams.get('room'),'A1B2C3');assert.equal(u.searchParams.get('backend'),f.client.backend);assert.equal(u.searchParams.has('token'),false);assert.equal(u.searchParams.has('pin'),false);}finally{f.client.dispose();}
});

test('only real deployed GAS endpoints and trusted Google origins are accepted',()=>{
  const f=fixture();assert.equal(f.validBackend('https://script.google.com/macros/s/ABC/exec'),true);assert.equal(f.validBackend('https://script.google.com/macros/s/ABC/dev'),false);assert.equal(f.validBackend('https://script.google.com.evil.invalid/macros/s/ABC/exec'),false);assert.equal(f.trustedGoogleOrigin('https://evil-googleusercontent.com'),false);assert.equal(f.trustedGoogleOrigin('http://abc.googleusercontent.com'),false);
});

test('Drive images are fetched only after close and reused when revealing results',async()=>{
  const f=fixture();let calls=0;f.client.rpc=async(action,data)=>{assert.equal(action,'images');calls++;return{p1:'data:image/png;base64,TEST'}};
  const state={code:'ABCDEF',round:{id:'r1',phase:'writing'},players:[{id:'p1',imageUrl:null}]};await f.client.hydrate(state);assert.equal(calls,0);state.round.phase='closed';state.players[0].imageUrl='gas-image:r1/p1';const hydrated=await f.client.hydrate(state);assert.ok(hydrated.players[0].imageUrl.startsWith('data:image/png'));state.round.phase='revealed';await f.client.hydrate(state);assert.equal(calls,1);
});

test('Bridge.html enforces configured parent origins and uses the top-level hosting page through the Google wrapper',async()=>{
  const text=await readFile(new URL('../gas/Bridge.html',import.meta.url),'utf8'),script=text.match(/<script>([\s\S]+)<\/script>/)[1].replace('<?!= boot ?>',JSON.stringify({channel:'channel',origins:['https://school.github.io']}));
  let handler,calls=0;const messages=[],top={postMessage:(m,o)=>messages.push({m,o})};const run={withSuccessHandler(fn){this.success=fn;return this},withFailureHandler(fn){this.failure=fn;return this},rpc(){calls++;this.success({ok:true,data:{ready:true}})}};
  vm.runInNewContext(script,{window:{top,addEventListener:(name,fn)=>{handler=fn}},google:{script:{run}}});assert.equal(messages[0].m.type,'oneword:ready');
  handler({data:{type:'oneword:request',channel:'channel',id:'1',action:'ping'},origin:'https://evil.invalid',source:top});assert.equal(calls,0);assert.equal(messages.at(-1).m.reply.status,403);
  handler({data:{type:'oneword:request',channel:'channel',id:'2',action:'ping'},origin:'https://school.github.io',source:top});assert.equal(calls,1);assert.equal(messages.at(-1).o,'https://school.github.io');
});
