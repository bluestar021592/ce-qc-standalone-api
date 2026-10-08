import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(shell,/const bounded=Number\(timeout\)>0/,'request helper must support unbounded long-running jobs');
assert.match(shell,/REQUEST_TIMEOUT_/,'bounded request timeout must have an explicit reason');
assert.match(shell,/try\{return await post\(endpoint,\{reportDate\},0\)\}/,'family execution request must remain unbounded while progress polling owns visibility');
assert.match(shell,/autoStartFamily\('CCSL','\/api\/run',reportDate,counts\.CCSL\)/,'CCSL long run must use the automatic transport-recovery owner');
assert.match(shell,/autoStartFamily\('SHOPEE','\/api\/shopee\/run\/start',reportDate,counts\.SHOPEE\)/,'SHOPEE long run must use the automatic transport-recovery owner');
assert.match(shell,/const endpoint=type==='SHOPEE'\?'\/api\/shopee\/run\/resume':'\/api\/resume'/,'selected-date resume must choose the correct CCSL/SHOPEE transport endpoints');
assert.match(shell,/await runFamilyRequest\(type,endpoint,date\)/,'interrupted CCSL/SHOPEE resume must remain unbounded and transport-recoverable');
assert.match(shell,/waitWhppTerminal\(reportDate,timeoutMs=1800000\)/,'WHPP terminal wait must allow long production runs');
assert.match(shell,/后台任务可能仍在继续/,'abort errors must not be presented as confirmed business failure');
assert.match(html,/<meta name="ce-qc-build" content="V\d+_[A-Z0-9_]+">/);
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d+-\d+/);

console.log('[V761/V713] upload-triggered CCSL/SHOPEE long processing remains unbounded and progress-owned; bounded requests retain explicit timeout errors');
