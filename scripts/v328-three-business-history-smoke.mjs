import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

const syntax = [
  'src/v328ThreeBusinessHistoryFast.js',
  'src/v329ThreeBusinessDailyCache.js',
  'src/v328EvidenceRepairCoordinator.js',
  'scripts/v329-three-business-cache-worker.mjs',
  'src/v308DeliveryDailyFastPath.js',
  'public/v308-dashboard-read-bridge.js',
  'public/v320-history-trend-owner.js',
  'public/v295-first-attempt-ui.js'
];
for (const file of syntax) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

const read = file => fs.readFileSync(file, 'utf8');
const heavy = read('src/v328ThreeBusinessHistoryFast.js');
const cacheSource = read('src/v329ThreeBusinessDailyCache.js');
const backend = read('src/v308DeliveryDailyFastPath.js');
const coordinator = read('src/v328EvidenceRepairCoordinator.js');
const worker = read('scripts/v329-three-business-cache-worker.mjs');
const ui = read('public/v308-dashboard-read-bridge.js');
const trendUi = read('public/v320-history-trend-owner.js');
const firstUi = read('public/v295-first-attempt-ui.js');

// Saved historical membership remains independent for TBKH/CN/VN.
for (const token of ['TBKH','SHOPEECN','SHOPEEVN','unified_import_rows','shipment_daily_snapshots','business_daily_parse_rows']) {
  assert.ok(heavy.includes(token), `historical membership source missing ${token}`);
}

// Compact history cache owns strict first-attempt + signing samples + regional signing sums.
for (const token of [
  'v329_three_business_daily_cache',
  'firstAttemptEligible',
  'firstAttemptSuccess',
  'firstAttemptUnknownPod',
  'firstAttemptEvidenceComplete',
  'signingDaysSum',
  'signingDaysCount',
  'ppSigningDaysSum',
  'ppSigningDaysCount',
  'pvSigningDaysSum',
  'pvSigningDaysCount',
  'ppAvgSigningDays',
  'pvAvgSigningDays'
]) assert.ok(cacheSource.includes(token), `three-business cache missing ${token}`);
assert.match(cacheSource, /只要存在真实签收天数样本就发布样本平均/);

// Web current path must stay per-business and must never reconstruct heavy history.
assert.match(backend, /readV236CurrentSummary\(date\)/);
assert.doesNotMatch(backend, /readV236CurrentSummary\(date,\{cacheOnly:true\}\)/);
assert.match(backend, /readV329ThreeBusinessDailyCache/);
assert.match(backend, /strictDailyEvidence/);
assert.match(backend, /attemptSource LIKE 'V246_STRICT_TRACK%'/);
assert.match(backend, /signingSampleAvailable=pod>0&&signingCount>0/);
assert.match(backend, /ppAvgSigningDays/);
assert.match(backend, /pvAvgSigningDays/);
assert.doesNotMatch(backend, /readV328ThreeBusinessHistory|readV320HistoricalDailyWithDispatch/);

// Isolated worker must derive old dates from saved members + strict ledger, not current V295 truth.
assert.match(coordinator, /v329-three-business-cache-worker\.mjs/);
assert.doesNotMatch(worker, /readV295FirstAttemptTrends|v295FirstAttemptTruth/);
for (const token of [
  'listV328HistoricalMembers',
  'strict(l.attemptSource)',
  'firstAttemptEligible',
  'firstAttemptSuccess',
  'firstAttemptUnknownPod',
  'regionMap',
  "region==='PP'",
  "region==='PV'",
  'ppSigningDaysSum',
  'pvSigningDaysSum',
  'writeV329ThreeBusinessDailyCache'
]) assert.ok(worker.includes(token), `isolated history worker missing ${token}`);

// All visible history/attempt cards share one payload; no duplicate heavy history request is allowed.
for (const label of ['平均签收天数','金边PP平均签收天数','外省PV平均签收天数']) assert.ok(ui.includes(label));
assert.match(ui, /Pending\/失败后再次START/);
assert.match(trendUi, /__CE_QC_V328_HISTORY_PAYLOADS__/);
assert.match(trendUi, /function specialCached/);
assert.doesNotMatch(trendUi, /fetch\(`\/api\/v308\/delivery-daily[^`]*history=all/);
assert.match(trendUi, /document\.getElementById\('pageTitle'\)/);
assert.match(trendUi, /claimV272Ownership/);
assert.match(trendUi, /setInterval\(enforceHistoryOwner,750\)/);
assert.match(firstUi, /__CE_QC_V328_HISTORY_PAYLOADS__/);
assert.match(firstUi, /cachedHistoryTrend/);
assert.match(firstUi, /firstAttemptEligible/);
assert.match(firstUi, /firstAttemptSuccess/);
assert.match(firstUi, /ce:v328-history-data/);

