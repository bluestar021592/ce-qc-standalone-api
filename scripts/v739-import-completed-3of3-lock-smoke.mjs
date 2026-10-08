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
const runTaskBody=shell.slice(shell.indexOf("async function runTask(mode,explicitReportDate"),shell.indexOf("function note(id,msg,tone"));
assert.ok(runTaskBody.indexOf('if(!verified.ok)')>=0&&runTaskBody.indexOf('if(!verified.ok)')<runTaskBody.indexOf("post('/api/timing-repair/start'"),'timing repair may only start after 3-of-3 proof within runTask');
assert.doesNotMatch(shell,/note\('v625RunMessage','7业务处理完成，签收时效补证已启动。','success'\)/,'unconditional green success must be retired');

const predicateStart=shell.indexOf('function familyComplete(value={})');
const predicateEnd=shell.indexOf('function familyProgressLabel(value={})');
const terminalStart=shell.indexOf('function v760FamilyTerminalSummary(');
const terminalEnd=shell.indexOf('async function v760VerifyAllFamilies(');
assert.ok(predicateStart>=0&&predicateEnd>predicateStart&&terminalStart>=0&&terminalEnd>terminalStart,'V760 family predicate/terminal owner missing');
const inspect=new Function('bundle','counts','date',shell.slice(predicateStart,predicateEnd)+
  '\n'+shell.slice(terminalStart,terminalEnd)+
  '\nreturn v760FamilyTerminalSummary(bundle,counts,date);');
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


assert.match(shell,/v762LoadFamilyTerminalTruth\(date\)/,'progress refresh must load saved completion evidence in parallel with live progress');
assert.match(shell,/void v762LoadFamilyTerminalTruth\(date\)/,'history proof must run independently of fast dashboard reads');
assert.match(shell,/\/api\/family-recovery-proof\?reportDate='\+encodeURIComponent\(date\)\+'&snapshotId='\+encodeURIComponent\(snapshot\),45000/,'nonblocking read-only worker may finish slowly while navigation remains interactive; exact snapshot remains pinned');
assert.match(shell,/if\(saved&&date===String\(v626LatestImport\?\.reportDate/,'completed historical proof must repaint UI as soon as it arrives');
assert.match(shell,/phase:'历史证据核验中'/,'pending proof must not imply business never ran');
assert.match(shell,/v762ProjectSavedCompletion\(ccsl,familyProof.CCSL,date\)/,'CCSL completed snapshot proof must project into the live bar');
assert.match(shell,/v762ProjectSavedCompletion\(shopee,familyProof.SHOPEE,date\)/,'SHOPEE completed snapshot proof must project into the live bar');
assert.match(shell,/v762RememberFamilyCompletionProof\(proof,date,String\(v626LatestImport\?\.snapshotId\|\|''\)\)/,'read-only diagnostic must update the same authoritative UI owner');
assert.match(shell,/scan!==total\|\|final!==total/,'completed fallback must require every original member scanned and finalized');
assert.match(shell,/record.exactMemberVerified!==true/,'completed fallback must require exact shipment membership rather than count-only equality');
assert.match(shell,/record.action!=='DONE'/,'unified COMPLETED alone must never project family terminal completion');
const proofStart=shell.indexOf('const v762FamilyTerminalProofs=new Map();');
const verifyStart=shell.indexOf('function v762VerifiedFamilyTruth(');
const projectStart=shell.indexOf('function v762ProjectSavedCompletion(');
const projectEnd=shell.indexOf('const v759WhppCompletionProofs=new Map();');
assert.ok(proofStart>=0&&verifyStart>proofStart&&projectEnd>projectStart,'V762 terminal proof owner functions missing');
const realDate='2026-07-04',snap='JULY04-IMMUTABLE';
const simulateProof=new Function('proof','reportDate','snapshotId',`
 // V765: sessionStorage is a presentation-only cache, never the owner of a
 // durable status. Keep V762's business-evidence simulation isolated.
 const v765RememberVerifiedFamilies=()=>{};
 ${shell.slice(proofStart,verifyStart)}
 ${shell.slice(projectStart,projectEnd)}
 const accepted=v762RememberFamilyCompletionProof(proof,reportDate,snapshotId);
 const saved=v762FamilyTerminalProofs.get(reportDate+'|'+snapshotId)||{};
 return {accepted,saved,
   ccsl:v762ProjectSavedCompletion({running:true,phase:'待处理'},saved.CCSL,reportDate),
   shopee:v762ProjectSavedCompletion({phase:'待处理'},saved.SHOPEE,reportDate)};
`);
const observed={ok:true,reportDate:realDate,snapshotId:snap,unifiedStatus:'COMPLETED',
 businesses:{
  CCSL:{action:'DONE',runStatus:'finished',runId:'CCSL-VALID',exactMemberVerified:true,sourceCount:6857,scanCount:6857,finalCount:6857,currentDate:'2026-07-01'},
  SHOPEE:{action:'DONE',runStatus:'finished',runId:'SPE-VALID',exactMemberVerified:true,sourceCount:1346,scanCount:1346,finalCount:1346,currentDate:'2026-07-01'}
 }};
const recovered=simulateProof(observed,realDate,snap);
assert.equal(recovered.ccsl.complete,true,'6857/6857 locked CCSL rows must recover completed progress');
assert.equal(recovered.shopee.complete,true,'1346/1346 locked SHOPEE rows must recover completed progress');
assert.equal(recovered.ccsl.running,false,'persisted finished lock must override stale running progress state');
assert.equal(recovered.shopee.scanDone,1346,'persisted Shopee count should remain visible');
assert.equal(recovered.ccsl.scanDone,6857,'persisted CCSL count should remain visible');
assert.equal(simulateProof({...observed,snapshotId:'WRONG'},realDate,snap).accepted,null,'cross-snapshot lock cannot project completion');
assert.equal(simulateProof({...observed,reportDate:'2026-07-03'},realDate,snap).accepted,null,'cross-date lock cannot project completion');
assert.equal(simulateProof({...observed,businesses:{...observed.businesses,CCSL:{...observed.businesses.CCSL,scanCount:6856}}},realDate,snap).saved.CCSL,undefined,'6856/6857 CCSL cannot be called complete');
assert.equal(simulateProof({...observed,businesses:{...observed.businesses,SHOPEE:{...observed.businesses.SHOPEE,finalCount:1345}}},realDate,snap).saved.SHOPEE,undefined,'1345/1346 Shopee finals cannot be called complete');
assert.equal(simulateProof({...observed,businesses:{...observed.businesses,SHOPEE:{...observed.businesses.SHOPEE,action:'WAIT',runStatus:'running'}}},realDate,snap).saved.SHOPEE,undefined,'still-running family must not become 3/3');
assert.equal(simulateProof({...observed,businesses:{}},realDate,snap).accepted,null,'unified completed flag without business proofs must not imply 3/3');
assert.equal(simulateProof({...observed,businesses:{...observed.businesses,CCSL:{...observed.businesses.CCSL,exactMemberVerified:false}}},realDate,snap).saved.CCSL,undefined,'matching counts without exact identities cannot complete CCSL');


console.log('[V762/V760/V755] exact member IDs and  July-04 6857 CCSL + 1346 Shopee persisted run locks recover 3/3 from strict snapshot and membership proof;  true selected-date 3-of-3 required before timing repair; 1-of-3 success banner prohibited;  single-click auto-process uses reconciled per-date counts · missing count fields cannot become zero-ticket · actual family run truth owns 3-of-3 completion');
