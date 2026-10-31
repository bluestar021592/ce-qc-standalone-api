import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const worker=fs.readFileSync('src/v766HeavyReadWorker.mjs','utf8');
const coord=fs.readFileSync('src/v766ReadJobCoordinator.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
assert.match(worker,/message\.kind==='HOME_TIMING'/);
assert.match(coord,/'HOME_FULL','HOME_RETURNS','HOME_TIMING'/);
assert.match(server,/app\.get\('\/api\/home-timing-summary'/);
assert.match(server,/v766ReadJob\('HOME_TIMING',\{reportDate,snapshotId\}\)/);
assert.match(server,/HOME_TIMING_SNAPSHOT_NOT_FOUND/);
assert.match(server,/Cache-Control','private, no-store'/);
assert.match(shell,/\/api\/home-timing-summary\?reportDate=/);
assert.match(shell,/json\(timingUrl,45000\)/);
assert.match(shell,/summary\?\.selectionMatched&&summary\?\.reportDate/);
assert.match(shell,/v802RenderSelectedTiming\(payload\)/);
assert.match(html,/v625-shell\.js\?v=20261031-v803-1&patch=803/);
assert.doesNotMatch(server.slice(server.indexOf("app.get('/api/home-timing-summary'"),server.indexOf("app.get('/api/home-quality-summary'")),/client\.trackQuery\(|client\.confirmQuery\(|requestSelectedDateTimingRepair\(/,
  'timing endpoint never calls remote data collection');
const f0=summary.indexOf('export function buildSelectedDateTimingProjection(');
const f1=summary.indexOf('export function buildHomeQualitySummary(',f0);
assert.ok(f0>=0&&f1>f0,'exact-day function must exist');
const snap={reportDate:'2026-07-12',snapshotId:'SNAP-12'};
const context={
  TIMING_TYPES:['TBKH','WHPP','SHOPEECN','SHOPEEVN'],
  selectUnifiedBatch:({reportDate,snapshotId})=>reportDate===snap.reportDate&&snapshotId===snap.snapshotId?snap:null,
  safeTimingForBatch:(batch,type)=>({businessType:type,overall:{
    avgDays:type==='TBKH'?2:null,podCount:type==='TBKH'?10:0,
    totalPodCount:type==='TBKH'?12:0
  },pp:{avgDays:2,podCount:3},pv:{avgDays:null,podCount:0}})
};
vm.createContext(context);
vm.runInContext(summary.slice(f0,f1).replace('export function','function'),context,{timeout:1000});
const build=context.buildSelectedDateTimingProjection;
assert.equal(build({reportDate:'2026-07-12',snapshotId:''}).ok,false);
assert.equal(build({reportDate:'2026-07-11',snapshotId:snap.snapshotId}).selectionMatched,false);
assert.equal(build({reportDate:snap.reportDate,snapshotId:'OTHER'}).selectionMatched,false);
const good=build({reportDate:snap.reportDate,snapshotId:snap.snapshotId});
assert.equal(good.selectionMatched,true);
assert.equal(good.reportDate,'2026-07-12');
assert.equal(good.remoteQueries,0);
assert.equal(good.timing.TBKH.overall.avgDays,2);
assert.equal(good.timing.WHPP.overall.avgDays,null,'unknown WHPP time remains absent');
const ui0=shell.indexOf('function v802RenderSelectedTiming(');
const ui1=shell.indexOf('function v800SetWhppMetrics(',ui0);
assert.ok(ui0>=0&&ui1>ui0);
const texts=new Map(),tctx={
  page:'home',setText:(id,val)=>texts.set(id,String(val)),fmt:n=>String(n),
  v801RenderTimingSummary:()=>{texts.set('_summaryRendered','yes')}
};
vm.createContext(tctx);vm.runInContext(shell.slice(ui0,ui1),tctx,{timeout:1000});
assert.equal(tctx.v802RenderSelectedTiming({...good,selectionMatched:false}),false);
assert.equal(texts.size,0);
assert.equal(tctx.v802RenderSelectedTiming(good),true);
assert.equal(texts.get('v625TimingTBKHOverall'),'2天');
assert.equal(texts.get('v625TimingWHPPOverall'),'—');
assert.match(texts.get('v625TimingWHPPPod'),/无可信签收时间/);
assert.match(texts.get('v625TimingPeriod'),/2026-07-12/);
console.log('[V802] PASS independent exact-day timing worker, date/snapshot pinned, 4-card evidence rendering and no fabricated time');
