import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

// Publish only the public snapshot on its own branch; never switch or modify main.
const ref='refs/heads/codex/campus-temperature-data';
const output=process.argv[2];if(!output)throw new Error('Missing snapshot path');
const raw=await readFile(output,'utf8'),snapshot=JSON.parse(raw);
if(snapshot.version!==1||snapshot.school!=='前峰國中'||!['ok','unavailable'].includes(snapshot.status))throw new Error('Invalid public temperature snapshot');
if(snapshot.status==='ok'&&(typeof snapshot.temperatureC!=='number'||!Number.isFinite(snapshot.temperatureC)||snapshot.temperatureC< -50||snapshot.temperatureC>60||!Number.isFinite(Date.parse(snapshot.fetchedAt))))throw new Error('Invalid temperature value or timestamp');
const git=(args,input)=>execFileSync('git',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
let parent;
try{git(['ls-remote','--exit-code','--heads','origin',ref]);git(['fetch','--depth=1','origin',ref]);parent=git(['rev-parse','FETCH_HEAD']);}catch(error){if(error.status!==2)throw error;}
const blob=git(['hash-object','-w','--stdin'],raw),tree=git(['mktree'],`100644 blob ${blob}\tcampus-temperature.json\n`);
const commit=git(['-c','user.name=classboard-temperature[bot]','-c','user.email=classboard-temperature@users.noreply.github.com','commit-tree',tree,...(parent?['-p',parent]:[])],`Update public campus temperature (${snapshot.status})\n`);
git(['push','origin',`${commit}:${ref}`]);
console.log(`Published ${snapshot.status} snapshot to ${ref}; main unchanged.`);
