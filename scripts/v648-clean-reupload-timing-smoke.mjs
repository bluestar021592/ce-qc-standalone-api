import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(repair,/keyOf=\(type,date,snapshotId=''\)/,'repair state must be snapshot-scoped');
assert.match(repair,/WAITING_FOR_POD_MEMBERS/,'fresh uploads must retry after POD members become available');
assert.match(repair,/age<5_000/,'POD-member waiting state must retry quickly');
assert.doesNotMatch(repair,/DELETE FROM business_track_events WHERE businessType=\? AND reportDate=\? AND shipmentCode=\?/,'repair must not destructively delete saved per-bill history');
assert.match(repair,/eventFingerprint/,'repair must merge/dedupe track evidence');
assert.match(repair,/fallbackSizes:\[25,10,5,1\]/,'track fallback must retain bounded 50→25→10→5→1 behavior');
assert.match(summary,/inspectSelectedDateTimingRepair\(type,batch\.reportDate,batch\.snapshotId\)/,'summary must inspect exact uploaded snapshot state');
assert.match(summary,/blocking:false/,'archive recovery must not block local timing publication');
assert.match(shell,/evidenceState==='RUNNING'\|\|timingRepairRunning/,'business page must poll while timing repair is active');
assert.match(shell,/showWhppScan=business==='WHPP'&&waiting>0/,'WHPP action must require WHPP and waiting>0');
assert.match(html,/v625-shell\.js\?v=20261005-v648-1/,'V648 JS cache revision missing');
assert.match(html,/v625-shell\.css\?v=20261005-v648-1/,'V648 CSS cache revision missing');

console.log('[V648] clean-reupload timing lifecycle + preserved track evidence + business polling smoke passed');
