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

assert.match(shell,/\/api\/selected-date-truth\?reportDate=/,'live progress must consult selected-date truth owner');
assert.match(shell,/const truthLocked=Boolean\(truth\?\.whppCompletion\?\.locked\)/,'WHPP truth lock must be explicit');
assert.match(shell,/complete:truthLocked\|\|Boolean\(whppPayload\.completionLock\?\.locked\)/,'truth lock must force WHPP family complete');
assert.match(shell,/phase:truthLocked\?'完成'/,'truth lock must force completed phase');

assert.match(html,/ce-qc-build" content="V\d{3,}_[A-Z0-9_]+"/,'V684+ build marker missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V684+ JS cache revision missing');

console.log('[V684] real diagnostic regression locked · null historical rows cannot zero WHPP/VN timing · selected-date truth forces WHPP 3/3');
