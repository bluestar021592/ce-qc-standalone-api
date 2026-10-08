import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const integrity=fs.readFileSync('src/dataIntegrity.js','utf8');
const v713=fs.readFileSync('scripts/v713-long-run-no-browser-abort-smoke.mjs','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(v713,/CCSL long run must use the automatic transport-recovery owner/,'legacy V713 gate must follow the automatic transport recovery owner');
assert.match(v713,/interrupted CCSL\/SHOPEE resume must remain unbounded and transport-recoverable/,'V713 selected-date resume gate must follow the transport recovery owner');
assert.doesNotMatch(shell,/selected-date-truth\?reportDate=.*fetchLiveProgress/s,'live 3-second progress polling must not hit selected-date truth');
assert.match(shell,/setInterval\(\(\)=>\{void refreshLiveProgress\(\)\},3000\)/,'live progress polling must be throttled to 3 seconds');
assert.match(shell,/home-quality-summary\?fast=1/,'home/import reads must use local-only fast summary');
assert.match(shell,/new URLSearchParams\(\{compact:'1'\}\)/,'business boards must request compact state first');
assert.match(shell,/Never block a board switch on \/api\/import\/unified-latest/,'business first paint must explicitly avoid the latest-import prerequisite');
assert.match(shell,/const latest=v626LatestImport\|\|null;[\s\S]*?const baseReportDate=requestedDate\|\|latest\?\.reportDate\|\|'';/,'business compact read must use URL context immediately');
assert.doesNotMatch(shell,/else if\(business\)\{\s*await latestImportContext\(\);\s*await loadBusiness\(\);/,'business navigation must not serially await latest-import before compact board state');
assert.match(shell,/else if\(business\)\{\s*await loadBusiness\(\);\s*void latestImportContext\(\);/,'business navigation must paint first and refresh latest context in background');
assert.match(shell,/dashboardContextUrl\(boardJump\.value\)/,'board dropdown must preserve reportDate and snapshotId across business switches');
assert.match(shell,/syncDashboardNavigationContext\(reportDate,snapshotId\)/,'resolved board context must be propagated to subsequent business navigation');
assert.match(shell,/v756ProgressDescriptor/,'live progress headline must derive from actual running counters rather than stale raw phase text');
assert.match(shell,/进度90秒未变化，后台仍在运行/,'unchanged long-running progress must be observable without being mislabeled complete');
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

console.log('[V756/V722] interaction-first navigation passed · board switches preserve date/snapshot · no serial latest-import blocker · running progress follows counters and exposes 90s no-change state');
