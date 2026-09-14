(function installV508CanonicalBusinessExportRoute(global){
  const VERSION='2026-09-13-v508-canonical-business-export-route-v2-pathname';
  if(global.__CE_QC_V508_CANONICAL_BUSINESS_EXPORT_ROUTE__===VERSION)return;
  global.__CE_QC_V508_CANONICAL_BUSINESS_EXPORT_ROUTE__=VERSION;

  const EXACT_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
  const CCSL_PAGES=new Set(['ce','ceaf','tbkh','ali1688','whpp']);
  const SHOPEE_PAGES=new Set(['shopeecn','shopeevn']);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function pageName(){
    // app.js declares currentPage with top-level `let`, so it is not guaranteed
    // to exist as window.currentPage in a classic script. Route pathname is the
    // durable public page identity and prevents static CCSL/SHOPEE header buttons
    // from accidentally falling back to aggregate snapshot export.
    try{
      const route=String(global.location?.pathname||'').replace(/^\/+|\/+$/g,'').trim().toLowerCase();
      if(route)return route;
    }catch{}
    try{return String(global.currentPage||'').trim().toLowerCase();}catch{return '';}
  }
  function requestedExactType(requested){
    const input=String(requested||'').trim().toUpperCase();
    if(EXACT_TYPES.has(input))return input;
    const page=pageName();
    const shouldResolveCurrent=(input==='CCSL'&&CCSL_PAGES.has(page))||(input==='SHOPEE'&&SHOPEE_PAGES.has(page));
    if(shouldResolveCurrent&&typeof global.currentBusinessType==='function'){
      try{
        const current=String(global.currentBusinessType()||'').trim().toUpperCase();
        if(EXACT_TYPES.has(current))return current;
      }catch{}
    }
    return '';
  }
  function ensureBusinessOptions(){
    const select=document.getElementById('periodExportBusiness');
    if(!select)return null;
    const wanted=[
      ['ALL','管理汇总 + 七业务'],['CE','仅CE'],['CEAF','仅CEAF空运'],['TBKH','仅TBKH'],['ALI1688','仅ALI1688'],
      ['SHOPEECN','仅SHOPEE CN'],['SHOPEEVN','仅SHOPEE VN'],['WHPP','仅WHPP']
    ];
    const existing=new Map([...select.options].map(option=>[String(option.value||'').toUpperCase(),option]));
    for(const [value,label] of wanted){
      const found=existing.get(value);
      if(found){found.textContent=label;continue;}
      const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);
    }
    return select;
  }
  function selectedReportDate(){
    const candidates=[
      document.getElementById('topHistoryDate')?.value,
      document.getElementById('periodExportDate')?.value,
      document.getElementById('dashboardRangeTo')?.value,
      document.getElementById('topRangeTo')?.value
    ];
    return candidates.map(value=>String(value||'').slice(0,10)).find(value=>/^\d{4}-\d{2}-\d{2}$/.test(value))||'';
  }
  async function latestSavedReportDate(){
    const selected=selectedReportDate();
    if(selected)return selected;
    try{
      const response=await fetch('/api/import/unified-latest?compact=1',{cache:'no-store',credentials:'same-origin'});
      const payload=await response.json();
      const date=String(payload?.import?.reportDate||'').slice(0,10);
      if(response.ok&&/^\d{4}-\d{2}-\d{2}$/.test(date))return date;
    }catch{}
    return '';
  }
  async function waitForV473Owner(){
    for(let attempt=0;attempt<40;attempt+=1){
      const owner=global.__CE_QC_V473_EXPORT_UI__;
      if(owner&&typeof owner.startExport==='function')return owner;
      await sleep(50);
    }
    throw Object.assign(new Error('V473独立导出服务界面未加载，已阻止回退到旧版快照导出。请刷新页面后重试。'),{code:'V508_V473_OWNER_UNAVAILABLE'});
  }
  function selectDailyBusiness(type,date){
    const select=ensureBusinessOptions();
    if(!select)throw new Error('报表导出业务选择器不存在。');
    const dailyTab=[...document.querySelectorAll('.period-tab')].find(button=>String(button.dataset?.period||'')==='daily')||null;
    if(typeof global.setExportPeriod==='function')global.setExportPeriod('daily',dailyTab);
    else document.querySelectorAll('.period-tab').forEach(button=>button.classList.toggle('active',button===dailyTab));
    const dateInput=document.getElementById('periodExportDate');
    if(!dateInput)throw new Error('报表导出日期控件不存在。');
    dateInput.value=date;
    select.value=type;
    if(select.value!==type)throw new Error(`报表导出业务选择失败：${type}`);
  }
  async function startCanonicalBusinessExport(type){
    const date=await latestSavedReportDate();
    if(!date)throw new Error('未找到可导出的已保存日报日期。');
    if(typeof global.navigatePage==='function')global.navigatePage('reports');
    await sleep(0);
    selectDailyBusiness(type,date);
    const owner=await waitForV473Owner();
    const button=document.querySelector('[data-testid="export-all-reports"]');
    if(!button)throw new Error('独立报表导出按钮不存在。');
    if(button.disabled)throw new Error('已有报表导出任务正在运行，请等待当前任务完成。');
    return owner.startExport(button);
  }

  const legacyExportBusiness=typeof global.exportBusiness==='function'?global.exportBusiness:null;
  global.exportBusiness=async function v508ExportBusiness(requestedType){
    const exactType=requestedExactType(requestedType);
    if(exactType){
      try{return await startCanonicalBusinessExport(exactType);}
      catch(error){alert(`导出失败：${error?.message||error}`);return;}
    }
    // CCSL/SHOPEE aggregate snapshot exporters are legacy paths that do not own
    // the latest V419/V246 canonical ledger truth. Never silently fall back to
    // them after a manual refresh. Move the operator to the V473 selector instead.
    const legacy=String(requestedType||'').trim().toUpperCase();
    if(legacy==='CCSL'||legacy==='SHOPEE'){
      try{if(typeof global.navigatePage==='function')global.navigatePage('reports');ensureBusinessOptions();}catch{}
      const message='综合旧版快照导出已停用。请在“报表导出”选择具体业务或“管理汇总 + 七业务”，再使用V473独立完整导出。';
      const progress=document.getElementById('exportProgressV194')||document.getElementById('exportProgress')||null;
      if(progress)progress.textContent=message;
      alert(message);
      return;
    }
    if(legacyExportBusiness)return legacyExportBusiness(requestedType);
    alert(`不支持的导出业务：${legacy||'空业务'}`);
  };

  ensureBusinessOptions();
  new MutationObserver(ensureBusinessOptions).observe(document.body,{childList:true,subtree:true});
  console.info('[CE-QC][V508_CANONICAL_BUSINESS_EXPORT_ROUTE]',VERSION,'all exact business export buttons route to V473/V200 canonical latest-state export; legacy CCSL/SHOPEE snapshot exporters fail closed.');
})(window);
