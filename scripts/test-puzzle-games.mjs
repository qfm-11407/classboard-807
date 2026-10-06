import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createScoreFixture} from './game-score-test-fixture.mjs';
const rulesSource = fs.readFileSync(new URL('../games/puzzle-rules.js',import.meta.url),'utf8');
const context = vm.createContext({}); vm.runInContext(rulesSource,context); const R = context.ClassroomPuzzles;
for (const count of [6,8,12]) {
  const deck = R.memoryDeck(count);
  assert.equal(deck.length,count*2);
  for (let icon = 0; icon < count; icon++) assert.equal(deck.filter(value => value === icon).length,2);
}
const memory = {deck:[0,1,0,1],matched:new Set(),open:[],locked:false,turns:0};
assert.equal(R.memoryTurn(memory,0),'first');
assert.equal(R.memoryTurn(memory,0),'ignored');
assert.equal(R.memoryTurn(memory,1),'mismatch');
assert.equal(R.memoryTurn(memory,2),'ignored','A third tap cannot reveal a card during a mismatch');
memory.open=[];memory.locked=false;
assert.equal(R.memoryTurn(memory,0),'first');assert.equal(R.memoryTurn(memory,2),'match');
assert.equal(R.memoryTurn(memory,0),'ignored');
R.memoryTurn(memory,1);assert.equal(R.memoryTurn(memory,3),'complete');
for (const layout of R.lightLayouts) {
  const mirrors = Object.fromEntries(layout.mirrors);
  assert(R.traceLight(layout,mirrors).success,'Every light layout has a known solution');
  mirrors[layout.mirrors[0][0]] = mirrors[layout.mirrors[0][0]] === '/' ? '\\' : '/';
  assert(!R.traceLight(layout,mirrors).success,'The first wrong reflection misses the goal');
  assert(R.traceLight(layout,mirrors).points.length <= layout.n**2*4+1);
}
for (const n of [4,5,6]) for (let variant=0;variant<8;variant++) {
  const puzzle=R.flowPuzzle(n,variant),paths=puzzle.ends.map(()=>[]);
  assert.equal(new Set(puzzle.solution.flat()).size,n*n);
  puzzle.solution.forEach((solution,group)=>{
    paths[group]=[solution[0]];
    for(const index of solution.slice(1))assert(R.extendFlow(paths,puzzle.ends,group,index,n),'All generated solutions use legal adjacent steps');
  });
  assert(R.flowProgress(paths,puzzle.ends,n).success);
  paths[0]=[puzzle.ends[0][0]];
  assert(!R.flowProgress(paths,puzzle.ends,n).success,'Partial paths cannot finish a board');
}
const flowPaths=[[0,1,2],[]],flowEnds=[[0,3],[4,7]];
assert(!R.extendFlow(flowPaths,flowEnds,0,4,4),'Diagonal jumps are rejected');
flowPaths[1]=[4,5];assert(!R.extendFlow(flowPaths,flowEnds,0,5,4),'Other paths cannot be crossed');
assert(R.extendFlow(flowPaths,flowEnds,0,1,4));assert.equal(flowPaths[0].length,2,'Backtracking truncates the old route');
assert(!R.adjacent(3,4,4),'Row wrapping is never adjacent');
assert(R.flowProgress([[0,1,2,3],[4,5,6,7]],[[0,3],[4,7]],4).success,'All pairs finish even when empty cells remain');
assert(!R.flowProgress([[],[]],[[0,3],[4,7]],4).success);
for (let difficulty=1;difficulty<=3;difficulty++) for(const course of R.balanceCourses) {
  const ball={...course.start,vx:0,vy:0};
  R.balanceStep(ball,course,{x:1,y:0,brake:false},.5,difficulty);
  assert(ball.x>course.start.x,'Held direction moves the ball');
  const speed=Math.hypot(ball.vx,ball.vy);
  R.balanceStep(ball,course,{x:0,y:0,brake:true},.2,difficulty);
  assert(Math.hypot(ball.vx,ball.vy)<speed/2,'Braking rapidly slows the ball');
  Object.assign(ball,{...course.holes[0],vx:0,vy:0});
  assert.equal(R.balanceStep(ball,course,{x:0,y:0},.01,difficulty),'fall');
  assert.equal(ball.x,course.start.x);assert.equal(ball.vx,0);
  Object.assign(ball,{...course.goal,vx:0,vy:0});assert.equal(R.balanceStep(ball,course,{x:0,y:0},.01,difficulty),'goal');
  const wall=course.walls[0];Object.assign(ball,{x:wall.x-14,y:wall.y+wall.h/2,vx:100,vy:0});
  R.balanceStep(ball,course,{x:1,y:0},.1,difficulty);
  assert(ball.x<=wall.x-12,'Substeps prevent passing through a wall');
  // Find a continuous corridor that clears walls and holes for every course.
  const safe=(x,y)=>x>=12&&x<=788&&y>=12&&y<=468&&!course.walls.some(w=>x>w.x-14&&x<w.x+w.w+14&&y>w.y-14&&y<w.y+w.h+14)&&!course.holes.some(h=>Math.hypot(x-h.x,y-h.y)<22+difficulty*2);
  const start=[Math.round(course.start.x/10),Math.round(course.start.y/10)],queue=[start],seen=new Set([start.join(',')]);let found=false;
  for(let head=0;head<queue.length&&!found;head++){
    const [x,y]=queue[head];if(Math.hypot(x*10-course.goal.x,y*10-course.goal.y)<25){found=true;break;}
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const next=[x+dx,y+dy],key=next.join(',');if(!seen.has(key)&&safe(next[0]*10,next[1]*10)){seen.add(key);queue.push(next);}}
  }
  assert(found,'Every balance course has a safe route to the flag');
}

