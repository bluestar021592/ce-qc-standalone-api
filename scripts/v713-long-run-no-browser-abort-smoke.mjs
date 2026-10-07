import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(shell,/const bounded=Number\(timeout\)>0/,'request helper must support unbounded long-running jobs');
assert.match(shell,/REQUEST_TIMEOUT_/,'bounded request timeout must have an explicit reason');
assert.match(shell,/runFamilyRequest\('CCSL','\/api\/run',reportDate\)/,'CCSL long run must use the unbounded transport-recovery owner');
assert.match(shell,/runFamilyRequest\('SHOPEE','\/api\/shopee\/run\/start',reportDate\)/,'SHOPEE long run must use the unbounded transport-recovery owner');
assert.match(shell,/runFamilyRequest\('CCSL','\/api\/resume',reportDate\)/,'CCSL resume must use the unbounded transport-recovery owner');
assert.match(shell,/runFamilyRequest\('SHOPEE','\/api\/shopee\/run\/resume',reportDate\)/,'SHOPEE resume must use the unbounded transport-recovery owner');
assert.match(shell,/waitWhppTerminal\(reportDate,timeoutMs=1800000\)/,'WHPP terminal wait must allow long production runs');
assert.match(shell,/后台任务可能仍在继续/,'abort errors must not be presented as confirmed business failure');
assert.match(html,/<meta name="ce-qc-build" content="V\d+_[A-Z0-9_]+">/);
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d+-\d+/);

console.log('[V713] long 7-business processing is progress-polled without a 6-minute browser abort; bounded requests retain explicit timeout errors');
