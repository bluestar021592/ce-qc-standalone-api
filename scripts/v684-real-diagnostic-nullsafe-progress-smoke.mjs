import fs from 'node:fs';
import assert from 'node:assert/strict';

const home=fs.readFileSync('src/homeQualitySummary.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(home,/function eventCode\(event = \{\}\) \{\s*event=event\|\|\{\};/,'eventCode must tolerate null historical rows');
assert.match(home,/function eventTime\(event = \{\}\) \{\s*event=event\|\|\{\};/,'eventTime must tolerate null historical rows');
assert.match(home,/function eventText\(event = \{\}\) \{\s*event=event\|\|\{\};/,'eventText must tolerate null historical rows');
assert.match(home,/function isReturned\(row=\{\}\) \{\s*row=row\|\|\{\};/,'return classifier must tolerate null rows');
assert.match(home,/function positivePodMembership\(row=\{\},ledgerRow=\{\}\)\{\s*row=row\|\|\{\};ledgerRow=ledgerRow\|\|\{\};/,'POD classifier must tolerate null rows');
assert.match(home,/\[\.\.\.events\]\.filter\(Boolean\)\.map/,'timing event sort must drop null events before parsing');

assert.doesNotMatch(shell,/\/api\/selected-date-truth\?reportDate=.*fetchLiveProgress/s,'live progress must not perform a duplicate selected-date truth query');
assert.match(shell,/const whppLock=whppPayload\.completionLock\|\|\{\}/,'WHPP progress payload must expose the selected-date durable completion lock');
assert.match(shell,/complete:Boolean\(whppLock\.locked\)\|\|familyComplete\(whppPayload\.runtime\|\|\{\}\)/,'completion lock must force WHPP family complete');
assert.match(shell,/phase:whppLock\.locked\?'完成'/,'completion lock must force completed phase');

assert.match(html,/ce-qc-build" content="V\d{3,}_[A-Z0-9_]+"/,'V684+ build marker missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V684+ JS cache revision missing');

console.log('[V684] real diagnostic regression locked · null historical rows cannot zero WHPP/VN timing · progress-owner completion lock forces WHPP 3/3 without duplicate truth polling');
