import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const SOURCE_URL='https://ems.kh.edu.tw:8443/portal/schoolac/schoolACDashboard.action?customerIdFrom=029b8e3dd27733ba716b7fe1d6eb4279';
const SCHOOL='前峰國中';
const text=value=>String(value).replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/gi,' ').replace(/&deg;|&#176;/gi,'°').replace(/℃/g,'°C').trim();
function field(html,id){const tags=html.match(/<input\b[^>]*>/gi)||[];const tag=tags.find(value=>new RegExp(`\\bid=["']${id}["']`,'i').test(value));return tag?.match(/\bvalue=["']([^"']*)["']/i)?.[1]||'';}
export function parseTemperature(html) {
  if(field(html,'schoolName')!==SCHOOL)throw new Error('看板尚未載入前峰國中資料');
  const values=[...html.matchAll(/<img\b[^>]*\bsrc=["'][^"']*\/temperature\.png(?:\?[^"']*)?["'][^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].map(match=>text(match[1]));
  const temperatures=values.map(value=>/^(-?\d{1,2}(?:\.\d{1,2})?)\s*°C$/i.exec(value)).filter(Boolean).map(match=>Number(match[1]));
  if(!temperatures.length||temperatures.some(value=>value< -50||value>60)||new Set(temperatures).size!==1)throw new Error('看板溫度空白、無效或不一致');
  const sourceClock=field(html,'customTime');
  return {school:SCHOOL,temperatureC:temperatures[0],sourceClock:/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(sourceClock)?sourceClock:null,reloadComplete:field(html,'reflashFlag')==='false'};
}
export async function fetchTemperature({fetchImpl=fetch,now=()=>new Date(),maxRequests=4}={}) {
  const cookies=new Map();let lastError=new Error('看板未回傳溫度');
  for(let attempt=0;attempt<maxRequests;attempt++){
    try{
      const response=await fetchImpl(SOURCE_URL,{headers:{Accept:'text/html',Referer:'https://www.qfm.kh.edu.tw/view/index.php?WebID=25',...(cookies.size?{Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')}:{})},redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error(`能源看板 HTTP ${response.status}`);
      for(const cookie of response.headers.getSetCookie?.()||[]){const pair=cookie.split(';',1)[0],index=pair.indexOf('=');if(index>0)cookies.set(pair.slice(0,index),pair.slice(index+1));}
      const parsed=parseTemperature(await response.text());
      if(!parsed.reloadComplete)throw new Error('等待看板完成重新載入');
      return {version:1,status:'ok',school:parsed.school,temperatureC:parsed.temperatureC,fetchedAt:now().toISOString(),sourceClock:parsed.sourceClock,sourceUrl:SOURCE_URL};
    }catch(error){lastError=error;}
  }
  throw lastError;
}
export async function captureTemperature(output,{fetchImpl=fetch,now=()=>new Date()}={}) {
  let snapshot;
  try{snapshot=await fetchTemperature({fetchImpl,now});}catch(_){snapshot={version:1,status:'unavailable',school:SCHOOL,temperatureC:null,fetchedAt:null,checkedAt:now().toISOString(),sourceUrl:SOURCE_URL};}
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(snapshot,null,2)+'\n');
  return snapshot;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const output=process.argv[2];if(!output)throw new Error('請指定溫度資料輸出路徑');
  const snapshot=await captureTemperature(resolve(output));
  if(snapshot.status!=='ok'){console.error('無法擷取有效校園溫度，已輸出無資料狀態。');process.exitCode=1;}
  else console.log(`${snapshot.school} ${snapshot.temperatureC.toFixed(1)}°C；擷取 ${snapshot.fetchedAt}（看板頁面時間 ${snapshot.sourceClock||'未提供'}，非量測時間）`);
}
