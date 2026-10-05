import fs from 'node:fs';
import assert from 'node:assert/strict';

const gate=fs.readFileSync('src/v501FreshStartManualTrackingGate.js','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(gate,/explicitSingleDay/,'legacy gate must allow an explicit single report day');
assert.match(gate,/from===to/,'single-day scope must be exact');
assert.match(gate,/V501_LEGACY_WIDE_RANGE_BLOCKED/,'wide-range legacy reconcile must remain blocked');
assert.match(gate,/无需清空数据/,'legacy scoped refresh must not instruct the user to purge');

assert.match(js,/const reportDate=selectedReportDate\(\)\|\|latest\.reportDate/,'manual POD refresh must bind to the selected report day');
assert.match(js,/fromDate:reportDate,toDate:reportDate/,'manual POD refresh must never expand to today');
assert.doesNotMatch(js,/const to=cambodiaToday\(\);let from=latest\.reportDate/,'old long-window refresh must be removed');

assert.match(html,/id="v641WhppScanPending"/,'WHPP waiting-scan action missing');
assert.match(js,/async function scanWhppPending\(/,'WHPP pending scan handler missing');
assert.match(js,/safeWhppRun\('resume',reportDate\)/,'WHPP pending scan must use the dedicated WHPP resume path');
assert.match(js,/扫描WHPP待处理 '\+fmt\(waiting\)\+' 票'/,'WHPP button must show the actual waiting count');

assert.match(html,/v625-shell\.js\?v=20261005-v(?:641|642)-1/,'V641 shell cache bust missing');
assert.match(html,/v625-shell\.css\?v=20261005-v(?:641|642)-1/,'V641 css cache bust missing');

console.log('[V641] single-day targeted tracking + explicit WHPP waiting-scan action smoke passed');
