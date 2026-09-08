import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { inspectV461WhppHistoricalSurvivors } from '../src/v461WhppHistoricalSurvivorDiagnosticPatch.js';
import { inspectV461WhppArchiveEvidence } from '../src/v461WhppArchiveEvidence.js';

const backend=fs.readFileSync('src/v461WhppHistoricalSurvivorDiagnosticPatch.js','utf8');
const archiveSource=fs.readFileSync('src/v461WhppArchiveEvidence.js','utf8');
const ui=fs.readFileSync('public/v461-whpp-survivor-diagnostic.js','utf8');
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');

assert.match(backend,/2026-09-08-v461-whpp-historical-survivor-evidence-v1/);
assert.match(backend,/2026-09-08-v461-after-access-identity-authenticated-readonly-route-v1/);
assert.match(backend,/2026-09-08-v461-bare-indexed-member-join-v1/);
assert.match(backend,/\/api\/v461\/whpp-history-survivor/);
assert.match(backend,/candidates\.some\(fn=>fn\.name==='accessIdentity'\)/,'V461 route must install only after accessIdentity');
assert.match(backend,/if\(!req\.user\)return res\.status\(401\)/,'V461 route must require authenticated req.user');
assert.match(backend,/c\.shipmentCode=m\.shipmentCode AND c\.businessType='WHPP'/,'current-state lookup must keep indexed columns bare');
assert.match(backend,/q\.shipmentCode=m\.shipmentCode AND q\.businessType='WHPP'/,'ledger lookup must keep indexed columns bare');
assert.match(backend,/p\.shipmentCode=m\.shipmentCode AND p\.businessType='WHPP'/,'POD-lock lookup must keep indexed columns bare');
assert.doesNotMatch(backend,/UPPER\(TRIM\((?:c|q|p)\.shipmentCode\)\)/,'large-table shipmentCode joins must never wrap indexed columns');
assert.doesNotMatch(backend,/\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|REPLACE\s+INTO|DROP\s+TABLE)\b/i,'V461 diagnostic source must stay read-only');
assert.doesNotMatch(backend,/CEClient|trackQuery\(|confirmQuery\(|exceptionQuery\(|\/tracking\/reconcile/,'V461 must never call CE or trigger tracking');

assert.match(archiveSource,/2026-09-08-v461-bounded-v266-offline-api-evidence-census-v1/);
assert.match(archiveSource,/otwms_order_confirm-query/);
assert.match(archiveSource,/tms-shipment-event_query/);
assert.match(archiveSource,/exception-item_query/);
assert.match(archiveSource,/MAX_FILES=12000/,'archive census must remain bounded');
assert.match(archiveSource,/CONCURRENCY=8/,'archive decompression must remain bounded');
assert.doesNotMatch(archiveSource,/CEClient|axios|https?:\/\/|fetch\(/,'archive census must stay offline');
assert.doesNotMatch(archiveSource,/\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|REPLACE\s+INTO|DROP\s+TABLE)\b/i,'archive census must not write database facts');

assert.match(ui,/2026-09-08-v461-whpp-historical-survivor-evidence-ui-v2/);
assert.match(ui,/\/api\/v461\/whpp-history-survivor/);
assert.match(ui,/__CE_QC_V142_HISTORY_AUDIT__/);
assert.match(ui,/lastLoadedAt/,'V461 UI must follow a completed manual V142 audit instead of auto-running history audit');
assert.match(ui,/V266原始API归档/);
assert.match(ui,/不调用CE接口/);
assert.match(ui,/不修改数据库/);
assert.doesNotMatch(ui,/\/api\/whpp\/run\/(?:start|resume)|\/api\/v246\/tracking\/reconcile/,'V461 UI must never start business processing');
assert.match(shell,/import '\.\/v461WhppHistoricalSurvivorDiagnosticPatch\.js'/);
assert.match(shell,/v461-whpp-survivor-diagnostic\.js\?v=20260908-v461-1/);

const db=new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);
  CREATE TABLE shipment_current_state(shipmentCode TEXT PRIMARY KEY,businessType TEXT,state TEXT,apiStatus TEXT);
  CREATE TABLE carryover_open_items(shipmentCode TEXT PRIMARY KEY,businessType TEXT,status TEXT,closeReason TEXT);
  CREATE TABLE qc_tracking_ledger(shipmentCode TEXT PRIMARY KEY,businessType TEXT,firstReportDate TEXT,trackingStatus TEXT,currentState TEXT,lastCheckedAt TEXT);
  CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,PRIMARY KEY(businessType,shipmentCode));
  CREATE TABLE business_run_locks(businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,completedAt TEXT,updatedAt TEXT);
  CREATE TABLE business_run_checkpoints(id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,runId TEXT,reportDate TEXT,stage TEXT,batchIndex INTEGER,totalBatches INTEGER,status TEXT,payloadJson TEXT,errorMessage TEXT,createdAt TEXT,updatedAt TEXT);
  CREATE TABLE business_states(businessType TEXT PRIMARY KEY,valueJson TEXT);
`);
for(const bill of ['W1','W2','W3'])db.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP','2026-09-01',?)").run(bill);
db.prepare("INSERT INTO shipment_current_state VALUES('W1','WHPP','POD','SUCCESS')").run();
db.prepare("INSERT INTO shipment_current_state VALUES('W2','WHPP','SHOP_ARRIVED_CURRENT','SUCCESS')").run();
db.prepare("INSERT INTO shipment_current_state VALUES('W3','WHPP','PENDING_SCAN','PENDING_SCAN')").run();
db.prepare("INSERT INTO carryover_open_items VALUES('W1','WHPP','CLOSED','POD')").run();
db.prepare("INSERT INTO carryover_open_items VALUES('W2','WHPP','OPEN','')").run();
db.prepare("INSERT INTO carryover_open_items VALUES('W3','WHPP','OPEN','')").run();
db.prepare("INSERT INTO qc_tracking_ledger VALUES('W1','WHPP','2026-09-01','TERMINAL','POD','2026-09-01T10:00:00Z')").run();
db.prepare("INSERT INTO qc_tracking_ledger VALUES('W2','WHPP','2026-09-01','OPEN','SHOP_ARRIVED_CURRENT','2026-09-02T10:00:00Z')").run();
db.prepare("INSERT INTO qc_tracking_ledger VALUES('W3','WHPP','2026-09-01','OPEN','PENDING_SCAN','')").run();
db.prepare("INSERT INTO business_pod_locks VALUES('WHPP','W1')").run();
db.prepare("INSERT INTO business_run_locks VALUES('WHPP','2026-09-01','RUN-1','failed','WHPP订单扫描',1,1,'PROCESS_RESTART_INTERRUPTED','','','2026-09-01T11:00:00Z')").run();
db.prepare("INSERT INTO business_run_checkpoints(businessType,runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt) VALUES('WHPP','RUN-1','2026-09-01','WHPP订单扫描',1,1,'saved','{}','','','2026-09-01T11:00:00Z')").run();
db.prepare("INSERT INTO business_states VALUES('WHPP',?)").run(JSON.stringify({reportDate:'2026-09-01',pnhBills:['W1','W2','W3'],processing:{runId:'RUN-1',phase:'待处理',running:false},finalRows:[]}));

const partial=inspectV461WhppHistoricalSurvivors('2026-09-01',db);
assert.equal(partial.readOnly,true);
assert.equal(partial.members,3);
assert.equal(partial.current.terminal,1);
assert.equal(partial.current.checkedNonterminal,1);
assert.equal(partial.current.pendingScan,1);
assert.equal(partial.ledger.rows,3);
assert.equal(partial.ledger.terminal,1);
assert.equal(partial.ledger.checkedOpen,1);
assert.equal(partial.ledger.placeholderOrUnverified,1);
assert.equal(partial.survivorCoverageCandidate,false,'one PENDING_SCAN placeholder must force archive proof');
assert.equal(partial.requiresArchiveProof,true);

db.prepare("UPDATE qc_tracking_ledger SET currentState='NORMAL_FINAL',lastCheckedAt='2026-09-02T12:00:00Z' WHERE shipmentCode='W3'").run();
const full=inspectV461WhppHistoricalSurvivors('2026-09-01',db);
assert.equal(full.ledger.placeholderOrUnverified,0);
assert.equal(full.ledger.known,3);
assert.equal(full.survivorCoverageCandidate,true,'full checked ledger may only advance to offline proof candidate');
assert.equal(full.conclusion,'SURVIVOR_LEDGER_FULL_CURRENT_EVIDENCE_CANDIDATE');
db.close();

const archiveRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v461-archive-'));
process.env.EVIDENCE_ARCHIVE_DIR=archiveRoot;
function writeEvidence(folder,name,payload){const dir=path.join(archiveRoot,'ce_api','2026-09-01',folder);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),gzipSync(Buffer.from(JSON.stringify(payload),'utf8')));}
writeEvidence('otwms_order_confirm-query','confirm.json.gz',{capturedAt:'2026-09-01T02:00:00Z',endpoint:'/api/otwms/order/confirm-query',requestBody:{shipmentCodes:['W1','W2','W3','OLD-CARRY']},responseData:{data:[{shipmentCode:'W1'},{shipmentCode:'W2'},{shipmentCode:'W3'}]}});
writeEvidence('tms-shipment-event_query','track.json.gz',{capturedAt:'2026-09-01T02:01:00Z',endpoint:'/api/tms-shipment-event/query',requestBody:['W2','W3'],responseData:{data:[]}});
writeEvidence('exception-item_query','exception.json.gz',{capturedAt:'2026-09-01T02:02:00Z',endpoint:'/api/exception-item/query',requestBody:['W2','W3'],responseData:{data:[]}});
const archive=await inspectV461WhppArchiveEvidence('2026-09-01',['W1','W2','W3']);
assert.equal(archive.networkCalls,0);
assert.equal(archive.databaseWrites,0);
assert.equal(archive.endpoints.confirm.requestedDaily,3);
assert.equal(archive.endpoints.confirm.responseDaily,3);
assert.equal(archive.endpoints.confirm.relatedRequestAll,4,'related request census may reveal carry without exposing bill ids');
assert.equal(archive.endpoints.track.requestedDaily,2);
assert.equal(archive.endpoints.exception.requestedDaily,2);
assert.equal(archive.archiveDailyEvidenceCandidate,true,'full confirm request coverage advances only to offline archive-evidence candidate');
fs.rmSync(archiveRoot,{recursive:true,force:true});

console.log('[V461] authenticated/index-friendly WHPP survivor + bounded V266 archive diagnostic smoke passed · exact daily cohort only · placeholder evidence fails closed · offline gzip evidence census · no CE call · no DB mutation');
