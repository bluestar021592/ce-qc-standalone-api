import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const whpp=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(shell,/FINISHED\|COMPLETED\|完成/i,'completed family detection must recognize runStatus=finished');
assert.match(shell,/if\(error\?\.code!=='CLIENT_WAIT_TIMEOUT'\)throw error/,'WHPP terminal waiter must tolerate transient progress-read timeout');
assert.match(shell,/WHPP后台仍在处理，实时进度暂时繁忙，继续等待/,'temporary WHPP progress timeout must be visible without aborting work');
assert.match(whpp,/if\(runtimePromise&&runtime\.active&&liveDate/,'WHPP progress must have an active-runtime in-memory fast path');
assert.match(whpp,/reason:'ACTIVE_RUNTIME_FAST_PATH'/,'WHPP active progress must avoid SQLite completion reads');
assert.match(html,/V720_LIVE_PROGRESS_RESILIENCE/,'V720 shell marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v720-1/,'V720 cache bust missing');

console.log('[V720] finished-family recognition + resilient WHPP polling + in-memory active progress fast path passed');
