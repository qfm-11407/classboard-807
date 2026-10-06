import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createScoreFixture } from './game-score-test-fixture.mjs';

const board = fs.readFileSync(new URL('../board.html',import.meta.url),'utf8');
function extract(source,name) {
  const start=source.indexOf(`function ${name}(`),brace=source.indexOf('{',start);
  assert(start>=0 && brace>start);
  let depth=0;
  for(let index=brace;index<source.length;index++) {
    if(source[index]==='{')depth++;
    if(source[index]==='}' && --depth===0)return source.slice(start,index+1);
  }
  throw Error(`Unclosed function ${name}`);
}
function element() {
  const classes=new Set(['hidden']),listeners={};
  return {dataset:{},style:{setProperty(){}},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},
    addEventListener:(name,handler)=>{listeners[name]=handler;},listeners,
    getAttribute(name){return this[name]||null;},focus(){},replaceChildren(){},append(){},clientWidth:1400,clientHeight:600};
}
const elements=new Map(),posts=[];
const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
const frame=get('chase-light-frame');frame.dataset.src='games/moving-dot.html?embedded=1';
frame.contentWindow={postMessage:(data,origin)=>posts.push({data,origin})};
const moleFrame=get('mole-pop-frame');moleFrame.dataset.src='games/mole-pop.html?embedded=1';
moleFrame.contentWindow={postMessage:(data,origin)=>posts.push({data,origin,frame:'mole-pop'})};
const oxFrame=get('tic-tac-toe-frame');oxFrame.dataset.src='games/tic-tac-toe.html?embedded=1';
oxFrame.contentWindow={postMessage:(data,origin)=>posts.push({data,origin,frame:'tic-tac-toe'})};
const newGames=['spot-difference','memory-match','balance-ball','light-maze','bubble-connect'];
for(const id of newGames){const f=get(`${id}-frame`);f.dataset.src=`games/${id}.html?embedded=1`;f.contentWindow={postMessage:(data,origin)=>posts.push({data,origin,frame:id})};}
const panels=['interaction','messages','chase-light','mole-pop','tic-tac-toe',...newGames].map(type=>get(`app-content-${type}`));
const context={document:{getElementById:get,querySelectorAll:()=>panels},window:{location:{origin:'https://example.test',protocol:'https:'}},
  setTimeout:callback=>callback(),stopExamTracker(){},updateWidgetTasks(){},returnToCourseFolders(){}};
