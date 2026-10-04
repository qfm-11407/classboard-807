import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

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
const panels=['interaction','messages','chase-light','mole-pop','tic-tac-toe'].map(type=>get(`app-content-${type}`));
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

const gameSource=fs.readFileSync(new URL('../games/moving-dot.js',import.meta.url),'utf8');
const gameElements=new Map(),events={},parentPosts=[];
const gameGet=id=>{if(!gameElements.has(id))gameElements.set(id,element());return gameElements.get(id);};
const back=element(),parent={postMessage:data=>parentPosts.push(data)};
let now=0;
const gameWindow={parent,location:{search:'?embedded=1',protocol:'https:',origin:'https://example.test'},addEventListener:(name,handler)=>{events[name]=handler;}};
const game=vm.runInNewContext(`${gameSource}\n({startGame,hit,gameState:()=>({state,score,remaining})})`,{
  document:{getElementById:gameGet,body:element(),hidden:false,fullscreenEnabled:false,
    querySelector:selector=>selector==='.back-link'?back:{value:'60'},querySelectorAll:()=>[],addEventListener(){},createTextNode:value=>value,createElement:element},
  window:gameWindow,URLSearchParams,localStorage:{getItem:()=>null,setItem(){}},
  requestAnimationFrame:()=>1,cancelAnimationFrame(){},performance:{now:()=>now},ResizeObserver:class{observe(){}},
});
assert.equal(back.textContent,'← 互動區');game.startGame();game.hit();assert.equal(game.gameState().score,1);
events.message({source:parent,origin:'https://other.test',data:{type:'classroom-game-pause'}});
assert.equal(game.gameState().state,'running');
events.message({source:parent,origin:'https://example.test',data:{type:'classroom-game-pause'}});
assert.equal(game.gameState().state,'paused','Hiding an embedded game must pause its countdown');
let prevented=false;back.listeners.click({preventDefault(){prevented=true;}});
assert(prevented);assert.equal(parentPosts.at(-1).type,'classroom-interaction-back');
assert(board.includes('src="doodle.html?embedded=1"'),'Keep the original sticky-board module');
console.log('Interaction hub tests: passed (nested navigation, lazy game load, pause on close, game scoring, embedded back, origin/source validation).');
