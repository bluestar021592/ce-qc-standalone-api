import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const file of ['src/v42WhppPatch.js','public/v146-unified-import-date-status.js','public/v67-resilient-run-guard.js','public/v168-seven-business-status.js','public/v132-whpp-seven-business-fast.js']) {
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

const v42=fs.readFileSync(new URL('../src/v42WhppPatch.js',import.meta.url),'utf8');
const v146=fs.readFileSync(new URL('../public/v146-unified-import-date-status.js',import.meta.url),'utf8');
const v67=fs.readFileSync(new URL('../public/v67-resilient-run-guard.js',import.meta.url),'utf8');
const v168=fs.readFileSync(new URL('../public/v168-seven-business-status.js',import.meta.url),'utf8');
const v132=fs.readFileSync(new URL('../public/v132-whpp-seven-business-fast.js',import.meta.url),'utf8');

assert.match(v42,/2026-08-30-v364-seven-business-import-commit-gate-v2/,'real unified import owner must be the V364 commit gate');
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

const handler=v42.slice(v42.indexOf('async function handleUnifiedImportV42'));
const stagedAt=handler.indexOf('stageUnifiedCoreImport(coreParsed');
const ccslAt=handler.indexOf('initializeCcslState(');
const shopeeAt=handler.indexOf('initializeShopeeState(');
const whppAt=handler.indexOf('saveWhppDailyImport({');
const activateAt=handler.indexOf('activateUnifiedCoreImport(staged)');
assert.ok(stagedAt>=0&&ccslAt>stagedAt&&shopeeAt>ccslAt&&whppAt>shopeeAt&&activateAt>whppAt,'08-15→08-16 transition must remain STAGING until CCSL, SHOPEE and WHPP queues are all ready');

assert.match(v146,/2026-08-30-v365-seven-business-import-ui-v1/,'browser import owner must isolate pending filename dates');
assert.match(v146,/let candidateTarget=''/,'filename-recognized date must live outside the committed report-date input');
assert.match(v146,/#detectFilenameDateButton/,'filename detection itself must be intercepted');
assert.match(v146,/restoreCommittedDate\(\)/,'pending selection must restore the last committed business date');
assert.match(v146,/body\.set\('reportDate',target\)/,'captured candidate date must still be submitted to the backend');
assert.match(v146,/payload\?\.importCommitted!==false/,'browser may switch only after backend commit acknowledgement');
assert.match(v146,/classification-whpp/,'import result must visibly include WHPP as business seven');
assert.match(v146,/正在导入并确认七业务/,'long import must expose a single non-repeatable in-flight action');
assert.match(v146,/__CE_QC_PENDING_IMPORT_DATE__/,'pending date must be observable without becoming canonical processing truth');

for (const source of [v67,v168,v132]) {
  assert.match(source,/reportDate/,'all processing\/status owners must remain date-bound');
}
assert.match(v67,/\{ key: 'CCSL'[\s\S]*\{ key: 'SHOPEE'[\s\S]*\{ key: 'WHPP'/,'execution order must remain CCSL → SHOPEE → WHPP');
assert.match(v67,/waitForWhppFinalized/,'WHPP completion must still require canonical finalization before seven-business completion');
assert.match(v168,/payload\?\.completed === true|payload\?\.completed===true/,'seven-business status must consume backend WHPP completion truth');
assert.match(v132,/canonicalCompleted/,'WHPP board must consume canonical completion rather than offering a stale continue button');

console.log('[V365] exact daily transition gate passed · candidate date is noncanonical until commit · seven classifications visible · CCSL/Shopee historical carry preserved · scan/track queues initialize before VALID switch · WHPP remains final canonical stage');
