import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const service = fs.readFileSync(new URL('../games/game-rankings.js',import.meta.url),'utf8');
const adapter = fs.readFileSync(new URL('../games/game-rankings-cloud.js',import.meta.url),'utf8');
const tick = async () => { for(let i=0;i<200;i++) await Promise.resolve(); };
const data = new Map(), subscriptions = new Set();
let fail = false, writes = 0, today = Date.parse('2026-10-04T03:00:00Z');
function publish() {
  for(const sub of subscriptions) {
    const prefix = sub.query.path + '/';
    const docs = [...data].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .sort((a,b) => b[1].score-a[1].score || a[0].localeCompare(b[0])).slice(0,sub.query.max)
      .map(([path,row])=>({id:path.split('/').at(-1),data:()=>row}));
    sub.callback({docs,metadata:{fromCache:false}});
  }
}
function ref(path) {
  return {path, collection:name=>ref(`${path}/${name}`), doc:name=>ref(`${path}/${name}`),
    orderBy(field,direction) { assert.equal(field,'score');assert.equal(direction,'desc');return this; },
    limit(max) { assert.equal(max,10);this.max=max;return this; },
    onSnapshot(options,callback,error) { assert.equal(options.includeMetadataChanges,true);const sub={query:this,callback,error};subscriptions.add(sub);publish();return ()=>subscriptions.delete(sub); },
  };
}
const db = {
  collection:ref,
  async runTransaction(fn) {
    if(fail)throw Error('offline');
    const staged=[];
    await fn({get:async ref=>({exists:data.has(ref.path),data:()=>data.get(ref.path)}),set:(ref,row)=>staged.push([ref.path,row])});
    for(const [path,row] of staged) { data.set(path,{...row,createdAt:row.createdAt==='SERVER_TIMESTAMP' ? today : row.createdAt});writes++; }
    publish();
  },
};
function setup(saved=new Map()) {
  class Clock extends Date { static now(){return today;} }
  const events={},timers=[];
  function element() {
    const selectors=new Map();
    return {children:[],handlers:{},open:false,textContent:'',append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){},
      querySelector(selector){if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector);},addEventListener(event,fn){this.handlers[event]=fn;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();},focus(){},
    };
  }
  const firebase={apps:[], initializeApp(config,name){assert.equal(config.projectId,'colabprogram-c8014');assert.equal(name,'classroom-game-rankings');const app={name};this.apps.push(app);return app;},firestore:()=>db};
  firebase.firestore.FieldValue={serverTimestamp:()=> 'SERVER_TIMESTAMP'};
  const shell=element(),window={firebase,addEventListener:(name,fn)=>{events[name]=fn;}};
  const context=vm.createContext({window,firebase,Date:Clock,Intl,setInterval:fn=>timers.push(fn),
    localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},
    document:{body:shell,getElementById:()=>shell,addEventListener:(name,fn)=>{events[name]=fn;},createElement:element},
  });
  vm.runInContext(adapter,context);vm.runInContext(service,context);
  return {api:window.ClassroomGameScores,cloud:window.ClassroomGameCloud,saved,events,timers,element};
}

const a=setup(),b=setup();
assert.equal(a.api.dailyBest('mole-pop',30),null);
assert.equal(b.api.dailyBest('mole-pop',30),null);
a.api.record('mole-pop',30,7);await tick();
assert.equal(b.api.dailyBest('mole-pop',30),7,'A second device receives scores without teacher sign-in');
assert.equal(data.size,2,'One round atomically writes history and its daily copy');
assert.equal(JSON.parse(a.saved.get('classroom-game-ranking-pending-v1')).length,0);
for(let score=8;score<20;score++) {a.api.record('mole-pop',30,score);await tick();}
assert.equal(b.api.read('mole-pop',30).top.length,10);
assert.equal(b.api.dailyBest('mole-pop',30),19);
assert.equal(b.api.dailyBest('mole-pop',60),null);
assert.equal(b.api.dailyBest('moving-dot',30),null);
today=Date.parse('2026-10-04T16:00:00Z');
assert.equal(b.api.dailyBest('mole-pop',30),null,'Cloud today query switches at Taipei midnight');
assert.equal(b.api.read('mole-pop',30).top[0].score,19);
a.api.record('mole-pop',30,-2);await tick();
assert.equal(b.api.dailyBest('mole-pop',30),-2,'Today remains independent of higher historical scores');

