(function installWhppRetryAwareCompatV135(global){
  if(global.__CE_QC_V135_WHPP_RETRY_RUN__)return;

  const VERSION='2026-08-29-v340-whpp-retry-ui-compat-v1';
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
    banner.innerHTML=`<b>WHPP快照已生成</b><span>${retry.toLocaleString('zh-CN')}票接口暂时失败，断点已保留；使用统一“继续处理”即可只补偿未完成票。</span>`;
    heading.insertAdjacentElement('afterend',banner);
  }

  async function refreshBanner(){
    try{retryBanner(await summary());}catch{}
  }

  // V340 intentionally does NOT wrap runUnified/resumeUnified and does NOT
  // start WHPP itself. V67 is the only owner of CCSL -> SHOPEE -> WHPP.
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(refreshBanner,120));
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('.side-link[data-page="whpp"]'))setTimeout(refreshBanner,120);
  },true);
  [250,900].forEach(ms=>setTimeout(refreshBanner,ms));

  global.__CE_QC_V135_WHPP_RETRY_RUN__={
    version:VERSION,
    compatibilityOnly:true,
    authoritativeRunner:'V67',
    canonicalSummary:'/api/v132/whpp-fast-summary',
    fetchSummary:summary,
    selectedDate,
    refreshBanner
  };
  console.info('[CE-QC][V340_WHPP_RETRY_COMPAT]',VERSION,'No duplicate runner; V67 owns WHPP execution.');
})(window);
