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
assert.match(shell,/new URLSearchParams\(\{businessType:targetBusiness\}\)/,'business integrity reads must be scoped');
assert.match(shell,/new URLSearchParams\(\{scope:'all',businessType:targetBusiness\}\)/,'business workspace reads must be scoped');
assert.match(server,/if\(String\(req\.query\.fast\|\|''\)==='1'\)/,'server must expose local-only fast home summary');
assert.match(server,/requestedType === 'WHPP' && req\.query\.compact === '1'/,'WHPP current board must have a compact first-paint path');
assert.match(server,/loadFastSqlBusinessState\(req\.params\.businessType, requestedSnapshotId, requestedReportDate\)/,'selected date must stay on fast SQL board path');
assert.doesNotMatch(server,/if \(!batch \|\| batch\.snapshotStatus !== 'COMPLETED' \|\| !batch\.reportDate\) return null/,'fast current-day board reads must remain available before processing completes');
assert.match(server,/const requestedBusinessType=String\(req\.query\.businessType\|\|''\)/,'tracking workspace must support business scoping');
assert.match(integrity,/selectedTypes=TYPES\.includes\(requestedType\)\?\[requestedType\]:TYPES/,'integrity report must scope to one board when requested');
assert.match(html,/<meta name="ce-qc-build" content="V\d+_[A-Z0-9_]+">/,'current shell build marker missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d+-\d+/,'current shell cache bust missing');

// V765 actual browser-session read cache: only full saved exact-member proofs
// are reusable, and a new snapshot or a purge must invalidate them.
assert.match(shell,/async function v765LoadBusinessDetailLane/,'large workspace/details must be off KPI critical path');
const businessLane=shell.slice(shell.indexOf('async function loadBusiness(options={})'),shell.indexOf('function rowTr(values)'));
assert.doesNotMatch(businessLane,/await Promise\.allSettled\(\[\s*json\('\/api\/data-integrity/,'large integrity read must not block initial metrics');
assert.match(businessLane,/void v765LoadBusinessDetailLane\(/,'background scoped detail lane must begin after the compact metrics paint');
assert.match(shell,/v765BoardDetailInflight\.get\(cacheKey\)/,'identical detail reads should join the same in-flight request');
assert.match(shell,/Date\.now\(\)-cached\.at<20000/,'nonterminal 20-second workspace cache is bounded');
assert.match(shell,/qualityKey='CE_QC_V765_TRACK_'\+targetBusiness\+'\|'\+reportDate\+'\|'\+snapshotId/,'track refresh needs snapshot-keyed throttling');
assert.match(shell,/const historyPromise=options\.skipHistory\?Promise\.resolve\(null\)[\s\S]*new Promise\(resolve=>setTimeout\(resolve,1200\)\)/,'history metadata must be optional and delayed after fast summary starts');
assert.match(shell,/v765InvalidateAllProofCache\(\)/,'new import/purge must invalidate verified completion cache');
assert.match(server,/const v765WorkspaceReadCache=new Map\(\)/,'heavy tracking workspace must have bounded short-lived server cache');
assert.match(server,/const V765_WORKSPACE_TTL_MS=20000/,'server cache must never keep dynamic status indefinitely');
assert.match(server,/const cacheEligible=Boolean\(identity&&explicitSnapshotId&&explicitReportDate&&requestedBusinessType&&scope==='all'\)/,'cache must be bound to user+snapshot+date+business');
assert.match(server,/req\.query\.fresh\|\|''/,'explicit manual refresh must bypass memoized workspace');
assert.match(server,/while\(v765WorkspaceReadCache\.size>2\)/,'server workspace cache must be memory bounded');
assert.match(shell,/if\(options\.skipQualityRefresh\)workspaceQuery\.set\('fresh','1'\)/,'manual/CE completed refresh must bypass stale business workspace response');


const cacheSlice=shell.slice(shell.indexOf('const V765_PROOF_CACHE_PREFIX='),shell.indexOf('const v762FamilyTerminalProofs=new Map();'));
const saved=new Map();
const mockedStorage={setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)||null,
  removeItem:k=>saved.delete(k),get length(){return saved.size},key:i=>[...saved.keys()][i]};
const now={now:()=>1700000000000};
const cacheHarness=new Function('sessionStorage','Date',cacheSlice+
  'const v762FamilyTerminalProofs=new Map(),v762FamilyProofNextRead=new Map(); return {save:v765RememberVerifiedFamilies,read:v765RestoreVerifiedFamilies,clear:v765InvalidateAllProofCache};');
const cache=cacheHarness(mockedStorage,now);
const date='2026-07-04',snap='S-765',valid={
  CCSL:{reportDate:date,snapshotId:snap,sourceCount:6857,scanCount:6857,finalCount:6857,runStatus:'finished'},
  SHOPEE:{reportDate:date,snapshotId:snap,sourceCount:1346,scanCount:1346,finalCount:1346,runStatus:'finished'}
};
cache.save(date,snap,valid);
assert.equal(cache.read(date,snap)?.CCSL?.sourceCount,6857);
assert.equal(cache.read(date,snap)?.SHOPEE?.sourceCount,1346);
assert.equal(cache.read(date,'DIFFERENT'),null,'new upload snapshot cannot reuse old 3/3 proof');
cache.clear();
assert.equal(cache.read(date,snap),null,'purge/reset must drop all verified browser proofs');
cache.save(date,snap,{...valid,SHOPEE:{...valid.SHOPEE,finalCount:1345}});
assert.equal(cache.read(date,snap),null,'incomplete 1345/1346 proof cannot recover 3/3');

console.log('[V756/V722] interaction-first navigation passed · board switches preserve date/snapshot · no serial latest-import blocker · running progress follows counters and exposes 90s no-change state');
