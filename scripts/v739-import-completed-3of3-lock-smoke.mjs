import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const store=fs.readFileSync('src/unifiedImportStore.js','utf8');

assert.match(shell,/const exactHistory=\(history\.rows\|\|\[\]\)\.find\(/,'import page must hydrate exact-date snapshot status from unified history');
assert.match(shell,/snapshotStatus:exactHistory\.snapshotStatus\|\|exactHistory\.status/,'exact completed history status must be merged into latest import context');
assert.doesNotMatch(shell,/ccsl=projectComplete\(ccsl,'CCSL'\)/,'unified snapshot lifecycle must not project CCSL complete');
assert.doesNotMatch(shell,/shopee=projectComplete\(shopee,'SHOPEE'\)/,'unified snapshot lifecycle must not project SHOPEE complete');
assert.doesNotMatch(shell,/V752_UNIFIED_COMPLETED_3OF3/,'retired aggregate 3-of-3 projection must remain absent');
assert.match(shell,/V754_WHPP_VERIFIED_DURABLE_COMPLETION/,'only verified WHPP completion may be retained across a transient progress read');
assert.match(store,/s\.status snapshotStatus/,'latest unified import must expose exact snapshot status without a second history-only dependency');
assert.match(store,/snapshotStatus: row\.snapshotStatus \|\| 'IMPORTED'/,'latest unified import must publish the exact snapshot lifecycle to every page');
assert.match(shell,/v752LaunchingFamily==='CCSL'/,'CCSL startup must be visible before the backend run lock appears');
assert.match(shell,/v752LaunchingFamily==='SHOPEE'/,'SHOPEE startup must be visible before the backend run lock appears');
assert.match(html,/上传并自动处理/,'daily upload primary action must clearly promise automatic processing');
assert.match(html,/id="v625RunStart"[\s\S]*?hidden/,'redundant manual start action must stay out of the normal single-click flow');
assert.match(shell,/const outcome=await runTask\('auto',r\.reportDate\|\|'',r\)/,'successful daily import must pin the exact upload response into automatic seven-business processing');
assert.match(shell,/async function autoStartFamily\(type,endpoint,reportDate,total\)/,'auto upload flow must skip completed or zero-ticket families safely');
assert.match(shell,/ZERO_TICKET/,'zero-ticket business families must count as completed instead of blocking the day');
assert.match(shell,/const v755ImportCountTruth=new Map\(\)/,'per-date import count truth cache must exist');
assert.match(shell,/rememberV755ImportCounts\(r,'UPLOAD_RESPONSE'\)/,'upload response counts must be pinned before reload can mutate browser state');
assert.match(shell,/const counts=await resolveV755FamilyCounts\(reportDate,explicitImportData\)/,'auto processing must resolve reconciled per-date counts before any zero-ticket skip');
assert.match(shell,/if\(!family\)throw new Error\('无法从服务器确认 /,'unknown business counts must fail closed instead of becoming zero');
assert.match(shell,/const zeroWhpp=Boolean\(countTruth\)&&Number\(latestCounts\.WHPP\|\|0\)===0/,'WHPP zero-ticket projection must require proven per-date count truth');
assert.doesNotMatch(shell,/code==='WHPP_REPORT_MISSING'&&Number\(v626LatestImport\?\.classificationCounts\?\.WHPP\|\|0\)===0/,'missing browser cache must never authorize WHPP zero-ticket skip');
assert.match(shell,/if\(runBusy\)\{note\('v625ImportMessage','当前日报仍在处理中/,'next daily upload must be blocked while the current day is still processing');
assert.match(shell,/resumeBtn\.disabled=allComplete/,'resume button must be disabled after exact 3\/3 completion');
assert.match(shell,/resumeBtn\.hidden=allComplete/,'resume button must be hidden after exact 3\/3 completion');
assert.match(html,/V750_TIMING_EVIDENCE_TRACK_VIEW|V748_PER_BOARD_TRACK_QUALITY_SIGNALS|V744_SIGNING_UI_SIMPLIFIED_AND_TERMINAL_BACKFILL|V743_LATEST_DAILY_REPORT_SIGNING_BACKFILL|V742_DAILY_REPORT_SIGNING_TIME|V741_HISTORICAL_TIMING_CLOSED_LOOP|V739_IMPORT_COMPLETED_3OF3_LOCK/,'V739+ shell build marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v(?:739|741|742|743|744|748|750)-1/,'V739+ JS cache bust missing');


assert.match(shell,/const verified=await v760VerifyAllFamilies\(reportDate,counts\)/,'HTTP success must be followed by selected-date 3-of-3 proof');
assert.match(shell,/if\(!verified\.ok\)\{/,'unfinished family must veto green success');
assert.match(shell,/return\{ok:false,error:reason\}/,'unfinished result must not be reported as successful');
assert.match(shell,/await post\('\/api\/timing-repair\/start'/,'timing repair must still exist after successful verification');
assert.ok(shell.indexOf('if(!verified.ok)')<shell.indexOf("post('/api/timing-repair/start'"),'timing repair may only start after 3-of-3 proof');
assert.doesNotMatch(shell,/note\('v625RunMessage','7业务处理完成，签收时效补证已启动。','success'\)/,'unconditional green success must be retired');

const predicateStart=shell.indexOf('function familyComplete(value={})');
const predicateEnd=shell.indexOf('function familyProgressLabel(value={})');
const terminalStart=shell.indexOf('function v760FamilyTerminalSummary(');
const terminalEnd=shell.indexOf('async function v760VerifyAllFamilies(');
assert.ok(predicateStart>=0&&predicateEnd>predicateStart&&terminalStart>=0&&terminalEnd>terminalStart,'V760 family predicate/terminal owner missing');
const inspect=new Function('bundle','counts','date',shell.slice(predicateStart,predicateEnd)+
  '\\n'+shell.slice(terminalStart,terminalEnd)+
  '\\nreturn v760FamilyTerminalSummary(bundle,counts,date);');
const date='2026-07-04',counts={CCSL:6200,SHOPEE:300,WHPP:190};
const done={running:false,runStatus:'finished',reportDate:date};
const waiting={running:false,phase:'待处理',reportDate:date};
const partial=inspect({ccsl:waiting,shopee:waiting,whpp:done},counts,date);
assert.equal(partial.ok,false,'WHPP-only 1-of-3 must not be declared 3-of-3');
assert.equal(partial.complete,1);
assert.match(partial.missing.join(','),/CCSL/);
assert.match(partial.missing.join(','),/SHOPEE/);
assert.equal(inspect({ccsl:done,shopee:done,whpp:done},counts,date).ok,true,'actual matching 3-of-3 must succeed');
assert.equal(inspect({ccsl:{...done,reportDate:'2026-07-03'},shopee:done,whpp:done},counts,date).ok,false,'previous date cannot finalize July-4');
assert.equal(inspect({ccsl:{...done,running:true},shopee:done,whpp:done},counts,date).ok,false,'running member cannot finish from stale terminal label');

console.log('[V760/V755] true selected-date 3-of-3 required before timing repair; 1-of-3 success banner prohibited;  single-click auto-process uses reconciled per-date counts · missing count fields cannot become zero-ticket · actual family run truth owns 3-of-3 completion');
