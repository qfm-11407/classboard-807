import { config } from './config.js';
const validBackend = value => { try { const u=new URL(value);return u.origin==='https://script.google.com'&&/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname); } catch { return false; } };
const trustedGoogleOrigin = value => { try { const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname.endsWith('.googleusercontent.com')); }catch{return false;} };
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
function saved(key){try{return localStorage.getItem(key)||'';}catch{return '';}}
const initial = new URLSearchParams(location.search).get('backend') || config.gasUrl || saved('oneword:backend');
export class GASClient {
  constructor(url=initial) { this.backend=validBackend(url)?url:'';this.ready=null;this.frame=null;this.peer=null;this.peerOrigin='';this.pending=new Map();this.sequence=0;this.imageCache=new Map();this.token='';try{this.token=sessionStorage.getItem(`oneword:teacher:${this.backend}`)||'';}catch{} }
  connect() {
    if(this.ready)return this.ready;
    if(!this.backend)return Promise.reject(new Error('尚未設定 GAS 網址，請回首頁設定後端連線'));
    this.channel=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    this.ready=new Promise((resolve,reject)=>{
      this.listener=event=>{
        const m=event.data;if(!m||m.channel!==this.channel||!trustedGoogleOrigin(event.origin))return;
        if(m.type==='oneword:ready'&&!this.peer){this.peer=event.source;this.peerOrigin=event.origin;clearTimeout(this.readyTimer);resolve();return;}
        if(m.type!=='oneword:response'||event.source!==this.peer||event.origin!==this.peerOrigin)return;
        const task=this.pending.get(m.id);if(!task)return;clearTimeout(task.timer);this.pending.delete(m.id);
        if(m.reply?.ok)task.resolve(m.reply.data);else task.reject(Object.assign(new Error(m.reply?.error||'GAS 未完成操作'),{status:m.reply?.status||503,retryable:m.reply?.retryable||false}));
      };
      window.addEventListener('message',this.listener);
      this.readyTimer=setTimeout(()=>{reject(new Error('GAS 連線逾時：請確認 /exec 網址、網頁應用程式存取權限，以及 GAS 的 ALLOWED_ORIGINS'));this.dispose();},30000);
      const frame=document.createElement('iframe');frame.hidden=true;frame.title='OneWord 雲端連線';frame.referrerPolicy='no-referrer';const url=new URL(this.backend);url.searchParams.set('channel',this.channel);frame.src=url.href;this.frame=frame;document.body.append(frame);
    });
    return this.ready;
  }
  async rpc(action,data={},auth=this.token,retries=0) {
    await this.connect();
    try{return await new Promise((resolve,reject)=>{const id=String(++this.sequence),timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(new Error('GAS 回應逾時，原始筆跡仍保留；請稍後確認或重試'),{status:503,retryable:true}));},action==='worker'?170000:60000);this.pending.set(id,{resolve,reject,timer});this.peer.postMessage({type:'oneword:request',channel:this.channel,id,action,data,auth},this.peerOrigin);});}
    catch(error){if(retries>0&&error.retryable){await wait(800+Math.random()*1000);return this.rpc(action,data,auth,retries-1);}throw error;}
  }
  async request(route,data,playerToken) {
    const u=new URL(route,location.href),r=u.pathname;let action,payload=data||{};
    if(r==='/api/login'){const result=await this.rpc('login',payload,'');this.token=result.token;try{sessionStorage.setItem(`oneword:teacher:${this.backend}`,this.token);}catch{}return{ok:true};}
    if(r==='/api/admin/state'){action='adminState';payload={room:u.searchParams.get('room')||''};}
    else if(r==='/api/admin/settings')action='settings';
    else if(r==='/api/admin/rooms')action='createRoom';
    else if(r==='/api/join')action='join';
    else if(r==='/api/submit')action='submit';
    else if(r==='/api/room'){action='room';payload={room:u.searchParams.get('room')};}
    else{const m=r.match(/^\/api\/admin\/rooms\/([A-F0-9]{6})\/(start|close|reveal|retry|export)$/);if(!m)throw new Error('找不到操作');action=m[2];payload={...payload,room:m[1]};}
    const retry=['adminState','room','submit'].includes(action)?2:0;
    return this.rpc(action,payload,playerToken||this.token,retry);
  }
  pageURL(file,room) { const u=new URL(file,location.href);u.search='';u.hash='';if(room)u.searchParams.set('room',room);if(this.backend&&this.backend!==config.gasUrl)u.searchParams.set('backend',this.backend);return u.href; }
  async hydrate(state) {
    if(!state.round||state.round.phase==='writing')return state;
    const count=state.players.filter(p=>p.imageUrl).length;if(!count)return state;
    const key=`${state.code}:${state.round.id}:${count}`;
    if(!this.imageCache.has(key)){const images=await this.rpc('images',{room:state.code,roundId:state.round.id},'',1);this.imageCache.clear();this.imageCache.set(key,images);}
    const images=this.imageCache.get(key);return {...state,players:state.players.map(p=>({...p,imageUrl:images[p.id]||null}))};
  }
  subscribe(code,receive,onConnection,images=false) {
    let closed=false,timer,last='';
    const poll=async()=>{try{let state=await this.rpc('room',{room:code},'',1);if(closed)return;onConnection(true);const version=String(state.revision)+':'+state.round?.phase;if(last!==version){if(images)state=await this.hydrate(state);if(closed)return;last=version;receive(state);}}catch(error){if(!closed)onConnection(false,error.message);}finally{if(!closed)timer=setTimeout(poll,Math.max(2500,config.pollMs||3500)+Math.random()*800);}};
    poll();return{close(){closed=true;clearTimeout(timer);}};
  }
  dispose(){clearTimeout(this.readyTimer);if(this.listener)window.removeEventListener('message',this.listener);this.frame?.remove();for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error('連線已重設'));}this.pending.clear();this.frame=null;this.peer=null;this.ready=null;}
}
export const client = new GASClient();
export function saveBackend(url){if(!validBackend(url))throw new Error('請輸入 https://script.google.com/macros/s/…/exec 格式的部署網址');try{localStorage.setItem('oneword:backend',url);}catch{}return url;}
export { validBackend, trustedGoogleOrigin };
