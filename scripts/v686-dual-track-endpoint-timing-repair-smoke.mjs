import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const normalizer=fs.readFileSync('src/v485StrictTrackEvidence.js','utf8');

assert.match(repair,/async function queryTimingEvidenceRows\(client,codes=\[\]\)/,'dual-channel timing query helper missing');
assert.match(repair,/primary=await client\.trackQuery\(bills\)/,'timing repair must query event endpoint first');
assert.match(repair,/const missing=bills\.filter\(code=>!covered\.has\(code\)\)/,'fallback must be limited to bills missing primary event evidence');
assert.match(repair,/fallback=await client\.shipmentTrack\(missing\)/,'timing repair must fall back to shipment-track only for POD members still missing recognizable event evidence');
assert.match(repair,/normalizeV485TrackRows\(primary,\{fallbackBills:bills\}\)/,'primary response must be normalized before deciding fallback');
assert.match(repair,/normalizeV485TrackRows\(fallback,\{fallbackBills:missing\}\)/,'shipment-track fallback must also pass through strict event normalization for missing members');
assert.match(repair,/query:codes=>queryTimingEvidenceRows\(client,codes\)/,'batch repair must use dual-channel helper');
assert.match(repair,/apiName:`v686-\$\{type\.toLowerCase\(\)\}-selected-date-timing`/,'V686 repair identity missing');
assert.match(normalizer,/function looksLikeEvent\(obj\)/,'strict event recognizer must remain authoritative');
assert.match(normalizer,/if\(hasAny\(obj,CODE_KEYS\)\)return true;/,'only event-like nodes may become timing evidence');
console.log('[V686] selected-date timing repair uses event-query then strict shipment-track fallback without fabricating non-event timing evidence');
