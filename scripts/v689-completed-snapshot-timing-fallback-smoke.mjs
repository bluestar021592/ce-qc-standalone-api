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
assert.match(home,/const trackEvidence=direct\.ok\?[\s\S]*?\(strictLedger\|\|savedTerminalFallback\|\|snapshotFallback\|\|direct\)/,'track fallback priority must remain track > strict ledger > saved terminal POD > completed snapshot > missing');
assert.match(home,/evidence:dailyReportFallback\|\|trackEvidence/,'uploaded daily-report signing time must own the overall signing-day metric when available');
assert.match(home,/const existingSigning=row\.evidence\?\.ok\?row\.evidence:null/,'archive pass must preserve already-valid local signing evidence');
assert.match(home,/evidence:existingSigning\|\|recoveredTrack/,'archive timing must never replace a valid daily-report signing result');

console.log('[V689] completed snapshot remains a track fallback while V742 daily-report signing evidence owns overall signing days');
