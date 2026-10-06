import fs from 'node:fs';
import assert from 'node:assert/strict';

const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(home,/const currentTotal=n\(current\?\.overall\?\.totalPodCount,0\)/,'canonical timing denominator must be read before cache fallback');
assert.match(home,/const totalPod=currentTotal>0\?currentTotal:n\(row\.pod,0\)/,'cache fallback must never shrink a nonzero canonical POD denominator');
assert.match(home,/Math\.min\(totalPod,Math\.max\(n\(current\?\.overall\?\.podCount,0\),cachedPodCount\)\)/,'cached valid sample count must be capped by canonical denominator');
console.log('[V678] saved timing cache cannot shrink selected-date canonical POD totals');
