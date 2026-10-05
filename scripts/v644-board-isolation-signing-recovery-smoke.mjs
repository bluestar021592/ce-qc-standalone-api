import fs from 'node:fs';
import assert from 'node:assert/strict';

const css=fs.readFileSync('public/v625-shell.css','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const whpp=fs.readFileSync('src/whppSigningEvidenceRepair.js','utf8');

assert.match(css,/\[hidden\]\{display:none!important\}/,'global hidden semantics must override component display rules');
assert.match(html,/id="v641WhppScanPending"[^>]*hidden/,'WHPP scan control must be hidden in markup by default');
assert.match(js,/const whppOnlyAction=byId\('v641WhppScanPending'\);\s*if\(whppOnlyAction\)whppOnlyAction\.hidden=true;/,'business board must fail-close WHPP-only action before async reads');
assert.match(js,/whppScanBtn\.hidden=!\(business==='WHPP'&&waiting>0\)/,'WHPP scan action may open only on WHPP with waiting members');
assert.match(whpp,/loadWhppCanonicalTruth/,'WHPP signing repair must read canonical truth');
assert.match(whpp,/truth\.rows\|\|\[\]/,'WHPP signing repair must derive POD members from canonical rows');
assert.match(summary,/readV329ThreeBusinessDailyCache/,'home timing must be able to read persisted V329 signing evidence');
assert.match(summary,/timingWithSavedCacheFallback/,'home timing must publish truthful saved-cache fallback');
assert.match(summary,/row\.avgSigningDays/,'saved signing average must come from persisted evidence metric');
assert.match(html,/v625-shell\.js\?v=20261005-v644-1/,'V644 JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=20261005-v644-1/,'V644 CSS cache bust missing');

console.log('[V644] business action isolation + historical signing timing recovery smoke passed');
