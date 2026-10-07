import fs from 'node:fs';
import assert from 'node:assert/strict';

const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(home,/recoverV498SavedShopeePodDates/,'V690 must reuse existing saved Shopee POD evidence owner');
assert.match(home,/extractV498SavedShopeePodEvidence/,'V690 must reuse strict saved terminal POD extractor');
assert.match(home,/v495SavedTerminalEventPodDate/,'V690 must reuse saved terminal lastEventTime proof');
assert.match(home,/function savedTerminalPodTimingEvidence\(reportDate,businessType,canonicalPodSet=new Set\(\)\)/,'saved terminal timing helper missing');

assert.match(home,/v498_saved_sqlite_pod_date/,'Shopee saved SQLite POD evidence source missing');
assert.match(home,/v495_saved_terminal_event_time/,'saved terminal event time source missing');
assert.match(home,/local_\$\{spec\[0\]\}_pod_date/,'WHPP\/Shopee local business-table POD evidence source missing');

assert.match(home,/const savedTerminalFallback=!direct\.ok&&!strictLedger\?savedTerminalTiming\.get\(shipmentCode\)\|\|null:null/,'saved terminal evidence must never outrank strict track or strict ledger');
assert.match(home,/const trackEvidence=direct\.ok\?[\s\S]*?\(strictLedger\|\|savedTerminalFallback\|\|snapshotFallback\|\|direct\)/,'saved terminal POD evidence must remain behind strict track/ledger inside the track fallback chain');
assert.match(home,/evidence:dailyReportFallback\|\|trackEvidence/,'overall signing days must prefer uploaded daily-report order-to-delivery evidence');

assert.match(home,/const usableLocalTiming=n\(current\.overall\?\.podCount,0\)>0&&current\.overall\?\.avgDays!=null/,'usable local timing guard missing');
assert.match(home,/const needs=count>0&&!usableLocalTiming/,'remote repair must stop once local timing is usable');

console.log('[V690] saved terminal POD evidence remains a fallback; V742 daily-report signing timing stops redundant remote repair when usable');
