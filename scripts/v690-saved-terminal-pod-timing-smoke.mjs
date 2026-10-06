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
assert.match(home,/strictLedger\|\|savedTerminalFallback\|\|snapshotFallback\|\|direct/,'timing priority must be strict track > strict ledger > saved terminal POD > completed snapshot > missing');

assert.match(home,/const usableLocalTiming=n\(current\.overall\?\.podCount,0\)>0&&current\.overall\?\.avgDays!=null/,'usable local timing guard missing');
assert.match(home,/const needs=count>0&&!usableLocalTiming/,'remote repair must stop once local timing is usable');

console.log('[V690] selected-date timing reuses formal saved terminal POD evidence and stops redundant remote retries once usable');
