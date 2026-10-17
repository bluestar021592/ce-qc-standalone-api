import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {createShopeeTemplateWorkbook} from '../src/shopeeTemplateExporter.js';
import {readV788ExistingWhppXlsx} from './v788-existing-whpp-xlsx-readback.mjs';
import {findV788ExistingWhppExport} from './v788-find-existing-whpp-export.mjs';
import {verifiedV788EvidenceCoverage} from '../src/v788WhppStatusCoverage.js';
import {explainV788Gate,presentV788AuditGates} from '../src/v788AuditGateMessages.js';
// V788 is exposed only as a deliberate ADMIN action inside the QC APP.
// No startup auto-query and no status endpoint that leaks shipment identifiers.
const genuine={verified:true,distributionMatchesV3:true,storedMembers:346,batches:8,
  byDate:{
    '2026-07-01':{s60:166,s80:0,s81:24,other:0},
    '2026-07-02':{s60:124,s80:0,s81:32,other:0}
  }};
const projected=verifiedV788EvidenceCoverage(genuine);
assert.equal(projected.independentlyVerifiedCounts,true);
assert.equal(projected.savedMembers,346);
assert.equal(projected.completedBatches,8);
assert.equal(projected.pod,290);
assert.equal(projected.returned,56);
assert.equal(projected.statusOnlyPreview.dates.length,2);
assert.equal(projected.statusOnlyPreview.signingTimeAccepted,false);
assert.equal(projected.statusOnlyPreview.ledgerAccepted,false);
assert.equal(projected.statusOnlyPreview.exportAccepted,false);
const friendly=presentV788AuditGates([
  {id:'WHPP_INDEPENDENT_TMS_346',status:'PASS',detail:{}},
  {id:'WHPP_LEDGER_VS_CURRENT',status:'BLOCK',
    detail:{openLedgerWithPODOrReturned:346,terminalLedgerWithUnfinished:0}},
  {id:'WHPP_POD_SIGNING_TIME',status:'REVIEW',
    detail:{podMembers:290,trustedSavedPodTimes:0,missingTrustedSavedPodTimes:290}},
  {id:'REAL_EXCEL_DETAIL_READBACK',status:'REVIEW',detail:{}}
]);
assert.equal(friendly.length,4);
assert.equal(friendly[0].status,'PASS');
assert.match(friendly[1].summary,/346/);
assert.match(friendly[2].summary,/290/);
assert.match(friendly[3].next,/真实Excel/);
assert.equal(JSON.stringify(friendly).includes('shipmentCode'),false,
  'user-facing acceptance cannot expose raw waybill data');
assert.deepEqual(presentV788AuditGates([]),[]);
assert.match(explainV788Gate({id:'SEVEN_BUSINESS_LATEST_SOURCES',
  detail:{missingRequiredDates:1}}).summary,/缺失 1/);

// Progress JSON may be stale after an interruption, and must NOT supersede
// authoritative exact-member SQLite totals after this projection is applied.
const staleProgress={savedMembers:0,completedBatches:0,pod:0,returned:0};
assert.deepEqual({...staleProgress,...projected}.pod,290);
assert.equal({...staleProgress,...projected}.savedMembers,346);
assert.equal(verifiedV788EvidenceCoverage({...genuine,verified:false}),null);
assert.equal(verifiedV788EvidenceCoverage({...genuine,batches:7}),null);
assert.equal(verifiedV788EvidenceCoverage({...genuine,byDate:{
  ...genuine.byDate,'2026-07-01':{s60:167,s80:0,s81:23,other:0}}}),null);
const server=fs.readFileSync('server.js','utf8');
const ui=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const activeShell=fs.readFileSync('public/v625-shell.html','utf8');
const activeJs=fs.readFileSync('public/v625-shell.js','utf8');
assert.match(activeShell,/id="v788WhppEvidencePanel"/,
  'real V625 settings MUST render the feature; legacy index.html does not render on /settings');
assert.match(activeShell,/id="v788WhppEvidenceStart"/);
assert.match(activeShell,/id="v788ReadOnlyAuditStart"/,
  'real settings must expose the no-download read-only audit action');
