import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync('public/v625-shell.js','utf8');
const css=fs.readFileSync('public/v806-home-card-clearance.css','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');

// An exact selected source day must never silently expand into 150k+ legacy
// carrying waybills. Check the actual production click handler in a sandbox.
const begin=js.indexOf('async function refreshOpenPodNow(){');
const end=js.indexOf('async function scanWhppPending(){',begin);
assert.ok(begin>0&&end>begin,'production selected-day refresh handler must exist');
const requests=[],notices=[];
const context={
  runBusy:false,
  v626LatestImport:{reportDate:'2026-07-12'},
  selectedReportDate:()=> '2026-07-12',
  v785OpenSourceVerified:true,
  v785OpenEarliestDate:'2026-07-01',
  v785OpenExpectedCount:13886,
  v785OpenTotal:1079,
  latestImportContext:async()=>{throw Error('unnecessary latest import lookup');},
  loadOpenPod:async()=>({openSourceCoverage:{complete:true}}),
  pollTrackingJob:async()=>({refreshed:17,failed:0}),
  post:async(url,args)=>{requests.push({url,args});return{job:{jobId:'test-task'}};},
  page:'home',
  loadHome:async()=>{},
  loadBusiness:async()=>{},
  note:(id,message)=>notices.push({id,message}),
  fmt:n=>String(n),
  Promise
};
vm.createContext(context);
vm.runInContext(js.slice(begin,end),context,{timeout:1000});
await context.refreshOpenPodNow();
assert.equal(requests.length,1);
assert.equal(requests[0].url,'/api/v246/tracking/reconcile');
assert.equal(requests[0].args.businessType,'ALL');
assert.equal(requests[0].args.fromDate,'2026-07-12',
  'must not expand the 2026-07-12 selection to earliest 2026-07-01');
assert.equal(requests[0].args.toDate,'2026-07-12');
assert.ok(notices.some(r=>r.message.includes('其他历史日期未批量更新')),
  'success must not claim all 1079 historical members were rescanned');

// Selected-day worker reads must own the first viewport. The expensive
// 30-day HOME_FULL starts only AFTER all card promises have settled.
const t=js.indexOf("const timingTypes=['WHPP','SHOPEEVN','SHOPEECN','TBKH']");
const jobs=js.indexOf('const timingJobs=timingTypes.map(',t);
const full=js.indexOf('void Promise.allSettled(timingJobs).then(',jobs);
assert.ok(t>=0&&jobs>t&&full>jobs);
assert.match(js,/const count=Number\(summary\.classification\?\.counts\?\.\[type\]\?\?-1\)/);
assert.match(js,/if\(count===0\)\{/);
assert.match(js,/本日报0票，无签收时效可计算/);
assert.match(js,/json\(timingUrl,85000\)/);
assert.match(js,/\.finally\(resolve\)/);
assert.match(js,/void Promise\.allSettled\(timingJobs\)\.then\(\(\)=>setTimeout\(\(\)=>\{/);
assert.match(js,/String\(payload\?\.snapshotId\|\|''\)!==proofSnapshot/);
assert.match(js,/String\(payload\?\.businessType\|\|''\)!==type/);
assert.match(js,/v802RenderSelectedTiming\(payload\)/);
assert.ok(full<js.indexOf("const historyRows=[];",full));

// Preserve five distinct real columns and title access to long statuses.
assert.match(html,/<th>运单号<\/th><th>业务<\/th><th>当前状态<\/th><th>最后更新时间<\/th><th>操作<\/th>/);
assert.match(css,/v626-open-table \.v625-table\{/);
assert.match(css,/table-layout:fixed!important/);
assert.match(css,/nth-child\(5\)\{width:17%\}/);
assert.match(js,/td\.title=String\(value\|\|'—'\)/);
console.log('[V808 SELECTED-DAY] PASS real click handler strictly day-bounded, read workers prioritized, sourced-zero day truthful, table action column preserved');
