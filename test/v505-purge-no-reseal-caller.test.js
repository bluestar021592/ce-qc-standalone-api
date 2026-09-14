import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const retiredV105=path.join(root,'src','v105AsyncPurgePatch.js');

function walk(dir,files=[]){
  if(!fs.existsSync(dir))return files;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full,files);
    else if(/\.(?:js|mjs)$/i.test(entry.name))files.push(full);
  }
  return files;
}
function activeRuntimeFiles(){
  const workers=walk(path.join(root,'scripts')).filter(file=>/CE_QC_.*(?:Worker|Audit|Diagnostic).*\.mjs$/i.test(path.basename(file)));
  return [
    path.join(root,'server.js'),
    path.join(root,'bootstrap.js'),
    ...walk(path.join(root,'src')),
    ...workers
  ].filter((file,index,list)=>file!==retiredV105&&list.indexOf(file)===index);
}

test('V505 production paths cannot reseal the backup-bound source fingerprint after PREPARE',()=>{
  const purgeFile=path.join(root,'src','dataPurge.js');
  const purge=fs.readFileSync(purgeFile,'utf8');
  const definitions=purge.match(/(?:export\s+)?function\s+resealPurgeChallenge\s*\(/g)||[];
  const calls=purge.match(/(?<!function\s)resealPurgeChallenge\s*\(/g)||[];
  assert.equal(definitions.length,1,'legacy reseal symbol may exist only as one dormant compatibility definition');
  assert.equal(calls.length,0,'dataPurge itself must never invoke the dormant reseal symbol');

  const production=activeRuntimeFiles().filter(file=>file!==purgeFile);
  const offenders=[];
  for(const file of production){
    const source=fs.readFileSync(file,'utf8');
    if(/\bresealPurgeChallenge\s*\(/.test(source)||/\bresealPurgeChallenge\b/.test(source))offenders.push(path.relative(root,file));
  }
  assert.deepEqual(offenders,[],'no active production route, coordinator or worker may import/call resealPurgeChallenge; the fingerprint must remain the one sealed after verified backup');

  const legacyWiring=[];
  for(const file of activeRuntimeFiles()){
    const source=fs.readFileSync(file,'utf8');
    if(/(?:import|require)[^\n]*v105AsyncPurgePatch/.test(source))legacyWiring.push(path.relative(root,file));
  }
  assert.deepEqual(legacyWiring,[],'retired V105 purge patch must stay absent from every active runtime import chain');
});
