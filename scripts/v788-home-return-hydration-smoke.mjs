import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const worker=fs.readFileSync('src/v766HeavyReadWorker.mjs','utf8');
const manager=fs.readFileSync('src/v766ReadJobCoordinator.js','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
assert.match(summary,/export function buildHomeReturnVerification\(/);
assert.match(summary,/bills\.size!==expected\|\|sourceRows\.length!==expected/,'partial members cannot be zero return');
assert.match(manager,/'HOME_FULL','HOME_RETURNS','READ_ONLY_CHECK'/);
assert.match(worker,/message\.kind==='HOME_RETURNS'/);
assert.match(server,/app\.get\('\/api\/home-return-summary'/);
assert.match(server,/v766ReadJob\('HOME_RETURNS'/);
assert.match(server,/HOME_RETURN_SNAPSHOT_MISSING/,'wrong-day source cannot be treated as the requested day');
assert.match(shell,/json\(returnsUrl,30000\)/);
assert.match(shell,/viewSequence!==v788HomeViewSequence/,'out-of-order workers never overwrite new date');
assert.match(shell,/progressUnknown\?'历史处理证据待核验'/,'unknown 0\/0 cannot be reported as new work');
assert.match(shell,/resumeBtn\.disabled=allComplete\|\|historyVerifying\|\|progressUnknown/);
assert.match(html,/v625-shell\.js\?v=20261019-v788-1&patch=794/);

const from=shell.indexOf('function v788RenderVerifiedHomeReturns(');
const end=shell.indexOf('let v788HomeViewSequence=',from);
assert.ok(from>=0&&end>from,'production UI return renderer must be present');
const displayed={};
const apply=vm.runInNewContext(shell.slice(from,end)+'\n v788RenderVerifiedHomeReturns;',{
  page:'home',selectedReportDate:()=> '2026-07-02',
  fmt:n=>String(n),pct:n=>String(n)+'%',setText:(id,value)=>{displayed[id]=value}
});
const date='2026-07-02',snapshotId='SNAP-PINNED';
const ok={ok:true,selectionMatched:true,reportDate:date,snapshotId,
  returns:{WHPP:{count:32,rate:20.51,total:156,verified:true},
    SHOPEECN:{count:0,rate:0,total:0,verified:true},
    SHOPEEVN:{count:30,rate:7.52,total:399,verified:true}}};
assert.equal(apply(ok,date,snapshotId),true);
assert.equal(displayed.v626ReturnWHPP,'32');
assert.equal(displayed.v626ReturnRateWHPP,'20.51%');
assert.equal(displayed.v626ReturnSHOPEEVN,'30');
assert.equal(displayed.v626ReturnRateSHOPEEVN,'7.52%');
assert.equal(displayed.v626ReturnSHOPEECN,'0');
assert.equal(apply({...ok,snapshotId:'OTHER-SNAPSHOT'},date,snapshotId),false);
assert.equal(displayed.v626ReturnWHPP,'32','old snapshot cannot overwrite');
assert.equal(apply({...ok,returns:{WHPP:{count:null,rate:null,total:156,verified:false},
 SHOPEECN:ok.returns.SHOPEECN,SHOPEEVN:ok.returns.SHOPEEVN}},date,snapshotId),true);
assert.equal(displayed.v626ReturnWHPP,'待核验','absent proof must never masquerade as zero');
assert.equal(displayed.v626ReturnRateWHPP,'待核验');
console.log('[V788 HOME RETURNS] PASS independent dated worker, exact scope, true 0 vs unknown, progress 0/0 fail-closed');
