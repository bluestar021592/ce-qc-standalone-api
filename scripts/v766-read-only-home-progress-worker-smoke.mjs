import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
const shell=fs.readFileSync(path.join(ROOT,'public','v625-shell.js'),'utf8');
const dbSource=fs.readFileSync(path.join(ROOT,'src','db.js'),'utf8');
const workerSource=fs.readFileSync(path.join(ROOT,'src','v766HeavyReadWorker.mjs'),'utf8');
const managerSource=fs.readFileSync(path.join(ROOT,'src','v766ReadJobCoordinator.js'),'utf8');

assert.match(server,/v766QuickHomeSummary\(\{reportDate,snapshotId\}\)/,'home must render source counts without waiting on historical timing');
assert.match(server,/v766ReadJob\('HOME_FULL'/,'home long-running signing must use isolated worker');
assert.match(server,/v766ReadJob\('FAMILY_PROOF'/,'7/4 exact run locks must be read outside Express event loop');
assert.match(server,/if\(String\(req\.query\.fast\|\|''\)==='1'\)return res\.status\(503\)/,'worker failure must not fall back to blocking main-thread timing');
assert.match(server,/const batch=fastDashboardBatch\('',date\)/,'finished proof must be pinned to existing selected-day snapshot');
assert.match(shell,/summaryQuickUrl=summaryUrl\+'&quick=1'/,'home must show counters first');
assert.match(shell,/summary\?\.quickOnly&&summary\.selectionMatched/,'full signing must hydrate after first paint, not start for missing report days');
assert.match(shell,/void loadHome\(\{summaryOverride:full,skipHistory:true,skipAux:true\}\)/,'full signing must not reload old first-paint counters/progress');
assert.match(shell,/if\(!summary\?\.quickOnly\)for\(const type of \['WHPP','SHOPEECN','SHOPEEVN'\]/,'unverified return status must stay blank, not become zero');
assert.match(shell,/selected&&selected!==String\(newest\.reportDate/,'latest import must not overwrite selected historical completion snapshot');
assert.match(shell,/\/api\/family-recovery-proof\?reportDate='\+encodeURIComponent\(date\)\+'&snapshotId='/,'proof must preserve reportDate and immutable snapshot');
assert.match(dbSource,/new DatabaseSync\(cfg\.dbFile,\{readOnly:true\}\)/,'worker database must be opened read-only');
assert.match(dbSource,/if\(IS_DASHBOARD_READ_WORKER\)/,'worker must bypass migration/copy paths');
assert.match(workerSource,/if\(process\.env\.CE_QC_DASHBOARD_READ_WORKER!=='1'\)/,'worker must reject missing read-only policy');
assert.match(workerSource,/exactMemberVerified=scanMissing===0&&finalMissing===0/,'7/4 completion cannot use counts without exact source ledger identities');
assert.match(managerSource,/const MAX_CONCURRENT=2/,'workers must have bounded concurrency');
assert.match(managerSource,/const MAX_RUN_MS=90000/,'slow worker must have a hard ceiling');
assert.match(managerSource,/if\(active\.has\(key\)\)return active\.get\(key\)/,'identical date/snapshot worker queries must deduplicate');

const tempRoot=fs.mkdtempSync(path.join(process.env.CE_QC_TEST_TEMP_DIR||os.tmpdir(),'ce-qc-v766-'));
const previous={data:process.env.DATA_DIR,db:process.env.DB_FILE};
let close=()=>{};
try{
  process.env.DATA_DIR=tempRoot;
  process.env.DB_FILE=path.join(tempRoot,'safe-read-test.db');
  const db=await import('../src/db.js');
  close=db.closeDb;
  db.getDb(); // Initialize full production schema in a throwaway test database.
  const {v766ReadJob}=await import('../src/v766ReadJobCoordinator.js');
  const readonly=await v766ReadJob('READ_ONLY_CHECK',{reportDate:'',snapshotId:''});
  assert.equal(readonly.result.readOnly,true,'worker must reject an actual SQL CREATE TABLE command');
  assert.equal(db.getDb().prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name='v766_must_not_exist'").get().c,0);
  const started=Date.now();
  const noBatch=await v766ReadJob('FAMILY_PROOF',{reportDate:'2099-01-01',snapshotId:'INVALID'})
    .then(()=>null,error=>String(error?.message||error));
  assert.match(noBatch,/VALID_BATCH_MISSING/,'unknown date must fail closed without inventing completed runs');
  assert.ok(Date.now()-started<90000);
  const blank=await v766ReadJob('HOME_FULL',{reportDate:'2099-01-01',snapshotId:''});
  assert.equal(blank.result.selectionMatched,false,'no source report must never be represented as imported');
  const repeat=await v766ReadJob('HOME_FULL',{reportDate:'2099-01-01',snapshotId:''});
  assert.equal(repeat.cache,'HIT','safe exact-date full summary should be short cached');
  console.log('[V766] isolated read-only worker, 7/4 snapshot identity gate, fast source-count paint, empty-day honesty, shared worker cache passed');
}finally{
  try{close()}catch{}
  if(previous.data===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous.data;
  if(previous.db===undefined)delete process.env.DB_FILE;else process.env.DB_FILE=previous.db;
  try{fs.rmSync(tempRoot,{recursive:true,force:true,maxRetries:5,retryDelay:150})}catch{}
}