fail=true;a.api.record('moving-dot',60,13);await tick();
assert.equal(a.api.dailyBest('moving-dot',60),13,'Offline score remains visible');
assert.equal(JSON.parse(a.saved.get('classroom-game-ranking-pending-v1')).length,1,'Failed upload remains durable');
const backup=setup(a.saved);assert.equal(backup.api.dailyBest('moving-dot',60),13);await tick();
const trigger=backup.element();const dialog=backup.api.attach({trigger,game:'moving-dot',mode:()=>60,title:'追光點點',modeLabel:()=> '60 秒'});
trigger.handlers.click();assert.match(dialog.querySelector('.game-rank-note').textContent,/暫無法同步/);
fail=false;backup.events.online();await tick();
assert.equal(b.api.dailyBest('moving-dot',60),13);
assert.match(dialog.querySelector('.game-rank-note').textContent,/雲端已同步/);
const size=data.size;a.events.online();await tick();assert.equal(data.size,size,'Two tabs retrying the same score do not duplicate a round');

b.api.dailyBest('tic-tac-toe','wins');
a.api.increment('tic-tac-toe','wins','0:O','第 1 桌 · O');await tick();
a.api.increment('tic-tac-toe','wins','0:O','第 1 桌 · O');await tick();
assert.equal(b.api.dailyBest('tic-tac-toe','wins'),2);
assert.equal(b.api.read('tic-tac-toe','wins').top.length,1,'Daily wins upsert one row per device/table/side');
b.api.increment('tic-tac-toe','wins','0:O','第 1 桌 · O');await tick();
assert.equal(a.api.read('tic-tac-toe','wins').top.length,2,'Different devices retain independent players');
assert.equal(b.api.dailyBest('tic-tac-toe','wins'),2);
// Two fast wins while a write is outstanding must retain the newer value.
a.api.increment('tic-tac-toe','wins','1:X','第 2 桌 · X');
a.api.increment('tic-tac-toe','wins','1:X','第 2 桌 · X');await tick();
assert.equal(b.api.read('tic-tac-toe','wins').top.filter(row=>row.label==='第 2 桌 · X')[0].score,2);

const legacy=new Map();
legacy.set('classroom-game-ranking-v1:tic-tac-toe:wins',JSON.stringify({top:[{id:'2026-10-04:2:O',date:'2026-10-04',time:Date.parse('2026-10-04T02:00:00Z'),score:5,label:'第 3 桌 · O'}]}));
const old=setup(legacy);old.api.dailyBest('tic-tac-toe','wins');await tick();
assert(data.size>size);assert([...data.values()].some(row=>row.participant==='2:O'&&row.score===5),'Older dated OX records acquire participant metadata without changing their date');

// Multiple iframe services share one storage queue without losing offline rounds.
fail=true;const shared=new Map(),frame1=setup(shared),frame2=setup(shared);
frame1.api.record('mole-pop',90,4);frame2.api.record('moving-dot',90,6);await tick();
assert.equal(JSON.parse(shared.get('classroom-game-ranking-pending-v1')).length,2);
fail=false;frame1.events.online();frame2.events.online();await tick();
assert.equal(JSON.parse(shared.get('classroom-game-ranking-pending-v1')).length,0);
assert.equal(b.api.dailyBest('moving-dot',90),6);
assert.equal(b.api.dailyBest('mole-pop',90),4);

