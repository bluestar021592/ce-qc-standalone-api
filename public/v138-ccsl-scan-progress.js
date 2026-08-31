(function installV138CcslScanProgress(global){
  if(global.__CE_QC_V138_CCSL_SCAN_PROGRESS__)return;
  const VERSION='2026-08-29-v341-ccsl-progress-owner-guard-v1';
  const V385_DETAIL_OWNER_RELEASE='2026-08-31-v385-release-stale-v67-detail-owner-v1';
  const V393_FAILURE_VISIBILITY='2026-08-31-v393-preserve-unified-failure-detail-v1';
  const POLL_MS=1000;
  const progressByType=new Map();
  let polling=false;

  global.__CE_QC_V96_V67_LIVE_PROGRESS_BRIDGE__=true;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const normalizeDate=value=>{const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
  const selectedReportDate=()=>normalizeDate(document.getElementById('reportDate')?.value||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');

  function releaseV67Owner(node){
    if(!node)return;
    delete node.dataset.v67UnifiedOwner;
    delete node.dataset.v67UnifiedReportDate;
  }

  function unifiedOwnsLegacyStatus(node){
    if(!node)return false;
    const stage=global.__CE_QC_UNIFIED_RUN_STAGE__;
    if(stage?.owner==='V67'){
      const type=String(stage.type||'').toUpperCase();
      if(stage.active===true){
        return type!=='CCSL';
      }
      // A completed/failed handoff is not stale CCSL detail. In particular, a
      // SHOPEE start error used to be overwritten within 250ms by the canonical
      // CCSL-completed renderer, hiding the real reason the three-stage runner
      // stopped. Preserve V67 terminal failure/error ownership until the next
      // explicit run changes the stage; successful DONE may return to CCSL detail.
      if(type==='FAILED'||type==='ERROR')return true;
      releaseV67Owner(node);
      return false;
    }
    if(node.dataset.v67UnifiedOwner==='1')releaseV67Owner(node);
    return false;
  }

  const statusText=progress=>{
    const status=String(progress?.runStatus||'').toLowerCase();
    if(progress?.noDaily===true)return '无日报';
    if(progress?.complete===true||progress?.zeroTicketDay===true)return '已完成';
    if(progress?.running)return '正在处理';
    if(progress?.paused||status==='paused')return '已暂停';
    if(status==='finished'||status==='completed')return '已完成';
    if(status.includes('retry')||status==='failed')return '待重试';
    return '待处理';
  };

  async function postJson(url,body){
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{}),cache:'no-store',credentials:'same-origin'});
    if(!response.ok)return null;
    const value=await response.json();
    return value?.ok===false?null:value;
  }

  async function canonicalCcsl(reportDate){
    try{return await postJson('/api/v317/ccsl-recovery',{action:'status',reportDate:reportDate||''});}catch{return null;}
  }

  function canonicalProgress(truth,reportDate){
    if(!truth)return null;
    const target=normalizeDate(truth.reportDate||reportDate);
    if(truth.dailyExists===false||String(truth.action||'').toUpperCase()==='NO_DAILY'){
      return {ok:true,businessType:'CCSL',reportDate:target,noDaily:true,canonicalTruth:true,complete:false,running:false,paused:false,runStatus:'no_daily',phase:'无需处理',scanDone:0,scanTotal:0,trackDone:0,trackTotal:0};
    }
    if(truth.complete===true||truth.zeroTicketDay===true){
      return {ok:true,businessType:'CCSL',reportDate:target,canonicalTruth:true,complete:true,zeroTicketDay:Boolean(truth.zeroTicketDay),running:false,paused:false,runStatus:'completed',phase:'已完成',sourceTotal:Number(truth.sourceTotal||0),scanDone:0,scanTotal:0,trackDone:0,trackTotal:0};
    }
    return null;
  }

  async function read(type='CCSL'){
    try{
      const normalizedType=String(type||'CCSL').toUpperCase();
      const reportDate=normalizedType==='CCSL'?selectedReportDate():'';
      if(normalizedType==='CCSL'){
        const truth=await canonicalCcsl(reportDate);
        const resolved=canonicalProgress(truth,reportDate);
        if(resolved){progressByType.set('CCSL',resolved);return resolved;}
      }
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
    if(/扫描|scan|order/i.test(raw))return {label:'订单扫描',done:Number(progress.scanDone||0),retry:Number(progress.scanRetry||0),observed:Number(progress.scanObserved||0),total:Number(progress.scanTotal||0),batchMax:350};
    if(/轨迹|track/i.test(raw))return {label:'轨迹查询',done:Number(progress.trackDone||0),retry:Number(progress.trackRetry||0),observed:Number(progress.trackObserved||0),total:Number(progress.trackTotal||0),batchMax:50};
    return {label:raw||'准备处理',done:Number(progress.done||0),retry:Number(progress.retry||0),observed:Number(progress.done||0)+Number(progress.retry||0),total:Number(progress.total||0),batchMax:0};
  }

  function finalMarkup(progress={}){
    const status=statusText(progress);
    if(progress?.noDaily===true){
      return '<span class="status-pill muted">CCSL 无日报</span>'
        +'<p>当前阶段：无需处理</p>'
        +'<p>所选日期没有CCSL有效日报/票据，不创建订单扫描或轨迹查询任务。</p>';
    }
    if(progress?.complete===true&&progress?.canonicalTruth===true){
      const reason=progress?.zeroTicketDay===true
        ?'当日有效日报CCSL为0票，无需启动订单扫描或轨迹查询。'
        :'CCSL当日处理真值已完成，无需重复建立处理任务。';
      return '<span class="status-pill success">CCSL 已完成</span>'
        +'<p>当前阶段：已完成</p>'
        +`<p>${reason}</p>`;
    }
    if(progress?.zeroTicketDay===true&&status==='已完成'){
      return `<span class="status-pill success">${esc(progress.businessType||'CCSL')} 已完成</span>`
        +'<p>当前阶段：已完成</p>'
        +'<p>当日有效日报CCSL为0票，无需启动订单扫描或轨迹查询。</p>';
    }
    const failed=Number(progress.scanRetry||0)+Number(progress.trackRetry||0);
    const skipped=Number(progress.podLockSkipped||0);
    const pillClass=status==='已完成'?'success':(status==='待重试'?'warning':'warning');
    return `<span class="status-pill ${pillClass}">${esc(progress.businessType||'CCSL')} ${esc(status)}</span>`
      +`<p>当前阶段：${esc(status==='已完成'?'已完成':(progress.phase||status))}</p>`
      +`<p>订单扫描：成功 ${fmt(progress.scanDone)} / ${fmt(progress.scanTotal)}${Number(progress.scanRetry||0)?` · 待重试 ${fmt(progress.scanRetry)}`:''} · 单批最大350</p>`
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
    const scanHint=p.label==='订单扫描'?'<p class="muted">当日日报与历史跨日遗留已分离；CE订单扫描固定350票/批，轨迹查询固定50票/批；失败票按限时失败前进机制进入补偿重试，不阻塞后续批次。</p>':'';
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
    if(status&&unifiedOwnsLegacyStatus(status))return;
    if(status){status.innerHTML=markup(progress);status.dataset.v334ProgressState=statusText(progress)==='已完成'?'done':(progress.noDaily?'no-daily':'active');}
    if(button&&button.disabled&&progress.running){
      const p=phase(progress);
      button.textContent=`${progress.businessType||'CCSL'} ${p.label} ${p.done}/${p.total}${p.retry?` · 重试${p.retry}`:''}`;
    }
  }

  function installStaticMarkupBridge(){
    const original=global.runStatusMarkup;
    if(typeof original!=='function'||original.__v334TruthfulProgress)return;
    const wrapped=function(state){
      const stage=global.__CE_QC_UNIFIED_RUN_STAGE__;
      if(stage?.owner==='V67'&&stage.active===true&&String(stage.type||'').toUpperCase()!=='CCSL')return original.apply(this,arguments);
      const type=String(state?.businessType||'CCSL').toUpperCase()==='SHOPEE'?'SHOPEE':'CCSL';
      const live=progressByType.get(type);
      const sameDate=!live?.reportDate||!state?.reportDate||String(live.reportDate)===String(state.reportDate);
      if((live?.canonicalTruth||live?.noDaily||live?.runId||live?.complete===true||live?.zeroTicketDay===true)&&sameDate)return markup(live);
      return original.apply(this,arguments);
    };
    wrapped.__v334TruthfulProgress=true;
    global.runStatusMarkup=wrapped;
  }

  const renderable=value=>Boolean(value&&(value.canonicalTruth||value.noDaily||value.running===true||value.complete===true||value.zeroTicketDay===true||value.runId));

  async function tick(){
    installStaticMarkupBridge();
    const page=document.getElementById('importPage');
    if(polling||!page||page.hidden)return;
    polling=true;
    try{
      const ccsl=await read('CCSL');
      if(renderable(ccsl))render(ccsl);
    }finally{polling=false;}
  }

  function enforceLastTruth(){
    installStaticMarkupBridge();
    const page=document.getElementById('importPage');
    const live=progressByType.get('CCSL');
    if(page&&!page.hidden&&renderable(live))render(live);
  }

  function install(){
    installStaticMarkupBridge();
    setInterval(tick,POLL_MS);
    setInterval(enforceLastTruth,250);
    [100,450,1200].forEach(ms=>setTimeout(tick,ms));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  global.__CE_QC_V138_CCSL_SCAN_PROGRESS__={version:VERSION,detailOwnerRelease:V385_DETAIL_OWNER_RELEASE,failureVisibility:V393_FAILURE_VISIBILITY,read,canonicalCcsl,phase,progressByType,selectedReportDate,enforceLastTruth,unifiedOwnsLegacyStatus,releaseV67Owner};
  console.info('[CE-QC][V341_CCSL_DETAIL_OWNER]',VERSION,V385_DETAIL_OWNER_RELEASE,V393_FAILURE_VISIBILITY,'CCSL progress keeps 350/50 detail; active non-CCSL V67 ownership and terminal V67 failures are never overwritten by CCSL detail. Successful/inactive ownership is released so canonical CCSL detail can refresh normally.');
})(window);