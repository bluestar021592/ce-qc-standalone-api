(function installV317CcslRecoveryOwner(global){
  if(global.__CE_QC_V317_CCSL_RECOVERY_OWNER__)return;
  const VERSION='2026-08-27-v333-ccsl-recovery-no-status-dom-mutation-v1';
  let busy=false,lastRunAt=0,timer=null;
  const date=value=>String(value||'').trim().replace(/\//g,'-').slice(0,10);
  function reportDate(){
    const selected=date(document.getElementById('reportDate')?.value||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
    if(selected)return selected;
    const text=String(document.getElementById('fileStatus')?.textContent||'');
    const hit=text.match(/20\d{2}-\d{2}-\d{2}/)?.[0];
    return date(hit||'');
  }
  async function call(action){
    const response=await fetch('/api/v317/ccsl-recovery',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({action,reportDate:reportDate()})});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok||data?.ok===false){const error=new Error(data?.error||`HTTP ${response.status}`);error.code=data?.code||`HTTP_${response.status}`;throw error;}
    return data;
  }
  async function directStart(){
    const response=await fetch('/api/run/start',{method:'POST',credentials:'same-origin',cache:'no-store'});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}
    if(response.ok&&data?.ok!==false)return data;
    const code=String(data?.code||`HTTP_${response.status}`);
    if(code==='RUN_ALREADY_ACTIVE')return{ok:true,alreadyRunning:true,code};
    const error=new Error(data?.error||data?.message||`CCSL续跑失败（HTTP ${response.status}）`);error.code=code;throw error;
  }
  function sync(status={}){
    global.__CE_QC_V317_CCSL_RECOVERY_OWNER__.lastStatus=status;
    global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.refresh?.();
  }
  async function tick(force=false){
    if(busy)return;
    const now=Date.now();if(!force&&now-lastRunAt<7000)return;lastRunAt=now;busy=true;
    try{
      let status=await call('status');sync(status);
      if(!status.dailyExists||status.complete||status.paused||!status.needsResume)return;
      const prepared=await call('prepare');status=prepared;sync(status);
      if(prepared.complete||prepared.paused||!prepared.needsResume)return;
      console.info('[CE-QC][V333_CCSL_AUTO_RECOVERY] starting checkpoint-safe CCSL continuation',prepared.reportDate,prepared.sourceTotal,prepared.action);
      await directStart();
      const after=await call('status');sync(after);
      if(typeof global.refresh==='function')setTimeout(()=>global.refresh().catch?.(()=>{}),200);
    }catch(error){
      console.warn('[CE-QC][V333_CCSL_AUTO_RECOVERY]',error?.code||'',error?.message||error);
    }finally{busy=false;}
  }
  function bind(){
    [350,1400,3500].forEach(ms=>setTimeout(()=>tick(true),ms));
    timer=setInterval(()=>tick(false),8000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>tick(true),200);});
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query'))setTimeout(()=>tick(true),300);},true);
  }
  global.__CE_QC_V317_CCSL_RECOVERY_OWNER__={version:VERSION,tick,reportDate,directStart,sync,lastStatus:null};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  console.info('[CE-QC][V333_CCSL_RECOVERY_UI]',VERSION,'recovery only; it never mutates #sevenBusinessStageSummary or #ccslRunStatus. V168 owns summary and V138 owns detail.');
})(window);
