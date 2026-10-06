import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(shell,/const bounded=Number\(timeout\)>0/,'request helper must support unbounded long-running jobs');
assert.match(shell,/REQUEST_TIMEOUT_/,'bounded request timeout must have an explicit reason');
assert.match(shell,/post\('\/api\/run',\{\},0\)/,'CCSL long run must not be browser-aborted at 6 minutes');
assert.match(shell,/post\('\/api\/shopee\/run\/start',\{\},0\)/,'SHOPEE long run must not be browser-aborted at 6 minutes');
assert.match(shell,/post\('\/api\/resume',\{\},0\)/,'CCSL resume must be unbounded while live progress is polled');
assert.match(shell,/post\('\/api\/shopee\/run\/resume',\{\},0\)/,'SHOPEE resume must be unbounded while live progress is polled');
assert.match(shell,/waitWhppTerminal\(reportDate,timeoutMs=1800000\)/,'WHPP terminal wait must allow long production runs');
assert.match(shell,/后台任务可能仍在继续/,'abort errors must not be presented as confirmed business failure');
assert.match(html,/V713_LONG_RUN_NO_ABORT/);
assert.match(html,/v625-shell\.js\?v=20261006-v713-1/);

console.log('[V713] long 7-business processing is progress-polled without a 6-minute browser abort; bounded requests retain explicit timeout errors');
