import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Small DOM fixtures validate controller transitions without claiming browser/layout QA.
async function pageFixture(page, responses) {
  const html=await readFile(new URL(`../public/${page}.html`,import.meta.url),'utf8');
  const nodes=new Map();
  function element(id='') {
    const attrs={},classes=new Set();let ink=false;
    const ctx={clearRect(){ink=false;},beginPath(){},moveTo(){},lineTo(){},arc(){},fill(){ink=true;},stroke(){ink=true;},fillRect(){},drawImage(){},getImageData(){const data=new Uint8ClampedArray(128);if(ink)for(let i=3;i<data.length;i+=4)data[i]=255;return{data}}};
    return {id,hidden:false,value:'',textContent:'',innerHTML:'',disabled:false,events:{},className:'',classList:{toggle(c,on){if(on)classes.add(c);else classes.delete(c)},contains(c){return classes.has(c)}},
      addEventListener(event,fn){this.events[event]=fn},setAttribute(k,v){attrs[k]=v},getAttribute(k){return attrs[k]},getContext(){return ctx},getBoundingClientRect(){return{left:0,top:0,width:512,height:512}},setPointerCapture(){},toDataURL(){return 'data:image/png;base64,TEST'},focus(){},select(){},showModal(){this.open=true},close(){this.open=false}};
  }
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){const node=element(match[1]);const value=match[0].match(/\bvalue="([^"]*)"/);if(value)node.value=value[1];node.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[1],node);}
  const source=(await readFile(new URL('../public/canvas.js',import.meta.url),'utf8')).replace('export class InkPad','class InkPad')+'\n'+(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace("import { InkPad } from './canvas.js';",'');
  const events=[],calls=[],store=new Map(),intervals=[];
  class Events{constructor(url){this.url=url;events.push(this)}close(){}send(state){this.onmessage({data:JSON.stringify(state)})}}
  const document={hidden:false,body:{dataset:{page}},getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],addEventListener(){},createElement:()=>element(),documentElement:{requestFullscreen:async()=>{}}};
  const sandbox={document,EventSource:Events,URLSearchParams,history:{replaceState(){}},location:{search:'?room=ABCDEF',hash:'',origin:'http://localhost:4178'},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},navigator:{},console,setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{intervals.push(fn);return 1},Date,fetch:async(url,options)=>{calls.push({url,options});const result=await responses(url,options);return {ok:result.status<400,status:result.status,json:async()=>result.body}}};
  vm.runInNewContext(source,sandbox,{filename:`${page}-controller.js`});
  await new Promise(resolve=>setImmediate(resolve));
  return{nodes,events,calls,intervals,document,store,get:id=>nodes.get(id)};
}
const player={id:'p1',studentId:'0000123',name:'測試同學',score:0,submitted:false,status:'waiting',correct:null,imageUrl:null};
const state=()=>({code:'ABCDEF',title:'單字測試',mode:'practice',points:10,serverTime:Date.now(),players:[{...player}],round:null});

test('student enters a string student ID, writes, submits once, locks and receives a verdict without explanations',async()=>{
  let room=state();
  const f=await pageFixture('play',async(url,opts)=>{
    if(url==='/api/join'){const data=JSON.parse(opts.body);assert.equal(data.studentId,'0000123');return{status:201,body:{player:{...player},token:'test-token'}};}
    if(url==='/api/submit'){room.players[0].submitted=true;room.players[0].status='submitted';return{status:201,body:{ok:true}};}
    if(url.startsWith('/api/room'))return{status:200,body:room};
    throw new Error('Unexpected route '+url);
  });
  f.get('join-code').value='ABCDEF';f.get('join-student-id').value='0000123';
  await f.get('join-form').onsubmit({preventDefault(){}});assert.equal(f.get('writing-panel').hidden,false);f.events[0].send(room);
  room.round={id:'r1',number:1,prompt:'寫一個字',phase:'writing',deadline:Date.now()+30000,seconds:30,submitted:0};f.events[0].send(room);
  assert.equal(f.get('submit-button').disabled,false);assert.ok(f.get('player-identity').textContent.includes('0000123'));
  const canvas=f.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:30,clientY:30,preventDefault(){}});canvas.events.pointerup({pointerId:1});
  await f.get('submit-button').onclick();assert.equal(f.get('submit-button').disabled,true);assert.equal(f.get('canvas-lock').hidden,false);
  await f.get('submit-button').onclick();assert.equal(f.calls.filter(c=>c.url==='/api/submit').length,1);
  room.round.phase='revealed';room.players[0].status='done';room.players[0].correct=true;f.events[0].send(room);
  assert.equal(f.get('own-result').hidden,false);assert.ok(f.get('own-result').textContent.includes('✓'));assert.equal(f.get('play-practice').hidden,false);
});

test('teacher controller loads, hides auth form, displays string IDs and keeps correct answers out of candidate statuses',async()=>{
  const room=state();room.usage={input:0,output:0,calls:0};room.players[0].judgeStatus='waiting';
  const f=await pageFixture('teacher',async()=>({status:200,body:{settings:{configured:false,model:'gpt-4.1-mini',concurrency:3},addresses:['http://192.168.1.2:4178'],questions:[{prompt:'請寫一字',answer:'冶',seconds:30}],room}}));
  assert.equal(f.get('login-panel').hidden,true);assert.equal(f.get('teacher-app').hidden,false);assert.equal(f.get('answer').value,'冶');assert.ok(f.get('teacher-players').innerHTML.includes('0000123'));assert.ok(f.get('join-url').value.includes('/play?room=ABCDEF'));assert.equal(f.get('practice-banner').hidden,false);
});

test('screen controller conceals handwriting and verdicts while writing, then displays independent images and boolean results',async()=>{
  const f=await pageFixture('screen',async()=>{throw new Error('No fetch needed')});const room=state();
  room.round={id:'r1',number:1,prompt:'請寫一字',phase:'writing',deadline:Date.now()+30000,seconds:30,submitted:1};room.players[0].submitted=true;room.players[0].status='submitted';f.events[0].send(room);
  assert.ok(!f.get('screen-grid').innerHTML.includes('<img'));assert.ok(f.get('screen-grid').innerHTML.includes('答案保密'));
  room.round.phase='closed';room.players[0].imageUrl='/api/image/ABCDEF/r1/p1';f.events[0].send(room);
  assert.ok(f.get('screen-grid').innerHTML.includes('<img'));assert.ok(f.get('screen-grid').innerHTML.includes('等待揭曉'));
  room.round.phase='revealed';room.round.answer='冶';room.players[0].correct=false;room.players[0].status='done';f.events[0].send(room);
  assert.ok(f.get('screen-grid').innerHTML.includes('✗'));assert.ok(f.get('screen-grid').innerHTML.includes('0000123'));assert.ok(f.get('screen-subtitle').textContent.includes('冶'));
});
