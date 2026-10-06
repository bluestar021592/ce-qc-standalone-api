import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const normalizer=fs.readFileSync('src/v485StrictTrackEvidence.js','utf8');

assert.match(repair,/async function queryTimingEvidenceRows\(client,codes=\[\]\)/,'dual-channel timing query helper missing');
assert.match(repair,/primary=await client\.trackQuery\(bills\)/,'timing repair must query event endpoint first');
assert.match(repair,/fallback=await client\.shipmentTrack\(bills\)/,'timing repair must fall back to shipment-track when event query yields no recognizable events');
assert.match(repair,/normalizeV485TrackRows\(primary,\{fallbackBills:bills\}\)/,'primary response must be normalized before deciding fallback');
assert.match(repair,/normalizeV485TrackRows\(fallback,\{fallbackBills:bills\}\)/,'shipment-track fallback must also pass through strict event normalization');
assert.match(repair,/query:codes=>queryTimingEvidenceRows\(client,codes\)/,'batch repair must use dual-channel helper');
assert.match(repair,/apiName:`v686-\$\{type\.toLowerCase\(\)\}-selected-date-timing`/,'V686 repair identity missing');
assert.match(normalizer,/function looksLikeEvent\(obj\)/,'strict event recognizer must remain authoritative');
assert.match(normalizer,/if\(hasAny\(obj,CODE_KEYS\)\)return true;/,'only event-like nodes may become timing evidence');
console.log('[V686] selected-date timing repair uses event-query then strict shipment-track fallback without fabricating non-event timing evidence');
