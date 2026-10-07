import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync('server.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const css=fs.readFileSync('public/v625-shell.css','utf8');
const storeFlow=fs.readFileSync('src/storeFlow.js','utf8');
const analyzer=fs.readFileSync('src/analyzerV30.js','utf8');

assert.match(server,/qualitySignals/,'tracking workspace must publish exact quality-signal counts');
assert.match(server,/shopArrived:qualityBuckets\.shopArrived\.length/,'store-arrival count must come from full workspace ledger, not the 5000-row preview');
assert.match(server,/pendingGap:qualityBuckets\.pendingGap\.length/,'Pending non-continuous count missing');
assert.match(server,/oc2Plus:qualityBuckets\.oc2Plus\.length/,'OC2+ count missing');
assert.match(server,/pendingFactDateContinuity \|\| row\.Pending事实连续性/,'Pending gap must use trajectory fact continuity');
assert.match(server,/workspaceOcDays/,'OC2+ must calculate current inclusive OC days');
assert.match(server,/shopCode: row\.currentShopCode/,'store detail must expose exact current shop code');
assert.match(server,/shopArrivedAt: row\.shopArrivedAt/,'store detail must expose arrival timestamp');

assert.match(html,/data-kpi-detail="shopArrived"/,'every business board must render store-arrival KPI');
assert.match(html,/data-kpi-detail="pendingGap"/,'every business board must render Pending-gap KPI');
assert.match(html,/data-kpi-detail="oc2Plus"/,'every business board must render OC2+ KPI');
assert.match(html,/V748_PER_BOARD_TRACK_QUALITY_SIGNALS/,'V748 shell marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v748-1/,'V748 JS cache bust missing');
assert.match(css,/v748-quality-signals/,'V748 quality card layout missing');

assert.match(shell,/businessType:requestedBusiness,fromDate:date,toDate:date/,'board must launch business-scoped exact-date tracking reconcile');
assert.match(shell,/\/api\/v246\/tracking\/reconcile/,'board precision refresh must use existing CE trajectory reconcile engine');
assert.match(shell,/await loadBusiness\(\{skipQualityRefresh:true\}\)/,'completed track refresh must immediately repaint the board without recursion');
assert.match(shell,/v748QualityRefreshKeys/,'automatic track refresh must be once-per-business/date per browser session');
assert.match(shell,/v748QualityRefreshKeys\.clear\(\)/,'latest shop-code import must invalidate quality refresh cache');
assert.match(shell,/void refreshV748BusinessTrackQuality\(v628BusinessReportDate\)/,'latest store list must trigger fresh trajectory classification on an open board');

assert.match(storeFlow,/SHOP_ARRIVED_CURRENT/,'store arrival must stay anchored to actual inbound trajectory');
assert.match(storeFlow,/getShopCodeMap\(\)/,'store detection must use the active runtime shop whitelist');
assert.match(analyzer,/facts\.pendingNonContinuous/,'Pending non-continuity must be trajectory-fact based');
assert.match(analyzer,/ocCurrent\(sorted, last, reportDate\)/,'OC duration must come from current trajectory evidence');

console.log('[V748] every business board exposes store-arrived, Pending non-continuous, and OC2+ overlays; first paint remains local and a once-per-board/date V246 track reconcile precisely refreshes nonterminal evidence using the active latest store whitelist');
