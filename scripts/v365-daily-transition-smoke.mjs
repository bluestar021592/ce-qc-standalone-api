import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { runAtomicUnifiedImportWithDbV366 } from '../src/v366AtomicUnifiedImport.js';
import { resolveUnifiedImportDate } from '../src/v146UnifiedImportDateBridgePatch.js';

for (const file of ['src/v42WhppPatch.js','src/v44WhppUiPatch.js','src/v102UnifiedImportSafetyGatePatch.js','src/v146UnifiedImportDateBridgePatch.js','src/v366AtomicUnifiedImport.js','public/v146-unified-import-date-status.js','public/v67-resilient-run-guard.js','public/v168-seven-business-status.js','public/v132-whpp-seven-business-fast.js']) {
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

function fakeResponse(){
  let sent=null;
  const res={
    statusCode:200,
    status(code){this.statusCode=Number(code||200);return this;},
    json(payload){sent={statusCode:this.statusCode,payload};return this;}
  };
  return {res,read:()=>sent};
}

// V366 relies on temporarily owning DatabaseSync.exec so legacy nested
// BEGIN/COMMIT calls can stay inside one outer import transaction. Prove that
// capability on the exact Node sqlite driver used by production before go-live.
{
  const probe=new DatabaseSync(':memory:');
  const original=probe.exec.bind(probe);
  let intercepted=0;
  probe.exec=function v366DriverProbe(sql){intercepted+=1;return original(sql);};
  probe.exec('CREATE TABLE v366_probe(id INTEGER PRIMARY KEY,value TEXT)');
  probe.exec("INSERT INTO v366_probe(value) VALUES('ok')");
  assert.equal(intercepted,2,'node:sqlite DatabaseSync.exec must be overrideable by the atomic import owner');
  assert.equal(probe.prepare('SELECT value FROM v366_probe').get()?.value,'ok','overridden exec must still execute real SQLite statements');
  delete probe.exec;
  probe.close();
}

// Execute the exact production transaction algorithm with real in-memory
// DatabaseSync. A successful nested legacy transaction must survive only after
// explicit importCommitted=true.
{
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE truth(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO truth(id,value) VALUES(1,'08-15');");
  const out=fakeResponse();
  await runAtomicUnifiedImportWithDbV366(async (_req,res)=>{
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE truth SET value=? WHERE id=1').run('08-16');
    db.exec('COMMIT');
    res.json({ok:true,importCommitted:true,reportDate:'2026-08-16'});
  },{},out.res,()=>{},db,{useGlobalLock:false});
  assert.equal(db.prepare('SELECT value FROM truth WHERE id=1').get()?.value,'08-16','explicitly committed daily transition must persist');
  assert.equal(out.read()?.statusCode,200,'successful atomic transition must stay HTTP 200');
  assert.equal(out.read()?.payload?.importCommitted,true,'successful atomic transition must preserve explicit commit acknowledgement');
  db.close();
}

// Missing commit acknowledgement must roll every nested write back and keep the
// previous official day intact.
{
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE truth(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO truth(id,value) VALUES(1,'08-15');");
  const out=fakeResponse();
  await runAtomicUnifiedImportWithDbV366(async (_req,res)=>{
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE truth SET value=? WHERE id=1').run('BROKEN-08-16');
    db.exec('COMMIT');
    res.json({ok:true,reportDate:'2026-08-16'});
  },{},out.res,()=>{},db,{useGlobalLock:false});
  assert.equal(db.prepare('SELECT value FROM truth WHERE id=1').get()?.value,'08-15','missing importCommitted=true must restore previous-day truth');
  assert.equal(out.read()?.statusCode,500,'missing explicit commit acknowledgement must be blocked');
  assert.equal(out.read()?.payload?.code,'ATOMIC_IMPORT_COMMIT_BLOCKED');
  db.close();
}

// Even if a downstream owner mistakenly returns success after requesting an
// inner rollback, the outer owner must reject the success and preserve 08-15.
{
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE truth(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO truth(id,value) VALUES(1,'08-15');");
  const out=fakeResponse();
  await runAtomicUnifiedImportWithDbV366(async (_req,res)=>{
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE truth SET value=? WHERE id=1').run('BROKEN-ROLLBACK');
    db.exec('ROLLBACK');
    res.json({ok:true,importCommitted:true,reportDate:'2026-08-16'});
  },{},out.res,()=>{},db,{useGlobalLock:false});
  assert.equal(db.prepare('SELECT value FROM truth WHERE id=1').get()?.value,'08-15','inner rollback request must poison outer success');
  assert.equal(out.read()?.statusCode,500,'inner rollback followed by success must be blocked');
  db.close();
}

// V379 server-side guard: a stale previous-day request can never override a
// newly selected file date unless the operator explicitly chose manual mode.
{
  const conflict=resolveUnifiedImportDate({requestDateValue:'2026-08-16',filename:'2026-08-17.xls',requestSource:'current-file'});
  assert.equal(conflict.ok,false,'stale 08-16 request date must be rejected against an 08-17 filename');
  assert.equal(conflict.code,'UNIFIED_IMPORT_DATE_CONFLICT');
  const filenameOnly=resolveUnifiedImportDate({filename:'2026-08-17.xls'});
  assert.equal(filenameOnly.ok,true);
  assert.equal(filenameOnly.reportDate,'2026-08-17','filename-only import must use the new file date');
  const explicitManual=resolveUnifiedImportDate({requestDateValue:'2026-08-16',filename:'2026-08-17.xls',requestSource:'manual'});
  assert.equal(explicitManual.ok,true,'explicit manual correction must remain available');
  assert.equal(explicitManual.reportDate,'2026-08-16');
}

const v42=fs.readFileSync(new URL('../src/v42WhppPatch.js',import.meta.url),'utf8');
const v44=fs.readFileSync(new URL('../src/v44WhppUiPatch.js',import.meta.url),'utf8');
const v102=fs.readFileSync(new URL('../src/v102UnifiedImportSafetyGatePatch.js',import.meta.url),'utf8');
const v146Bridge=fs.readFileSync(new URL('../src/v146UnifiedImportDateBridgePatch.js',import.meta.url),'utf8');
const v366=fs.readFileSync(new URL('../src/v366AtomicUnifiedImport.js',import.meta.url),'utf8');
const v146=fs.readFileSync(new URL('../public/v146-unified-import-date-status.js',import.meta.url),'utf8');
const v67=fs.readFileSync(new URL('../public/v67-resilient-run-guard.js',import.meta.url),'utf8');
const v168=fs.readFileSync(new URL('../public/v168-seven-business-status.js',import.meta.url),'utf8');
const v132=fs.readFileSync(new URL('../public/v132-whpp-seven-business-fast.js',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../bootstrap.js',import.meta.url),'utf8');

assert.match(v42,/IDENTICAL_FINALIZED_WHPP_MEMBERSHIP_REUPLOAD_NOOP/,'real unified import owner must preserve an already completed WHPP lifecycle when the same membership is reuploaded');
assert.match(v42,/const stageStatus = `STAGING:\$\{batchId\}`/,'new daily batch must start invisible as STAGING');
assert.match(v42,/UPDATE unified_import_batches SET status='VALID' WHERE batchId=\? AND status=\?/,'STAGING batch must have one explicit VALID commit point');
assert.match(v42,/FAILED_STAGING:/,'failed new-day writes must never become current VALID truth');
assert.match(v42,/importCommitted: true/,'successful import response must explicitly acknowledge full commit');
assert.match(v42,/businessTypes: \[\.\.\.ALL_TYPES\]/,'committed import reconciliation must publish all seven businesses');
assert.match(v42,/classificationCounts: effectiveCounts/,'WHPP must remain visible in committed classification counts');
assert.match(v42,/fastCarryoverSummary/,'new-day import must use bounded indexed carry counts');
assert.doesNotMatch(v42,/getUnifiedProcessingQueue/,'new-day import must not materialize every OPEN carry stateJson before it can classify');
assert.doesNotMatch(v42,/loadAppState|loadBusinessState/,'new-day import must not hydrate previous giant mutable state before switching dates');
assert.match(v42,/shopeePriorCarryRows/,'Shopee historical carry must retain CN\/VN identity when the new day is initialized');
assert.match(v42,/recipient_group: businessType === 'SHOPEECN' \? 'CN' : 'VN'/,'historical Shopee carry must stay eligible under the canonical CN\/VN state filter');
assert.match(v42,/priorCarryRows, needTrackBills/,'Shopee state save must receive the retained historical carry rows');

assert.match(v42,/function loadPreservedWhppDailyRows\(reportDate\)/,'preserved WHPP daily membership must be loadable as exact rows');
assert.match(v42,/WHPP_PRESERVED_MEMBERSHIP_REHYDRATE_MISMATCH/,'preserved WHPP rehydration must fail closed on count mismatch');
assert.match(v42,/REHYDRATED_EXISTING_COMPLETE_DAILY_MEMBERSHIP/,'preserved WHPP membership must be explicitly rehydrated');
const preservedBranch=v42.slice(v42.indexOf('if (preservedWhpp.present) {'),v42.indexOf('} else {',v42.indexOf('if (preservedWhpp.present) {')));
assert.match(preservedBranch,/loadPreservedWhppDailyRows\(parsed\.reportDate\)/,'preserved WHPP branch must load exact target-date rows');
assert.match(preservedBranch,/saveWhppDailyImport\(\{/,'preserved WHPP branch must rebuild WHPP current processing state');
assert.match(preservedBranch,/reportDate: parsed\.reportDate/,'rehydrated WHPP processing state must be target-date bound');

assert.match(v42,/function verifyAtomicImportPersistence\(/,'import must verify persisted truth before success');
assert.match(v42,/IMPORT_VERIFY_CCSL_QUEUE_MISMATCH/,'CCSL normalized queue membership must be verified');
assert.match(v42,/IMPORT_VERIFY_SHOPEE_QUEUE_MISMATCH/,'SHOPEE normalized queue membership and CN\/VN split must be verified');
assert.match(v42,/IMPORT_VERIFY_WHPP_QUEUE_MISMATCH/,'WHPP normalized daily membership must be verified');
assert.match(v42,/IMPORT_VERIFY_CCSL_STATE_DATE_MISMATCH/,'CCSL current-state date must be verified');
assert.match(v42,/IMPORT_VERIFY_SHOPEE_STATE_DATE_MISMATCH/,'SHOPEE normalized queue membership and CN\/VN split must be verified');
assert.match(v42,/IMPORT_VERIFY_WHPP_STATE_DATE_MISMATCH/,'WHPP current-state date must be verified');
assert.match(v42,/const verification = verifyAtomicImportPersistence\(/,'persisted verification must run in the real import path');
const verifyAt=v42.indexOf('const verification = verifyAtomicImportPersistence(');
const responseCommitAt=v42.indexOf('importCommitted: true',verifyAt);
assert.ok(verifyAt>=0&&responseCommitAt>verifyAt,'DB persistence verification must happen before importCommitted=true is returned');

const handler=v42.slice(v42.indexOf('async function handleUnifiedImportV42'));
const stagedAt=handler.indexOf('stageUnifiedCoreImport(coreParsed');
const ccslAt=handler.indexOf('initializeCcslState(');
const shopeeAt=handler.indexOf('initializeShopeeState(');
const whppAt=handler.indexOf('saveWhppDailyImport({');
const activateAt=handler.indexOf('activateUnifiedCoreImport(staged)');
const persistenceAt=handler.indexOf('verifyAtomicImportPersistence(');
assert.ok(stagedAt>=0&&ccslAt>stagedAt&&shopeeAt>ccslAt&&whppAt>shopeeAt&&activateAt>whppAt&&persistenceAt>activateAt,'08-15→08-16 transition must remain STAGING until CCSL, SHOPEE and WHPP queues are ready, then verify persisted truth');

assert.match(v102,/2026-08-30-v366-pre-persistence-atomic-import-safety-v4/,'pre-persistence owner must install the V366 atomic gate and rollback-failure reset');
assert.match(v102,/runAtomicUnifiedImportV366/,'the real unified-import final handler must execute through the atomic owner');
assert.match(v102,/return await runAtomicUnifiedImportV366\(finalHandler, req, res, next\)/,'V102 must await the atomic owner before returning any import result');
assert.match(v102,/ATOMIC_IMPORT_ROLLBACK_FAILED/,'rollback failure must be treated as a fatal import error');
assert.match(v102,/closeDb\(\)/,'rollback failure must reset the singleton SQLite connection');
assert.match(v146Bridge,/2026-08-16-v146-unified-import-date-bridge-v1/,'server-side date bridge must remain installed between safety and final import ownership');
assert.match(v146Bridge,/2026-08-30-v379-request-file-date-conflict-guard-v1/,'server-side bridge must reject stale request-date/file-date conflicts');
assert.match(v146Bridge,/UNIFIED_IMPORT_DATE_CONFLICT/,'server-side bridge must expose an explicit date conflict code');
assert.match(v146Bridge,/requestSource: req\.body\?\.reportDateSource/,'server-side bridge must receive the current-file/manual source marker');
assert.match(v146Bridge,/source === 'manual'/,'only explicit manual correction may override a conflicting filename date');
assert.match(v366,/2026-08-30-v366-atomic-seven-business-import-v3/,'atomic transaction owner version must include rollback-failure detection');
assert.match(v366,/runAtomicUnifiedImportWithDbV366/,'the exact production atomic core must be directly executable by go-live tests');
assert.match(v366,/originalExec\('BEGIN IMMEDIATE'\)/,'atomic owner must hold one outer write transaction');
assert.match(v366,/res\.json = function v366BufferedJson/,'success or failure JSON must be buffered until commit or rollback');
assert.match(v366,/const explicitCommit = payload\?\.importCommitted === true/,'outer transaction must require explicit backend commit acknowledgement');
assert.match(v366,/originalExec\('COMMIT'\)/,'all seven-business writes must commit only at the outer owner');
assert.match(v366,/originalExec\('ROLLBACK'\)/,'any incomplete import must have an outer rollback path');
assert.match(v366,/ATOMIC_IMPORT_ROLLBACK_FAILED/,'a failed SQLite rollback must never be silently reported as safe');
assert.match(v366,/db\.isTransaction/,'rollback verification must inspect the real SQLite transaction state');
assert.match(v366,/innerRollbackSeen/,'an inner rollback request must poison the outer success path');
assert.match(v366,/nestedDepth !== 0/,'unbalanced nested transactions must block commit');
assert.match(v366,/UNIFIED_IMPORT_ALREADY_ACTIVE/,'concurrent daily imports must be rejected instead of interleaving writes');

const bootstrapV102=bootstrap.indexOf("importPhase('v102UnifiedImportSafetyGatePatch'");
const bootstrapV146=bootstrap.indexOf("importPhase('v146UnifiedImportDateBridgePatch'");
const bootstrapV42=bootstrap.indexOf("importPhase('v42WhppPatch'");
assert.ok(bootstrapV102>=0&&bootstrapV146>bootstrapV102&&bootstrapV42>bootstrapV146,'production bootstrap route ownership must remain V102 safety/atomic → V146 date bridge → V42 final importer');

assert.match(v146,/2026-09-01-v410-atomic-seven-business-visible-truth-v1/,'browser import owner must isolate pending dates, normalize seven-business totals, and wait for atomic commit');
assert.match(v146,/2026-08-30-v379-file-date-conflict-guard-v2/,'browser import owner must include current-file fail-closed plus server conflict-source ownership');
assert.match(v146,/let candidateTarget=''/,'filename-recognized date must live outside the committed report-date input');
assert.match(v146,/#detectFilenameDateButton/,'filename detection itself must be intercepted');
assert.match(v146,/restoreCommittedDate\(\)/,'pending selection must restore the last committed business date');
assert.match(v146,/body\.set\('reportDate',target\)/,'captured candidate date must still be submitted to the backend');
assert.match(v146,/body\.set\('reportDateSource',manualTarget&&target===manualTarget\?'manual':'current-file'\)/,'frontend must label explicit manual override separately from the current file date');
assert.match(v146,/body\.delete\('reportDate'\)/,'an unrecognized new file must delete any stale prior reportDate so backend workbook detection remains authoritative');
assert.match(v146,/if\(file\)return pendingTarget\|\|manualOverrideDate\(\)\|\|candidateTarget\|\|filenameDate\(file\.name\)/,'selected new files must fail closed instead of falling back to the committed previous day');
assert.match(v146,/pendingTarget=manualTarget\|\|candidateTarget\|\|filenameDate\(file\.name\)/,'import click must use only explicit current-file manual override or the selected file date');
assert.doesNotMatch(v146,/pendingTarget=.*normalizeDate\(document\.getElementById\('reportDate'\)/,'new selected files must never inherit the previous committed reportDate input');
assert.match(v146,/resetStaleDateOverride\(\);[\s\S]*candidateTarget=filenameDate\(file\.name\)/,'choosing a new file must clear stale filename/manual override state before deciding its date');
assert.match(v146,/文件名未含可确认日期/,'unknown filenames must visibly explain workbook-content detection instead of pretending the previous day is current');
assert.match(v146,/payload\?\.ok===true&&payload\?\.importCommitted===true/,'browser may switch only after explicit successful atomic commit acknowledgement');
assert.doesNotMatch(v146,/importCommitted!==false/,'undefined commit acknowledgement must never be treated as success');
assert.match(v146,/UNIFIED_IMPORT_NOT_COMMITTED/,'HTTP 200 without atomic commit acknowledgement must be converted into a fail-closed browser response');
assert.match(v146,/BUSINESS_TYPES=\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]/,'visible effective total must sum all seven business classifications including WHPP');
assert.match(v146,/classification-whpp/,'import result must visibly include WHPP as business seven');
assert.match(v146,/正在导入并确认七业务/,'long import must expose a single non-repeatable in-flight action');
assert.match(v146,/__CE_QC_PENDING_IMPORT_DATE__/,'pending date must be observable without becoming canonical processing truth');
assert.match(v44,/v146-unified-import-date-status\.js\?v=20260901-v410-1/,'HTML owner must force the browser to load the V410 atomic import UI instead of a cached older script');
assert.match(v44,/v168-seven-business-status\.js\?v=20260901-v409-1/,'HTML owner must pair the V410 import date owner with the V409 lightweight status owner');

const parserStart=v146.indexOf('  function validDate');
const parserEnd=v146.indexOf('  function status');
assert.ok(parserStart>=0&&parserEnd>parserStart,'V379 filename parser helpers must remain extractable for go-live regression');
const detectFilenameDate=new Function('document','unifiedImportState','appState','shopeeState',`${v146.slice(parserStart,parserEnd)};return filenameDate;`)(
  {getElementById(){return {value:'2026-08-16'};}},
  {reportDate:'2026-08-16'},
  null,
  null
);
assert.equal(detectFilenameDate('8-17.xls'),'2026-08-17','real operator filename 8-17.xls must advance from committed 08-16 to 08-17');
assert.equal(detectFilenameDate('08-17.xls'),'2026-08-17','zero-padded 08-17.xls must resolve to 08-17');
assert.equal(detectFilenameDate('8月17日.xls'),'2026-08-17','Chinese 8月17日.xls must resolve to 08-17');

for (const source of [v67,v168,v132]) {
  assert.match(source,/reportDate/,'all processing/status owners must remain date-bound');
}
assert.match(v67,/\{ key: 'CCSL'[\s\S]*\{ key: 'SHOPEE'[\s\S]*\{ key: 'WHPP'/,'execution order must remain CCSL → SHOPEE → WHPP');
assert.match(v67,/waitForWhppFinalized/,'WHPP completion must still require canonical finalization before seven-business completion');
assert.match(v168,/payload\?\.completed === true|payload\?\.completed===true/,'seven-business status must consume backend WHPP completion truth');
assert.match(v132,/canonicalCompleted/,'WHPP board must consume canonical completion rather than offering a stale continue button');

console.log('[V410/V409/V365/V366/V379] exact daily transition + frontend fail-closed + backend request/file conflict guard + executable atomic persistence gate passed · 8-17.xls/08-17.xls/8月17日.xls resolve to 2026-08-17 · stale prior-day request cannot override the selected file · explicit manual correction remains available · visible totals include WHPP · real DatabaseSync commit/rollback behavior proven · production route order V102→V146→V42 locked · explicit commit acknowledgement required · preserved WHPP is rehydrated to target date · seven memberships and all three current states are reread and verified before commit · any inner failure rolls back · browser cache is busted · WHPP remains final canonical stage');
