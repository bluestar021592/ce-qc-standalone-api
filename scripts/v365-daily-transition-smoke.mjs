import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

for (const file of ['src/v42WhppPatch.js','src/v44WhppUiPatch.js','src/v102UnifiedImportSafetyGatePatch.js','src/v366AtomicUnifiedImport.js','public/v146-unified-import-date-status.js','public/v67-resilient-run-guard.js','public/v168-seven-business-status.js','public/v132-whpp-seven-business-fast.js']) {
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
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

const v42=fs.readFileSync(new URL('../src/v42WhppPatch.js',import.meta.url),'utf8');
const v44=fs.readFileSync(new URL('../src/v44WhppUiPatch.js',import.meta.url),'utf8');
const v102=fs.readFileSync(new URL('../src/v102UnifiedImportSafetyGatePatch.js',import.meta.url),'utf8');
const v366=fs.readFileSync(new URL('../src/v366AtomicUnifiedImport.js',import.meta.url),'utf8');
const v146=fs.readFileSync(new URL('../public/v146-unified-import-date-status.js',import.meta.url),'utf8');
const v67=fs.readFileSync(new URL('../public/v67-resilient-run-guard.js',import.meta.url),'utf8');
const v168=fs.readFileSync(new URL('../public/v168-seven-business-status.js',import.meta.url),'utf8');
const v132=fs.readFileSync(new URL('../public/v132-whpp-seven-business-fast.js',import.meta.url),'utf8');

assert.match(v42,/2026-08-30-v366-seven-business-atomic-whpp-rehydrate-v1/,'real unified import owner must include atomic WHPP rehydration');
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

// A pre-existing complete WHPP daily membership must not be treated as a mere
// count. It must be rehydrated into WHPP's current processing state for the same
// target date, otherwise CCSL/Shopee can move to the new day while WHPP stays old.
assert.match(v42,/function loadPreservedWhppDailyRows\(reportDate\)/,'preserved WHPP daily membership must be loadable as exact rows');
assert.match(v42,/WHPP_PRESERVED_MEMBERSHIP_REHYDRATE_MISMATCH/,'preserved WHPP rehydration must fail closed on count mismatch');
assert.match(v42,/REHYDRATED_EXISTING_COMPLETE_DAILY_MEMBERSHIP/,'preserved WHPP membership must be explicitly rehydrated');
const preservedBranch=v42.slice(v42.indexOf('if (preservedWhpp.present) {'),v42.indexOf('} else {',v42.indexOf('if (preservedWhpp.present) {')));
assert.match(preservedBranch,/loadPreservedWhppDailyRows\(parsed\.reportDate\)/,'preserved WHPP branch must load exact target-date rows');
assert.match(preservedBranch,/saveWhppDailyImport\(\{/,'preserved WHPP branch must rebuild WHPP current processing state');
assert.match(preservedBranch,/reportDate: parsed\.reportDate/,'rehydrated WHPP processing state must be target-date bound');

// Do not trust a successful function return alone. Before the response can carry
// importCommitted=true, the route must re-read the normalized DB and prove all
// seven memberships plus CCSL/SHOPEE/WHPP current dates are aligned.
assert.match(v42,/function verifyAtomicImportPersistence\(/,'import must verify persisted truth before success');
assert.match(v42,/IMPORT_VERIFY_CCSL_QUEUE_MISMATCH/,'CCSL normalized queue membership must be verified');
assert.match(v42,/IMPORT_VERIFY_SHOPEE_QUEUE_MISMATCH/,'SHOPEE normalized queue membership and CN\/VN split must be verified');
assert.match(v42,/IMPORT_VERIFY_WHPP_QUEUE_MISMATCH/,'WHPP normalized daily membership must be verified');
assert.match(v42,/IMPORT_VERIFY_CCSL_STATE_DATE_MISMATCH/,'CCSL current-state date must be verified');
assert.match(v42,/IMPORT_VERIFY_SHOPEE_STATE_DATE_MISMATCH/,'SHOPEE current-state date must be verified');
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

assert.match(v102,/2026-08-30-v366-pre-persistence-atomic-import-safety-v3/,'pre-persistence owner must install the V366 atomic gate');
assert.match(v102,/runAtomicUnifiedImportV366/,'the real unified-import final handler must execute through the atomic owner');
assert.match(v102,/return await runAtomicUnifiedImportV366\(finalHandler, req, res, next\)/,'V102 must await the atomic owner before returning any import result');
assert.match(v366,/2026-08-30-v366-atomic-seven-business-import-v1/,'atomic transaction owner version must be active');
assert.match(v366,/originalExec\('BEGIN IMMEDIATE'\)/,'atomic owner must hold one outer write transaction');
assert.match(v366,/res\.json = function v366BufferedJson/,'success or failure JSON must be buffered until commit or rollback');
assert.match(v366,/const explicitCommit = payload\?\.importCommitted === true/,'outer transaction must require explicit backend commit acknowledgement');
assert.match(v366,/originalExec\('COMMIT'\)/,'all seven-business writes must commit only at the outer owner');
assert.match(v366,/originalExec\('ROLLBACK'\)/,'any incomplete import must have an outer rollback path');
assert.match(v366,/innerRollbackSeen/,'an inner rollback request must poison the outer success path');
assert.match(v366,/nestedDepth !== 0/,'unbalanced nested transactions must block commit');
assert.match(v366,/UNIFIED_IMPORT_ALREADY_ACTIVE/,'concurrent daily imports must be rejected instead of interleaving writes');

assert.match(v146,/2026-08-30-v366-atomic-seven-business-import-ui-v1/,'browser import owner must isolate pending dates and wait for atomic commit');
assert.match(v146,/let candidateTarget=''/,'filename-recognized date must live outside the committed report-date input');
assert.match(v146,/#detectFilenameDateButton/,'filename detection itself must be intercepted');
assert.match(v146,/restoreCommittedDate\(\)/,'pending selection must restore the last committed business date');
assert.match(v146,/body\.set\('reportDate',target\)/,'captured candidate date must still be submitted to the backend');
assert.match(v146,/payload\?\.ok===true&&payload\?\.importCommitted===true/,'browser may switch only after explicit successful atomic commit acknowledgement');
assert.doesNotMatch(v146,/importCommitted!==false/,'undefined commit acknowledgement must never be treated as success');
assert.match(v146,/classification-whpp/,'import result must visibly include WHPP as business seven');
assert.match(v146,/正在导入并确认七业务/,'long import must expose a single non-repeatable in-flight action');
assert.match(v146,/__CE_QC_PENDING_IMPORT_DATE__/,'pending date must be observable without becoming canonical processing truth');
assert.match(v44,/v146-unified-import-date-status\.js\?v=20260830-v366-1/,'HTML owner must force the browser to load the V366 import UI instead of a cached older script');

for (const source of [v67,v168,v132]) {
  assert.match(source,/reportDate/,'all processing\/status owners must remain date-bound');
}
assert.match(v67,/\{ key: 'CCSL'[\s\S]*\{ key: 'SHOPEE'[\s\S]*\{ key: 'WHPP'/,'execution order must remain CCSL → SHOPEE → WHPP');
assert.match(v67,/waitForWhppFinalized/,'WHPP completion must still require canonical finalization before seven-business completion');
assert.match(v168,/payload\?\.completed === true|payload\?\.completed===true/,'seven-business status must consume backend WHPP completion truth');
assert.match(v132,/canonicalCompleted/,'WHPP board must consume canonical completion rather than offering a stale continue button');

console.log('[V365/V366] exact daily transition + atomic persistence gate passed · driver override proven · candidate date stays noncanonical · explicit commit acknowledgement required · preserved WHPP is rehydrated to target date · seven memberships and all three current states are reread and verified before commit · any inner failure rolls back · browser cache is busted · WHPP remains final canonical stage');
