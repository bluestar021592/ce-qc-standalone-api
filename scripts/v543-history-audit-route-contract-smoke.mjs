import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('src/v142SevenBusinessExportPatch.js','utf8');
assert.match(source,/res\.status\(202\)\.json/,'audit start must return immediately with 202');
assert.match(source,/statusUrl:`\/api\/v142\/history-integrity-job\/\$\{started\.job\.jobId\}`/,'start response must publish status URL');
assert.match(source,/if\(job\.status==='RUNNING'\)return res\.status\(202\)/,'running status polling must stay non-blocking');
assert.match(source,/if\(job\.status==='FAILED'\)return res\.status\(500\)/,'terminal worker failure must surface explicitly');
assert.match(source,/return res\.json\(\{\.\.\.job\.result/,'successful worker result must preserve legacy audit payload shape');
console.log('[V543] history audit route contract smoke passed');
