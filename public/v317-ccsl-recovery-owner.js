(function installV317CcslRecoveryOwner(global){
  if(global.__CE_QC_V317_CCSL_RECOVERY_OWNER__)return;
  const VERSION='2026-08-26-v317-ccsl-restart-auto-recovery-v1';
  let busy=false,lastRunAt=0,timer=null;
  const date=value=>String(value||'').trim().replace(/\//g,'-').slice(0,10);
  function reportDate(){
    const text=String(document.getElementById('fileStatus')?.textContent||'');
    const hit=text.match(/20\d{2}-\d{2}-\d{2}/)?.[0];if(hit)return date(hit);
    return date(document.getElementById('reportDate')?.value||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
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
  function setCcslBadge(value){
    document.querySelectorAll('#importPage .status-pill,#importPage span,#importPage b').forEach(node=>{
      const t=String(node.textContent||'').replace(/\s+/g,' ').trim();
      if(/^CCSL\s*(待处理|处理中|已暂停|已完成)/i.test(t))node.textContent=value;
    });
  }
  function show(mode,status={}){
    const detail=document.getElementById('ccslRunStatus');
    const sourceTotal=Number(status.sourceTotal||0);
    const lock=status.lock||{};
    const batch=Number(lock.batchIndex||0),total=Number(lock.totalBatches||0);
    const stage=String(lock.currentStage||'').trim();
    const progress=stage?` · ${stage}${total>0?` ${batch}/${total}`:''}`:'';
    if(mode==='complete'){
      setCcslBadge('CCSL 已完成');
      if(detail)detail.innerHTML='<span class="status-pill success">CCSL 已完成 · 正式快照已生成</span>';
      return;
    }
    if(mode==='paused'){
      setCcslBadge('CCSL 已暂停');
      if(detail)detail.innerHTML=`<span class="status-pill warning">CCSL 已暂停 · 保留断点 ${sourceTotal.toLocaleString('zh-CN')} 票</span>`;
      return;
    }
    if(mode==='running'){
      setCcslBadge('CCSL 处理中');
      if(detail)detail.innerHTML=`<span class="status-pill warning">CCSL 正在恢复并继续处理${progress}</span><p>当日CCSL队列：${sourceTotal.toLocaleString('zh-CN')} 票 · 已保存成功票不会重复请求</p>`;
      return;
    }
    setCcslBadge('CCSL 待处理');
  }
  function sync(status={}){
    if(status.complete)return show('complete',status);
    if(status.paused)return show('paused',status);
    if(status.needsResume||String(status?.lock?.status||'').toLowerCase()==='running')return show('running',status);
    show('waiting',status);
  }
  async function tick(force=false){
    if(busy||location.pathname!=='/import')return;
    const now=Date.now();if(!force&&now-lastRunAt<7000)return;lastRunAt=now;busy=true;
    try{
      let status=await call('status');sync(status);
      if(!status.dailyExists||status.complete||status.paused||!status.needsResume)return;
      const prepared=await call('prepare');status=prepared;sync(status);
      if(prepared.complete||prepared.paused||!prepared.needsResume)return;
      console.info('[CE-QC][V317_CCSL_AUTO_RECOVERY] starting checkpoint-safe CCSL continuation',prepared.reportDate,prepared.sourceTotal,prepared.action);
      await directStart();
      const after=await call('status');sync(after);
      if(typeof global.refresh==='function')setTimeout(()=>global.refresh().catch?.(()=>{}),200);
    }catch(error){
      console.warn('[CE-QC][V317_CCSL_AUTO_RECOVERY]',error?.code||'',error?.message||error);
    }finally{busy=false;}
  }
  function bind(){
    [350,1400,3500].forEach(ms=>setTimeout(()=>tick(true),ms));
    timer=setInterval(()=>tick(false),8000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>tick(true),200);});
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page="import"],#topRangeQuery,.top-range-query'))setTimeout(()=>tick(true),300);},true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V317_CCSL_RECOVERY_OWNER__={version:VERSION,tick,reportDate,directStart,sync};
  console.info('[CE-QC][V317_CCSL_RECOVERY_UI]',VERSION,'CCSL restart recovery is independent of SHOPEE completion and respects explicit pause state.');
})(window);
