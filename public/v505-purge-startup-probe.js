(function installV505PurgeStartupProbe(global){
  if(global.__CE_QC_V505_PURGE_STARTUP_PROBE__)return;
  const PATCH_ID='2026-09-12-v505-startup-probe-v2-exact-job-bound';
  const PROBE_AFTER_MS=75_000;
  const PROBE_COOLDOWN_MS=30_000;
  let lastProbeAt=0;
  let running=false;

  async function readStatus(url){
    const response=await fetch(`${url}${url.includes('?')?'&':'?'}startupProbe=${Date.now()}`,{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)return null;
    try{return await response.json();}catch{return null;}
  }
  async function requestSerializedRecovery(){
    const response=await fetch('/api/admin/data-purge/prepare',{
      method:'POST',cache:'no-store',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:'{}'
    });
    if(response.ok)return;
    let detail={};try{detail=await response.json();}catch{}
    const code=String(detail.code||'');
    if(code&&code!=='DATA_PURGE_SUBMISSION_BUSY'&&code!=='DATA_PURGE_HTTP_BUSY'){
      console.warn('[CE-QC][V505_PURGE_STARTUP_PROBE] recovery remained protected',code);
    }
  }
  async function tick(){
    if(running)return;
    const owner=global.__CE_QC_V505_DATA_PURGE_RECOVERY__;
    const state=owner?.getStatus?.();
    const job=state?.currentJob;
    if(!state?.active||!job||String(job.kind||'PREPARE').toUpperCase()!=='PREPARE')return;
    const statusName=String(job.status||'').toUpperCase();
    if(!['QUEUED','RUNNING'].includes(statusName))return;
    const jobId=String(job.jobId||'').trim();
    const statusUrl=String(job.statusUrl||job.pollUrl||'');
    if(!jobId||!/^\/purge-status\/[a-f0-9]{48}\.json$/i.test(statusUrl))return;
    running=true;
    try{
      const status=await readStatus(statusUrl);
      if(String(status?.jobId||'')!==jobId)return;
      const latestState=String(status?.status||'').toUpperCase();
      if(!['QUEUED','RUNNING'].includes(latestState))return;
      const heartbeatAt=Number(status?.heartbeatAt||0);
      if(!heartbeatAt||Date.now()-heartbeatAt<PROBE_AFTER_MS)return;
      if(Date.now()-lastProbeAt<PROBE_COOLDOWN_MS)return;
      lastProbeAt=Date.now();
      await requestSerializedRecovery();
    }catch(error){
      console.warn('[CE-QC][V505_PURGE_STARTUP_PROBE] probe skipped',error?.message||error);
    }finally{running=false;}
  }

  const timer=setInterval(()=>{void tick();},5000);
  timer.unref?.();
  global.__CE_QC_V505_PURGE_STARTUP_PROBE__={patchId:PATCH_ID,tick};
  console.info('[CE-QC][V505_PURGE_STARTUP_PROBE]',PATCH_ID);
})(window);
