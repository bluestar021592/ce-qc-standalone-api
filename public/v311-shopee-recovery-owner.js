(function installV311ShopeeRecoveryOwner(global){
  if(global.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__)return;
  const VERSION='2026-08-26-v312-direct-http-shopee-resume-v1';
  let busy=false,lastRunAt=0,timer=null;
  const date=v=>String(v||'').slice(0,10);
  function reportDate(){
    const input=date(document.getElementById('reportDate')?.value||'');if(input)return input;
    const text=String(document.getElementById('fileStatus')?.textContent||'');return date(text.match(/20\d{2}-\d{2}-\d{2}/)?.[0]||'');
  }
  async function call(action){
    const response=await fetch('/api/v311/shopee-recovery',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action,reportDate:reportDate()})});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}if(!response.ok||data?.ok===false){const error=new Error(data?.error||`HTTP ${response.status}`);error.code=data?.code||`HTTP_${response.status}`;throw error;}return data;
  }
  async function directResume(){
    const response=await fetch('/api/shopee/run/resume',{method:'POST',credentials:'same-origin',cache:'no-store'});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}
    if(response.ok&&data?.ok!==false)return data;
    const code=String(data?.code||`HTTP_${response.status}`);
    if(code==='RUN_ALREADY_ACTIVE')return{ok:true,alreadyRunning:true,code};
    const error=new Error(data?.error||data?.message||`SHOPEE续跑失败（HTTP ${response.status}）`);error.code=code;throw error;
  }
  function patchBadge(mode){
    document.querySelectorAll('#importPage .status-pill,#importPage span,#importPage b').forEach(node=>{
      const t=String(node.textContent||'').replace(/\s+/g,' ').trim();
      if(/SHOPEE CN\/VN\s*(待处理|处理中|已完成)/i.test(t)){
        if(mode==='running'){node.textContent='SHOPEE CN/VN 处理中';node.dataset.v312Recovery='running';}
        if(mode==='complete'){node.textContent='SHOPEE CN/VN 已完成';node.dataset.v312Recovery='complete';}
      }
    });
    const status=document.getElementById('ccslRunStatus');
    if(status&&mode==='running'&&!/SHOPEE\s*正在处理/i.test(String(status.textContent||''))){
      status.innerHTML='<span class="status-pill info">SHOPEE 正在从已保存断点继续处理…</span>';
    }
  }
  async function tick(force=false){
    if(busy)return;
    const now=Date.now();if(!force&&now-lastRunAt<5000)return;lastRunAt=now;busy=true;
    try{
      const status=await call('status');
      if(status.complete){patchBadge('complete');if(typeof global.refresh==='function')setTimeout(()=>global.refresh().catch?.(()=>{}),200);return;}
      if(!status.dailyExists||!status.needsResume)return;
      const prepared=await call('prepare');
      if(prepared.complete){patchBadge('complete');return;}
      patchBadge('running');
      console.info('[CE-QC][V312_RECOVERY_UI] direct HTTP resume from persisted SHOPEE checkpoint',prepared.reportDate,prepared.reopenedFrom||prepared.lock?.status||'');
      try{
        await directResume();
      }catch(error){
        if(error?.code==='RUN_NOT_RECOVERABLE'||error?.code==='RUN_ALREADY_COMPLETED'){
          const retryPrepared=await call('prepare');
          if(!retryPrepared.complete)await directResume();
        }else throw error;
      }
      const after=await call('status');
      if(after.complete){patchBadge('complete');if(typeof global.refresh==='function')setTimeout(()=>global.refresh().catch?.(()=>{}),250);}
      else patchBadge('running');
    }catch(error){console.warn('[CE-QC][V312_RECOVERY_UI]',error?.code||'',error?.message||error);}
    finally{busy=false;}
  }
  function bind(){
    [500,1800,4200].forEach(ms=>setTimeout(()=>tick(true),ms));
    timer=setInterval(()=>tick(false),5000);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query'))setTimeout(()=>tick(true),350);},true);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>tick(true),200);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__={version:VERSION,tick,reportDate,patchBadge,directResume};
  console.info('[CE-QC][V312_RECOVERY_UI]',VERSION,'backend-aware recovery now POSTs /api/shopee/run/resume directly after repairing the persisted run lock, bypassing stale browser runInFlight/app-state gates; checkpoints and daily membership remain untouched.');
})(window);