function element(tag='div') {
  const classes=new Set(),attributes=new Map();
  return {tag,dataset:{},children:[],listeners:{},style:{setProperty(){}},clientWidth:600,clientHeight:430,hidden:false,
    classList:{add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),toggle:(n,v)=>v?classes.add(n):classes.delete(n),contains:n=>classes.has(n)},
    setAttribute:(n,v)=>attributes.set(n,v),getAttribute:n=>attributes.get(n),append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    addEventListener(n,fn){this.listeners[n]=fn;},focus(){},setPointerCapture(){},releasePointerCapture(){},
    getBoundingClientRect(){return {left:0,top:0,width:400,height:400};},
    querySelector(){return {textContent:''};},
    querySelectorAll(selector){return this.children.filter(child=>selector==='.puzzle-board'&&child.className?.includes('puzzle-board'));},
  };
}
const engine=fs.readFileSync(new URL('../games/puzzle-games.js',import.meta.url),'utf8');
function createGame(id,difficulty=1){
  const elements=new Map(),docEvents={},events={},posts=[],scores=createScoreFixture(),inputs=[1,2,3].map(value=>({...element('input'),value:String(value)}));
  const get=id=>{if(!elements.has(id)){const item=element();item.parentElement=element();elements.set(id,item);}return elements.get(id);},back=element('a'),parent={postMessage:(data,origin)=>posts.push({data,origin})};
  let now=0;
  const document={getElementById:get,createElement:element,createElementNS:(_,tag)=>element(tag),body:Object.assign(element(),{dataset:{game:id}}),hidden:false,fullscreenEnabled:false,
    querySelector:selector=>selector==='.back-link'?back:inputs[difficulty-1],querySelectorAll:()=>inputs,addEventListener:(n,fn)=>{docEvents[n]=fn;}};
  const ctx=vm.createContext({document,URLSearchParams,performance:{now:()=>now},requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},Math:Object.assign(Object.create(Math),{random:()=>.7})});
  ctx.window={ClassroomGameScores:scores,parent,location:{search:'?embedded=1',origin:'https://example.test',protocol:'https:'},addEventListener:(n,fn)=>{events[n]=fn;}};
  vm.runInContext(rulesSource,ctx);ctx.window.ClassroomPuzzles=ctx.ClassroomPuzzles;
  vm.runInContext(engine.replace(/\}\)\(\);\s*$/,'globalThis.api={start,pause,resume,advance,finish,beginFlow,moveFlow,control,snapshot:()=>({state,elapsed,round,errors,level,memory,spot,light,flow,ball,tilt})};\n})();'),ctx);
  return {api:ctx.api,get,back,docEvents,events,parent,posts,scores,document,inputs,advance(seconds){now+=seconds*1000;ctx.api.advance(now);}};
}
const tap=button=>button.listeners.pointerdown({button:0,preventDefault(){},stopPropagation(){}});
for(const id of ['spot-difference','memory-match','balance-ball','light-maze','bubble-connect'])for(const difficulty of [1,2,3]){
  const g=createGame(id,difficulty),{api}=g;api.start();
  assert.equal(api.snapshot().state,'running');assert.equal(g.back.textContent,'← 互動區');
  if(id==='balance-ball'){
    const startX=api.snapshot().ball.x;
    g.docEvents.keydown({key:'ArrowRight',preventDefault(){}});g.advance(.1);
    assert(api.snapshot().ball.x>startX,'Keyboard controls drive the live physics');g.docEvents.keyup({key:'ArrowRight'});
    const pad=g.get('play-area').children[1],right=pad.children.at(-1),before=api.snapshot().ball.x;
    right.listeners.pointerdown({button:0,pointerId:7,preventDefault(){}});g.advance(.1);right.listeners.pointerup({pointerId:7});
    assert(api.snapshot().ball.x>before,'Held touch controls drive the live physics');
    const arena=g.get('play-area').children[0];
    arena.listeners.pointerdown({button:0,pointerId:11,clientX:100,clientY:100,preventDefault(){}});
    arena.listeners.pointermove({pointerId:12,clientX:0,clientY:100,preventDefault(){}});
    assert.equal(api.control().x,0,'A second finger cannot take over platform steering');
    arena.listeners.pointermove({pointerId:11,clientX:160,clientY:80,preventDefault(){}});
    assert(api.control().x>0 && api.control().y<0,'Dragging on the platform steers diagonally');
    const touchX=api.snapshot().ball.x;g.advance(.1);assert(api.snapshot().ball.x>touchX);
    arena.listeners.pointerup({pointerId:11});assert.equal(api.snapshot().tilt,null);assert(api.control().brake,'Lifting the finger brakes');
    arena.listeners.pointerdown({button:0,pointerId:13,clientX:100,clientY:100,preventDefault(){}});
    api.pause();assert.equal(api.snapshot().tilt,null,'Pausing clears platform input');api.resume();
  }
  g.advance(.1);api.pause();const elapsed=api.snapshot().elapsed;g.advance(50);assert.equal(api.snapshot().elapsed,elapsed,'Pause freezes time');
  g.events.message({source:g.parent,origin:'https://other.test',data:{type:'classroom-game-pause'}});api.resume();assert.equal(api.snapshot().state,'running');
  g.events.message({source:{},origin:'https://example.test',data:{type:'classroom-game-pause'}});assert.equal(api.snapshot().state,'running');
  g.events.message({source:g.parent,origin:'https://example.test',data:{type:'classroom-game-pause'}});assert.equal(api.snapshot().state,'paused');api.resume();
  if(id==='memory-match'){
    const m=api.snapshot().memory,a=0,b=m.deck.findIndex(value=>value!==m.deck[a]);tap(m.buttons[a]);tap(m.buttons[b]);assert(m.locked);api.pause();g.advance(2);assert(m.locked);api.resume();g.advance(.9);assert(!m.locked);
    for(const value of new Set(m.deck)){const pair=m.deck.map((v,i)=>v===value?i:-1).filter(i=>i>=0);tap(m.buttons[pair[0]]);tap(m.buttons[pair[1]]);}
  }else if(id==='spot-difference'){
    const first=api.snapshot().spot;tap(first.buttons[(first.odd+1)%(first.n**2)]);assert.equal(api.snapshot().errors,1);
    for(let round=0;round<10;round++){const s=api.snapshot().spot;tap(s.buttons[s.odd]);}
  }else{
    for(let round=0;round<3;round++){
      if(id==='light-maze'){
        const l=api.snapshot().light;for(const [index,orientation]of l.layout.mirrors)if(l.mirrors[index]!==orientation)tap(l.buttons[index]);
      }else if(id==='bubble-connect'){
        const f=api.snapshot().flow;
        for(const path of f.solution)for(const index of path){
          const event={button:0,pointerId:1,clientX:(index%f.n+.5)*400/f.n,clientY:(Math.floor(index/f.n)+.5)*400/f.n,preventDefault(){}};
          f.board.listeners.pointerdown(event);f.board.listeners.pointerup(event);
        }
      }else{
        const ball=api.snapshot().ball;Object.assign(ball,R.balanceCourses[round].goal,{vx:0,vy:0});g.advance(.02);
      }
      assert.equal(api.snapshot().state,round===2?'finished':'between');
      if(round<2){assert(g.get('play-area').hidden,'Level completion hides the board behind the controls');g.get('start').listeners.click();assert.equal(g.get('play-area').hidden,false);assert(g.get('overlay').hidden);}
    }
  }
  assert.equal(api.snapshot().state,'finished',`${id} can complete at difficulty ${difficulty}`);
  assert.equal(g.scores.completed.length,1);assert(g.scores.completed[0].score>=0);
  assert.equal(g.get('play-area').inert,true);api.finish(true);assert.equal(g.scores.completed.length,1,'A result is recorded once');
  g.get('start').listeners.click();assert.equal(api.snapshot().state,'running','Replay starts a fresh round');assert.equal(api.snapshot().round,0);
  g.back.listeners.click({preventDefault(){}});assert.equal(api.snapshot().state,'paused');assert.equal(g.posts.at(-1).data.type,'classroom-interaction-back');
}
const timed=createGame('spot-difference');timed.api.start();timed.advance(61);assert.equal(timed.api.snapshot().state,'finished');assert.equal(timed.api.snapshot().elapsed,60);assert.equal(timed.scores.completed.length,1);
for(const difficulty of [1,2,3]){
  const lives=createGame('spot-difference',difficulty);lives.api.start();
  assert(lives.get('details').innerHTML.includes('剩餘 3 顆生命'));
  for(let mistake=1;mistake<=3;mistake++){
    const s=lives.api.snapshot().spot;tap(s.buttons[(s.odd+1)%(s.n**2)]);
    assert.equal(lives.api.snapshot().errors,mistake);assert.equal(lives.api.snapshot().state,mistake===3?'finished':'running');
    assert(lives.get('details').innerHTML.includes(`剩餘 ${3-mistake} 顆生命`));
  }
  assert.equal(lives.get('dialog-title').textContent,'生命用完！');
  const result=lives.api.snapshot().spot;tap(result.buttons[result.odd]);assert.equal(lives.api.snapshot().round,0,'No answer after losing all lives');assert.equal(lives.scores.completed.length,1);
  lives.get('start').listeners.click();assert(lives.get('details').innerHTML.includes('剩餘 3 顆生命'),'Replay restores all three hearts');
}
const stale=createGame('spot-difference');stale.api.start();const oldQuestion=stale.api.snapshot().spot;tap(oldQuestion.buttons[oldQuestion.odd]);tap(oldQuestion.buttons[oldQuestion.odd]);assert.equal(stale.api.snapshot().round,1,'Queued input from an old question cannot score twice');
const shortFlow=createGame('bubble-connect');shortFlow.api.start();
const f=shortFlow.api.snapshot().flow,shortPaths=f.solution.map((path,i)=>i===1?[path[0],path.at(-1)]:path);
assert(R.adjacent(shortPaths[1][0],shortPaths[1][1],f.n));
for(const path of shortPaths)for(const index of path){const event={button:0,pointerId:1,clientX:(index%f.n+.5)*400/f.n,clientY:(Math.floor(index/f.n)+.5)*400/f.n,preventDefault(){}};f.board.listeners.pointerdown(event);f.board.listeners.pointerup(event);}
assert.equal(shortFlow.api.snapshot().state,'between','All pairs pass through the actual touch handlers without filling the grid');assert(R.flowProgress(f.paths,f.ends,f.n).filled<f.n*f.n);
const perfectMemory=createGame('memory-match'),wrongMemory=createGame('memory-match');
for(const g of [perfectMemory,wrongMemory]){
  g.api.start();const m=g.api.snapshot().memory;
  if(g===wrongMemory){tap(m.buttons[0]);tap(m.buttons[m.deck.findIndex(v=>v!==m.deck[0])]);g.advance(.9);}
  for(const value of new Set(m.deck)){const pair=m.deck.map((v,i)=>v===value?i:-1).filter(i=>i>=0);tap(m.buttons[pair[0]]);tap(m.buttons[pair[1]]);}
}
assert.equal(perfectMemory.scores.completed[0].score,1000);assert.equal(wrongMemory.scores.completed[0].score,953,'One mismatch deducts 45 points plus elapsed time');
console.log('Puzzle games tests: passed (15 completions; three lives and stale input; memory scoring; direct touch steering/release/pause; hidden boards during level transitions; complete flow pairs with empty cells; 24 solvable layouts; pause, navigation and physics).');
