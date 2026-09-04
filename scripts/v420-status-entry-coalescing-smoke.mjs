import fs from 'node:fs';
import assert from 'node:assert/strict';

const v168=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const v169=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
const v412=fs.readFileSync('public/v412-seven-business-convergence.js','utf8');
const v67=fs.readFileSync('public/v67-resilient-run-guard.js','utf8');
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');

assert.match(v168,/if \(refreshBusy\) return lastTruth/,'V168 remains the one display/status fetch owner; entry guards must wait for its truth instead of spawning competing readers');
assert.match(v168,/lockControl\(start, '状态确认中'/,'V168 may still render the unconfirmed display as fail-closed; V169 owns the explicit-entry release bridge');
assert.match(v169,/V421_CLICKABLE_UNCONFIRMED_REVISION='2026-09-03-v421-clickable-unconfirmed-start-v1'/,'V169 must expose the explicit unconfirmed-entry bridge revision');
assert.match(v169,/V423_EXPLICIT_SHOPEE_RESTART_REVISION='2026-09-04-v423-explicit-shopee-restart-resume-v1'/,'V169 must expose the exact current-date Shopee restart routing revision');
assert.match(v169,/V424_RESUME_FLOOR_HANDOFF_REVISION='2026-09-04-v424-v169-v67-proof-handoff-v1'/,'V169 must expose the V424 same-proof handoff revision');
assert.match(v169,/function releaseStartButtonForConfirmation\(state\)/,'V169 must have one explicit Start release bridge');
assert.match(v169,/const lockedByV168=btn\.dataset\.v168Locked==='1'/,'V169 may release only the button actually locked by V168 or still showing the exact status-confirming label');
assert.match(v169,/if\(v67Stage\.active===true\|\|\(!lockedByV168&&label!=='状态确认中'\)\)return false/,'V169 must never unlock an active V67 processing button');
assert.match(v169,/btn\.disabled=false;[\s\S]*btn\.textContent='开始全自动处理'/,'unconfirmed display must leave one explicit Start path clickable');
assert.match(v169,/delete btn\.dataset\.v168Locked/,'V169 must clear the V168 button lock bookkeeping after taking ownership of the explicit-entry bridge');
assert.match(v169,/async function ensureFreshEntryState/,'V169 explicit entry must wait for canonical status rather than immediately reject an in-flight read');
assert.match(v169,/for\(let attempt=0;attempt<2&&state\.kind==='unconfirmed';attempt\+=1\)/,'V169 may perform one bounded retry for an explicit user entry');
assert.match(v169,/global\.__CE_QC_V168_SEVEN_BUSINESS_STATUS__\?\.refresh\?\.\(\{force:true\}\)/,'V169 must reuse the canonical V168 refresh owner');
assert.match(v169,/await waitForStatusAdvance\(beforeCheckedAt\)/,'V169 must wait for an already-running V168 request instead of treating stale lastTruth as final');
assert.match(v169,/const state=await ensureFreshEntryState\(\)/,'run/resume guard must await confirmed state');
assert.match(v169,/if\(state\.kind==='unconfirmed'\)[\s\S]*releaseStartButtonForConfirmation\(state\)[\s\S]*SEVEN_BUSINESS_STATUS_UNCONFIRMED/,'bounded confirmation failure must remain fail-closed while leaving a deliberate retryable Start entry visible');
assert.match(v169,/else if\(state\.kind==='unconfirmed'\)\{[\s\S]*lockResumeButtons\(state\);[\s\S]*releaseStartButtonForConfirmation\(state\)/,'background unconfirmed rendering must keep Resume locked but Start clickable');
assert.match(v169,/function exactShopeeRestartInterruption\(state\)[\s\S]*ccsl\?\.complete!==true[\s\S]*shopee\.state!=='failed'[\s\S]*normalizeDate\(shopee\.date\)!==target[\s\S]*PROCESS_RESTART_INTERRUPTED/,'restart privilege must require fresh exact-date failed Shopee only after CCSL completion');
assert.match(v169,/createShopeeRestartHandoff\?\.\(\{[\s\S]*reportDate:state\.reportDate[\s\S]*checkedAt:Number\(state\.truth\?\.checkedAt\|\|0\)/,'V169 must ask V67 to bind the same fresh V168 proof to the restart handoff');
assert.match(v169,/if\(!handoff\)[\s\S]*SHOPEE_RESTART_HANDOFF_REJECTED/,'rejected V67 handoff must fail closed instead of falling back to a bare resume');
assert.match(v169,/return originalEntries\.resumeUnified\.call\(this,handoff\)/,'exact restart must carry the V67-issued handoff into the original V67 resume entry');
assert.doesNotMatch(v169,/\/api\/shopee\/run\/(?:start|resume)|\/api\/whpp\/run\/(?:start|resume)|\/api\/(?:run|resume)/,'V169 remains an entry-policy layer and must never own processing APIs');

const guardBody=v412.match(/async function guardCall[\s\S]*?function wrapEntries/)?.[0]||'';
assert.ok(guardBody,'V412 guard must be inspectable');
assert.doesNotMatch(guardBody,/refreshThenLearn\(/,'V412 explicit entry must not force another status request before V169/V67');
assert.match(guardBody,/learnWhppCompletion\(\)/,'V412 may learn already-present canonical completion without network I/O');
assert.match(guardBody,/exactFreshStagesDone\(target\)/,'V412 may skip only on already-known exact fresh completion');

assert.match(v67,/V424_RESUME_FLOOR_REVISION\s*=\s*'2026-09-04-v424-restart-proof-resume-floor-v1'/,'V67 must expose the V424 resume floor revision');
assert.match(v67,/global\.runUnified\s*=\s*\(\)\s*=>\s*execute\(\s*['"]start['"]\s*\)/,'V67 remains sole explicit start owner');
assert.match(v67,/global\.resumeUnified\s*=\s*handoff\s*=>\s*execute\(\s*['"]resume['"]\s*,\s*handoff\s*\)/,'V67 remains sole explicit resume owner and accepts only its internal proof handoff');
assert.match(v67,/if \(resumeFloor && index < resumeFloor\.index\)[\s\S]*resumeFloor: V424_RESUME_FLOOR_REVISION/,'accepted resume floor must skip already-proven earlier stages without a second status read');
assert.match(v67,/if \(resumeFloor && index === resumeFloor\.index\)[\s\S]*runStage\(stage, true, target\)/,'resume floor stage must use the existing V67 resume execution path');

assert.match(shell,/<script src=\"\/v67-resilient-run-guard\.js\?v=20260904-v424-1\"/,'browser shell must execute the V424 V67 runner build');
assert.match(shell,/<script src=\"\/v169-seven-business-legacy-status-sync\.js\?v=20260904-v424-1\"/,'browser shell must execute the V424 V169 handoff build');
assert.match(shell,/<script src=\"\/v412-seven-business-convergence\.js\?v=20260904-v420-1\"/,'browser shell must actually request the V420 convergence build with a current cache-bust URL');
assert.doesNotMatch(shell,/<script src=\"\/v67-resilient-run-guard\.js\?v=20260902-v414-explicit-1\"/,'retired V414 V67 URL may remain only as non-executable compatibility metadata');
assert.doesNotMatch(shell,/<script src=\"\/v169-seven-business-legacy-status-sync\.js\?v=20260904-v423-1\"/,'retired V423 V169 URL may remain only as non-executable compatibility metadata');
assert.doesNotMatch(shell,/<script src=\"\/v169-seven-business-legacy-status-sync\.js\?v=20260901-v411-1\"/,'old V411 URL may remain only as non-executable compatibility metadata, never as the live script src');
assert.doesNotMatch(shell,/<script src=\"\/v412-seven-business-convergence\.js\?v=20260901-v413-3\"/,'old V413 URL may remain only as non-executable compatibility metadata, never as the live script src');

console.log('[V424/V423/V422/V421/V420] unified-entry delivery smoke passed · browser shell cache-busts V424 V67/V169 + V420 convergence · V168 display stays fail-closed · exact current-date Shopee restart requires same-proof V67 handoff · prior completed stages cannot be reopened by a second status read · generic failures remain normal-start · V412 no duplicate preflight · V67 sole runner');