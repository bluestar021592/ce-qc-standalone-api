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

test('V505 destructive execution worker has one production entrypoint and sealed-path/receipt preflights run first',()=>{
  const coordinator=path.join(root,'src','v505PurgeCoordinator.js');
  const worker=path.join(root,'scripts','CE_QC_PurgeExecuteTaskWorker.mjs');
  const production=[path.join(root,'server.js'),path.join(root,'bootstrap.js'),...walk(path.join(root,'src')),...walk(path.join(root,'scripts'))]
    .filter((file,index,list)=>file!==coordinator&&list.indexOf(file)===index);
  const callers=production.filter(file=>/\brunPurgeExecutionWorker\b/.test(fs.readFileSync(file,'utf8'))).map(file=>path.relative(root,file).replaceAll('\\','/'));
  assert.deepEqual(callers,['scripts/CE_QC_PurgeExecuteTaskWorker.mjs'],'destructive worker must not gain a second production entrypoint that bypasses readonly preflight');

  const source=fs.readFileSync(worker,'utf8');
  const preflightImport=source.indexOf("import('../src/v505PurgeExecuteReadOnlyPreflight.js')");
  const firstSealedPathCall=source.indexOf('assertPurgeExecuteSealedDatabasePath(payload)');
  const delayAt=source.indexOf('if(delay)await new Promise');
  const lastSealedPathCall=source.lastIndexOf('assertPurgeExecuteSealedDatabasePath(payload)');
  const preflightCall=source.indexOf('assertPurgeExecuteReadOnlyPreflight(payload)');
  const coordinatorImport=source.indexOf("import('../src/v505PurgeCoordinator.js')");
  const destructiveCall=source.indexOf('runPurgeExecutionWorker(payload)');
  const sealedPathCallCount=(source.match(/assertPurgeExecuteSealedDatabasePath\(payload\)/g)||[]).length;
  assert.equal(sealedPathCallCount,2,'sealed DB path must be checked once before startup delay and again immediately before SQLite preflight');
  assert.ok(preflightImport>=0&&firstSealedPathCall>preflightImport&&delayAt>firstSealedPathCall&&lastSealedPathCall>delayAt&&preflightCall>lastSealedPathCall&&coordinatorImport>preflightCall&&destructiveCall>coordinatorImport,'sealed database path must be revalidated after the startup delay and before strict readonly preflight/destructive coordinator loading');

  const preflight=fs.readFileSync(path.join(root,'src','v505PurgeExecuteReadOnlyPreflight.js'),'utf8');
  assert.match(preflight,/V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED/,'runtime fallback DB path drift must fail closed before getDb opens SQLite');
  assert.match(preflight,/(?:backup|备份) manifest/,'sealed path must be corroborated by the verified backup manifest');
  assert.match(preflight,/V505_PURGE_COMMIT_RECEIPT_INVALID/,'malformed durable receipt must fail closed before destructive code loads');
  assert.match(preflight,/if\(exactReceipt\(receipt,job\)\)/,'exact committed receipt must be recognized before any new DELETE path');
});
