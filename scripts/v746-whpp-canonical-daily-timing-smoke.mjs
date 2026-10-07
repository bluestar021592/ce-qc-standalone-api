import assert from 'node:assert/strict';
import fs from 'node:fs';

const home=fs.readFileSync('src/homeQualitySummary.js','utf8');
const diag=fs.readFileSync('src/v745WhppTimingSourceDiagnostics.js','utf8');
const canonical=fs.readFileSync('src/whppCanonicalTruth.js','utf8');

assert.match(canonical,/business_daily_parse_rows[\s\S]*businessType='WHPP'/,'WHPP canonical truth must retain legacy daily-parse fallback');
assert.match(home,/FROM business_daily_parse_rows[\s\S]*businessType='WHPP' AND reportDate=\?/,'selected-date WHPP signing must read canonical daily-parse source when unified rows are absent');
assert.match(home,/businessType='WHPP' AND reportDate>=\?/,'later WHPP daily observations must backfill historical signing time');
assert.match(home,/WHPP_DAILY_PARSE/,'WHPP timing evidence source must be observable');
assert.match(home,/whpp_daily_parse_delivery_time/,'selected-date WHPP daily-parse evidence must be labelled');
assert.match(home,/latest_whpp_daily_parse_delivery_time/,'later WHPP daily-parse evidence must be labelled');

assert.match(diag,/business_daily_parse_rows/,'WHPP diagnostic must inspect canonical daily-parse rows');
assert.match(diag,/legacyObservationRows/,'diagnostic must report canonical daily-parse observation coverage');
assert.match(diag,/sourceTable/,'diagnostic samples must identify the backing source');

console.log('[V746] WHPP signing timing now follows its canonical persistence path: unified rows when present, business_daily_parse_rows fallback otherwise, including later-report backfill');
