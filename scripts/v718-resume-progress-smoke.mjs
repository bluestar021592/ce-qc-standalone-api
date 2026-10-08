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
assert.match(shell,/\['RUN_ALREADY_COMPLETED','RUN_NOT_RECOVERABLE'\]\.includes\(code\)/,'resume UI may swallow only terminal no-work 409 responses');
assert.match(shell,/const beforeResume=await fetchLiveProgress\(reportDate\)/,'resume must read the exact three-family truth before starting any family');
assert.match(shell,/if\(familyComplete\(beforeResume\.ccsl\)\)[\s\S]*?CCSL已完成，继续处理时自动跳过/,'completed CCSL must not be resumed');
assert.match(shell,/if\(familyComplete\(beforeResume\.shopee\)\)[\s\S]*?SHOPEE已完成，继续处理时自动跳过/,'completed SHOPEE must not be resumed');
assert.match(shell,/if\(familyComplete\(beforeResume\.whpp\)\)[\s\S]*?WHPP已完成，继续处理时自动跳过/,'completed WHPP must not be resumed');
assert.doesNotMatch(shell,/if\(e\.status===409\)return/,'resume UI must not swallow all 409 failures');
assert.match(html,/<meta name="ce-qc-build" content="V\d+_[A-Z0-9_]+">/,'current shell build marker missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d+-\d+/,'current shell cache bust missing');

console.log('[V756/V718] selected-date progress + resume-only-unfinished families + exact 409 handling passed');
