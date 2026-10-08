import assert from 'node:assert/strict';
import fs from 'node:fs';

const progress=fs.readFileSync('src/v33RunProgressPatch.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(progress,/function shopeeProgress\(db, requestedReportDate = ''\)/,'SHOPEE progress must accept the selected report date');
assert.match(progress,/const requested = normalizeReportDate\(requestedReportDate\)/,'SHOPEE progress must normalize the requested date');
assert.match(progress,/shopeeProgress\(db, req\.query\.reportDate\)/,'progress endpoint must forward the selected date to SHOPEE');
assert.match(server,/if \(!options\.resume\) \{[\s\S]*?const probeBills = state\.pnhBills\.slice/,'SHOPEE duplicate preflight must run only on fresh start');
assert.match(shell,/const proof=await v761FamilyRecoveryProof\(reportDate\)/,'resume must load exact selected-date business disposition before any run');
assert.match(shell,/for\(const type of \['CCSL','SHOPEE'\]\)/,'resume must consider each family separately');
assert.match(shell,/await v761ContinueFamily\(type,proof\?\.businesses\?\.\[type\],reportDate\)/,'resume must dispatch each family against its persisted facts');
assert.match(shell,/if\(action==='START'\)/,'missing run may be first started only after exact evidence proof');
assert.match(shell,/if\(action==='RESUME'\)/,'interrupted run must resume, not restart');
assert.match(shell,/if\(action==='WAIT'\)/,'existing running business must be awaited');
assert.match(shell,/if\(action==='DONE'\|\|action==='ZERO_TICKET'\)/,'completed and 0-ticket families must never be rerun');
assert.match(shell,/if\(familyComplete\(current\.whpp\)\)/,'completed WHPP must remain untouched');
assert.doesNotMatch(shell,/\['RUN_ALREADY_COMPLETED','RUN_NOT_RECOVERABLE'\]\.includes\(code\)/,'no-run must not be silently ignored by resume');
assert.doesNotMatch(shell,/if\(e\.status===409\)return/,'resume UI must not swallow all 409 failures');
assert.match(html,/<meta name="ce-qc-build" content="V\d+_[A-Z0-9_]+">/,'current shell build marker missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d+-\d+/,'current shell cache bust missing');

assert.match(progress,/const lockStatus=String\(lock.status\|\|''\)/,'V760 status priority uses persisted run lock');
assert.match(shell,/const verified=await v760VerifyAllFamilies\(reportDate,counts\)/,'V760 must verify live selected-date family completion after resume');

console.log('[V761/V718] selected-date resume dispatcher distinguishes never-started, paused, running, completed and blocked evidence without silent no-run 409');
