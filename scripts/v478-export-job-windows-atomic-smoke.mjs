import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const files=['src/exportJobAtomicJson.js','src/v84ExportJobWorker.js','src/v84ExportBusinessWorker.js','src/v473AllBusinessExportWorker.js','src/v473ExportSidecar.js'];
for(const file of files){const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(checked.status,0,`${file} syntax failed: ${checked.stderr||checked.stdout}`);}
const read=file=>fs.readFileSync(file,'utf8');
const helper=read('src/exportJobAtomicJson.js');
assert.match(helper,/2026-09-08-v478-windows-retry-safe-export-job-json-v1/);
for(const code of ['EPERM','EBUSY','EACCES'])assert.match(helper,new RegExp(`'${code}'`));
assert.match(helper,/Atomics\.wait\(/,'sync worker retry must be bounded without event-loop timers');
assert.match(helper,/await sleep\(DELAYS\[attempt\]\)/,'async sidecar retry must yield between attempts');
assert.doesNotMatch(helper,/unlinkSync\(file|rmSync\(file|writeFileSync\(file,/,'V478 must not delete or directly overwrite the destination as a fallback');
for(const file of files.slice(1)){
  const source=read(file);
  assert.match(source,/exportJobAtomicJson\.js/,`${file} must use the shared V478 writer`);
}
assert.doesNotMatch(read('src/v84ExportJobWorker.js'),/renameSync\(temp,jobFile\)/,'V84 heartbeat must not use one-shot rename');
assert.doesNotMatch(read('src/v84ExportBusinessWorker.js'),/renameSync\(temp,file\)/,'child progress/result must not use one-shot rename');
assert.doesNotMatch(read('src/v473AllBusinessExportWorker.js'),/renameSync\(temp,jobFile\)/,'ALL preflight must not use one-shot rename');

const {writeJsonAtomicSync,writeJsonAtomic}=await import('../src/exportJobAtomicJson.js');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v478-'));
try{
  const syncFile=path.join(temp,'sync.json');fs.writeFileSync(syncFile,'{"old":true}','utf8');
  const originalSync=fs.renameSync;let syncCalls=0;
  fs.renameSync=function(...args){syncCalls+=1;if(syncCalls<=3){const error=new Error('simulated Windows target lock');error.code='EPERM';throw error;}return originalSync.apply(this,args);};
  try{const result=writeJsonAtomicSync(syncFile,{ok:true,mode:'sync'});assert.equal(result.attempts,4);}finally{fs.renameSync=originalSync;}
  assert.deepEqual(JSON.parse(fs.readFileSync(syncFile,'utf8')),{ok:true,mode:'sync'});assert.equal(syncCalls,4,'sync EPERM must retry then succeed');

  const asyncFile=path.join(temp,'async.json');await fsp.writeFile(asyncFile,'{"old":true}','utf8');
  const originalAsync=fsp.rename;let asyncCalls=0;
  fsp.rename=async function(...args){asyncCalls+=1;if(asyncCalls<=2){const error=new Error('simulated Windows busy target');error.code='EBUSY';throw error;}return originalAsync.apply(this,args);};
  try{const result=await writeJsonAtomic(asyncFile,{ok:true,mode:'async'});assert.equal(result.attempts,3);}finally{fsp.rename=originalAsync;}
  assert.deepEqual(JSON.parse(await fsp.readFile(asyncFile,'utf8')),{ok:true,mode:'async'});assert.equal(asyncCalls,3,'async EBUSY must retry then succeed');

  const fatalFile=path.join(temp,'fatal.json');
  const originalFatal=fs.renameSync;let fatalCalls=0;
  fs.renameSync=function(){fatalCalls+=1;const error=new Error('simulated nonretryable error');error.code='EINVAL';throw error;};
  try{assert.throws(()=>writeJsonAtomicSync(fatalFile,{ok:false}),error=>error?.code==='EINVAL');}finally{fs.renameSync=originalFatal;}
  assert.equal(fatalCalls,1,'nonretryable errors must fail immediately');
}finally{fs.rmSync(temp,{recursive:true,force:true});}

console.log('[V478] Windows-safe export Job JSON smoke passed · simulated EPERM/EBUSY recover with bounded retries · EINVAL fails immediately · V84/V473/child status writers share one atomic owner');
