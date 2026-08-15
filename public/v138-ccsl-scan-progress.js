(function installV138CcslScanProgress(global){
  if(global.__CE_QC_V138_CCSL_SCAN_PROGRESS__)return;
  const VERSION='2026-08-15-v138-ccsl-scan-progress-v1';
  const POLL_MS=1000;
  const progressByType=new Map();
  let polling=false;

  // V138 supersedes the older V96 renderer. Prevent the lazy loader from starting
  // a second poller that would race this one and paint stale scanResults.length as
  // completed work.
  global.__CE_QC_V96_V67_LIVE_PROGRESS_BRIDGE__=true;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');

  async function read(type){
    try{
      const response=await fetch(`/api/v33/run-progress?businessType=${encodeURIComponent(type)}`,{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)return null;
      const value=await response.json();
      if(value?.ok!==false)progressByType.set(type,value);
      return value;
    }catch{return null;}
  }

  function phase(progress={}){
    const raw=String(progress.phase||'').trim();
    if(/扫描|scan|order/i.test(raw))return {label:'订单扫描',done:Number(progress.scanDone||0),retry:Number(progress.scanRetry||0),observed:Number(progress.scanObserved||0),total:Number(progress.scanTotal||0),batchMax:50};
    if(/轨迹|track/i.test(raw))return {label:'轨迹查询',done:Number(progress.trackDone||0),retry:Number(progress.trackRetry||0),observed:Number(progress.trackObserved||0),total:Number(progress.trackTotal||0),batchMax:50};
    return {label:raw||'准备处理',done:Number(progress.done||0),retry:Number(progress.retry||0),observed:Number(progress.done||0)+Number(progress.retry||0),total:Number(progress.total||0),batchMax:0};
  }

  function markup(progress={}){
    const p=phase(progress),batch=Number(progress.batchIndex||0),batches=Number(progress.totalBatches||0);
    const batchText=batches>0?` · 当前批次 ${batch||1}/${batches}`:'';
    const retryText=p.retry>0?` · <b>待重试 ${fmt(p.retry)}</b>`:'';
    const last=String(progress.lastMessage||'').trim();
    const scanHint=p.label==='订单扫描'?'<p class="muted">每个真实CE扫描批次最多50票；网络异常时单批会自动限时并转为待重试，不会无限卡住。</p>':'';
    return `<span class="status-pill warning">${esc(progress.businessType||'CCSL')} 正在处理 · ${esc(p.label)}</span>`
      +`<p>${esc(p.label)}：成功 ${fmt(p.done)} / ${fmt(p.total)}${retryText}${batchText}</p>`
      +`<p class="muted">已产生结果 ${fmt(p.observed)} / ${fmt(p.total)}${p.batchMax?` · 单批最大${p.batchMax}`:''}</p>`
      +scanHint
      +(last?`<p class="muted">${esc(last)}</p>`:'');
  }

  function render(progress){
    if(!progress)return;
    const status=document.getElementById('ccslRunStatus');
    const button=document.querySelector('[data-testid="global-auto-process"]');
    if(status)status.innerHTML=markup(progress);
    if(button&&button.disabled){
      const p=phase(progress);
      button.textContent=`${progress.businessType||'CCSL'} ${p.label} ${p.done}/${p.total}${p.retry?` · 重试${p.retry}`:''}`;
    }
  }

  async function tick(){
    if(polling||location.pathname!=='/import')return;
    polling=true;
    try{
      const [ccsl,shopee]=await Promise.all([read('CCSL'),read('SHOPEE')]);
      const active=[ccsl,shopee].find(item=>item?.running===true);
      if(active)render(active);
    }finally{polling=false;}
  }

  function installStaticMarkupBridge(){
    const original=global.runStatusMarkup;
    if(typeof original!=='function'||original.__v138TruthfulProgress)return;
    const wrapped=function(state){
      const type=String(state?.businessType||'CCSL').toUpperCase()==='SHOPEE'?'SHOPEE':'CCSL';
      const live=progressByType.get(type);
      const sameDate=!live?.reportDate||!state?.reportDate||String(live.reportDate)===String(state.reportDate);
      if(live?.running&&sameDate)return markup(live);
      return original.apply(this,arguments);
    };
    wrapped.__v138TruthfulProgress=true;
    global.runStatusMarkup=wrapped;
  }

  function install(){
    installStaticMarkupBridge();
    setInterval(tick,POLL_MS);
    setTimeout(tick,150);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  global.__CE_QC_V138_CCSL_SCAN_PROGRESS__={version:VERSION,read,phase,progressByType};
  console.info('[CE-QC][V138_CCSL_SCAN_PROGRESS]',VERSION);
})(window);
