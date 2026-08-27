(function installV138CcslScanProgress(global){
  if(global.__CE_QC_V138_CCSL_SCAN_PROGRESS__)return;
  const VERSION='2026-08-27-v332-selected-date-complete-progress-v1';
  const POLL_MS=1000;
  const progressByType=new Map();
  let polling=false;

  global.__CE_QC_V96_V67_LIVE_PROGRESS_BRIDGE__=true;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const normalizeDate=value=>{const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
  const selectedReportDate=()=>normalizeDate(document.getElementById('reportDate')?.value||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
  const statusText=progress=>{
    const status=String(progress?.runStatus||'').toLowerCase();
    if(progress?.complete===true||progress?.zeroTicketDay===true)return '已完成';
    if(progress?.running)return '正在处理';
    if(progress?.paused||status==='paused')return '已暂停';
    if(status==='finished'||status==='completed')return '已完成';
    if(status.includes('retry')||status==='failed')return '待重试';
    return '待处理';
  };

  async function read(type){
    try{
      const normalizedType=String(type||'CCSL').toUpperCase();
      const reportDate=normalizedType==='CCSL'?selectedReportDate():'';
      const suffix=reportDate?`&reportDate=${encodeURIComponent(reportDate)}`:'';
      const response=await fetch(`/api/v33/run-progress?businessType=${encodeURIComponent(normalizedType)}${suffix}`,{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)return null;
      const value=await response.json();
      if(value?.ok!==false)progressByType.set(normalizedType,value);
      return value;
    }catch{return null;}
  }

  function phase(progress={}){
    const raw=String(progress.phase||'').trim();
    if(/扫描|scan|order/i.test(raw))return {label:'订单扫描',done:Number(progress.scanDone||0),retry:Number(progress.scanRetry||0),observed:Number(progress.scanObserved||0),total:Number(progress.scanTotal||0),batchMax:100};
    if(/轨迹|track/i.test(raw))return {label:'轨迹查询',done:Number(progress.trackDone||0),retry:Number(progress.trackRetry||0),observed:Number(progress.trackObserved||0),total:Number(progress.trackTotal||0),batchMax:50};
    return {label:raw||'准备处理',done:Number(progress.done||0),retry:Number(progress.retry||0),observed:Number(progress.done||0)+Number(progress.retry||0),total:Number(progress.total||0),batchMax:0};
  }

  function finalMarkup(progress={}){
    const status=statusText(progress);
    if(progress?.zeroTicketDay===true&&status==='已完成'){
      return `<span class="status-pill success">${esc(progress.businessType||'CCSL')} 已完成</span>`
        +'<p>当前阶段：已完成</p>'
        +'<p>当日有效日报CCSL为0票，无需启动订单扫描或轨迹查询。</p>';
    }
    const failed=Number(progress.scanRetry||0)+Number(progress.trackRetry||0);
    const skipped=Number(progress.podLockSkipped||0);
    const pillClass=status==='已完成'?'success':(status==='待重试'?'warning':'warning');
    return `<span class="status-pill ${pillClass}">${esc(progress.businessType||'CCSL')} ${esc(status)}</span>`
      +`<p>当前阶段：${esc(status==='已完成'?'完成':(progress.phase||status))}</p>`
      +`<p>订单扫描：成功 ${fmt(progress.scanDone)} / ${fmt(progress.scanTotal)}${Number(progress.scanRetry||0)?` · 待重试 ${fmt(progress.scanRetry)}`:''} · 单批最大100</p>`
      +`<p>轨迹查询：成功 ${fmt(progress.trackDone)} / ${fmt(progress.trackTotal)}${Number(progress.trackRetry||0)?` · 待重试 ${fmt(progress.trackRetry)}`:''} · 单批最大50</p>`
      +(skipped?`<p class="muted">历史POD锁直接闭环 ${fmt(skipped)} 票，无需重复请求CE接口。</p>`:'')
      +(failed?`<p class="muted">仍有 ${fmt(failed)} 票接口待重试，不能按完整完成处理。</p>`:'');
  }

  function markup(progress={}){
    if(!progress.running)return finalMarkup(progress);
    const p=phase(progress),batch=Number(progress.batchIndex||0),batches=Number(progress.totalBatches||0);
    const batchText=batches>0?` · 当前批次 ${batch||1}/${batches}`:'';
    const retryText=p.retry>0?` · <b>待重试 ${fmt(p.retry)}</b>`:'';
    const last=String(progress.lastMessage||'').trim();
    const scanHint=p.label==='订单扫描'?'<p class="muted">当日日报与历史跨日遗留已分离；CE扫描单批最多100票，失败票在主流程结束后至少补偿重试3轮。</p>':'';
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
    if(status){status.innerHTML=markup(progress);status.dataset.v332ProgressState=statusText(progress)==='已完成'?'done':'active';}
    if(button&&button.disabled&&progress.running){
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
      else if(ccsl?.complete===true||ccsl?.zeroTicketDay===true||ccsl?.runId)render(ccsl);
    }finally{polling=false;}
  }

  function installStaticMarkupBridge(){
    const original=global.runStatusMarkup;
    if(typeof original!=='function'||original.__v138TruthfulProgress)return;
    const wrapped=function(state){
      const type=String(state?.businessType||'CCSL').toUpperCase()==='SHOPEE'?'SHOPEE':'CCSL';
      const live=progressByType.get(type);
      const sameDate=!live?.reportDate||!state?.reportDate||String(live.reportDate)===String(state.reportDate);
      if((live?.runId||live?.complete===true||live?.zeroTicketDay===true)&&sameDate)return markup(live);
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
  global.__CE_QC_V138_CCSL_SCAN_PROGRESS__={version:VERSION,read,phase,progressByType,selectedReportDate};
  console.info('[CE-QC][V332_CCSL_FINAL_PROGRESS]',VERSION,'CCSL progress reads the selected report date and renders proven zero-ticket completion as green completed instead of stale 0/0 pending.');
})(window);