const puzzleGames=['spot-difference','memory-match','balance-ball','light-maze','bubble-connect'];
for(const [index,game] of puzzleGames.entries()) {
  assert.equal(b.api.dailyBest(game,1),null);
  a.api.record(game,1,800+index);await tick();
  assert.equal(b.api.dailyBest(game,'1'),800+index,'New game scores reach a second device');
  assert.equal(b.api.dailyBest(game,2),null,'Difficulty rankings stay isolated');
  a.api.record(game,2,600+index);await tick();
  assert.equal(b.api.dailyBest(game,2),600+index);
  assert.equal(b.api.dailyBest(game,1),800+index);
  for(let score=0;score<12;score++){a.api.record(game,3,score);await tick();}
  assert.equal(b.api.read(game,3).top.length,10,'Every new game limits the shared ranking to ten');
  assert.equal(b.api.dailyBest(game,3),11);
}
fail=true;const puzzlesOffline=new Map(),offlinePuzzles=setup(puzzlesOffline);
for(const game of puzzleGames)offlinePuzzles.api.record(game,3,950);
offlinePuzzles.api.record('mole-pop',60,30);await tick();
assert.equal(JSON.parse(puzzlesOffline.get('classroom-game-ranking-pending-v1')).length,6,'Old and new game queues coexist');
const reloadedPuzzles=setup(puzzlesOffline);
for(const game of puzzleGames)assert.equal(reloadedPuzzles.api.dailyBest(game,3),950,'New puzzle scores survive an offline reload');
await tick();fail=false;reloadedPuzzles.events.online();await tick();
assert.equal(JSON.parse(puzzlesOffline.get('classroom-game-ranking-pending-v1')).length,0);
for(const game of puzzleGames)assert.equal(b.api.dailyBest(game,3),950,'Offline puzzle scores sync after reconnect');
const puzzleSize=data.size;offlinePuzzles.events.online();await tick();assert.equal(data.size,puzzleSize,'Concurrent retries keep new puzzle scores unique');
const oldPuzzles=new Map(),datedScore={id:'old-puzzle-result',date:'2026-10-03',time:Date.parse('2026-10-03T02:00:00Z'),score:999,label:''};
oldPuzzles.set('classroom-game-ranking-v1:light-maze:2',JSON.stringify({top:[datedScore],today:[]}));
const puzzleMigration=setup(oldPuzzles);puzzleMigration.api.dailyBest('light-maze',2);await tick();
assert(b.api.read('light-maze',2).top.some(row=>row.score===999&&row.date==='2026-10-03'),'Existing dated puzzle scores migrate with their original date');
const migrationSize=data.size;const migrationReload=setup(oldPuzzles);migrationReload.api.dailyBest('light-maze',2);await tick();assert.equal(data.size,migrationSize,'Puzzle migration occurs once');
for(const [path,row] of data)if(puzzleGames.some(game=>path.includes(`/gameRankings/${game}-`))){
  assert(Number.isInteger(row.score)&&row.score>=0&&row.score<=1000);assert.equal(row.participant,'','Puzzle scores use no OX participant metadata');
}

for(const game of ['mole-pop','moving-dot','tic-tac-toe',...puzzleGames]) {
  const html=fs.readFileSync(new URL(`../games/${game}.html`,import.meta.url),'utf8');
  assert(html.indexOf('firebase-app-compat.js')<html.indexOf('firebase-firestore-compat.js'));
  assert(html.indexOf('firebase-firestore-compat.js')<html.indexOf('src="game-rankings-cloud.js'));
  assert(html.indexOf('src="game-rankings-cloud.js')<html.indexOf('src="game-rankings.js'));
  assert(!html.includes('firebase-auth-compat.js'),'Fun rankings never require or alter teacher login');
  assert(html.includes('game-rankings.js?v=cloud-3'),'Every game shares the extended queue allowlist');
}
const rules=fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
assert.match(rules,/match \/gameRankings\/\{bucket\}/);
assert.match(rules,/allow update: if increasedWins\(scoreId\)/);
assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['score'\]\)/);
assert.match(rules,/data\.score is int && data\.score >= -10000 && data\.score <= 100000/);
assert.match(rules,/allow update: if isTeacher\(\)\s*&& request\.resource\.data\.syncVersion == 2/,'Existing classroom protection stays in place');
const puzzlePattern=rules.match(/function puzzleBucket\(\)\s*\{\s*return bucket\.matches\('([^']+)'\)/)?.[1];assert(puzzlePattern);
const puzzleRule=new RegExp(puzzlePattern);
for(const game of puzzleGames)for(const mode of [1,2,3])assert(puzzleRule.test(`${game}-${mode}`));
for(const bucket of ['light-maze-30','light-maze-4','memory-match-0','other-1','xspot-difference-1','balance-ball-1-suffix'])assert(!puzzleRule.test(bucket),'Rules reject unapproved games and modes');
assert.match(rules,/\(!puzzleBucket\(\) \|\| \(data\.score >= 0 && data\.score <= 1000\)\)/,'New score writes are bounded to actual puzzle results');
console.log(`Cloud game ranking tests: passed (${writes} writes; eight games, 15 puzzle modes, cross-device top ten, offline/reload/retry, local puzzle migration, shared old/new queue, idempotency, Taipei rollover, OX wins, SDK order and scoped rule guards).`);
