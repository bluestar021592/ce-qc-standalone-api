import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
const { statsOf } = await import('../src/v200Metrics.js');
const { assertV200ExportRange, assertShopeeExportTruth } = await import('../src/v200TemplateDashboardExporter.js');
const { resolveStrictShopeeAttempt } = await import('../src/v230AttemptSigningTruth.js');

const range = { from: '2026-08-14', to: '2026-08-14' };
const base = [
  {
    shipmentCode: 'SPE-VN-001', businessType: 'SHOPEEVN', dailyMembershipDates: ['2026-08-14'], reportMembershipDate: '2026-08-14', firstReportDate: '2026-08-14',
    area: '金边', store: false, pod: true, returned: false, pending: false, delivering: false, podDate: '2026-08-14', podTime: '2026-08-14 12:00:00', attemptNo: 1, signingDays: 1
  },
  {
    shipmentCode: 'SPE-VN-002', businessType: 'SHOPEEVN', dailyMembershipDates: ['2026-08-14'], reportMembershipDate: '2026-08-14', firstReportDate: '2026-08-14',
    area: '外省', store: false, pod: true, returned: false, pending: false, delivering: false, podDate: '2026-08-15', podTime: '2026-08-15 09:00:00', attemptNo: 2, signingDays: 2
  },
  {
    shipmentCode: 'SPE-VN-003', businessType: 'SHOPEEVN', dailyMembershipDates: ['2026-08-14'], reportMembershipDate: '2026-08-14', firstReportDate: '2026-08-14',
    area: '外省', store: true, pod: false, returned: true, pending: false, delivering: false, attemptNo: 0, signingDays: 0
  },
  {
    shipmentCode: 'SPE-VN-004', businessType: 'SHOPEEVN', dailyMembershipDates: ['2026-08-14'], reportMembershipDate: '2026-08-14', firstReportDate: '2026-08-14',
    area: '金边', store: false, pod: false, returned: false, pending: true, delivering: false, attemptNo: 0, signingDays: 0
  }
];

assert.equal(assertV200ExportRange(base, range), true);
const stats = statsOf(base, range);
assert.equal(stats.overall.total, 4);
assert.equal(stats.overall.pp, 2);
assert.equal(stats.overall.pv, 2);
assert.equal(stats.overall.unknown, 0);
assert.equal(stats.overall.pod, 2);
assert.equal(stats.overall.returned, 1);
assert.equal(stats.overall.notPod, 1);
assert.equal(stats.overall.a1, 1);
assert.equal(stats.overall.a2, 1);
assert.equal(stats.overall.a3, 0);
assert.equal(stats.overall.attemptUnknown, 0);
assert.equal(stats.overall.days.length, 2);
assert.equal(stats.overall.ppDays.length, 1);
assert.equal(stats.overall.pvDays.length, 1);
assert.equal(assertShopeeExportTruth('SHOPEEVN', base, stats), true);

assert.throws(() => assertV200ExportRange([{ ...base[0], reportMembershipDate: '2026-08-13', dailyMembershipDates: ['2026-08-13'] }], range), /V200_EXPORT_RANGE_LEAK/);
const missingAttempt = base.map(row => ({ ...row, dailyMembershipDates: [...row.dailyMembershipDates] }));
missingAttempt[0].attemptNo = 0;
const missingAttemptStats = statsOf(missingAttempt, range);
assert.throws(() => assertShopeeExportTruth('SHOPEEVN', missingAttempt, missingAttemptStats), /SHOPEE_EXPORT_TRUTH_INCOMPLETE/);

const ev=(eventCode,eventTime,desc='')=>({eventCode,eventTime,rawJson:JSON.stringify({trackingEventDesc:desc})});
const one=resolveStrictShopeeAttempt({pod:true,podDate:'2026-08-14',events:[ev('70','2026-08-14 08:00:00','Parcel start to deliver'),ev('80','2026-08-14 12:00:00','Successfully delivered')]});
assert.equal(one.attemptNo,1);
const duplicateStart=resolveStrictShopeeAttempt({pod:true,podDate:'2026-08-14',events:[ev('70','2026-08-14 08:00:00','Parcel start to deliver'),ev('70','2026-08-14 09:00:00','Parcel start to deliver'),ev('80','2026-08-14 12:00:00','Successfully delivered')]});
assert.equal(duplicateStart.attemptNo,1,'duplicate START without failure must remain first attempt');
const two=resolveStrictShopeeAttempt({pod:true,podDate:'2026-08-15',events:[ev('70','2026-08-14 08:00:00','Parcel start to deliver'),ev('150','2026-08-14 18:00:00','Pending delivery problem'),ev('70','2026-08-15 08:00:00','Parcel start to deliver'),ev('80','2026-08-15 12:00:00','Successfully delivered')]});
assert.equal(two.attemptNo,2);
const three=resolveStrictShopeeAttempt({pod:true,podDate:'2026-08-16',events:[ev('70','2026-08-14 08:00:00','Parcel start to deliver'),ev('150','2026-08-14 18:00:00','Pending delivery problem'),ev('70','2026-08-15 08:00:00','Parcel start to deliver'),ev('150','2026-08-15 18:00:00','Pending delivery problem'),ev('70','2026-08-16 08:00:00','Parcel start to deliver'),ev('80','2026-08-16 12:00:00','Successfully delivered')]});
assert.equal(three.attemptNo,3);

const historicalSource = fs.readFileSync(new URL('../src/v320HistoricalExportRows.js', import.meta.url), 'utf8');
const businessFilterAt = historicalSource.indexOf("AND UPPER(TRIM(u.businessType))=?");
const rankAt = historicalSource.indexOf('ROW_NUMBER() OVER(PARTITION BY reportDate');
assert.ok(businessFilterAt >= 0 && rankAt > businessFilterAt, 'latest VALID export membership must filter business before date ranking');
assert.match(historicalSource, /UNIFIED_PER_BUSINESS_LATEST_VALID/);

const attemptSource = fs.readFileSync(new URL('../src/v230AttemptSigningTruth.js', import.meta.url), 'utf8');
assert.ok(!attemptSource.includes('reportDate BETWEEN ? AND ?'), 'saved tracking evidence must not be cut off at report-date range; later real POD evidence is required');
assert.match(attemptSource, /shipmentCode IN/);
assert.match(attemptSource, /已保存轨迹真实POD节点/);

const workbookSource = fs.readFileSync(new URL('../src/v200ReferenceWorkbook.js', import.meta.url), 'utf8');
assert.ok(!workbookSource.includes("'—'"), 'verified workbook must not emit dash placeholders for numeric metrics');
assert.match(workbookSource, /if \(percent\) cell\.numFmt = '0\.00%'/);
assert.match(workbookSource, /V200_VERIFIED_METRIC_MISSING/);

console.log('[SHOPEE_EXPORT_TRUTH_SMOKE] PASS date-range isolation · per-business latest VALID ownership · PP/PV reconciliation · POD/return/notPOD reconciliation · real 1/2/3 delivery cycles · full saved tracking POD-date recovery · signing-day sample completeness · no dash placeholders');
