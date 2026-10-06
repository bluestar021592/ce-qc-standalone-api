import fs from 'node:fs';
import assert from 'node:assert/strict';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const server=fs.readFileSync('server.js','utf8');

assert.match(shell,/const whppLock=truthLocked\?truth\.whppCompletion:\(whppPayload\.completionLock\|\|\{\}\)/,'WHPP durable completion lock must merge selected-date truth with progress payload');
assert.match(shell,/complete:truthLocked\|\|Boolean\(whppPayload\.completionLock\?\.locked\)/,'WHPP selected-date truth or durable completion lock must mark UI family complete');
assert.match(shell,/outcome:\(truthLocked\|\|whppPayload\.completionLock\?\.locked\)\?'COMPLETED'/,'WHPP selected-date truth or completion lock must publish COMPLETED outcome to UI');
assert.match(server,/\[CE-QC\]\[V663_TIMING_DIAG\]/,'timing diagnostic log missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v6(?:6[3-9]|[7-9]\d)-1/,'V663+ shell revision missing');
console.log('[V663] durable WHPP completion projection + timing diagnostics passed');
