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
assert.match(repair,/if\(status==='HISTORICAL_EVIDENCE_UNAVAILABLE'\)return current/,'historical exhausted dates must not auto-query again');
assert.match(repair,/savedEvents===0/,'historical suppression must require no local saved timing events');

assert.doesNotMatch(business,/DELETE FROM business_track_events WHERE businessType=\? AND reportDate=\?/,'business finalization must never erase saved timing events');
assert.match(business,/appendPermanentBusinessTrackEvents\(db,type,date,state\.trackEvents\|\|\[\],now\)/,'business final save must append timing events');
assert.match(business,/if\(date&&\(state\.trackEvents\|\|\[\]\)\.length\)appendPermanentBusinessTrackEvents/,'runtime checkpoints must persist timing events immediately');
assert.match(business,/strictPodEventTime/,'strict POD event timestamp persistence missing');
assert.match(business,/VALUES\(\?,\?,\?,'strict_track_event',\?,\?\)/,'POD lock must retain strict track source');

assert.doesNotMatch(whpp,/\['business_scan_results','business_track_events','business_exception_items','business_final_rows'\]/,'WHPP finalization must not delete saved timing events');
assert.match(whpp,/appendPermanentWhppTrackEvents\(db,reportDate,normalized\.trackEvents\|\|\[\],now\)/,'WHPP finalization must append timing events');
assert.match(whpp,/if\(normalized\.reportDate&&\(normalized\.trackEvents\|\|\[\]\)\.length\)appendPermanentWhppTrackEvents/,'WHPP checkpoints must persist timing evidence immediately');

assert.match(shell,/历史轨迹证据缺失/,'historical evidence unavailable UI missing');
assert.match(shell,/时效不可计算/,'historical timing unavailable explanation missing');
assert.match(shell,/历史证据缺失/,'timing card must stop calling exhausted history retryable');
assert.match(html,/V700_PERSISTENT_TIMING_EVIDENCE/,'V700 shell build marker missing');
assert.match(html,/v625-shell\.js\?v=20261006-v700-1/,'V700 JS cache bust missing');

console.log('[V700] historical timing gaps stop futile retries; future 60/70/Pending/80 evidence is append-only and persistent');
