import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const storeUrl = new URL('../src/v87WhppExportStore.js', import.meta.url);
const workerUrl = new URL('../src/v84ExportJobWorker.js', import.meta.url);
const businessUrl = new URL('../src/v84ExportBusinessWorker.js', import.meta.url);
const uiUrl = new URL('../public/v84-async-export-ui.js', import.meta.url);
const store = fs.readFileSync(storeUrl, 'utf8');
const worker = fs.readFileSync(workerUrl, 'utf8');
const business = fs.readFileSync(businessUrl, 'utf8');
const ui = fs.readFileSync(uiUrl, 'utf8');

test('V87 WHPP export reader and workers are syntax valid', () => {
  for (const url of [storeUrl, workerUrl, businessUrl, uiUrl]) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr || check.stdout);
  }
});

test('WHPP export completion is daily-authority certified, membership is immutable, and count planning stays lightweight', () => {
  assert.match(store, /V419_WHPP_EXPORT_MEMBERSHIP_ID='2026-09-03-v419-whpp-completion-certified-membership-export-v4'/);
  assert.match(store, /function completedDailyAuthority/);
  assert.match(store, /summary\.completed===true/);
  assert.match(store, /summary\.finalizedSnapshotId/,'surviving daily completion must point to the exact finalized snapshot');
  assert.match(store, /function latestEligibleCompletedSnapshots/);
  assert.match(store, /UPPER\(COALESCE\(status,''\)\)<>'INVALID'/);
  assert.match(store, /UPPER\(COALESCE\(reconciliationStatus,''\)\)<>'FAILED'/);
  assert.match(store, /authority\?\.dailyPresent/,'when a daily header survives it must own completion eligibility');
  assert.match(store, /text\(row\.snapshotId\)===authority\.snapshotId/,'legacy snapshot cannot self-authorize; daily finalizedSnapshotId must match exactly');
  assert.match(store, /text\(row\.status\)\.toUpperCase\(\)==='VALID'.*text\(row\.reconciliationStatus\)\.toUpperCase\(\)==='COMPLETED'/s,'fully rotated history may stand alone only with explicit VALID+COMPLETED snapshot evidence');
  assert.match(store, /SELECT snapshotId,reportDate,status,reconciliationStatus,createdAt,id/,'eligible-date query must stay metadata-only');
  assert.doesNotMatch(store, /SELECT snapshotId,reportDate,payloadJson,createdAt,id/,'count planning must not materialize every snapshot payload');
  assert.match(store, /function loadSnapshotPayload/,'snapshot JSON may be loaded lazily for one rotated historical date');
  assert.match(store, /function standardMembershipMeta/);
  assert.match(store, /WHPP_EXPORT_DAILY_MEMBERSHIP_INCOMPLETE/);
  assert.match(store, /expected>0&&actual===0/,'fully rotated membership may use an immutable fallback after completion eligibility is established');
  assert.match(store, /function latestValidUnifiedMembershipRows/);
  assert.match(store, /b\.status='VALID'/,'rotated history should recover exact VALID unified membership before snapshot JSON');
  assert.match(store, /membershipSource:'WHPP_VALID_UNIFIED_DAILY'/);
  assert.match(store, /WHPP_LEGACY_FINALIZED_SNAPSHOT/,'certified 4f53-era completed snapshots must be distinguishable in diagnostics');
  assert.match(store, /function snapshotMembershipRows/);
  assert.match(store, /state\.pnhBills/);
  assert.match(store, /state\.dailyParseRows/);
  const snapshotMembershipBody=store.match(/function snapshotMembershipRows[\s\S]*?function validateRecoveredCount/)?.[0]||'';
  assert.ok(snapshotMembershipBody,'snapshot membership function must be inspectable');
  assert.doesNotMatch(snapshotMembershipBody,/state\.finalRows/,'WHPP finalRows contains today + carry and must never restore daily membership');
  assert.match(store, /WHPP_EXPORT_MEMBERSHIP_UNRECOVERABLE/,'unknown old snapshot membership must fail closed rather than use carry-contaminated final rows');
  assert.match(store, /if\(meta\.complete\)return meta\.expected===0\?\[\]:standardMembershipRows/,'complete standard membership must outrank historical fallbacks');
  assert.match(store, /function finalRowsByBill\(reportDate,bills=\[\]/,'final rows must be requested only for already-admitted member bills');
  assert.match(store, /UPPER\(TRIM\(shipmentCode\)\) IN/);
  assert.match(store, /normalizeWhppRow\(finals\.get\(bill\)\|\|\{\},member,snapshot\.reportDate\)/,'final rows may enrich only an admitted member');
  assert.match(store, /function membershipCount/);
  assert.match(store, /latestEligibleCompletedSnapshots\(fromDate,toDate,db\)\.reduce\(\(sum,snapshot\)=>sum\+membershipCount\(snapshot,db\),0\)/,'large-range split count must read certified completion + membership only, not hydrate final rows');
  assert.match(store, /whppExportMembershipSource/);
  assert.match(store, /listCompletedWhppSnapshots/);
  assert.match(store, /whppDailyCounts/);
  assert.doesNotMatch(store, /DELETE FROM|UPDATE |INSERT INTO|DROP TABLE/i,'V87 export reader stays read-only');
});

test('ALL background export includes WHPP as the seventh business and splits it under the same memory cap', () => {
  assert.match(worker, /'SHOPEEVN', 'WHPP'/);
  assert.match(worker, /if \(type === 'WHPP'\) return countCompletedWhppRows/);
  assert.match(worker, /const parts = count > LARGE_BUSINESS_THRESHOLD \? splitRange\(range\) : \[range\]/);
  assert.match(worker, /whppDailyCounts\(range\.from, range\.to\)/);
  assert.match(worker, /正在准备 .*7业务后台导出/);
  assert.match(worker, /7业务轻量管理汇总/);
});

test('isolated business worker selects the WHPP membership-locked range reader only for WHPP', () => {
  assert.match(business, /type === 'WHPP'/);
  assert.match(business, /listCompletedWhppSnapshots\(from, to\)/);
  assert.match(business, /listLightweightCompletedUnifiedSnapshots\(from, to, \[type\]\)/);
  assert.match(business, /'WHPP'/);
});

test('report selector exposes CEAF and WHPP explicitly and defaults ALL to seven businesses', () => {
  assert.match(ui, /\['ALL', '管理汇总 \+ 7业务'\]/);
  assert.match(ui, /\['CEAF', '仅CEAF空运'\]/);
  assert.match(ui, /\['WHPP', '仅WHPP本土'\]/);
  assert.match(ui, /ensureBusinessOptions\(\)/);
});