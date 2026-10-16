import assert from 'node:assert/strict';
import fs from 'node:fs';
// V788 is exposed only as a deliberate ADMIN action inside the QC APP.
// No startup auto-query and no status endpoint that leaks shipment identifiers.
const server=fs.readFileSync('server.js','utf8');
const ui=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
assert.match(server,/app\.get\('\/api\/v788\/whpp-evidence\/status',requireRole\('ADMIN'\)/);
assert.match(server,/app\.post\('\/api\/v788\/whpp-evidence\/start',requireRole\('ADMIN'\)/);
assert.match(server,/acknowledgeIsolatedQuery!==true/);
assert.match(server,/v788StageActive=true/);
assert.match(server,/runV788Stage\(\{execute:true\}\)/);
assert.match(server,/productionDatabaseModified:false/);
assert.match(server,/import fsSync from 'node:fs'/);
assert.match(server,/fsSync\.readFileSync\(v788StageReport,'utf8'\)/);
assert.match(server,/businessStateUpdated:false/);
assert.match(server,/new V788ReadOnlyDatabaseSync\(v788SidecarFile,\{readOnly:true\}\)/);
assert.match(server,/verifyV788PersistedSidecar\(checkDb,String\(data\?\.sourceSignature\|\|''\)\)/);
assert.match(server,/saved\.sidecarVerified=checked\.verified===true/);
assert.match(ui,/data.sidecarVerified===true/);

assert.match(server,/distributionMatchesV3:data\?\.coverage\?\.distributionMatchesV3===true/);
assert.match(server,/evidenceConflicts:Number\(data\?\.coverage\?\.conflictingExistingStates\|\|0\)/);
const stageSource=fs.readFileSync('scripts/v788-whpp-stage-tms-evidence.mjs','utf8');
// The in-APP CE system login writes a configurable tokenFile. Reject V788
// implementations that silently read an obsolete hardcoded D:\\ token path.
assert.match(stageSource,/getTokenFile\(\)/);
assert.match(stageSource,/new CEClient\(\)/);
assert.match(stageSource,/client\.http\.post\('\/api\/tms-shipment\/track'/);
assert.match(stageSource,/maxRedirects:0/);
assert.doesNotMatch(stageSource,/refreshTokenIfNeeded\(/);
assert.doesNotMatch(stageSource,/client\.shipmentTrack\(/);
assert.doesNotMatch(stageSource,/['"]x-refresh-token['"]\s*\]/);
assert.match(stageSource,/V788_TMS_TOKEN_SOURCE_MISMATCH/);
assert.match(stageSource,/V788_ISOLATED_SOURCE_CHANGED_DURING_READ/);
assert.match(stageSource,/if\(failure\)break;/);
assert.match(stageSource,/V788_SIDECAR_BATCH_MEMBERS_MISSING/);

assert.match(html,/id="v788WhppEvidencePanel"/);
assert.match(html,/id="v788WhppEvidenceStart"/);
assert.match(html,/开始隔离核验（346票）/);
assert.match(ui,/function startV788WhppEvidence\(\)/);
assert.match(ui,/function loadV788WhppEvidenceStatus\(\)/);
assert.match(ui,/acknowledgeIsolatedQuery:true/);
assert.match(ui,/!isCeApiSessionUsable\(ceAuth\)/);
assert.match(ui,/const needsReview=allBatchesPresent&&!isFull/);
assert.match(ui,/needsReview\|\|!isCeApiSessionUsable\(ceAuth\)/);
assert.match(ui,/需复核，禁止重复查询/);
assert.match(server,/lastStatus==='RUNNING'\?'INTERRUPTED_RETRYABLE'/,
  'a stale last-batch RUNNING report must be resumable after a process restart');
assert.match(server,/lastStatus==='STOPPED_RETRYABLE'\?'STOPPED_RETRYABLE'/,
  'a persisted stop must not be lost at APP restart');
assert.match(server,/resumeAvailable/,
  'the APP exposes only resumable state, not raw TMS payload');
assert.match(ui,/const restartFinalize=allBatchesPresent&&data.status==='INTERRUPTED_RETRYABLE'/,
  'eight committed batches with interrupted final report must not be treated as contradictory');
assert.match(ui,/const needsReview=allBatchesPresent&&!isFull&&!restartFinalize/,
  'genuine inconsistent full evidence must still block the action');
assert.match(ui,/继续安全核验（保留已有批次）/);


import {DatabaseSync} from 'node:sqlite';
import {strictWhppTmsBatch,initV788Sidecar,stageV788Batch,inspectV788Sidecar,v788SourceSignature,verifyV788PersistedSidecar}
  from './v788-whpp-tms-evidence-sidecar.mjs';
import {runV788Stage} from './v788-whpp-stage-tms-evidence.mjs';

// No actual network, auth, D drive, or file access on the default command.
assert.deepEqual(await runV788Stage(),{
  status:'DRY_RUN',openedDatabase:false,queriedTms:false});
assert.throws(()=>strictWhppTmsBatch(['A'],[], '2026-07-01'),/V788_TMS_PARTIAL_BATCH/);
assert.throws(()=>strictWhppTmsBatch(['A'],[{shipmentCode:'B',shipmentStatus:'60'}],'2026-07-01'),/UNREQUESTED/);
assert.throws(()=>strictWhppTmsBatch(['A'],[{shipmentCode:'A',eventCode:'60'}],'2026-07-01'),/MISSING_DIRECT_STATUS/);
assert.throws(()=>strictWhppTmsBatch(['A'],[{shipmentCode:'A',shipmentStatus:'60'},{shipmentCode:'A',shipmentStatus:'81'}],'2026-07-01'),/DUPLICATE_MEMBER/);
assert.throws(()=>strictWhppTmsBatch(['A','A'],[{shipmentCode:'A',shipmentStatus:'60'}],'2026-07-01'),/DUPLICATE_REQUEST_CODES/);
const strict=strictWhppTmsBatch(['A','B'],[
  {shipmentCode:'B',shipmentStatus:'81',receiverPhone:'sensitive-data'},
  {shipmentCode:'A',shipmentStatus:'60',lastUpdateDate:'2026-07-05 10:00:00'}
], '2026-07-01');
assert.equal(strict.length,2);
assert.equal(strict[0].explicitPodTime,'','generic lastUpdateDate must never forge POD time');
assert.equal(JSON.stringify(strict).includes('sensitive-data'),false,'raw PII must not be persisted');
assert.equal(strict[0].apiDigest.length,64);
const verified=strictWhppTmsBatch(['A'],[{shipmentCode:'A',shipmentStatus:'60',signedAt:'2026-07-04 10:00:00'}], '2026-07-01');
assert.equal(verified[0].explicitPodTime,'2026-07-04 10:00:00');

const db=new DatabaseSync(':memory:');
try{
  const all=[
    {date:'2026-07-01',codes:Array.from({length:190},(_,i)=>'J'+String(i).padStart(4,'0')),
      states:new Map()},
    {date:'2026-07-02',codes:Array.from({length:156},(_,i)=>'K'+String(i).padStart(4,'0')),
      states:new Map()}
  ];
  for(const day of all){
    for(let i=0;i<day.codes.length;i++)day.states.set(day.codes[i],i<(day.date==='2026-07-01'?166:124)?'POD':'RETURNED');
  }
  const sig=v788SourceSignature(all);
  initV788Sidecar(db,sig);
  assert.throws(()=>initV788Sidecar(db,'a'.repeat(64)),/IDENTITY_MISMATCH/);
  let done=0;
  for(const d of all){
    for(let i=0;i<Math.ceil(d.codes.length/50);i++){
      const codes=d.codes.slice(i*50,(i+1)*50);
      const rows=codes.map(code=>({shipmentCode:code,shipmentStatus:d.states.get(code)==='POD'?'60':'81'}));
      assert.deepEqual(stageV788Batch(db,{date:d.date,index:i,codes,rows}),{reused:false,matched:codes.length});
      done++;
      assert.deepEqual(stageV788Batch(db,{date:d.date,index:i,codes,rows}),{reused:true,matched:codes.length});
    }
  }
  assert.equal(done,8);
  const audit=inspectV788Sidecar(db,all);
  assert.equal(audit.expectedMembers,346);
  assert.equal(audit.persistedMembers,346);
  assert.equal(audit.missingMembers,0);
  assert.equal(audit.conflictingExistingStates,0);
  assert.equal(audit.podWithExplicitTime,0);
  assert.equal(audit.completedBatches,8);
  assert.equal(audit.statuses.s60,290);
  assert.equal(audit.statuses.s81,56);
  assert.equal(audit.byDate['2026-07-01'].s60,166);
  assert.equal(audit.byDate['2026-07-02'].s81,32);
  assert.equal(audit.distributionMatchesV3,true);
  assert.equal(audit.complete,true);
  assert.equal(verifyV788PersistedSidecar(db,sig).verified,true,
    'actual SQLite evidence proves all 346 terminal statuses and 8 batches');
  assert.equal(verifyV788PersistedSidecar(db,'f'.repeat(64)).verified,false,
    'a stale JSON report signature must not certify a different sidecar');

  // The reported terminal totals are an independent hard gate, not merely
  // 346 rows with any status or a green batch counter.
  db.prepare('UPDATE v788_tms_evidence SET shipmentStatus=? WHERE reportDate=? AND shipmentCode=?').run('81','2026-07-01',all[0].codes[0]);
  const drift=inspectV788Sidecar(db,all);
  assert.equal(drift.distributionMatchesV3,false);
  assert.equal(drift.complete,false);
  assert.equal(verifyV788PersistedSidecar(db,sig).verified,false,
    'a green JSON report must not hide a manually corrupted SQLite terminal state');

  db.prepare('UPDATE v788_tms_evidence SET shipmentStatus=? WHERE reportDate=? AND shipmentCode=?').run('60','2026-07-01',all[0].codes[0]);
  assert.equal(inspectV788Sidecar(db,all).complete,true);
  assert.throws(()=>stageV788Batch(db,{date:'2026-07-01',index:0,
    codes:all[0].codes.slice(0,50),
    rows:all[0].codes.slice(0,50).map(code=>({shipmentCode:code,shipmentStatus:'80'}))}),/REPLAY_STATUS_CHANGED/);
  // Simulate an incomplete batch: no partial insertion is allowed.
  const db2=new DatabaseSync(':memory:');
  try{
    initV788Sidecar(db2,sig);
    assert.throws(()=>stageV788Batch(db2,{date:'2026-07-01',index:0,codes:['A','B'],
      rows:[{shipmentCode:'A',shipmentStatus:'60'}]}),/PARTIAL_BATCH/);
    assert.equal(db2.prepare('SELECT COUNT(*) n FROM v788_tms_evidence').get().n,0);
    assert.equal(db2.prepare('SELECT COUNT(*) n FROM v788_batch_commits').get().n,0);
  }finally{db2.close()}
}finally{db.close()}
console.log('[V788] sidecar: 346 exact members, 8 batches, replay-safe, status/time provenance, no source SQLite writes');
