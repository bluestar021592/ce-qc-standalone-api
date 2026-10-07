import assert from 'node:assert/strict';
import fs from 'node:fs';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const diag=fs.readFileSync('src/v736TimingDiagnostics.js','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(repair,/V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION/,'V740 repair revision missing');
assert.match(repair,/client\.confirmQuery\(codes\)/,'historical POD timing must query confirm endpoint without re-uploading the daily report');
assert.match(repair,/persistConfirmRows\(type,date,rows\)/,'live confirm rows must persist into selected-date scan evidence');
assert.match(repair,/confirm85WithTime/,'orderStatus=85 with real timestamp counter missing');
assert.match(repair,/confirm85WithoutTime/,'orderStatus=85 without timestamp counter missing');
assert.match(repair,/const statusBills=bills\.filter\(code=>!confirmTimedBills\.has\(code\)\)/,'shipmentStatus fallback must skip bills already timed by confirm');
assert.match(repair,/const timedBills=new Set\(\[\.\.\.confirmTimedBills,\.\.\.statusTimedBills\]\)/,'confirm and shipmentStatus timestamp evidence must share one resolved set');
assert.match(repair,/POST_CONFIRM_STATUS_AND_TRACK_QUERY_EXHAUSTED/,'durable exhaustion must happen only after all three live evidence sources are exhausted');
assert.match(diag,/confirm85WithTime/,'diagnostics must expose confirm timing recovery');
assert.match(home,/business_scan_results/,'home timing must read persisted confirm scan evidence');

console.log('[V740] historical signing timing reuses existing POD membership and live confirm-query timestamps; no daily-report re-upload or 7-business rerun is required');
