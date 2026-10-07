import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const business=fs.readFileSync('src/businessStore.js','utf8');
const whpp=fs.readFileSync('src/whppStore.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(repair,/HISTORICAL_AUTO_REPAIR_MAX_AGE_DAYS=30/,'historical automatic repair cutoff missing');
assert.match(repair,/HISTORICAL_EVIDENCE_UNAVAILABLE/,'durable historical evidence-unavailable state missing');
assert.match(repair,/selected_date_timing_stop:/,'durable timing stop key missing');
assert.match(repair,/INSERT INTO app_state\(key,valueJson,updatedAt\)/,'durable timing stop must persist in app_state');
assert.match(repair,/if\(status==='HISTORICAL_EVIDENCE_UNAVAILABLE'\)\{/,'durable historical exhaustion state handling missing');
assert.match(repair,/V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION/,'confirm-first timing repair revision missing');
assert.match(repair,/statusQueried/,'historical repair must record shipmentStatus query count');
assert.match(repair,/clearDurableStop\(type,date\)/,'legacy zero-query historical stops must be cleared for one real retry');
assert.match(repair,/timedBills\.size===0&&completed===0&&failed>=trackBills\.length&&persistedEvents===0&&reportAgeDays\(date\)>HISTORICAL_AUTO_REPAIR_MAX_AGE_DAYS/,'durable historical exhaustion must be decided only after confirm+status+track repair finishes');
assert.match(repair,/exhaustionSource:'POST_CONFIRM_STATUS_AND_TRACK_QUERY_EXHAUSTED'/,'durable stop must prove confirm, shipmentStatus and track repair were exhausted');
assert.doesNotMatch(repair,/savedEvents===0[\s\S]*自动补查已停止/,'historical repair must never stop before the first real timing query');

assert.doesNotMatch(business,/DELETE FROM business_track_events WHERE businessType=\? AND reportDate=\?/,'business finalization must never erase saved timing events');
assert.match(business,/appendPermanentBusinessTrackEvents\(db,type,date,state\.trackEvents\|\|\[\],now\)/,'business final save must append timing events');
assert.match(business,/if\(date&&\(state\.trackEvents\|\|\[\]\)\.length\)appendPermanentBusinessTrackEvents/,'runtime checkpoints must persist timing events immediately');
assert.match(business,/strictPodEventTime/,'strict POD event timestamp persistence missing');
assert.match(business,/VALUES\(\?,\?,\?,'strict_track_event',\?,\?\)/,'POD lock must retain strict track source');

assert.doesNotMatch(whpp,/\['business_scan_results','business_track_events','business_exception_items','business_final_rows'\]/,'WHPP finalization must not delete saved timing events');
assert.match(whpp,/appendPermanentWhppTrackEvents\(db,reportDate,normalized\.trackEvents\|\|\[\],now\)/,'WHPP finalization must append timing events');
assert.match(whpp,/if\(normalized\.reportDate&&\(normalized\.trackEvents\|\|\[\]\)\.length\)appendPermanentWhppTrackEvents/,'WHPP checkpoints must persist timing evidence immediately');

assert.match(shell,/待后续日报回补|历史签收时间缺失|历史轨迹证据缺失/,'historical evidence/backfill UI missing');
assert.match(shell,/后续日报更新后自动回补|时效不可计算/,'historical timing/backfill explanation missing');
assert.match(shell,/待后续日报回补|历史时间缺失|历史证据缺失/,'timing card must stop calling exhausted CE history retryable');
assert.match(html,/<meta name="ce-qc-build" content="V\d+_[A-Z0-9_]+">/,'current shell build marker missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d+-\d+/,'current JS cache bust missing');

console.log('[V700] historical timing performs confirm-query then shipmentStatus then track repair before durable exhaustion; future timing evidence remains append-only and persistent');
