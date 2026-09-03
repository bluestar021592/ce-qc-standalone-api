import fs from 'node:fs';
import assert from 'node:assert/strict';

const v168=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const v169=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
const v412=fs.readFileSync('public/v412-seven-business-convergence.js','utf8');
const v67=fs.readFileSync('public/v67-resilient-run-guard.js','utf8');

assert.match(v168,/let refreshPromise = null/,'V168 must expose one in-flight status promise');
assert.match(v168,/if \(refreshPromise\) return refreshPromise/,'V168 callers must join the same in-flight status read');
assert.match(v168,/refreshPromise = \(async \(\) =>/,'V168 must own one shared refresh promise');
assert.match(v168,/finally \{ refreshPromise = null; \}/,'V168 must release the shared promise after settlement');
assert.doesNotMatch(v168,/if \(refreshBusy\) return lastTruth/,'V168 must not return stale unconfirmed truth while a fresh read is already in flight');

assert.match(v169,/async function ensureFreshEntryState/,'V169 explicit entry must wait for canonical status rather than immediately reject an in-flight read');
assert.match(v169,/await global\.__CE_QC_V168_SEVEN_BUSINESS_STATUS__\?\.refresh\?\.\(\{ force: true \}\)/,'V169 must reuse the canonical V168 refresh owner');
assert.match(v169,/for\(let attempt=0;attempt<2&&state\.kind==='unconfirmed';attempt\+=1\)/,'V169 may perform one bounded retry for an explicit user entry');
assert.match(v169,/const state=await ensureFreshEntryState\(\)/,'run/resume guard must await confirmed state');
assert.match(v169,/if\(state\.kind==='unconfirmed'\)[\s\S]*SEVEN_BUSINESS_STATUS_UNCONFIRMED/,'V169 must remain fail-closed if bounded confirmation still fails');

const guardBody=v412.match(/async function guardCall[\s\S]*?function wrapEntries/)?.[0]||'';
assert.ok(guardBody,'V412 guard must be inspectable');
assert.doesNotMatch(guardBody,/refreshThenLearn\(/,'V412 explicit entry must not force another status request before V169/V67');
assert.match(guardBody,/exactFreshStagesDone\(target\)/,'V412 may skip only on already-known exact fresh completion');

assert.match(v67,/global\.runUnified\s*=\s*\(\)\s*=>\s*execute\(\s*['"]start['"]\s*\)/,'V67 remains sole explicit start owner');
assert.match(v67,/global\.resumeUnified\s*=\s*\(\)\s*=>\s*execute\(\s*['"]resume['"]\s*\)/,'V67 remains sole explicit resume owner');

console.log('[V420] unified-entry status coalescing smoke passed · one V168 in-flight status owner · V169 bounded explicit-entry confirmation · V412 no duplicate preflight · V67 sole runner');
