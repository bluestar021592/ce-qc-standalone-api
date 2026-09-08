import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV='test';
const {
  inspectV464WhppOfflineRecovery,
  repairV464WhppOfflineHistory,
  handleV464WhppOfflineRecoveryRequest,
  V464_WHPP_OFFLINE_RECOVERY_ROUTE
}=await import('../src/v464WhppOfflineHistoryRecoveryPatch.js');

for(const file of ['src/v464WhppOfflineHistoryRecoveryPatch.js','public/v464-whpp-offline-history-recovery.js','src/v462WhppSurvivorFastPatch.js','public/v461-whpp-survivor-diagnostic.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const backend=fs.readFileSync('src/v464WhppOfflineHistoryRecoveryPatch.js','utf8');
const ui=fs.readFileSync('public/v464-whpp-offline-history-recovery.js','utf8');
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
const v462=fs.readFileSync('src/v462WhppSurvivorFastPatch.js','utf8');
const v461ui=fs.readFileSync('public/v461-whpp-survivor-diagnostic.js','utf8');

assert.match(backend,/2026-09-08-v464-proof-gated-member-locked-whpp-offline-history-recovery-v1/);
assert.match(backend,/2026-09-08-v468-v462-lazy-exact-route-dispatch-v1/);
assert.match(backend,/export const V464_WHPP_OFFLINE_RECOVERY_ROUTE='\/api\/v464\/whpp-history-offline-recovery'/);
assert.match(backend,/export function handleV464WhppOfflineRecoveryRequest/);
assert.doesNotMatch(backend,/import express from 'express'/,'V464 must be inert and must not import Express at module load');
assert.doesNotMatch(backend,/express\.application\.(?:use|get|post)|previousUse|WRAPPED=Symbol\.for\('ce-qc\.v464/,'V464 must never mutate global Express prototypes');
assert.match(backend,/stateMembershipExact/);
assert.match(backend,/stateDailyFinalCoverageExact/);
assert.match(backend,/stateWorksetExact/);
assert.match(backend,/survivorExact/);
assert.match(backend,/carryLedgerConsistent/);
assert.match(backend,/archiveConfirmExact/);
assert.match(backend,/BEGIN IMMEDIATE/);
assert.match(backend,/V464_POST_WRITE_VERIFY_FAILED/);
assert.match(backend,/x-ce-qc-history-recovery/);
assert.match(backend,/V464_OFFLINE_RECOVERY/);
assert.match(backend,/auditAction, requireRole, sameOriginWriteGuard/,'V464 must reuse canonical audit/write safety middleware');
assert.match(backend,/const requireOperator=requireRole\('OPERATOR'\)/,'V464 repair POST must require OPERATOR or ADMIN');
assert.match(backend,/sameOriginWriteGuard\(req,res,\(\)=>requireOperator\(req,res,\(\)=>executePost\(req,res\)\)\)/,'V464 POST must enforce same-origin before operator-gated repair execution');
assert.match(backend,/WHPP_HISTORY_OFFLINE_RECOVERY/,'successful explicit repair must be audit logged');
assert.match(backend,/apiStatus=\/失败\|retry\/i\.test/,'V464 historical final rows must preserve saved retry truth instead of forcing SUCCESS');
assert.doesNotMatch(backend,/CEClient|axios|https?:\/\/|trackQuery\(|confirmQuery\(|exceptionQuery\(|\/api\/whpp\/run|\/api\/v246\/tracking\/reconcile/,'V464 must remain offline and must never start business processing');
assert.doesNotMatch(backend,/UPDATE\s+(?:shipment_current_state|carryover_open_items|qc_tracking_ledger|business_pod_locks|business_track_events|business_scan_results|business_exception_items)/i,'V464 must not rewrite protected current evidence tables');

assert.match(v462,/2026-09-08-v468-v462-single-hook-lazy-v464-dispatch-v1/);
assert.match(v462,/const V464_ROUTE='\/api\/v464\/whpp-history-offline-recovery'/);
assert.match(v462,/import\('\.\/v464WhppOfflineHistoryRecoveryPatch\.js'\)/,'V462 must lazy-load V464 only on the exact recovery route');
assert.match(v462,/handleV464WhppOfflineHistoryRecoveryRequest|handleV464WhppOfflineRecoveryRequest/,'V462 must delegate to V464 exact-route handler');
assert.equal((v462.match(/express\.application\.use\s*=\s*wrapped/g)||[]).length,1,'V462 must install exactly one Express prototype wrapper assignment; reading previousUse is not a second hook');
assert.match(v462,/export function getV462WhppArchiveEvidence/,'V464 must consume the already-completed isolated archive job read-only');
assert.doesNotMatch(shell,/^\s*import ['"]\.\/v464WhppOfflineHistoryRecoveryPatch\.js['"];?\s*$/m,'V44 startup must not eagerly import V464');
assert.doesNotMatch(shell,/<script\s+src=["']\/v464-whpp-offline-history-recovery\.js/i,'V44 HTML must not eagerly load V464 UI');
assert.match(v461ui,/2026-09-08-v468-v462-survivor-lazy-v464-ui-v1/);
assert.match(v461ui,/v464-whpp-offline-history-recovery\.js\?v=20260908-v468-1/,'V464 UI must be loaded only from the V462 survivor owner with a fresh V468 cache key');
assert.match(v461ui,/else if\(p\.archiveJob\?\.state==='COMPLETED'\)void ensureV464Ui\(\)/,'V464 UI must not load until isolated V266 archive work is completed');

assert.match(ui,/2026-09-08-v464-explicit-proof-gated-offline-whpp-recovery-ui-v2-role-aware/);
assert.match(ui,/canRepair===false/,'VIEWER must not receive an executable repair button');
assert.match(ui,/OPERATOR \/ ADMIN/);
assert.match(ui,/离线恢复/);
assert.match(ui,/X-CE-QC-History-Recovery/);
assert.match(ui,/__CE_QC_V142_HISTORY_AUDIT__\?\.refresh/);
assert.doesNotMatch(ui,/\/api\/whpp\/run\/(?:start|resume)|\/api\/v246\/tracking\/reconcile/,'V464 UI must not start scan/track business processing');
assert.equal((ui.match(/method:'POST'/g)||[]).length,1,'V464 UI has exactly one explicit repair POST site');

{
  let statusCode=200,payload=null,nextCalled=0;
  const res={status(code){statusCode=code;return this;},json(value){payload=value;return this;}};
  const handled=handleV464WhppOfflineRecoveryRequest({path:V464_WHPP_OFFLINE_RECOVERY_ROUTE,method:'GET',user:null,query:{}},res,()=>{nextCalled+=1;});
  assert.equal(handled,true,'exact V464 route must be handled');
  assert.equal(statusCode,401,'unauthenticated V464 GET must fail before any database read');
  assert.equal(payload?.code,'AUTH_REQUIRED');
  assert.equal(nextCalled,0);
  assert.equal(handleV464WhppOfflineRecoveryRequest({path:'/api/other',method:'GET'},res,()=>{}),false,'non-V464 paths must remain completely untouched');
}

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,sourceFile TEXT,totalCount INTEGER,summaryJson TEXT,createdAt TEXT,updatedAt TEXT,PRIMARY KEY(businessType,reportDate));
CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,rowJson TEXT);
CREATE TABLE shipment_current_state(shipmentCode TEXT PRIMARY KEY,businessType TEXT,state TEXT,apiStatus TEXT);
CREATE TABLE carryover_open_items(shipmentCode TEXT PRIMARY KEY,businessType TEXT,status TEXT,closeReason TEXT);
CREATE TABLE qc_tracking_ledger(shipmentCode TEXT PRIMARY KEY,businessType TEXT,firstReportDate TEXT,trackingStatus TEXT,currentState TEXT,lastCheckedAt TEXT);
CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,PRIMARY KEY(businessType,shipmentCode));
CREATE TABLE business_run_locks(businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,completedAt TEXT,updatedAt TEXT);
CREATE TABLE business_run_checkpoints(id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,runId TEXT,reportDate TEXT,stage TEXT,batchIndex INTEGER,totalBatches INTEGER,status TEXT,payloadJson TEXT,errorMessage TEXT,createdAt TEXT,updatedAt TEXT);
CREATE TABLE business_states(businessType TEXT PRIMARY KEY,valueJson TEXT,updatedAt TEXT);
CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,apiStatus TEXT,carryStatus TEXT,latestEventTime TEXT,latestEventDesc TEXT,latestNode TEXT,recipient_raw TEXT,recipient_normalized TEXT,recipient_group TEXT,recipient_group_reason TEXT,source_row_number INTEGER,rawJson TEXT,createdAt TEXT,updatedAt TEXT,PRIMARY KEY(businessType,shipmentCode,reportDate));
CREATE TABLE business_export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT UNIQUE,businessType TEXT,reportDate TEXT,runId TEXT,payloadJson TEXT,generatedAt TEXT,createdAt TEXT,status TEXT,reconciliationStatus TEXT,invalidReason TEXT);
CREATE TABLE business_history_summary(businessType TEXT,reportDate TEXT,summaryJson TEXT,createdAt TEXT,updatedAt TEXT,PRIMARY KEY(businessType,reportDate));
`);
const date='2026-09-01';
const daily=[
  {shipmentCode:'W1',reportDate:date,regionCode:'PP'},
  {shipmentCode:'W2',reportDate:date,regionCode:'PV'},
  {shipmentCode:'W3',reportDate:date,regionCode:'PP'}
];
for(const row of daily)db.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?,?)").run(date,row.shipmentCode,JSON.stringify(row));
db.prepare("INSERT INTO business_daily_reports VALUES('WHPP',?,'9-1.xls',3,?,'','')").run(date,JSON.stringify({batchId:'B1',snapshotId:'IMPORT-S1',total:3}));
for(const row of [
  ['W1','POD','SUCCESS'],['W2','RETURNED','SUCCESS'],['W3','SHOP_ARRIVED_CURRENT','SUCCESS']
])db.prepare("INSERT INTO shipment_current_state VALUES(?,'WHPP',?,?)").run(...row);
for(const row of [['W1','CLOSED','POD'],['W2','CLOSED','RETURNED'],['W3','OPEN','']])db.prepare("INSERT INTO carryover_open_items VALUES(?,'WHPP',?,?)").run(...row);
for(const row of [
  ['W1','TERMINAL','POD','2026-09-01T10:00:00Z'],['W2','TERMINAL','RETURNED','2026-09-01T10:10:00Z'],['W3','OPEN','SHOP_ARRIVED_CURRENT','2026-09-02T08:00:00Z']
])db.prepare("INSERT INTO qc_tracking_ledger VALUES(?,'WHPP',?,?,?,?)").run(row[0],date,row[1],row[2],row[3]);
const finalRows=[
  {shipmentCode:'W1',reportDate:date,currentState:'POD',是否POD:'是',regionCode:'PP'},
  {shipmentCode:'W2',reportDate:date,currentState:'RETURNED',退回状态:'已退回',primaryCategory:'退回',regionCode:'PV'},
  {shipmentCode:'W3',reportDate:date,currentState:'SHOP_ARRIVED_CURRENT',shopState:'SHOP_ARRIVED_CURRENT',regionCode:'PP',API状态:'retry'},
  {shipmentCode:'C1',sourceReportDate:'2026-08-31',currentState:'POD',是否POD:'是',regionCode:'PP'},
  {shipmentCode:'C2',sourceReportDate:'2026-08-31',currentState:'OPEN',primaryCategory:'派送中',regionCode:'PV'}
];
const state={businessType:'WHPP',reportDate:date,pnhBills:['W1','W2','W3'],dailyParseRows:daily,carryBills:['C1','C2'],nextCarryBills:['C1','C2'],finalRows,processing:{runId:'WHPP-0901',phase:'WHPP待重试',running:false,paused:false}};
db.prepare("INSERT INTO business_states VALUES('WHPP',?,'')").run(JSON.stringify(state));
const archiveJob={state:'COMPLETED',truncated:false,readErrors:1,result:{endpoints:{confirm:{requestedDaily:3,responseDaily:3},track:{requestedDaily:0},exception:{requestedDaily:0}}}};
const badArchiveJob={state:'COMPLETED',truncated:false,readErrors:0,result:{endpoints:{confirm:{requestedDaily:3,responseDaily:2},track:{requestedDaily:0},exception:{requestedDaily:0}}}};

const badProof=inspectV464WhppOfflineRecovery(date,db,badArchiveJob);
assert.equal(badProof.repairable,false,'one missing confirm response must fail closed');
assert.ok(badProof.failedChecks.includes('archiveConfirmExact'));
assert.equal(db.prepare("SELECT COUNT(*) count FROM business_final_rows").get().count,0,'failed preflight must not write history');

const beforeCurrent=JSON.stringify(db.prepare("SELECT * FROM shipment_current_state ORDER BY shipmentCode").all());
const beforeCarry=JSON.stringify(db.prepare("SELECT * FROM carryover_open_items ORDER BY shipmentCode").all());
const beforeLedger=JSON.stringify(db.prepare("SELECT * FROM qc_tracking_ledger ORDER BY shipmentCode").all());
const proof=inspectV464WhppOfflineRecovery(date,db,archiveJob);
assert.equal(proof.repairable,true);
assert.equal(proof.members,3);
assert.equal(proof.stateMembers,3);
assert.equal(proof.stateCarry,2);
assert.equal(proof.stateFinalRows,5);
assert.equal(proof.stateDailyFinalCoverage,3);
assert.equal(proof.expectedWorkset,5);
assert.equal(proof.survivor.ledgerKnown,3);
assert.equal(proof.archive.confirmRequestedDaily,3);
assert.equal(proof.archive.confirmResponseDaily,3);
assert.equal(proof.archive.readErrors,1,'one unrelated unread gzip must not defeat exact 3/3 confirm proof');

const result=repairV464WhppOfflineHistory({reportDate:date,db,archiveJobOverride:archiveJob});
assert.equal(result.repaired,true);
assert.equal(result.members,3);
assert.equal(result.historicalFinalRowsWritten,3,'recovery writes only exact daily members, not historical carry rows');
assert.equal(db.prepare("SELECT COUNT(*) count FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").get(date).count,3);
assert.equal(db.prepare("SELECT apiStatus FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? AND shipmentCode='W3'").get(date).apiStatus,'API_PENDING_RETRY','saved retry truth must survive offline history recovery');
const snapshot=db.prepare("SELECT snapshotId,status,reconciliationStatus,payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=?").get(date);
assert.equal(snapshot.status,'VALID');
assert.equal(snapshot.reconciliationStatus,'COMPLETED');
const snapshotPayload=JSON.parse(snapshot.payloadJson);
assert.equal(snapshotPayload.recoveryProof.memberCount,3);
assert.equal(snapshotPayload.state.finalRows.length,5,'snapshot retains the preserved full workset evidence while historical table is member-locked');
const dailyAfter=JSON.parse(db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?").get(date).summaryJson);
assert.equal(dailyAfter.completed,true);
assert.equal(dailyAfter.snapshotStatus,'COMPLETED');
assert.equal(dailyAfter.finalizedSnapshotId,snapshot.snapshotId);
assert.equal(JSON.stringify(db.prepare("SELECT * FROM shipment_current_state ORDER BY shipmentCode").all()),beforeCurrent,'current shipment truth must not change');
assert.equal(JSON.stringify(db.prepare("SELECT * FROM carryover_open_items ORDER BY shipmentCode").all()),beforeCarry,'carry truth must not change');
assert.equal(JSON.stringify(db.prepare("SELECT * FROM qc_tracking_ledger ORDER BY shipmentCode").all()),beforeLedger,'V246 ledger truth must not change');
const stateAfter=JSON.parse(db.prepare("SELECT valueJson FROM business_states WHERE businessType='WHPP'").get().valueJson);
assert.equal(stateAfter.processing.phase,'完成');
assert.equal(stateAfter.finalRows.length,5);
assert.equal(stateAfter.snapshotStatus,'COMPLETED');
const afterProof=inspectV464WhppOfflineRecovery(date,db,archiveJob);
assert.equal(afterProof.recoveredAlready,true);
db.close();
console.log('[V469/V468/V464] inert lazy-route proof-gated offline WHPP history recovery smoke passed · one V462 Express prototype wrapper assignment · no V464 Express prototype hook · V462 exact-path lazy dispatch only · V44 startup stays quarantined · unauthenticated route fails before DB · missing confirm response fails closed · exact daily+carry state workset · V246 full checked evidence · retry truth preserved · member-locked historical writes · current/carry/ledger unchanged · transaction verified · no CE/network');