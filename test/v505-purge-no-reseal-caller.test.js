import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function walk(dir,files=[]){
  if(!fs.existsSync(dir))return files;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full,files);
    else if(/\.(?:js|mjs)$/i.test(entry.name))files.push(full);
  }
  return files;
}

test('V505 production paths cannot reseal the backup-bound source fingerprint after PREPARE',()=>{
  const purgeFile=path.join(root,'src','dataPurge.js');
  const purge=fs.readFileSync(purgeFile,'utf8');
  const definitions=purge.match(/(?:export\s+)?function\s+resealPurgeChallenge\s*\(/g)||[];
  const calls=purge.match(/(?<!function\s)resealPurgeChallenge\s*\(/g)||[];
  assert.equal(definitions.length,1,'legacy reseal symbol may exist only as one dormant compatibility definition');
  assert.equal(calls.length,0,'dataPurge itself must never invoke the dormant reseal symbol');

  const production=[
    path.join(root,'server.js'),
    path.join(root,'bootstrap.js'),
    ...walk(path.join(root,'src')),
    ...walk(path.join(root,'scripts'))
  ].filter((file,index,list)=>file!==purgeFile&&list.indexOf(file)===index);
  const offenders=[];
  for(const file of production){
    const source=fs.readFileSync(file,'utf8');
    if(/\bresealPurgeChallenge\s*\(/.test(source)||/\bresealPurgeChallenge\b/.test(source))offenders.push(path.relative(root,file));
  }
  assert.deepEqual(offenders,[],'no production route, coordinator or worker may import/call resealPurgeChallenge; the fingerprint must remain the one sealed after verified backup');
});