const api=vm.runInNewContext(`let currentActiveApp=null;${['pauseInteractionGame','handleInteractionMessage','openApp','closeApp'].map(name=>extract(board,name)).join('\n')}\n({openApp,closeApp,handleInteractionMessage,active:()=>currentActiveApp})`,context);
api.openApp('interaction');assert.equal(api.active(),'interaction');assert(!panels[0].classList.contains('hidden'));
api.openApp('messages');api.closeApp();assert.equal(api.active(),'interaction','Closing sticky messages returns to the hub');
api.openApp('chase-light');assert.equal(frame.src,frame.dataset.src);
api.closeApp();assert.equal(api.active(),'interaction');assert.equal(posts.at(-1).data.type,'classroom-game-pause');
assert.equal(posts.at(-1).origin,'https://example.test');
api.openApp('chase-light');
api.handleInteractionMessage({source:frame.contentWindow,origin:'https://other.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'chase-light','Reject cross-origin messages');
api.handleInteractionMessage({source:{},origin:'https://example.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'chase-light','Reject messages from unrelated frames');
api.handleInteractionMessage({source:frame.contentWindow,origin:'https://example.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'interaction');api.closeApp();assert.equal(api.active(),null,'Closing the hub returns to home');
api.openApp('mole-pop');assert.equal(moleFrame.src,moleFrame.dataset.src,'Lazy-load the mole game');
assert(!panels[3].classList.contains('hidden'));
api.handleInteractionMessage({source:frame.contentWindow,origin:'https://example.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'mole-pop','Another game cannot navigate the active game');
api.handleInteractionMessage({source:moleFrame.contentWindow,origin:'https://other.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'mole-pop');
api.handleInteractionMessage({source:moleFrame.contentWindow,origin:'https://example.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'interaction');assert.equal(posts.at(-1).frame,'mole-pop');
api.openApp('mole-pop');api.closeApp();assert.equal(api.active(),'interaction','Closing the mole game returns to the hub');
assert.equal(posts.at(-1).data.type,'classroom-game-pause');

api.openApp('tic-tac-toe');assert.equal(oxFrame.src,oxFrame.dataset.src,'Lazy-load four OX tables');
assert(!panels[4].classList.contains('hidden'));
api.handleInteractionMessage({source:moleFrame.contentWindow,origin:'https://example.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'tic-tac-toe','Other games cannot navigate the OX tables');
api.handleInteractionMessage({source:oxFrame.contentWindow,origin:'https://other.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'tic-tac-toe');
api.handleInteractionMessage({source:oxFrame.contentWindow,origin:'https://example.test',data:{type:'classroom-interaction-back'}});
assert.equal(api.active(),'interaction');
api.openApp('tic-tac-toe');api.closeApp();assert.equal(api.active(),'interaction');
assert.equal(oxFrame.src,oxFrame.dataset.src,'Returning to a game preserves its loaded document');
for(const id of newGames){
  const f=get(`${id}-frame`);api.openApp(id);assert.equal(f.src,f.dataset.src,'New games lazy-load');assert.equal(api.active(),id);
  api.handleInteractionMessage({source:frame.contentWindow,origin:'https://example.test',data:{type:'classroom-interaction-back'}});assert.equal(api.active(),id);
  api.handleInteractionMessage({source:f.contentWindow,origin:'https://other.test',data:{type:'classroom-interaction-back'}});assert.equal(api.active(),id);
  api.handleInteractionMessage({source:f.contentWindow,origin:'https://example.test',data:{type:'classroom-interaction-back'}});assert.equal(api.active(),'interaction');
  assert(posts.some(post=>post.frame===id&&post.data.type==='classroom-game-pause'));
  api.openApp(id);api.closeApp();assert.equal(api.active(),'interaction');
}
const hubMarkup=board.slice(board.indexOf('id="app-content-interaction"'),board.indexOf('id="app-content-messages"'));
assert(hubMarkup.includes('grid-cols-3'));
assert.equal((hubMarkup.match(/onclick="openApp\('/g)||[]).length,9,'The hub has exactly nine cards');

const gameSource=fs.readFileSync(new URL('../games/moving-dot.js',import.meta.url),'utf8');
const gameElements=new Map(),events={},parentPosts=[];
const gameGet=id=>{if(!gameElements.has(id))gameElements.set(id,element());return gameElements.get(id);};
const back=element(),parent={postMessage:data=>parentPosts.push(data)};
let now=0;
const dotScoreService=createScoreFixture();
const gameWindow={ClassroomGameScores:dotScoreService,parent,location:{search:'?embedded=1',protocol:'https:',origin:'https://example.test'},addEventListener:(name,handler)=>{events[name]=handler;}};
const game=vm.runInNewContext(`${gameSource}\n({startGame,hit,advance,resumeGame,finish,gameState:()=>({state,score,remaining,target:{...target}})})`,{
  document:{getElementById:gameGet,body:element(),hidden:false,fullscreenEnabled:false,
    querySelector:selector=>selector==='.back-link'?back:{value:'60'},querySelectorAll:()=>[],addEventListener(){},createTextNode:value=>value,createElement:element},
  window:gameWindow,URLSearchParams,Math:Object.assign(Object.create(Math),{random:()=>.5}),localStorage:{getItem:()=>null,setItem(){}},
  requestAnimationFrame:()=>1,cancelAnimationFrame(){},performance:{now:()=>now},ResizeObserver:class{observe(){}},
});
assert.equal(back.textContent,'← 互動區');game.startGame();
const initialTarget=game.gameState().target;
assert(Math.abs(Math.hypot(initialTarget.vx,initialTarget.vy)-220)<1e-8,'The first dot starts at the faster speed');
assert.equal(initialTarget.size,104);
now+=100; game.advance(now);
const movedTarget=game.gameState().target;
assert(Math.abs(Math.hypot(movedTarget.x-initialTarget.x,movedTarget.y-initialTarget.y)-22)<1e-8,'The faster speed is applied to actual movement');
game.hit();assert.equal(game.gameState().score,1);
assert(Math.abs(Math.hypot(game.gameState().target.vx,game.gameState().target.vy)-230)<1e-8,'A hit still speeds up the next dot');
assert.equal(game.gameState().target.size,101);
events.message({source:parent,origin:'https://other.test',data:{type:'classroom-game-pause'}});
assert.equal(game.gameState().state,'running');
events.message({source:parent,origin:'https://example.test',data:{type:'classroom-game-pause'}});
assert.equal(game.gameState().state,'paused','Hiding an embedded game must pause its countdown');
let prevented=false;back.listeners.click({preventDefault(){prevented=true;}});
assert(prevented);assert.equal(parentPosts.at(-1).type,'classroom-interaction-back');
game.resumeGame(); now+=61000; game.advance(now);
assert.deepEqual(dotScoreService.completed, [{game:'moving-dot',mode:'60',score:1}]);
game.finish(); assert.equal(dotScoreService.completed.length,1,'A completed round is recorded once');
game.startGame();
for(let count=0;count<45;count++)game.hit();
assert(Math.abs(Math.hypot(game.gameState().target.vx,game.gameState().target.vy)-420)<1e-8,'Speed remains capped');
assert.equal(game.gameState().target.size,40,'Targets remain large enough to touch');
assert(board.includes('src="doodle.html?embedded=1"'),'Keep the original sticky-board module');
console.log('Interaction hub tests: passed (nested navigation, lazy game load, pause on close, game scoring, embedded back, origin/source validation).');
