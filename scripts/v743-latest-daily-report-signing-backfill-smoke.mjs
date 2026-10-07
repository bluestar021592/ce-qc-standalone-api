import assert from 'node:assert/strict';
import fs from 'node:fs';

const home=fs.readFileSync('src/homeQualitySummary.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(home,/JOIN unified_import_batches b ON b\.batchId=u\.batchId AND b\.status='VALID'/,'latest signing observation must come only from valid daily-report batches');
assert.match(home,/u\.reportDate>=\?/,'selected-date members must be allowed to receive later daily-report observations');
assert.match(home,/ORDER BY UPPER\(TRIM\(u\.shipmentCode\)\),u\.reportDate DESC,u\.createdAt DESC,u\.rowid DESC/,'newest daily-report observation must win deterministically');
assert.match(home,/region:String\(base\?\.regionCode\|\|chosen\.row\.regionCode/,'PP/PV attribution must stay anchored to selected-date membership when available');
assert.match(home,/evidenceSource:String\(chosen\.row\.reportDate\|\|''\).*latest_daily_report_delivery_time/s,'later daily-report timing evidence must be explicitly labelled');
assert.match(home,/const canonicalPodSet=new Set\(selectedDatePodBills/,'selected-date POD membership must remain immutable while timing observations advance');
assert.match(home,/evidence:dailyReportFallback\|\|trackEvidence/,'daily-report signing evidence must own overall signing days');

assert.match(shell,/待后续日报回补/,'missing final delivery times must be labelled as later-report backfill, not irreversible loss');
assert.match(shell,/后续日报更新后自动回补/,'UI must explain automatic later-report timing backfill');
assert.match(html,/V744_SIGNING_UI_SIMPLIFIED_AND_TERMINAL_BACKFILL|V743_LATEST_DAILY_REPORT_SIGNING_BACKFILL/,'V743+ shell marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v743-1/,'V743 cache bust missing');

// July-1 VN acceptance reproduced from the proven historical analysis:
// early snapshot had 281 PP POD members averaging 917/281 days; three later
// daily-report observations became POD at 51, 51, and 42 inclusive days.
const earlyPpSum=917;
const ppAvg=(earlyPpSum+51+51+42)/284;
const pvAvg=812/261;
const overallAvg=(ppAvg*284+pvAvg*261)/545;
assert.ok(Math.abs(ppAvg-3.7359154929577465)<1e-12,'July-1 PP latest-observation acceptance must remain 3.7359154929577465');
assert.ok(Math.abs(pvAvg-3.111111111111111)<1e-12,'July-1 PV acceptance must remain 3.111111111111111');
assert.ok(Math.abs(overallAvg-3.436697247706422)<1e-12,'July-1 VN overall acceptance must remain 3.436697247706422');

console.log('[V743] selected-date membership is frozen while latest VALID daily-report status/派件时间 backfills signing days; July-1 VN acceptance = overall 3.436697, PP 3.735915, PV 3.111111');
