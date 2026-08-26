(function installV311ShopeeRecoveryOwner(global){
  if(global.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__)return;
  const VERSION='2026-08-26-v313-single-source-shopee-completion-v1';
  let busy=false,lastRunAt=0,timer=null;
  const date=v=>String(v||'').slice(0,10);
  function reportDate(){
    const input=date(document.getElementById('reportDate')?.value||'');if(input)return input;
    const text=String(document.getElementById('fileStatus')?.textContent||'');const hit=text.match(/20\d{2}-\d{2}-\d{2}/)?.[0];if(hit)return date(hit);
    return date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
  }
  async function call(action){
    const response=await fetch('/api/v311/shopee-recovery',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({action,reportDate:reportDate()})});
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
  function setTextByMatch(re,value){
    document.querySelectorAll('#importPage .status-pill,#importPage span,#importPage b').forEach(node=>{
      const t=String(node.textContent||'').replace(/\s+/g,' ').trim();if(re.test(t))node.textContent=value;
    });
  }
  function canonicalNotice(mode,status={}){
    const top=document.getElementById('globalProcessingNotice');
    const detail=document.getElementById('ccslRunStatus');
    const stage=String(status?.lock?.currentStage||'').trim();
    const batch=Number(status?.lock?.batchIndex||0),total=Number(status?.lock?.totalBatches||0);
    const progress=stage?` · ${stage}${total>0?` ${batch}/${total}`:''}`:'';
    if(mode==='complete'){
      if(top){top.hidden=false;top.className='global-processing-notice success';top.innerHTML='<span><strong>SHOPEE处理完成</strong> · 已生成 VALID + COMPLETED 正式快照</span>';top.dataset.v313Truth='complete';}
      if(detail){detail.innerHTML='<span class="status-pill success">SHOPEE 已完成 · 正式快照已生成</span>';detail.dataset.v313Truth='complete';}
      setTextByMatch(/SHOPEE CN\/VN\s*(待处理|处理中|已完成)/i,'SHOPEE CN/VN 已完成');
      setTextByMatch(/^尚未全部完成$/,'全部完成');
      return;
    }
    if(mode==='running'){
      if(top){top.hidden=false;top.className='global-processing-notice warning';top.innerHTML=`<span><strong>SHOPEE处理中</strong>${progress}</span>`;top.dataset.v313Truth='running';}
      if(detail){detail.innerHTML=`<span class="status-pill warning">SHOPEE 正在处理${progress}</span>`;detail.dataset.v313Truth='running';}
      setTextByMatch(/SHOPEE CN\/VN\s*(待处理|处理中|已完成)/i,'SHOPEE CN/VN 处理中');
      return;
    }
    if(mode==='waiting'){
      if(top){top.hidden=false;top.className='global-processing-notice warning';top.innerHTML='<span><strong>SHOPEE尚未完成</strong> · 正在从已保存断点恢复</span>';top.dataset.v313Truth='waiting';}
      if(detail){detail.innerHTML='<span class="status-pill warning">SHOPEE 尚未完成 · 正在恢复断点</span>';detail.dataset.v313Truth='waiting';}
      setTextByMatch(/SHOPEE CN\/VN\s*(待处理|处理中|已完成)/i,'SHOPEE CN/VN 待处理');
    }
  }
  function syncCanonicalStatus(status={}){
    if(status.complete)return canonicalNotice('complete',status);
    if(!status.dailyExists)return;
    const lockState=String(status?.lock?.status||'').toLowerCase();
    if(lockState==='running')return canonicalNotice('running',status);
    if(status.needsResume)return canonicalNotice('waiting',status);
  }
  async function tick(force=false){
    if(busy)return;
    const now=Date.now();if(!force&&now-lastRunAt<5000)return;lastRunAt=now;busy=true;
    try{
      let status=await call('status');syncCanonicalStatus(status);
      if(status.complete||!status.dailyExists||!status.needsResume)return;
      const prepared=await call('prepare');status=prepared;syncCanonicalStatus(status);
      if(prepared.complete)return;
      canonicalNotice('running',prepared);
      console.info('[CE-QC][V313_RECOVERY_UI] direct HTTP resume from persisted SHOPEE checkpoint',prepared.reportDate,prepared.reopenedFrom||prepared.lock?.status||'');
      try{
        await directResume();
      }catch(error){
        if(error?.code==='RUN_NOT_RECOVERABLE'||error?.code==='RUN_ALREADY_COMPLETED'){
          const retryPrepared=await call('prepare');syncCanonicalStatus(retryPrepared);if(!retryPrepared.complete)await directResume();
        }else throw error;
      }
      const after=await call('status');syncCanonicalStatus(after);
      if(after.complete&&typeof global.refresh==='function')setTimeout(()=>global.refresh().catch?.(()=>{}),250);
    }catch(error){console.warn('[CE-QC][V313_RECOVERY_UI]',error?.code||'',error?.message||error);}
    finally{busy=false;}
  }
  function bind(){
    [400,1600,4000].forEach(ms=>setTimeout(()=>tick(true),ms));
    timer=setInterval(()=>tick(false),5000);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query'))setTimeout(()=>tick(true),350);},true);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>tick(true),200);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__={version:VERSION,tick,reportDate,directResume,syncCanonicalStatus,canonicalNotice};
  console.info('[CE-QC][V313_RECOVERY_UI]',VERSION,'the only authoritative visible SHOPEE completion state is backend VALID+COMPLETED snapshot truth; legacy V309/V310 resume owners yield to this owner, so top notice and bottom badges cannot disagree.');
})(window);
