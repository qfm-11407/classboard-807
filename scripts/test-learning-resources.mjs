import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const source=fs.readFileSync(new URL('../board.html',import.meta.url),'utf8');
const reading=source.slice(source.indexOf('<div id="app-content-reading"'),source.indexOf('<!-- 名單編輯視窗'));
const expected=[
  ['成語考驗','https://qfm-11407.github.io/exam_115/idioms1150102.html','assets/idioms-exam-qr.png','20261019'],
  ['理化習作','https://qfm-11407.github.io/exam_115/science1150102.html','assets/science-workbook-qr.png','20261015'],
  ['社會練習','https://qfm-11407.github.io/exam_115/social1150102.html','assets/social-practice-qr.png','20261015'],
];
const cards=[...reading.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
assert.equal(cards.length,3);
expected.forEach(([label,url,asset,version],index)=>{
  const [,attributes,content]=cards[index];
  assert(attributes.includes(`href="${url}"`));
  assert(attributes.includes('target="_blank"'));
  assert(attributes.includes('rel="noopener noreferrer"'));
  assert(attributes.includes(`aria-label="${label}（在新分頁開啟）"`));
  assert(content.includes(`src="${asset}?v=${version}"`) && content.includes(`>${label}</h3>`));
  assert(fs.statSync(new URL(`../${asset}`,import.meta.url)).size>0);
});
assert(reading.includes('學習天地') && reading.includes('grid-cols-3'));
assert(!reading.includes('愛閱網') && !reading.includes('成語闖關') && !reading.includes('chatgpt.site'));
assert(!reading.includes('Wi-Fi') && !reading.includes('Wi‑Fi') && !reading.includes('wifi-qfm'));
const configurations=JSON.parse(fs.readFileSync(new URL('../firebase.json',import.meta.url),'utf8')).hosting;
configurations.forEach(site=>assert(site.ignore.includes('assets/wifi-qfm-d303-qr.png'),'Do not publish the retired Wi-Fi asset'));
const digest=path=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
if(process.argv.length===4){
  assert.equal(digest(process.argv[2]),digest(new URL('../assets/science-workbook-qr.png',import.meta.url)));
  assert.equal(digest(process.argv[3]),digest(new URL('../assets/social-practice-qr.png',import.meta.url)));
}
if(process.argv.length===3)assert.equal(digest(process.argv[2]),digest(new URL('../assets/idioms-exam-qr.png',import.meta.url)));
console.log('Learning resource tests: passed (idioms before science/social, correct GitHub Pages links, safe new tabs, uploaded QR assets, cache versions and retired entries absent).');
