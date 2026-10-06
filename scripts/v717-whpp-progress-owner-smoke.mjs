import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');

assert.match(shell,/post\('\/api\/whpp\/run\/'\+\(mode==='resume'\?'resume':'start'\),\{reportDate\},0\)/,
  'WHPP long-run start/resume must be unbounded on the browser side');
assert.doesNotMatch(shell,/renderLiveProgress\(\{ccsl:\{\},shopee:\{\},whpp:/,
  'WHPP terminal waiter must not wipe completed CCSL/SHOPEE progress');
assert.match(shell,/startProgressPolling\(\)/,
  'global progress polling must remain the single UI progress owner');

console.log('[V717] WHPP start/resume no longer times out at 30s and WHPP wait no longer clobbers CCSL/SHOPEE progress');
