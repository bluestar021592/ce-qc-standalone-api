import fs from 'node:fs';
import assert from 'node:assert/strict';

const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(home,/function completedSnapshotTimingEvidence\(reportDate,businessType,canonicalPodSet=new Set\(\)\)/,'completed snapshot timing fallback owner missing');
assert.match(home,/REPORT_DATE_TO_POD_SNAPSHOT/,'snapshot timing fallback must be explicitly labeled');
assert.match(home,/attemptSource:'COMPLETED_SNAPSHOT_DAY'/,'snapshot attempt/day source must be explicit');
assert.match(home,/evidenceSource:'completed_snapshot_pod_date'/,'snapshot timing evidence source must be explicit');

assert.match(home,/tabs\?\.pod\?\.rows/,'WHPP snapshot POD rows must be consumed');
assert.match(home,/tabs\?\.\[group\+'_pod'\]\?\.rows/,'Shopee CN\/VN snapshot POD rows must be consumed');
assert.match(home,/tabs\?\.\[group\+'_attempt1'\]/,'Shopee snapshot attempt1 membership must be reused');
assert.match(home,/tabs\?\.\[group\+'_attempt2'\]/,'Shopee snapshot attempt2 membership must be reused');
assert.match(home,/tabs\?\.\[group\+'_attempt3'\]/,'Shopee snapshot attempt3 membership must be reused');

assert.match(home,/const snapshotFallback=!direct\.ok&&!strictLedger&&!savedTerminalFallback\?snapshotTiming\.get\(shipmentCode\)\|\|null:null/,'snapshot fallback must remain behind strict track, strict ledger, and saved terminal POD evidence');
assert.match(home,/strictLedger\|\|savedTerminalFallback\|\|snapshotFallback\|\|direct/,'local timing priority must be track > strict ledger > saved terminal POD > completed snapshot > missing');
assert.match(home,/const savedFallback=!direct\.ok&&!strictLedger&&row\.evidence\?\.ok\?row\.evidence:null/,'archive pass must preserve a valid completed-snapshot fallback');
assert.match(home,/strictLedger\|\|savedFallback\|\|direct/,'archive timing priority must preserve saved snapshot fallback');

console.log('[V689] completed snapshot POD-date timing fallback preserves strict-track priority and survives archive pass');
