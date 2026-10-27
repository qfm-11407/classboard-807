import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=['index.html','teacher.html','student.html','screen.html','style.css','app.js','canvas.js','transport.js','config.js','.nojekyll','README.md','DEPLOY_GAS.md','gas/Code.gs','gas/Bridge.html','gas/appsscript.json'];
const target=path.resolve(root,'github-upload');
if(path.dirname(target)!==path.resolve(root))throw new Error('Unexpected package directory');
await mkdir(path.join(target,'gas'),{recursive:true});
async function inventory(dir,prefix=''){const out=[];for(const item of await readdir(dir,{withFileTypes:true})){const name=prefix+item.name;if(item.isDirectory())out.push(...await inventory(path.join(dir,item.name),name+'/'));else out.push(name);}return out;}
for(const name of await inventory(target))if(!files.includes(name))throw new Error('Unexpected file in package directory: '+name);
const entries=[];
for(const name of files){const data=await readFile(path.join(root,name));await copyFile(path.join(root,name),path.join(target,name));entries.push({name,data});}
function crc32(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0;}
const chunks=[],directory=[];let offset=0;
for(const {name,data} of entries){const filename=Buffer.from(name,'utf8'),compressed=deflateRawSync(data),crc=crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);chunks.push(header,filename,compressed);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);directory.push(central,filename);offset+=header.length+filename.length+compressed.length;
}
const table=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(table.length,12);end.writeUInt32LE(offset,16);
const output=path.join(root,'oneword-github-test.zip');await writeFile(output,Buffer.concat([...chunks,table,end]));console.log('Upload package: '+output+' ('+entries.length+' files; no local data or credentials).');
