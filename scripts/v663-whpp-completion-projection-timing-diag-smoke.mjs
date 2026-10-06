import fs from 'node:fs';
import assert from 'node:assert/strict';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const server=fs.readFileSync('server.js','utf8');

assert.match(shell,/completionLock:whppPayload\.completionLock\|\|\{\}/,'WHPP durable completion lock must survive frontend projection');
assert.match(shell,/complete:Boolean\(whppPayload\.completionLock\?\.locked\)/,'WHPP completed snapshot must mark UI family complete');
assert.match(shell,/outcome:whppPayload\.completionLock\?\.locked\?'COMPLETED'/,'WHPP completed snapshot must publish COMPLETED outcome to UI');
assert.match(server,/\[CE-QC\]\[V663_TIMING_DIAG\]/,'timing diagnostic log missing');
assert.match(html,/v625-shell\.js\?v=20261005-v663-1/,'V663 shell revision missing');
console.log('[V663] durable WHPP completion projection + timing diagnostics passed');