assert.match(server,/new V788AuditWorker\(/,
  'read-only acceptance must run off the backend event loop');
const readonlyWorker=fs.readFileSync('scripts/v788-inapp-readonly-audit-worker.mjs','utf8');
assert.match(readonlyWorker,/verifyV788PersistedSidecar\(proofDb,signature\)/,
  'in-app full audit must independently reverify persisted per-waybill TMS evidence');
assert.match(readonlyWorker,/ISOLATED_DATABASE_AUDIT/,
  'old database schema unavailability must be reported without suppressing independently valid TMS evidence');
assert.match(readonlyWorker,/readyToPublish:false/,
  'independent TMS success must never become permission to publish');
assert.match(activeJs,/独立TMS证据库：已核实346票逐票成员/,
  'real settings must separate independent TMS evidence from legacy DB reconciliation');
assert.match(server,/app\.post\('\/api\/v788\/readonly-audit\/start',requireRole\('ADMIN'\)/,
  'audit must be explicit ADMIN action, not an automatic startup scan');
assert.match(server,/acknowledgeReadOnlyAudit!==true/,
  'read-only audit must require explicit opt-in');
assert.match(activeJs,/只读核验现有隔离副本/,
  'read-only acceptance must be actionable without command files');
assert.match(activeJs,/String\(gate\.summary\|\|/,
  'real settings must display readable audit findings rather than raw technical JSON');
assert.match(fs.readFileSync('scripts/v788-inapp-readonly-audit-worker.mjs','utf8'),
  /presentV788AuditGates\(gates\)/,
  'worker must project individual results to privacy-safe user guidance');
assert.match(activeShell,/data-settings-panel="interface"/);
assert.match(activeJs,/loadV788WhppEvidenceV625/);
assert.match(activeJs,/startV788WhppEvidenceV625/);
assert.match(activeJs,/if\(name==='interface'\)void loadSettings\(\)\.then\(\(\)=>loadV788WhppEvidenceV625\(\)\)/);
assert.match(activeJs,/acknowledgeIsolatedQuery:true/);
assert.match(activeJs,/sidecarVerified===true/);
assert.match(activeJs,/CE系统接口凭证未就绪/);
assert.match(activeJs,/data.isolatedSourceReady!==true/);
assert.match(server,/isolatedSourceReady=process.platform==='win32'&&v788IsRegularExactFile\(v788SourceCopy\)/);
assert.match(server,/code:'V788_ISOLATED_SOURCE_MISSING'/);
assert.match(activeJs,/needsReview\|\|loginRequired/);
assert.match(activeJs,/byId\('v788WhppEvidenceStart'\)\?\.addEventListener\('click',startV788WhppEvidenceV625\)/);

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
assert.match(server,/new V788ReadOnlyDatabaseSync\(v788SourceCopy,\{readOnly:true\}\)/);
assert.match(server,/v788ReadSourceMembershipSignature\(srcDb\)/);
assert.match(server,/actualSourceSignature!==reportSignature/);
assert.match(server,/if\(v788IsRegularExactFile\(v788StageReport\)\)/,
  'JSON report must be read only from an exact safe regular file');
assert.match(server,/REPORT_MISSING_OR_UNSAFE_USING_SQLITE_PROOF/,
  'missing report cannot prevent independent source + sidecar verification');
assert.match(server,/REPORT_UNREADABLE_USING_SQLITE_PROOF/,
  'malformed progress JSON cannot conceal valid saved status evidence');
assert.match(server,/STALE_REPORT_SIGNATURE_USING_SQLITE_PROOF/,
  'a stale JSON signature must not outweigh a fresh independent SQLite comparison');

assert.match(server,/if\(checked\.verified===true\)\{/,
  'only independently verified SQLite status evidence may produce a completed preview');
assert.ok(server.includes('saved.statusOnlyPreview=independentlyVerifiedCoverage.statusOnlyPreview'),
  'verified proof must supply the historical status preview');
assert.ok(fs.readFileSync('src/v788WhppStatusCoverage.js','utf8').includes('signingTimeAccepted:false,ledgerAccepted:false,exportAccepted:false'));
assert.match(ui,/WHPP历史状态只读预览可用/);
assert.match(ui,/试用范围只限上述历史状态只读预览/);


assert.match(server,/verifyV788PersistedSidecar\(checkDb,actualSourceSignature\)/);
assert.match(server,/saved\.sidecarVerified=checked\.verified===true/);
assert.match(server,/previewV788WhppLedgerReconciliation\(/,
  'status route must reconcile ledger only from independently opened SQLite proof');
assert.match(server,/summarizeV788WhppPodTimeSources\(/,
  'real ADMIN route must list saved signing-time sources without querying TMS');
assert.match(activeJs,/隔离库签收时间来源诊断/,
  'active V625 view must distinguish missing time from conflicting candidates');
assert.match(activeJs,/候选时间尚未批准用于签收天数/,
  'saved time candidates cannot be presented as formal signing-day acceptance');
assert.match(activeJs,/无冲突且无重复来源候选/,
  'review-required candidates must not be included in the unambiguous count');
assert.match(activeJs,/data\.ledgerReconciliation/,
  'V625 must display aggregate ledger differences instead of requiring manual commands');
assert.match(activeJs,/尚未修改历史账本或正式数据库/,
  'preview must never claim the ledger has been repaired');
assert.match(activeJs,/历史账本待核验：状态表缺失或重复/,
  'blocked ledger preview must explain current-state missing/duplicate evidence');
assert.match(activeJs,/账本缺失或重复/,
  'blocked preview must explain historical ledger missing/duplicate evidence');
assert.match(activeJs,/相反终态/,
  'blocked preview must label opposite TMS terminal conflicts');
assert.match(activeJs,/差异次数，并非去重运单票数/,
  'state and ledger differences must never be mistaken for unique shipments');
assert.match(activeJs,/ISOLATED_LEDGER_PREVIEW_UNAVAILABLE/,
  'missing source ledger table must be reported as unavailable, not zero problems');


assert.match(server,/saved\.independentPodTimeEvidenceChecked=true/,
  'read-only status panel may display independent POD time count only after signed SQLite proof verification');
assert.match(server,/checked\.trustedExplicitPodTimes/,
  'POD time count must come from the independently opened sidecar, never a JSON progress count');
assert.match(server,/checked\.missingTrustedExplicitPodTimes/);
assert.match(activeJs,/data\.independentPodTimeEvidenceChecked===true/,
  'real V625 interface must label independent signing-time coverage explicitly');
assert.match(activeJs,/该证据尚未写入正式签收时间账本/,
  'time evidence from isolated proof is not yet formal signing-day acceptance');

assert.match(ui,/data.sidecarVerified===true/);

assert.match(server,/distributionMatchesV3:data\?\.coverage\?\.distributionMatchesV3===true/);
assert.ok(server.includes('independentlyVerifiedCoverage=verifiedV788EvidenceCoverage(checked)'),
  'SQLite proof must be projected independently of progress JSON');
assert.ok(server.includes('...(independentlyVerifiedCoverage||{})'),
  'verified coverage must override any stale JSON progress totals');
assert.ok(activeJs.includes('data.independentlyVerifiedCounts===true'),
  'completed status-only preview must require independently verified counts');
assert.ok(!activeJs.includes("data.savedStatus==='346_TMS_ROWS_STAGED_NOT_BUSINESS_ACCEPTED'"),
  'a stale final JSON report must not force another 346-waybill query');

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
assert.match(ui,/const offlineFinalize=restartFinalize&&covered===346&&batches===8/);
assert.match(ui,/\(loginMissing&&!offlineFinalize\)/);
assert.match(ui,/loginMissing&&!isFull&&!offlineFinalize/);
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
import {strictWhppTmsBatch,initV788Sidecar,stageV788Batch,inspectV788Sidecar,v788SourceSignature,verifyV788PersistedSidecar,v788ReadSourceMembershipSignature,previewV788WhppLedgerReconciliation}
  from './v788-whpp-tms-evidence-sidecar.mjs';
import {runV788Stage} from './v788-whpp-stage-tms-evidence.mjs';
import {summarizeV788WhppPodTimeSources} from './v788-whpp-pod-time-source-inventory.mjs';

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
  // A separate original-source read must independently reproduce the
  // fingerprint; a perfectly shaped sidecar cannot validate itself.
  const sourceDb=new DatabaseSync(':memory:');
  try{
    sourceDb.exec("CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT)");
    const write=sourceDb.prepare("INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode) VALUES('WHPP',?,?)");
    for(const day of all)for(const code of day.codes)write.run(day.date,code);
    assert.equal(v788ReadSourceMembershipSignature(sourceDb),sig);
    // Same member COUNT but different member ID must fail source equality.
    sourceDb.prepare("UPDATE business_daily_parse_rows SET shipmentCode='ALTERED_CODE' WHERE reportDate='2026-07-01' AND shipmentCode=?").run(all[0].codes[0]);
    assert.notEqual(v788ReadSourceMembershipSignature(sourceDb),sig);
    sourceDb.prepare("DELETE FROM business_daily_parse_rows WHERE reportDate='2026-07-02' AND shipmentCode=?").run(all[1].codes[0]);
    assert.throws(()=>v788ReadSourceMembershipSignature(sourceDb),/V788_ISOLATED_SOURCE_MEMBERSHIP_CHANGED/);
  }finally{sourceDb.close()}
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
  // A saved old RETURNING label is a normal predecessor of latest TMS 81;
  // opposite POD vs RETURNING remains a real contradiction.
  const returningMember=all[0].codes.at(-1);
  all[0].states.set(returningMember,'RETURNING');
  const completedFromReturning=inspectV788Sidecar(db,all);
  assert.equal(completedFromReturning.complete,true);
  assert.equal(completedFromReturning.conflictingExistingStates,0);
  all[0].states.set(returningMember,'RETURNED');
  all[0].states.set(all[0].codes[0],'RETURN_IN_PROGRESS');
  const podFromReturning=inspectV788Sidecar(db,all);
  assert.equal(podFromReturning.complete,false);
  assert.equal(podFromReturning.conflictingExistingStates,1);
  all[0].states.set(all[0].codes[0],'POD');
  assert.equal(verifyV788PersistedSidecar(db,sig).verified,true,
    'actual SQLite evidence proves all 346 terminal statuses and 8 batches');
  // Status proof is independent from signing-time proof. Do not infer a
  // successful signing timestamp just because TMS returned code 60.
  const initialProof=verifyV788PersistedSidecar(db,sig);
  assert.equal(initialProof.trustedExplicitPodTimes,0);
  assert.equal(initialProof.missingTrustedExplicitPodTimes,290);
  assert.equal(initialProof.invalidStoredEvidence,0);
  const podOne=all[0].codes[0],returnOne=all[0].codes.at(-1);
  const setPodTime=db.prepare('UPDATE v788_tms_evidence SET explicitPodTime=? WHERE reportDate=? AND shipmentCode=?');
  setPodTime.run('2026-07-04 10:00:00','2026-07-01',podOne);
  const oneTime=verifyV788PersistedSidecar(db,sig);
  assert.equal(oneTime.verified,true);
  assert.equal(oneTime.trustedExplicitPodTimes,1);
  assert.equal(oneTime.missingTrustedExplicitPodTimes,289);
  setPodTime.run('2026-06-30 11:00:00','2026-07-01',podOne);
  const beforeSourceDay=verifyV788PersistedSidecar(db,sig);
  assert.equal(beforeSourceDay.verified,false);
  assert.equal(beforeSourceDay.invalidStoredEvidence,1);
  assert.equal(beforeSourceDay.reason,'SAVED_PROOF_TIME_OR_DIGEST_INVALID');
  setPodTime.run('','2026-07-01',podOne);
  setPodTime.run('2026-07-05 12:00:00','2026-07-01',returnOne);
  assert.equal(verifyV788PersistedSidecar(db,sig).verified,false,
    'status 81 must never claim a POD time');
  setPodTime.run('','2026-07-01',returnOne);
  const oldDigest=db.prepare('SELECT apiDigest FROM v788_tms_evidence WHERE reportDate=? AND shipmentCode=?').get('2026-07-01',podOne).apiDigest;
  db.prepare('UPDATE v788_tms_evidence SET apiDigest=? WHERE reportDate=? AND shipmentCode=?').run('INVALID','2026-07-01',podOne);
  assert.equal(verifyV788PersistedSidecar(db,sig).verified,false,
    'malformed signed API evidence digest cannot be accepted');
  db.prepare('UPDATE v788_tms_evidence SET apiDigest=? WHERE reportDate=? AND shipmentCode=?').run(oldDigest,'2026-07-01',podOne);
  assert.equal(verifyV788PersistedSidecar(db,sig).verified,true);
  assert.throws(()=>stageV788Batch(db,{date:'2026-07-01',index:0,
    codes:all[0].codes.slice(0,50),
    rows:all[0].codes.slice(0,50).map((code,index)=>({
      shipmentCode:code,shipmentStatus:'60',
      ...(index===0?{signedAt:'2026-07-04 10:00:00'}:{})
    }))}),/V788_BATCH_REPLAY_EXPLICIT_POD_TIME_CHANGED/,
    'same terminal status with a newly different signedAt must not be silently discarded');

  // Two independently opened read-only inputs: historical source/current/
  // ledger versus the exact 346-member TMS proof. Nothing is updated.
  const compareDb=new DatabaseSync(':memory:');
  try{
    compareDb.exec("CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);"+
      "CREATE TABLE shipment_current_state(businessType TEXT,reportDate TEXT,shipmentCode TEXT,state TEXT,stateJson TEXT);"+
      "CREATE TABLE qc_tracking_ledger(businessType TEXT,shipmentCode TEXT,trackingStatus TEXT,terminalReason TEXT)");
    const src=compareDb.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?)");
    const current=compareDb.prepare("INSERT INTO shipment_current_state VALUES('WHPP',?,?,?,?)");
    const led=compareDb.prepare("INSERT INTO qc_tracking_ledger VALUES('WHPP',?,?,?)");
    for(const day of all){
      for(const code of day.codes){
        const pod=day.states.get(code)==='POD';
        const stale=day.date==='2026-07-01'&&(code==='J0000'||code==='J0189');
        src.run(day.date,code);
        current.run(day.date,code,stale?'OPEN':pod?'POD':'RETURNED','{}');
        led.run(code,stale?'OPEN':'TERMINAL',stale?'':pod?'POD':'RETURNED');
      }
    }
    // An isolated source may have NO saved signing timestamps: report
    // missing evidence explicitly instead of using TMS 60 as a fake POD day.
    compareDb.exec('PRAGMA query_only=ON');
    const emptyTimeInventory=summarizeV788WhppPodTimeSources(compareDb,db,sig);
    assert.equal(emptyTimeInventory.podMembers,290);
    assert.equal(emptyTimeInventory.timeCandidateMembers,0);
    assert.equal(emptyTimeInventory.missingTimeMembers,290);
    assert.equal(emptyTimeInventory.signingTimeAccepted,false);
    compareDb.exec('PRAGMA query_only=OFF');
    compareDb.exec(
      "CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,podTime TEXT,source TEXT);"+
      "CREATE TABLE business_shipment_tracks(businessType TEXT,reportDate TEXT,shipmentCode TEXT,shipmentStatus TEXT,rawJson TEXT);"+
      "CREATE TABLE business_track_events(id INTEGER PRIMARY KEY,businessType TEXT,reportDate TEXT,shipmentCode TEXT,rawJson TEXT);"+
      "CREATE TABLE business_scan_results(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,orderStatus TEXT,rawJson TEXT);"+
      "CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,rawJson TEXT)"
    );
    compareDb.prepare("INSERT INTO business_pod_locks VALUES('WHPP',?,?,?)")
      .run('J0000','2026-07-04 10:00:00','whpp_saved_scan_pod_time');
    compareDb.prepare("INSERT INTO business_shipment_tracks VALUES('WHPP','2026-07-01','J0000','60',?)")
      .run(JSON.stringify({shipmentStatus:'60',signedAt:'2026-07-04 10:00:00'}));
    const insertScan=compareDb.prepare("INSERT INTO business_scan_results VALUES('WHPP','2026-07-01',?,1,'85',?)");
    const insertFinal=compareDb.prepare("INSERT INTO business_final_rows VALUES('WHPP','2026-07-01',?,1,?)");
    insertScan.run('J0000',JSON.stringify({podTime:'2026-07-04 10:00:00'}));
    insertFinal.run('J0000',JSON.stringify({signedAt:'2026-07-04 10:00:00'}));
    insertScan.run('J0001',JSON.stringify({signedAt:'2026-07-05 10:00:00'}));
    insertFinal.run('J0001',JSON.stringify({signedAt:'2026-07-06 10:00:00'}));
    insertScan.run('J0002',JSON.stringify({lastUpdateDate:'2026-07-07 15:00:00'}));
    // Two different named POD timestamps within ONE saved scan must be
    // detected as conflicting rather than accepting the first field only.
    insertScan.run('J0004',JSON.stringify({
      podTime:'2026-07-09 10:00:00',signedAt:'2026-07-10 11:00:00'
    }));
    // A duplicate TMS source row cannot be treated as a clean signing
    // candidate even when a separate valid scan timestamp exists.
    compareDb.prepare("INSERT INTO business_shipment_tracks VALUES('WHPP','2026-07-01','J0005','60',?)")
      .run(JSON.stringify({shipmentStatus:'60',signedAt:'2026-07-09 11:00:00'}));
    compareDb.prepare("INSERT INTO business_shipment_tracks VALUES('WHPP','2026-07-01','J0005','60',?)")
      .run(JSON.stringify({shipmentStatus:'60',signedAt:'2026-07-10 11:00:00'}));
    insertScan.run('J0005',JSON.stringify({signedAt:'2026-07-10 11:00:00'}));
    const insertEvent=compareDb.prepare("INSERT INTO business_track_events(businessType,reportDate,shipmentCode,rawJson) VALUES('WHPP','2026-07-01',?,?)");
    insertEvent.run('J0002',JSON.stringify({signedAt:'2026-07-08 13:00:00'}));
    // Generic eventTime must never become a POD date.
    insertEvent.run('J0003',JSON.stringify({eventTime:'2026-07-10 16:00:00',lastUpdateDate:'2026-07-11 12:00:00'}));
    // Returned shipments are never included in the signing-time POD count.
    compareDb.prepare("INSERT INTO business_pod_locks VALUES('WHPP',?,?,?)")
      .run('J0189','2026-07-08 12:00:00','whpp_saved_scan_pod_time');
    compareDb.exec('PRAGMA query_only=ON');
    const inventory=summarizeV788WhppPodTimeSources(compareDb,db,sig);
    assert.equal(inventory.available,true);
    assert.equal(inventory.podMembers,290);
    assert.equal(inventory.timeCandidateMembers,5);
    assert.equal(inventory.missingTimeMembers,285);
    assert.equal(inventory.conflictingTimeMembers,2,
      'different explicit signing moments must remain a manual evidence conflict');
    assert.equal(inventory.unambiguousTimeCandidateMembers,2);
    assert.equal(inventory.ambiguousSourceMembers,1,
      'duplicate saved evidence must not appear as unambiguous signed time');
    assert.equal(inventory.manualReviewMembers,3,
      'count distinct POD members needing time or source ambiguity review');
    assert.equal(inventory.byDate['2026-07-01'].unambiguousTimeCandidateMembers,2);
    assert.equal(inventory.bySource.sidecar,0);
    assert.equal(inventory.bySource.podLock,1);
    assert.equal(inventory.bySource.savedTrack,1);
    assert.equal(inventory.bySource.savedEvent,1);
    assert.equal(inventory.bySource.savedScan,4);
    assert.equal(inventory.bySource.savedFinal,2);
    assert.equal(inventory.signingTimeAccepted,false);
    assert.equal(inventory.productionModified,false);
    assert.equal(JSON.stringify(inventory).includes('J0000'),false,
      'POD time inventory must not leak shipment identifiers');
    const beforeSource=compareDb.prepare('SELECT total_changes() AS n').get().n;
    const beforeSidecar=db.prepare('SELECT total_changes() AS n').get().n;
    const recon=previewV788WhppLedgerReconciliation(compareDb,db,sig);
    assert.equal(recon.ready,true,'fully verified sidecar permits a READ-ONLY delta preview');
    assert.equal(recon.sourceMembers,346);
    assert.equal(recon.strictPOD,290);
    assert.equal(recon.strictReturned,56);
    assert.equal(recon.currentNeedsPODSync,1);
    assert.equal(recon.currentNeedsReturnedSync,1);
    assert.equal(recon.ledgerNeedsPODSync,1);
    assert.equal(recon.ledgerNeedsReturnedSync,1);
    assert.equal(recon.currentOppositeTerminal,0);
    assert.equal(recon.ledgerOppositeTerminal,0);
    assert.equal(recon.productionModified,false);
    assert.equal(recon.exportAccepted,false);
    assert.equal(compareDb.prepare('SELECT total_changes() AS n').get().n,beforeSource);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n,beforeSidecar);
    assert.ok(!JSON.stringify(recon).includes('J0000'),'no shipment identifier may leak into preview');
    const bad=previewV788WhppLedgerReconciliation(compareDb,db,'a'.repeat(64));
    assert.equal(bad.ready,false,'wrong source signature cannot produce reconciliation');
    assert.equal(bad.productionModified,false);
    compareDb.exec('PRAGMA query_only=OFF');
    compareDb.prepare("UPDATE shipment_current_state SET state='RETURNED' WHERE shipmentCode='J0000'").run();
    compareDb.exec('PRAGMA query_only=ON');
    const contradiction=previewV788WhppLedgerReconciliation(compareDb,db,sig);
    assert.equal(contradiction.ready,false,'reverse terminal conflict must never be auto-closed');
    assert.equal(contradiction.currentOppositeTerminal,1);
    assert.equal(contradiction.reason,'RECONCILIATION_REQUIRES_MANUAL_REVIEW');
    // A stale RETURNING state is incompatible with new POD, but the normal
    // precursor to a completed return. Only the first must block sync.
    compareDb.exec('PRAGMA query_only=OFF');
    compareDb.prepare("UPDATE shipment_current_state SET state='RETURN_IN_PROGRESS' WHERE shipmentCode='J0000'").run();
    compareDb.exec('PRAGMA query_only=ON');
    const returningVsPod=previewV788WhppLedgerReconciliation(compareDb,db,sig);
    assert.equal(returningVsPod.ready,false);
    assert.equal(returningVsPod.currentOppositeTerminal,1,
      'TMS 60 vs RETURN_IN_PROGRESS must block closure');
    compareDb.exec('PRAGMA query_only=OFF');
    compareDb.prepare("UPDATE shipment_current_state SET state='RETURNING' WHERE shipmentCode='J0189'").run();
    compareDb.prepare("UPDATE shipment_current_state SET state='OPEN' WHERE shipmentCode='J0000'").run();
    compareDb.exec('PRAGMA query_only=ON');
    const returningVsReturned=previewV788WhppLedgerReconciliation(compareDb,db,sig);
    assert.equal(returningVsReturned.ready,true);
    assert.equal(returningVsReturned.currentOppositeTerminal,0);
    assert.equal(returningVsReturned.currentNeedsReturnedSync,1,
      'TMS 81 must be eligible to complete an older RETURNING member');
    assert.equal(returningVsReturned.reason,'READONLY_RECONCILIATION_PREVIEW_ONLY');

  }finally{compareDb.close()}

  // Generate a REAL XLSX using the production exporter, reopen and compare
  // its actual cells with an independently opened 346-member source and
  // sidecar strict status truth. Nothing touches the formal Windows DB.
  const xlsxTemp=await fsPromises.mkdtemp(path.join(os.tmpdir(),'v788-existing-whpp-'));
  const xlsxSource=new DatabaseSync(':memory:');
  try{
    xlsxSource.exec('CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT)');
    const addSource=xlsxSource.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?)");
    const snapshotRows=all.map(day=>{
      const rows=day.codes.map(code=>{
        addSource.run(day.date,code);
        const isPod=day.states.get(code)==='POD';
        return {
          shipmentCode:code,reportDate:day.date,businessType:'WHPP',
          currentState:isPod?'POD':'RETURNED',
          terminalEvidenceStatus:'STRICT_TMS',
          shipmentStatus:isPod?'60':'81',
          isPod:isPod?1:0,是否POD:isPod?'是':'否',
          是否退回:isPod?'否':'是',退回状态:isPod?'':'已退回',
          regionCode:'PP',signingDays:null
        };
      });
      return {snapshotId:'V788-'+day.date,reportDate:day.date,payload:{finalRows:rows}};
    });
    const made=await createShopeeTemplateWorkbook({
      type:'WHPP',periodType:'custom',
      range:{from:'2026-07-01',to:'2026-07-02'},
      snapshots:snapshotRows,outputDir:xlsxTemp
    });
    const discovered=findV788ExistingWhppExport(xlsxTemp);
    assert.equal(discovered.status,'FOUND','one-click audit must locate a genuine existing export');
    assert.equal(discovered.file,made.file);
    assert.equal(discovered.kind,'COMBINED');
    assert.equal(findV788ExistingWhppExport(path.join(xlsxTemp,'not-created')).status,'NOT_FOUND',
      'missing export must stay missing, never trigger an export or synthetic pass');

    // Users may have ALREADY exported the two days separately rather than
    // generating one combined report. Both must be present and independently
    // verified; one date alone can NEVER claim 346-member completeness.
    const dailyDir=path.join(xlsxTemp,'existing-daily');
    await fsPromises.mkdir(dailyDir);
    const firstDay=await createShopeeTemplateWorkbook({
      type:'WHPP',periodType:'daily',
      range:{from:all[0].date,to:all[0].date},
      snapshots:[snapshotRows[0]],outputDir:dailyDir
    });
    const onlyOne=findV788ExistingWhppExport(dailyDir);
    assert.equal(onlyOne.status,'NOT_FOUND');
    assert.equal(onlyOne.reason,'DAILY_PAIR_INCOMPLETE');
    const secondDay=await createShopeeTemplateWorkbook({
      type:'WHPP',periodType:'daily',
      range:{from:all[1].date,to:all[1].date},
      snapshots:[snapshotRows[1]],outputDir:dailyDir
    });
    const dailyPair=findV788ExistingWhppExport(dailyDir);
    assert.equal(dailyPair.status,'FOUND');
    assert.equal(dailyPair.kind,'TWO_DAILY');
    assert.deepEqual(dailyPair.workbookEntries.map(x=>x.file),[firstDay.file,secondDay.file]);
    const dailyReadback=await readV788ExistingWhppXlsx({
      sourceDb:xlsxSource,proofDb:db,workbookEntries:dailyPair.workbookEntries
    });
    assert.equal(dailyReadback.status,'XLSX_CONTENT_VERIFIED');
    assert.equal(dailyReadback.readbackRows,346);
    assert.equal(dailyReadback.readbackPodRows,290);
    assert.equal(dailyReadback.readbackReturnedRows,56);
    const wrongDateScope=await readV788ExistingWhppXlsx({
      sourceDb:xlsxSource,proofDb:db,
      workbookEntries:dailyPair.workbookEntries.map((x,i)=>({
        file:x.file,expectedDates:[all[1-i].date]
      }))
    });
    assert.equal(wrongDateScope.status,'BLOCKED',
      'real daily Excel rows cannot be credited to the wrong source day');
    assert.equal(wrongDateScope.issues.unexpectedDateRows,346);
    await assert.rejects(readV788ExistingWhppXlsx({
      sourceDb:xlsxSource,proofDb:db,
      workbookEntries:dailyPair.workbookEntries.map((x,i)=>({
        file:firstDay.file,expectedDates:[all[i].date]
      }))
    }),/V788_XLSX_DATE_SCOPE_INVALID/,
    'the same Excel file cannot count as both original days');
    xlsxSource.exec('PRAGMA query_only=ON');
    const beforeRead=xlsxSource.prepare('SELECT total_changes() n').get().n;
    const actual=await readV788ExistingWhppXlsx({
      sourceDb:xlsxSource,proofDb:db,workbookPath:made.file
    });
    assert.equal(actual.status,'XLSX_CONTENT_VERIFIED');
    assert.equal(actual.sourceMembers,346);
    assert.equal(actual.readbackRows,346);
    assert.equal(actual.readbackPodRows,290);
    assert.equal(actual.readbackReturnedRows,56);
    assert.equal(actual.xlsxUnchangedDuringReadback,true);
    if(process.platform!=='win32'){
      // A symlink can point at a perfectly correct XLSX; the readback still
      // must reject it instead of following a mutable alias to a new file.
      const alias=path.join(xlsxTemp,'linked-source.xlsx');
      await fsPromises.symlink(made.file,alias,'file');
      const linkedFolder=path.join(os.tmpdir(),'v788-export-linked-'+path.basename(xlsxTemp));
      await fsPromises.symlink(xlsxTemp,linkedFolder,'dir');
      try{
        assert.equal(findV788ExistingWhppExport(linkedFolder).status,'UNAVAILABLE',
          'an export directory redirection must never qualify as a real workbook');
      }finally{await fsPromises.rm(linkedFolder,{force:true})}
      await assert.rejects(
        readV788ExistingWhppXlsx({sourceDb:xlsxSource,proofDb:db,workbookPath:alias}),
        /V788_XLSX_NOT_SAFE_REGULAR_FILE/
      );
    }
    assert.equal(actual.allSevenBusinessExportAccepted,false);
    assert.equal(xlsxSource.prepare('SELECT total_changes() n').get().n,beforeRead);
    assert.ok(!JSON.stringify(actual).includes('J0000'),'aggregate readback may not leak waybills');
    // Same row count but another bill: block wrong-member substitutions.
    const changed=new ExcelJS.Workbook();
    await changed.xlsx.readFile(made.file);
    changed.getWorksheet('全部明细').getRow(2).getCell(2).value='V788_NOT_A_SOURCE_BILL';
    const corrupt=path.join(xlsxTemp,'changed-whpp.xlsx');
    await changed.xlsx.writeFile(corrupt);
    const wrongBill=await readV788ExistingWhppXlsx({
      sourceDb:xlsxSource,proofDb:db,workbookPath:corrupt
    });
    assert.equal(wrongBill.status,'BLOCKED');
    assert.equal(wrongBill.issues.missingMembers,1);
    assert.equal(wrongBill.issues.extraMembers,1);
    // Restored member but false signed status: do not accept a workbook
    // that presents a true return as POD or vice versa.
    changed.getWorksheet('全部明细').getRow(2).getCell(2).value=all[0].codes[0];
    changed.getWorksheet('全部明细').getRow(2).getCell(4).value='R';
    const badMark=path.join(xlsxTemp,'wrong-marker.xlsx');
    await changed.xlsx.writeFile(badMark);
    const markerError=await readV788ExistingWhppXlsx({
      sourceDb:xlsxSource,proofDb:db,workbookPath:badMark
    });
    assert.equal(markerError.status,'BLOCKED');
    assert.ok(markerError.issues.terminalMarkerMismatch>=1);
    // A correct all-detail sheet cannot conceal a falsified marker in a
    // separate POD/return sheet. Read back each actual XLSX tab.
    const alteredPod=new ExcelJS.Workbook();
    await alteredPod.xlsx.readFile(made.file);
    alteredPod.getWorksheet('POD明细').getRow(2).getCell(4).value='R';
    const podMarkerPath=path.join(xlsxTemp,'wrong-pod-tab-marker.xlsx');
    await alteredPod.xlsx.writeFile(podMarkerPath);
    const podMarkerError=await readV788ExistingWhppXlsx({
      sourceDb:xlsxSource,proofDb:db,workbookPath:podMarkerPath
    });
    assert.equal(podMarkerError.status,'BLOCKED');
    assert.ok(podMarkerError.issues.terminalMarkerMismatch>=1);

    const alteredReturn=new ExcelJS.Workbook();
    await alteredReturn.xlsx.readFile(made.file);
    alteredReturn.getWorksheet('退回明细').getRow(2).getCell(4).value='Y';
    const returnMarkerPath=path.join(xlsxTemp,'wrong-return-tab-marker.xlsx');
    await alteredReturn.xlsx.writeFile(returnMarkerPath);
    const returnMarkerError=await readV788ExistingWhppXlsx({
      sourceDb:xlsxSource,proofDb:db,workbookPath:returnMarkerPath
    });
    assert.equal(returnMarkerError.status,'BLOCKED');
    assert.ok(returnMarkerError.issues.terminalMarkerMismatch>=1);
    // Proof disappears: still check exact membership, but never certify
    // terminal status based solely on an untrusted workbook label.
    const missingProofDb=new DatabaseSync(':memory:');
    try{
      initV788Sidecar(missingProofDb,sig);
      const without=await readV788ExistingWhppXlsx({
        sourceDb:xlsxSource,proofDb:missingProofDb,workbookPath:made.file
      });
      assert.equal(without.status,'MEMBERSHIP_ONLY_NEEDS_TMS');
      assert.equal(without.independentlyVerifiedTms,false);
    }finally{missingProofDb.close()}
  }finally{
    xlsxSource.close();
    await fsPromises.rm(xlsxTemp,{recursive:true,force:true});
  }

  // Replacing a saved waybill with an unrelated ID preserves all eight
  // batch counters and 290/56 terminal totals, but MUST fail exact proof.
  db.prepare('UPDATE v788_tms_evidence SET shipmentCode=? WHERE reportDate=? AND shipmentCode=?')
    .run('NOT_A_SOURCE_MEMBER','2026-07-01',all[0].codes[0]);
  const wrongMember=verifyV788PersistedSidecar(db,sig);
  assert.equal(wrongMember.distributionMatchesV3,true);
  assert.equal(wrongMember.exactMemberSetMatches,false);
  assert.equal(wrongMember.verified,false);
  db.prepare('UPDATE v788_tms_evidence SET shipmentCode=? WHERE reportDate=? AND shipmentCode=?')
    .run(all[0].codes[0],'2026-07-01','NOT_A_SOURCE_MEMBER');
  assert.equal(verifyV788PersistedSidecar(db,sig).verified,true);

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
const xlsxReadbackSource=fs.readFileSync('scripts/v788-existing-whpp-xlsx-readback.mjs','utf8');
assert.match(xlsxReadbackSource,/fs\.realpathSync\.native\(workbookPath\)/,
  'real source must be checked for path replacement on both sides of readback');
assert.match(xlsxReadbackSource,/stat\.dev,stat\.ino,stat\.size,stat\.mtimeMs,stat\.ctimeMs/,
  'source metadata must detect same-size replacements and inode changes');
assert.match(xlsxReadbackSource,/duplicatedPodAndReturnedMembers:overlap/,
  'same dated waybill must not belong to both XLSX POD and returned detail sheets');
assert.match(xlsxReadbackSource,/podOutsideAllDetail:orphanPod/,
  'orphan POD rows must block XLSX before strict TMS is available');
assert.match(xlsxReadbackSource,/returnedOutsideAllDetail:orphanReturned/,
  'orphan returned rows must block XLSX before strict TMS is available');
const inAppWorker=fs.readFileSync('scripts/v788-inapp-readonly-audit-worker.mjs','utf8');
assert.match(inAppWorker,/findV788ExistingWhppExport\(exportsConfig\.exportsDir\)/,
  'in-app ADMIN audit must try existing real export without generating a file');
assert.match(inAppWorker,/await readV788ExistingWhppXlsx\(/,
  'a discovered existing XLSX must be re-opened and checked against source and TMS');
assert.match(inAppWorker,/WHPP_EXISTING_REAL_XLSX/,
  'WHPP readback must remain a separate gate from seven-business Excel completion');
console.log('[V788] sidecar: 346 exact members, existing export discovery, replay-safe, no source SQLite writes');
