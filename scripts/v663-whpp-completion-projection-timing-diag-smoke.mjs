import fs from 'node:fs';
import assert from 'node:assert/strict';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const server=fs.readFileSync('server.js','utf8');
const whppSupervisor=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');

assert.match(shell,/const whppLock=whppPayload\.completionLock\|\|\{\}/,'WHPP UI must consume the durable completion lock already projected by the WHPP progress owner');
assert.match(shell,/complete:Boolean\(whppLock\.locked\)\|\|familyComplete\(whppPayload\.runtime\|\|\{\}\)/,'WHPP durable completion lock must mark the UI family complete');
assert.match(shell,/outcome:whppLock\.locked\?'COMPLETED'/,'WHPP durable completion lock must publish COMPLETED outcome to UI');
assert.doesNotMatch(shell,/selected-date-truth\?reportDate=.*fetchLiveProgress/s,'live progress polling must not perform a second heavy selected-date truth read');
assert.match(whppSupervisor,/const completionLock=inspectV378WhppCompletionLock\(requestedDate,dateState\)/,'WHPP progress owner must project durable selected-date completion truth');
assert.match(server,/\[CE-QC\]\[V663_TIMING_DIAG\]/,'timing diagnostic log missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V663+ shell revision missing');
console.log('[V663] WHPP progress owner projects durable completion truth directly; UI consumes it without duplicate selected-date polling');
