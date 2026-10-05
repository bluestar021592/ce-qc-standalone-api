import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(repair,/normalizeV485TrackRows/,'selected-date timing repair must reuse V485 nested CE track normalizer');
assert.match(repair,/groupRows\(rows=\[\],fallbackBills=\[\]\)/,'groupRows must accept request bills for parent-child inheritance');
assert.match(repair,/normalizeV485TrackRows\(rows,\{fallbackBills\}\)/,'nested CE track rows must inherit exact request membership');
assert.match(repair,/archiveV485TrackQueryResponse/,'fresh timing-repair responses must also enter durable CE evidence archive');
assert.match(repair,/persistedEvents/,'repair state must expose actual persisted event count');
assert.match(shell,/有效轨迹 .* POD总数/,'timing UI must expose valid versus total POD coverage');
assert.match(html,/v625-shell\.js\?v=20261005-v6(?:5[3-9]|[6-9]\d)-1/,'V653+ JS asset revision missing');
console.log('[V653] nested CE track flattening + signing evidence coverage diagnostics smoke passed');
