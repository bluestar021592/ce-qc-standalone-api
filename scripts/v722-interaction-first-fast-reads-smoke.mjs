import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const integrity=fs.readFileSync('src/dataIntegrity.js','utf8');
const v713=fs.readFileSync('scripts/v713-long-run-no-browser-abort-smoke.mjs','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(v713,/CCSL long run must use the unbounded transport-recovery owner/,'legacy V713 gate must follow the transport recovery owner');
assert.match(v713,/SHOPEE resume must use the unbounded transport-recovery owner/,'legacy V713 resume gate must follow the transport recovery owner');
assert.doesNotMatch(shell,/selected-date-truth\?reportDate=.*fetchLiveProgress/s,'live 3-second progress polling must not hit selected-date truth');
assert.match(shell,/setInterval\(\(\)=>\{void refreshLiveProgress\(\)\},3000\)/,'live progress polling must be throttled to 3 seconds');
assert.match(shell,/home-quality-summary\?fast=1/,'home/import reads must use local-only fast summary');
assert.match(shell,/new URLSearchParams\(\{compact:'1'\}\)/,'business boards must request compact state first');
assert.match(shell,/new URLSearchParams\(\{businessType:business\}\)/,'business integrity reads must be scoped');
assert.match(shell,/new URLSearchParams\(\{scope:'all',businessType:business\}\)/,'business workspace reads must be scoped');
assert.match(server,/if\(String\(req\.query\.fast\|\|''\)==='1'\)/,'server must expose local-only fast home summary');
assert.match(server,/requestedType === 'WHPP' && req\.query\.compact === '1'/,'WHPP current board must have a compact first-paint path');
assert.match(server,/loadFastSqlBusinessState\(req\.params\.businessType, requestedSnapshotId, requestedReportDate\)/,'selected date must stay on fast SQL board path');
assert.doesNotMatch(server,/if \(!batch \|\| batch\.snapshotStatus !== 'COMPLETED' \|\| !batch\.reportDate\) return null/,'fast current-day board reads must remain available before processing completes');
assert.match(server,/const requestedBusinessType=String\(req\.query\.businessType\|\|''\)/,'tracking workspace must support business scoping');
assert.match(integrity,/selectedTypes=TYPES\.includes\(requestedType\)\?\[requestedType\]:TYPES/,'integrity report must scope to one board when requested');
assert.match(html,/<meta name="ce-qc-build" content="V\d+_[A-Z0-9_]+">/,'current shell build marker missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d+-\d+/,'current shell cache bust missing');

console.log('[V722] interaction-first fast reads passed: no heavy truth in live polling, compact selected-date boards, scoped workspace/integrity, fast local home summary');
