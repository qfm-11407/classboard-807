import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../games/game-rankings.js',import.meta.url),'utf8');
function setup(saved = new Map()) {
  let now = Date.parse('2026-10-03T15:59:00Z'), denyRead = false, denyWrite = false;
  class Clock extends Date { static now() { return now; } }
  const events = {}, docEvents = {}, timers = [], dialogs = [];
  function element() {
    const selectors = new Map();
    return { children:[], handlers:{}, attributes:{}, open:false, textContent:'',
      append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children=[...nodes]; },
      setAttribute(key,value) { this.attributes[key]=value; },
      querySelector(key) { if(!selectors.has(key))selectors.set(key,element());return selectors.get(key); },
      addEventListener(key,fn) { this.handlers[key]=fn; },
      showModal() { this.open=true; }, close() { this.open=false;this.handlers.close?.(); }, focus(options) { this.focused=options.preventScroll; },
    };
  }
  const shell = element();
  const window = { addEventListener:(name,fn)=>{events[name]=fn;} };
  vm.runInNewContext(source, { window, Date:Clock, Intl, setInterval:fn=>{timers.push(fn);},
    document:{ getElementById:()=>shell, body:shell, addEventListener:(name,fn)=>{docEvents[name]=fn;}, createElement(tag) { const el=element(); if(tag==='dialog')dialogs.push(el);return el; } },
    localStorage:{ getItem(key) { if(denyRead)throw Error('blocked');return saved.get(key)??null; }, setItem(key,value) { if(denyWrite)throw Error('blocked');saved.set(key,value); } },
  });
  return { api:window.ClassroomGameScores, saved, events, docEvents, timers, dialogs, element,
    at:date=>{now=Date.parse(date);}, deny:(read,write)=>{denyRead=read;denyWrite=write;},
  };
}
const env=setup(), {api}=env;
assert.equal(api.day(),'2026-10-03');
assert.equal(api.day(Date.parse('2026-10-03T16:00:00Z')),'2026-10-04','Midnight follows Taiwan, not the host timezone');
assert.equal(api.dailyBest('mole-pop',60),null);
api.record('mole-pop',60,-5);api.record('mole-pop',60,-2);api.record('mole-pop',60,-7);
assert.equal(api.dailyBest('mole-pop',60),-2,'Negative best scores must not become zero');
for(let score=0;score<12;score++) api.record('mole-pop',60,score);
assert.deepEqual(JSON.parse(JSON.stringify(api.read('mole-pop',60).top.map(row=>row.score))),[11,10,9,8,7,6,5,4,3,2]);
assert.equal(api.read('mole-pop',60).today.length,10);
assert.equal(api.dailyBest('mole-pop',30),null);assert.equal(api.dailyBest('moving-dot',60),null);
api.record('moving-dot',60,4); assert.equal(api.dailyBest('moving-dot',60),4);
env.at('2026-10-03T16:00:00Z');
assert.equal(api.dailyBest('mole-pop',60),null,'The new day has no completed score');
assert.equal(api.read('mole-pop',60).top[0].score,11,'Yesterday’s leaderboard remains');
api.record('mole-pop',60,1); assert.equal(api.dailyBest('mole-pop',60),1,'Today best may be lower than the all-time top ten');
assert.equal(api.read('mole-pop',60).top[0].date,'2026-10-03');
api.record('mole-pop',60,11);
const ties=api.read('mole-pop',60).top.filter(row=>row.score===11);
assert.equal(ties[0].date,'2026-10-03');assert.equal(ties[1].date,'2026-10-04','Equal scores keep separate dated rounds');
assert.equal(api.record('mole-pop',60,NaN),false);assert.equal(api.record('mole-pop',60,Infinity),false);

api.increment('tic-tac-toe','wins','0:O','第 1 桌 · O');
api.increment('tic-tac-toe','wins','0:O','第 1 桌 · O');
api.increment('tic-tac-toe','wins','1:X','第 2 桌 · X');
assert.equal(api.dailyBest('tic-tac-toe','wins'),2);
assert.equal(api.read('tic-tac-toe','wins').top.length,2,'Daily wins update one record per table/player');
env.at('2026-10-04T16:00:00Z');
assert.equal(api.increment('tic-tac-toe','wins','0:O','第 1 桌 · O'),1,'Each new day resets the cumulative wins');
assert.equal(api.read('tic-tac-toe','wins').top.length,3);

let mode=60, paused=0, updates=0;
const trigger=env.element();
const dialog=api.attach({trigger,game:'mole-pop',mode:()=>mode,title:'地鼠出沒',modeLabel:()=>`${mode} 秒`,beforeOpen:()=>paused++,onChange:()=>updates++});
trigger.handlers.click();
assert.equal(paused,1);assert.equal(dialog.open,true);
const list=dialog.querySelector('.game-rank-list');
assert.equal(list.children.length,10);
assert.equal(list.children[0].children[1].children[0].textContent,'11 分');
assert.equal(list.children[0].children[1].children[1].textContent,'（2026/10/03）');
dialog.querySelector('.game-rank-close').handlers.click();assert.equal(dialog.open,false);assert.equal(trigger.focused,true);
mode=30;trigger.handlers.click();assert.equal(list.children.length,1);assert.match(list.children[0].textContent,/尚無成績/);
api.record('mole-pop',30,3);assert.equal(list.children[0].children[1].children[0].textContent,'3 分','An open ranking refreshes after a new result');
const before=updates;env.timers[0]();assert(updates>before,'Midnight refresh changes only score UI, not navigation');
env.events.storage({key:'classroom-game-ranking-v1:mole-pop:30'});env.docEvents.visibilitychange();

const reload=setup(env.saved);reload.at('2026-10-04T16:00:00Z');
assert.equal(reload.api.dailyBest('mole-pop',30),3,'Completed records survive reopening');
env.saved.set('classroom-game-ranking-v1:broken:60','not json');assert.equal(api.dailyBest('broken',60),null);
env.saved.set('classroom-game-ranking-v1:invalid:60',JSON.stringify({top:[null, {score:'10'}, {score:20,id:'bad',date:'no date',time:5}],today:[]}));
assert.equal(api.read('invalid',60).top.length,0);
env.saved.set('classroom-mole-pop-best-v3','{"60":500}');assert.equal(api.dailyBest('legacy',60),null,'Undated previous records are never assigned a fabricated date');

const blocked=setup();blocked.deny(true,true);blocked.api.record('mole-pop',60,-3);assert.equal(blocked.api.dailyBest('mole-pop',60),-3);
const writeBlocked=setup();writeBlocked.deny(false,true);writeBlocked.api.record('moving-dot',30,5);assert.equal(writeBlocked.api.dailyBest('moving-dot',30),5,'Readable but unwritable storage falls back to memory');
for(const game of ['mole-pop','moving-dot','tic-tac-toe']) {
  const html=fs.readFileSync(new URL(`../games/${game}.html`,import.meta.url),'utf8');
  assert(html.indexOf('src="game-rankings.js')<html.indexOf(`src="${game}.js`),'The shared score service loads first');
  assert.match(html,/今日最佳/);assert.match(html,/id="open-score-rank"/);
}
console.log('Game ranking tests: passed (Taiwan day rollover, signed scores, top ten, modes/games isolated, tied scores, OX daily upserts, dialog/focus/pause, persistence, invalid data, storage failures, legacy dates).');
