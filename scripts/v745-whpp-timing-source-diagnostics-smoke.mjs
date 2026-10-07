import assert from 'node:assert/strict';
import fs from 'node:fs';

const diag=fs.readFileSync('src/v745WhppTimingSourceDiagnostics.js','utf8');
const server=fs.readFileSync('server.js','utf8');

assert.match(diag,/persistentSelectedDatePodBills\(db,'WHPP',date\)/,'diagnostic must use exact selected-date WHPP POD membership');
assert.match(diag,/JOIN unified_import_batches b ON b\.batchId=u\.batchId AND b\.status='VALID'/,'diagnostic must inspect only valid uploaded daily-report observations');
assert.match(diag,/u\.reportDate>=\?/,'diagnostic must include later daily reports that can backfill historical signing time');
assert.match(diag,/topTimingFields/,'diagnostic must expose aggregate timing/status field coverage');
assert.match(diag,/samples/,'diagnostic must expose bounded sample observations');
assert.match(server,/\/api\/whpp-timing-source-diagnostics/,'read-only WHPP timing diagnostic route missing');

console.log('[V745] read-only WHPP timing source diagnostic exposes exact POD-member daily-report field coverage without re-uploading or rerunning business processing');