// Runtime fixture: cache-only history must publish strict attempts and real sample averages,
// including PP/PV split, without production DB/network.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-three-history-'));
process.env.DATA_DIR = root;
process.env.DB_FILE = path.join(root, 'history.db');
process.env.ACCESS_MODE = 'LOCAL';
process.env.SQLITE_MMAP_BYTES = '0';
process.env.SQLITE_CACHE_KIB = '8192';
process.env.NODE_ENV = 'test';
process.env.CE_QC_DISABLE_V246_TRACKING = '1';

const { getDb, closeDb } = await import('../src/db.js');
const { writeV329ThreeBusinessDailyCache } = await import('../src/v329ThreeBusinessDailyCache.js');
const { readV308DeliveryDaily } = await import('../src/v308DeliveryDailyFastPath.js');
const db = getDb();

for (const type of ['TBKH','SHOPEECN','SHOPEEVN']) {
  writeV329ThreeBusinessDailyCache(type, [
    {
      reportDate:'2026-07-01',total:2,pod:1,ocCurrent:1,sameDayPod:1,
      attempt1:1,attempt2:0,attempt3:0,
      signingDaysSum:1,signingDaysCount:1,
      ppSigningDaysSum:1,ppSigningDaysCount:1,pvSigningDaysSum:0,pvSigningDaysCount:0,
      firstAttemptEligible:2,firstAttemptSuccess:1,firstAttemptUnknownPod:0,ready:true
    },
    {
      reportDate:'2026-07-02',total:2,pod:1,ocCurrent:0,sameDayPod:0,
      attempt1:0,attempt2:1,attempt3:0,
      signingDaysSum:2,signingDaysCount:1,
      ppSigningDaysSum:0,ppSigningDaysCount:0,pvSigningDaysSum:2,pvSigningDaysCount:1,
      firstAttemptEligible:2,firstAttemptSuccess:0,firstAttemptUnknownPod:0,ready:true
    },
    {
      reportDate:'2026-07-03',total:4,pod:3,ocCurrent:0,sameDayPod:0,
      attempt1:2,attempt2:0,attempt3:0,
      signingDaysSum:7,signingDaysCount:2,
      ppSigningDaysSum:2,ppSigningDaysCount:1,pvSigningDaysSum:5,pvSigningDaysCount:1,
      firstAttemptEligible:3,firstAttemptSuccess:2,firstAttemptUnknownPod:1,ready:true
    }
  ], db, 'BEHAVIOR_FIXTURE');
}

for (const type of ['TBKH','SHOPEECN','SHOPEEVN']) {
  const started = performance.now();
  const data = readV308DeliveryDaily(type, '2026-07-03', '2026-07-03', db, { historyAll:true });
  assert.deepEqual(data.dates, ['2026-07-01','2026-07-02','2026-07-03']);
  assert.equal(data.daily[0].attempt1, 1);
  assert.equal(data.daily[0].avgSigningDays, 1);
  assert.equal(data.daily[0].firstAttemptRate, 50);
  assert.equal(data.daily[1].attempt2, 1);
  assert.equal(data.daily[1].avgSigningDays, 2);
  assert.equal(data.daily[1].firstAttemptRate, 0);
  assert.equal(data.daily[2].signingSampleCount, 2);
  assert.equal(data.daily[2].signingEvidenceComplete, false);
  assert.equal(data.daily[2].evidenceIncomplete, true);
  assert.equal(data.daily[2].firstAttemptRate, null);
  assert.equal(data.daily[2].avgSigningDays, 3.5);
  assert.equal(data.daily[2].ppAvgSigningDays, 2);
  assert.equal(data.daily[2].pvAvgSigningDays, 5);
  assert.ok(performance.now() - started < 100);
}

closeDb();
fs.rmSync(root, { recursive:true, force:true });
console.log('[THREE_BUSINESS_HISTORY] behavior smoke passed · saved membership · strict attempts · partial real signing samples · PP/PV averages · shared cache-only UI · no release-name coupling');
