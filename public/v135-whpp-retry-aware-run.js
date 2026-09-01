(function installWhppRetryAwareCompatV135(global){
  if(global.__CE_QC_V135_WHPP_RETRY_RUN__)return;

  const VERSION='2026-09-01-v403-whpp-retry-center-guidance-v1';
  const normalizeDate=value=>{const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};

  function selectedDate(){
    const runnerDate=normalizeDate(global.__CE_QC_V67_RESILIENT_RUN_GUARD__?.targetDate?.());
    if(runnerDate)return runnerDate;
    const input=normalizeDate(document.getElementById('reportDate')?.value);
    if(input)return input;
    const dom=normalizeDate(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
    if(dom)return dom;
    try{return normalizeDate(unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'');}catch{return '';}
  }

  async function jsonFetch(url){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
    const text=await response.text();
    let payload={};
    try{payload=text?JSON.parse(text):{};}catch{}
    if(!response.ok||payload?.ok===false)throw new Error(payload.error||payload.message||`HTTP ${response.status}`);
    return payload;
  }

  async function summary(){
    const date=selectedDate();
    return jsonFetch(`/api/v132/whpp-fast-summary${date?`?reportDate=${encodeURIComponent(date)}`:''}`);
  }

  function retryCount(value){return Number(value?.metrics?.retryPending||value?.state?.metrics?.retryPending||0);}

  function retryBanner(value){
    const page=document.getElementById('whppFastPage');
    if(!page)return;
    page.querySelector('.v135-whpp-retry-banner')?.remove();
    const retry=retryCount(value);
    const completed=Boolean(value?.completed===true||value?.state?.completed===true);
    if(!completed||retry<=0)return;
    const heading=page.querySelector('.v18-page-heading');
    if(!heading)return;
    const banner=document.createElement('div');
    banner.className='processing-notice warning v135-whpp-retry-banner';
    banner.innerHTML=`<b>WHPP正式快照已完成</b><span>${retry.toLocaleString('zh-CN')}票接口暂时失败，失败票由“七业务接口失败 / 失效重试中心”独立自动补偿；无需、也不应重新启动七业务处理。若CE授权失效，请仅在重试中心重新登录后继续补偿。</span>`;
    heading.insertAdjacentElement('afterend',banner);
  }

  async function refreshBanner(){
    try{retryBanner(await summary());}catch{}
  }

  // V403: completed/retry-pending is still a completed WHPP lifecycle. V169 is
  // therefore correct to lock runUnified/resumeUnified. Failed API tickets are
  // recovered separately by V145; V135 remains display-only and never starts a
  // business run or retry job itself.
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(refreshBanner,120));
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('.side-link[data-page="whpp"]'))setTimeout(refreshBanner,120);
  },true);
  [250,900].forEach(ms=>setTimeout(refreshBanner,ms));

  global.__CE_QC_V135_WHPP_RETRY_RUN__={
    version:VERSION,
    compatibilityOnly:true,
    displayOnly:true,
    authoritativeRunner:'V67',
    retryOwner:'V145',
    canonicalSummary:'/api/v132/whpp-fast-summary',
    fetchSummary:summary,
    selectedDate,
    refreshBanner
  };
  console.info('[CE-QC][V403_WHPP_RETRY_GUIDANCE]',VERSION,'Completed WHPP stays locked; V145 independently owns failed-ticket compensation.');
})(window);
