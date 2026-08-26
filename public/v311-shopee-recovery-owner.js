(function installV311ShopeeRecoveryOwner(global){
  if(global.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__)return;
  const VERSION='2026-08-26-v311-backend-aware-shopee-recovery-v1';
  let busy=false,lastRunAt=0,timer=null;
  const date=v=>String(v||'').slice(0,10);
  function reportDate(){
    const input=date(document.getElementById('reportDate')?.value||'');if(input)return input;
    const text=String(document.getElementById('fileStatus')?.textContent||'');return date(text.match(/20\d{2}-\d{2}-\d{2}/)?.[0]||'');
  }
  async function call(action){
    const response=await fetch('/api/v311/shopee-recovery',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action,reportDate:reportDate()})});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);return data;
  }
  function patchBadge(mode){
    document.querySelectorAll('#importPage .status-pill,#importPage span,#importPage b').forEach(node=>{
      const t=String(node.textContent||'').replace(/\s+/g,' ').trim();
      if(/SHOPEE CN\/VN\s*(待处理|处理中|已完成)/i.test(t)){
        if(mode==='running'){node.textContent='SHOPEE CN/VN 处理中';node.dataset.v311Recovery='running';}
        if(mode==='complete'){node.textContent='SHOPEE CN/VN 已完成';node.dataset.v311Recovery='complete';}
      }
    });
  }
  async function tick(force=false){
    if(busy)return;const d=reportDate();if(!d)return;
    const now=Date.now();if(!force&&now-lastRunAt<5000)return;lastRunAt=now;busy=true;
    try{
      const status=await call('status');
      if(status.complete){patchBadge('complete');if(typeof global.refresh==='function')setTimeout(()=>global.refresh().catch?.(()=>{}),200);return;}
      if(!status.dailyExists||!status.needsResume)return;
      const prepared=await call('prepare');
      if(prepared.complete){patchBadge('complete');return;}
      patchBadge('running');
      console.info('[CE-QC][V311_RECOVERY_UI] resuming SHOPEE from persisted checkpoint',prepared.reportDate,prepared.reopenedFrom||prepared.lock?.status||'');
      if(typeof global.resumeShopee==='function')await global.resumeShopee();
      else if(typeof global.resumeUnified==='function')await global.resumeUnified();
    }catch(error){console.warn('[CE-QC][V311_RECOVERY_UI]',error?.message||error);}
    finally{busy=false;}
  }
  function bind(){
    [700,2200,5200].forEach(ms=>setTimeout(()=>tick(true),ms));
    timer=setInterval(()=>tick(false),5000);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query'))setTimeout(()=>tick(true),500);},true);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>tick(true),250);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__={version:VERSION,tick,reportDate,patchBadge};
  console.info('[CE-QC][V311_RECOVERY_UI]',VERSION,'backend-aware recovery checks exact SHOPEE run lock + VALID COMPLETED snapshot instead of trusting stale DOM labels; finished-without-snapshot runs are reopened and resumed from persisted checkpoints.');
})(window);
