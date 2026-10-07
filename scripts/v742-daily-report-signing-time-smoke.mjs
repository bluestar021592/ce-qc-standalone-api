import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractDailyReportSigningEvidence, naturalSigningDays } from '../src/dailyReportSigningTiming.js';

assert.equal(naturalSigningDays('2026-10-01 09:49:24','2026-10-04 17:15:24'),4,'inclusive natural-day calculation must count the first day');
assert.equal(naturalSigningDays('2026-10-01 09:49:24','2026-10-01 17:15:24'),1,'same-day POD must be one day');

const pod=extractDailyReportSigningEvidence({'状态标识':'Y','下单时间':'2026-10-01 09:49:24','派件时间':'2026-10-04 17:15:24'});
assert.equal(pod.ok,true);
assert.equal(pod.days,4);
assert.equal(pod.evidenceSource,'daily_report_delivery_time');

const pending=extractDailyReportSigningEvidence({'状态标识':'P','下单时间':'2026-10-01 09:49:24','派件时间':'2026-10-04 17:15:24'});
assert.equal(pending.ok,false,'only daily-report Y/POD rows can contribute to POD signing averages');

const noDelivery=extractDailyReportSigningEvidence({'状态标识':'Y','下单时间':'2026-10-01 09:49:24','bookingDate':'2026-10-04 17:15:24'});
assert.equal(noDelivery.ok,false,'bookingDate must never be used as POD/delivery time');

const home=fs.readFileSync('src/homeQualitySummary.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(home,/dailyReportSigningEvidenceForBills/,'home timing must read the original imported daily report');
assert.match(home,/unified_import_rows/,'daily-report timing must use persisted original import rows');
assert.match(home,/evidence:dailyReportFallback\|\|trackEvidence/,'daily-report order-to-delivery signing evidence must be preferred for overall average');
assert.match(home,/const attemptNo=row=>Number\(row\.attemptEvidence\?\.attempt\|\|row\.evidence\?\.attempt\|\|0\)/,'attempt buckets must remain driven by track/attempt evidence');
assert.match(home,/signingStart:'DAILY_REPORT_ORDER_TIME'/,'timing rule must expose daily-report order-time start');
assert.match(home,/signingTerminal:'DAILY_REPORT_DELIVERY_TIME_WHEN_STATUS_Y'/,'timing rule must expose Y/POD delivery-time terminal');

assert.match(shell,/日报下单时间→派件时间（含首日）/,'home must explain the actual average-signing formula');
assert.match(shell,/有效时效/,'card must not call daily-report signing evidence a track');
assert.match(html,/V742_DAILY_REPORT_SIGNING_TIME/,'V742 shell marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v742-1/,'V742 cache bust missing');

console.log('[V742] POD average signing days come directly from uploaded daily report: 状态标识=Y, 下单时间→派件时间, inclusive natural days; 1/2/3 attempt identity still comes from real track evidence');
