import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const storeUrl = new URL('../src/v87WhppExportStore.js', import.meta.url);
const workerUrl = new URL('../src/v84ExportJobWorker.js', import.meta.url);
const businessUrl = new URL('../src/v84ExportBusinessWorker.js', import.meta.url);
const historicalUrl = new URL('../src/v320HistoricalExportRows.js', import.meta.url);
const evidenceUrl = new URL('../src/v200EvidenceData.js', import.meta.url);
const uiUrl = new URL('../public/v84-async-export-ui.js', import.meta.url);
const store = fs.readFileSync(storeUrl, 'utf8');
const worker = fs.readFileSync(workerUrl, 'utf8');
const business = fs.readFileSync(businessUrl, 'utf8');
const historical = fs.readFileSync(historicalUrl, 'utf8');
const evidence = fs.readFileSync(evidenceUrl, 'utf8');
const ui = fs.readFileSync(uiUrl, 'utf8');

function quotedArrayAfter(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return [];
  const tail = source.slice(start, start + 400);
  const body = tail.match(/\[([^\]]+)\]/)?.[1] || '';
  return [...body.matchAll(/'([^']+)'/g)].map(match => match[1]);
}

test('V87 WHPP export reader and workers are syntax valid', () => {
  for (const url of [storeUrl, workerUrl, businessUrl, historicalUrl, evidenceUrl, uiUrl]) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr || check.stdout);
  }
});

test('WHPP export completion is daily-authority certified, membership is immutable, and count planning stays lightweight', () => {
  assert.match(store, /V419_WHPP_EXPORT_MEMBERSHIP_ID='2026-09-03-v419-whpp-completion-certified-membership-export-v4'/);
  assert.match(store, /V457_WHPP_LEGACY_COMPLETION_RECOVERY_ID='2026-09-08-v457-whpp-legacy-metadata-loss-attestation-v1'/);
  assert.match(store, /V460_WHPP_HISTORY_SNAPSHOT_DISAMBIGUATION_ID='2026-09-08-v460-whpp-history-snapshot-exact-disambiguation-v1'/);
  assert.match(store, /function completedDailyAuthority/);
  assert.match(store, /summary\.completed===true/);
  assert.match(store, /summary\.finalizedSnapshotId/,'surviving modern daily completion must point to the exact finalized snapshot');
  assert.match(store, /function legacyCompletionProofs/,'legacy completion recovery must have one explicit proof owner');
  assert.match(store, /business_history_summary/,'legacy metadata-loss recovery must require the persisted history snapshot attestation');
  assert.match(store, /coveredDailyRows/,'legacy metadata-loss recovery must prove exact member final coverage');
  assert.match(store, /authority\.metadataAbsent/,'explicit incomplete\/failed daily metadata must never enter legacy recovery');
  assert.match(store, /const historyId=text\(legacyProof\.history\.get\(date\)\)/,'legacy recovery must read the persisted history snapshot id before choosing a candidate');
  assert.match(store, /const attested=candidates\.filter\(row=>text\(row\.snapshotId\)===historyId\)/,'V460 must disambiguate same-date snapshots by exact persisted history id');
  assert.match(store, /if\(attested\.length!==1\)continue/,'history id must uniquely select exactly one viable same-date snapshot');
  assert.doesNotMatch(store, /candidates\.length!==1/,'unrelated surviving old snapshots must not block an exact persisted history attestation');
  assert.match(store, /function latestEligibleCompletedSnapshots/);
  assert.match(store, /UPPER\(COALESCE\(status,''\)\)<>'INVALID'/);
  assert.match(store, /UPPER\(COALESCE\(reconciliationStatus,''\)\)<>'FAILED'/);
  assert.match(store, /authority\?\.dailyPresent/,'when a daily header survives it must own modern completion eligibility or the narrow V457/V460 metadata-loss proof');
  assert.match(store, /text\(row\.snapshotId\)===authority\.snapshotId/,'modern daily finalizedSnapshotId must match exactly');
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
  assert.match(store, /WHPP_LEGACY_FINALIZED_SNAPSHOT/,'certified legacy completed snapshots must be distinguishable in diagnostics');
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
  assert.match(store, /latestEligibleCompletedSnapshots\(fromDate,toDate,db\)\.reduce\(\(sum,snapshot\)=>sum\+membershipCount\(snapshot,db\),0\)/,'large-range count planning must read certified completion + membership only, not hydrate final rows');
  assert.match(store, /whppExportMembershipSource/);
  assert.match(store, /listCompletedWhppSnapshots/);
  assert.match(store, /whppDailyCounts/);
  assert.doesNotMatch(store, /DELETE FROM|UPDATE |INSERT INTO|DROP TABLE/i,'V87 export reader stays read-only');
});

test('ALL background export includes WHPP as the seventh business and keeps one complete workbook per business', () => {
  assert.deepEqual(quotedArrayAfter(worker, 'const ALL_TYPES=Object.freeze'), ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
  assert.match(worker, /requested\.has\('WHPP'\).*countCompletedWhppRows\(range\.from,range\.to\)/s,'WHPP count planning must use the completion-certified reader');
  assert.match(worker, /rows\.push\(\.\.\.whppDailyCounts\(range\.from,range\.to\)\)/,'management summary must include WHPP daily counts');
  assert.match(worker, /outputContract:'ONE_WORKBOOK_PER_BUSINESS'/,'modern export must keep one complete workbook per business');
  assert.match(worker, /不再输出日期分片/,'modern export must not reintroduce date-split workbooks');
  assert.match(worker, /正在准备 .*7业务.*完整表格/,'ALL export must advertise seven-business output');
});

test('V200 isolated business worker accepts all seven businesses and WHPP still uses the membership-locked reader internally', () => {
  assert.deepEqual(quotedArrayAfter(business, 'const allowed=new Set'), ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
  assert.match(business, /VERSION='2026-09-08-v474-indexed-business-export-progress-v1'/,'isolated business worker must keep the V474 indexed progress owner');
  assert.match(business, /createV200ReferenceDashboardWorkbook\(\{[\s\S]*?type,periodType,range,outputDir:getRuntimeConfig\(\)\.exportsDir,[\s\S]*?onProgress:payload=>writeProgress\(payload\|\|\{\}\)[\s\S]*?\}\)/,'all businesses must use the one V200 workbook owner and preserve V474 child progress');
  assert.match(business, /partCount>1\|\|partIndex!==1/,'business worker must reject date splitting');
  assert.match(historical, /if\(businessType==='WHPP'\)return collectLegacyV200Rows\(businessType,range,onProgress\)/,'V320 must hand WHPP to its dedicated reader');
  assert.match(evidence, /businessType === 'WHPP' \? seedWhpp\(range, onProgress\) : seedUnified/,'V200 data owner must keep WHPP separate from unified membership');
  assert.match(evidence, /listCompletedWhppSnapshots\(range\.from, range\.to\)/,'WHPP workbook membership must originate from completion-certified snapshots');
});

test('report selector exposes all seven businesses including CEAF and WHPP', () => {
  for (const value of ['ALL','CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) assert.match(ui, new RegExp(`\\['${value}',`));
  assert.match(ui, /管理汇总 \+ 7业务/);
  assert.match(ui, /仅CEAF空运完整表/);
  assert.match(ui, /仅WHPP本土完整表/);
  assert.match(ui, /ensureBusinessOptions\(\)/);
});