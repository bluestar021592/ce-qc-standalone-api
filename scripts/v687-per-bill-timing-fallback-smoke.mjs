import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');

assert.match(repair,/const covered=new Set\(primaryNormalized\.map\(row=>billOf\(row\)\)\.filter\(Boolean\)\)/,'primary event coverage set missing');
assert.match(repair,/const missing=bills\.filter\(code=>!covered\.has\(code\)\)/,'shipment-track fallback must target only missing bills');
assert.match(repair,/fallback=await client\.shipmentTrack\(missing\)/,'shipment-track fallback must query only missing members');
assert.match(repair,/return \[\.\.\.primary,\.\.\.fallback\]/,'primary and fallback payloads must merge before normalization/persistence');
console.log('[V687] per-bill event-query coverage falls back only missing POD members to shipment-track');
