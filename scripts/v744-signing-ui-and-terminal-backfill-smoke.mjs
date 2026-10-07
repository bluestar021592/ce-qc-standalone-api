import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dailyReportProvesPod, extractDailyReportSigningEvidence } from '../src/dailyReportSigningTiming.js';

const html=fs.readFileSync('public/v625-shell.html','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.doesNotMatch(html,/1派平均签收|2派平均签收|3派平均签收/,'home signing overview must not render 1/2/3 attempt cards');
assert.doesNotMatch(html,/v625-attempt-grid/,'obsolete attempt-signing grid must be removed from the home shell');
assert.doesNotMatch(shell,/prefix\+'A1'|prefix\+'A2'|prefix\+'A3'/,'home renderer must not update removed 1/2/3 attempt cards');

assert.equal(dailyReportProvesPod({'状态说明':'POD'}),true,'explicit POD description must be accepted');
assert.equal(dailyReportProvesPod({orderStatus:'85'}),true,'orderStatus 85 must be accepted as POD');
assert.equal(dailyReportProvesPod({shipmentStatus:'60'}),true,'shipmentStatus 60 must be accepted as POD');
assert.equal(dailyReportProvesPod({'状态说明':'未签收'}),false,'negative signing description must never become POD');
assert.equal(dailyReportProvesPod({'状态说明':'RETURNED'}),false,'returned status must never become POD signing evidence');

const whppLike=extractDailyReportSigningEvidence({
  bookingDate:'2026-07-01 08:00:00',
  deliveryTime:'2026-07-03 18:00:00',
  orderStatus:'85'
});
assert.equal(whppLike.ok,true,'terminal WHPP-like daily row with order and delivery time must produce signing evidence');
assert.equal(whppLike.days,3);

assert.match(home,/if\(!obsByBill\.has\(bill\)\)obsByBill\.set\(bill,\[\]\)/,'later-report backfill must retain all observations per waybill');
assert.match(home,/for\(const row of candidates\)/,'backfill must scan newest-to-older observations until a valid terminal signing row is found');
assert.match(shell,/当日无POD/,'zero-POD boards must explain why no signing average exists');
assert.match(html,/V744_SIGNING_UI_SIMPLIFIED_AND_TERMINAL_BACKFILL/,'V744 shell marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v744-1/,'V744 cache bust missing');

console.log('[V744] 1/2/3 attempt signing cards removed; terminal daily-report POD markers broadened safely; newest-to-older valid daily observations can backfill WHPP/VN signing days');
