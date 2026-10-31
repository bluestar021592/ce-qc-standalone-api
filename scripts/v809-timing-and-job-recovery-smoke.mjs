import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const server=fs.readFileSync('server.js','utf8');
const runtime=fs.readFileSync('src/v246QcTrackingRuntimePatch.js','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
assert.match(html,/id="v809TrackJobStatus"/);
assert.match(shell,/v809TrackJobStatus'\)\?\.addEventListener\('click',\(\)=>void v809ViewTrackingProgress\(\)\)/);
assert.match(runtime,/previousGet\.call\(app,'\/api\/v246\/tracking\/active-job',jobStatusHandler\)/);
assert.match(runtime,/code:'V246_DIFFERENT_SCOPE_JOB_RUNNING'/);
assert.match(runtime,/const kickoff=setTimeout\(\(\)=>executeJob\(job,reason\)/);
assert.match(shell,/v809ReadSelectedTrackingJob\(reportDate,startedAt\)/);
assert.match(server,/V809_TIMING_DIAG/);
assert.match(summary,/u\.snapshotId IN \(\s*SELECT later\.snapshotId FROM unified_import_batches later/);
assert.match(summary,/later\.status='VALID' AND later\.reportDate>=\?/);
assert.match(summary,/UPPER\(TRIM\(u\.shipmentCode\)\) IN/);
const begin=shell.indexOf('async function v809ReadSelectedTrackingJob(');
const end=shell.indexOf('\nasync function scanWhppPending(){',begin);
assert.ok(begin>0&&end>begin,'extract real V809 frontend handlers');
const job={jobId:'V246-ONCE',selection:{businessType:'ALL',fromDate:'2026-07-12',toDate:'2026-07-12'},status:'RUNNING'};
async function scenario({recover=true,priorRunning=false}={}){
  let posts=0,reads=0,polls=0;
  const notices=[];
  const ctx={
    URLSearchParams,Date,Promise,runBusy:false,
    v809TrackingRefreshBusy:false,v809TrackingInspectBusy:false,
    v626LatestImport:{reportDate:'2026-07-12'},
    v785OpenSourceVerified:true,v785OpenVerifiedDate:'2026-07-12',
    v785OpenExpectedCount:13886,v785OpenTotal:1079,v626TrackingJobId:'',
    selectedReportDate:()=> '2026-07-12',
    latestImportContext:async()=>({reportDate:'2026-07-12'}),
    loadOpenPod:async()=>({openSourceCoverage:{complete:true}}),
    loadHome:async()=>{},loadBusiness:async()=>{},page:'home',
    post:async()=>{posts++;const e=new Error('前端等待超时');e.code='CLIENT_WAIT_TIMEOUT';throw e},
    json:async url=>{
      reads++;
      assert.match(url,/\/api\/v246\/tracking\/active-job\?/);
      const p=new URL(url,'http://localhost').searchParams;
      assert.equal(p.get('fromDate'),'2026-07-12');
      assert.equal(p.get('toDate'),'2026-07-12');
      assert.equal(p.get('businessType'),'ALL');
      return{ok:true,job:priorRunning?job:(reads===1?null:(recover?job:null))}
    },
    pollTrackingJob:async()=>{polls++;return{...job,status:'COMPLETED',failed:0,refreshed:17}},
    note:(id,msg)=>notices.push(String(msg)),
    fmt:n=>String(n),appendLiveLog:()=>{},
    isTransportLoss:e=>e?.code==='CLIENT_WAIT_TIMEOUT',sleep:async()=>{}
  };
  vm.createContext(ctx);
  vm.runInContext(shell.slice(begin,end),ctx,{timeout:1000});
  await ctx.refreshOpenPodNow();
  return{posts,reads,polls,notices};
}
const recovered=await scenario({recover:true});
assert.equal(recovered.posts,1,'POST timeout must never resubmit automatically');
assert.equal(recovered.reads,2);
assert.equal(recovered.polls,1);
assert.ok(recovered.notices.some(x=>x.includes('任务已完成并重新核对')));
const unknown=await scenario({recover:false});
assert.equal(unknown.posts,1);
assert.equal(unknown.polls,0,'unconfirmed task cannot count completed');
assert.ok(unknown.notices.some(x=>x.includes('不要重复点击')));
const running=await scenario({priorRunning:true});
assert.equal(running.posts,0,'same-day running job reused');
assert.equal(running.polls,1);
console.log('[V809 JOB RECOVERY] PASS scoped read-only job lookup, 30s lost POST handoff, no duplicate dispatch and existing job continuation; timing valid-snapshot index contract retained');
