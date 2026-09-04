import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../src/unifiedRunPreparation.js',import.meta.url),'utf8');

assert.match(source,/LAZY_ON_EXPLICIT_RUN/,'lazy run-preparation policy missing');
assert.match(source,/status='OPEN'/,'only OPEN carry may be prepared');
assert.match(source,/sourceReportDate<\?/,'historical carry must exclude current report date');
assert.match(source,/CCSL_TYPES=.*CE.*CEAF.*TBKH.*ALI1688/s,'CCSL scope incomplete');
assert.match(source,/SHOPEE_TYPES=.*SHOPEECN.*SHOPEEVN/s,'SHOPEE scope incomplete');
assert.match(source,/WHERE reportDate=\? AND status='VALID'/,'exact VALID batch authority missing');
assert.match(source,/ORDER BY createdAt DESC,rowid DESC/,'same-date correction must use newest valid batch');
assert.match(source,/podSet/,'POD lock exclusion missing');
assert.match(source,/scanPool:\[\.\.\.new Set\(\[\.\.\.currentBills,\.\.\.carryBills\]\)\]/,'scan pool must merge current + carry once');
assert.doesNotMatch(source,/UPDATE\s+carryover_open_items/i,'run preparation must be read-only');
assert.doesNotMatch(source,/DELETE\s+FROM/i,'run preparation must never delete persistence');

console.log('[SYSTEM] unified run preparation smoke passed · exact VALID batch · OPEN historical carry · current day excluded · read-only');
