(function installV308DashboardReadBridge(global){
  if(global.__CE_QC_V308_DASHBOARD_READ_BRIDGE__)return;
  const VERSION='2026-08-26-v308-nonblocking-dashboard-read-bridge-v1';
  const SPECIAL=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
  const nativeFetch=global.fetch.bind(global);
  const inFlight=new Map();
  let tableTimer=null,lastTableKey='';
  const date=v=>String(v||'').slice(0,10);
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('zh-CN'):'—';
  const pct=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':`${Number(v).toFixed(2)}%`;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function installStyle(){
    if(document.getElementById('v308DashboardStyle'))return;
    const s=document.createElement('style');s.id='v308DashboardStyle';s.textContent=`
      .v18-trend-section .v271-trend-status{display:none!important}
      #v308DeliveryDailyTable{margin-top:14px;overflow:hidden}
      #v308DeliveryDailyTable .v308-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:10px}
      #v308DeliveryDailyTable .v308-head h2{margin:0;font-size:18px;color:#123a67}
      #v308DeliveryDailyTable .v308-head p{margin:4px 0 0;color:#6f849b;font-size:12px;line-height:1.55}
      #v308DeliveryDailyTable .v308-state{padding:8px 10px;border-radius:7px;background:#eef7ff;color:#315d86;font-size:12px}
      #v308DeliveryDailyTable .v308-state.warn{background:#fff7e6;color:#8a6200}
      #v308DeliveryDailyTable .v308-state.error{background:#fff1f1;color:#a61b1b}
      #v308DeliveryDailyTable .v308-table-wrap{overflow:auto;border:1px solid #dfe9f4;border-radius:9px;background:#fff}
      #v308DeliveryDailyTable table{width:100%;min-width:1180px;border-collapse:collapse;font-size:12px}
      #v308DeliveryDailyTable th{position:sticky;top:0;background:#f4f8fc;color:#35546f;font-weight:700;white-space:nowrap}
      #v308DeliveryDailyTable th,#v308DeliveryDailyTable td{padding:10px 9px;border-right:1px solid #e5edf5;border-bottom:1px solid #e5edf5;text-align:center}
      #v308DeliveryDailyTable th:last-child,#v308DeliveryDailyTable td:last-child{border-right:0}
      #v308DeliveryDailyTable tbody tr:last-child td{border-bottom:0}
      #v308DeliveryDailyTable td:first-child,#v308DeliveryDailyTable th:first-child{text-align:left;padding-left:12px}
      #v308DeliveryDailyTable .v308-missing{color:#9aaabc}
      #v308DeliveryDailyTable .v308-foot{margin:8px 2px 0;color:#6f849b;font-size:11px;line-height:1.55}
    `;document.head.appendChild(s);
  }
  function parseUrl(raw){try{return new URL(raw,location.origin);}catch{return null;}}
  function selectedTypeFromUrl(u){return String(u?.searchParams?.get('businessType')||'').toUpperCase();}
  function rewrite(raw){
    const u=parseUrl(raw);if(!u||u.origin!==location.origin)return raw;
    const type=selectedTypeFromUrl(u);
    if((u.pathname==='/api/v263/delivery-trends'||u.pathname==='/api/v253/trends')&&SPECIAL.has(type)){
      u.pathname='/api/v308/delivery-daily';return u.pathname+u.search;
    }
    // Deep V273 reconciliation is intentionally not started by passive page viewing.
    // Generic visible trends already have V253 persisted daily facts; exports and
    // explicit reconciliation continue to use their own strict routes unchanged.
    if(u.pathname==='/api/v273/trends'){
      u.pathname='/api/v253/trends';return u.pathname+u.search;
    }
    return raw;
  }
  function methodOf(input,init){return String(init?.method||input?.method||'GET').toUpperCase();}
  function shouldCoalesce(raw){const u=parseUrl(raw);return Boolean(u&&['/api/v308/delivery-daily','/api/v253/trends','/api/v273/trends','/api/v263/delivery-trends'].includes(u.pathname));}
  function fetchShared(url,init={}){
    const key=String(url);let pending=inFlight.get(key);
    if(!pending){
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6500);
      const safeInit={...init,signal:controller.signal,cache:'no-store',credentials:init.credentials||'same-origin'};
      pending=nativeFetch(url,safeInit).finally(()=>{clearTimeout(timer);setTimeout(()=>inFlight.delete(key),300);});
      inFlight.set(key,pending);
    }
    return pending.then(response=>response.clone());
  }
  global.fetch=function v308DashboardFetch(input,init){
    try{
      if(methodOf(input,init)!=='GET')return nativeFetch(input,init);
      const raw=typeof input==='string'?input:String(input?.url||'');
      const next=rewrite(raw);
      if(!shouldCoalesce(next))return nativeFetch(input,init);
      return fetchShared(next,init||{});
    }catch{return nativeFetch(input,init);}
  };

  function activeShopeeType(){
    const title=String(document.getElementById('pageTitle')?.textContent||'').toUpperCase();
    if(title.includes('SHOPEE CN'))return'SHOPEECN';
    if(title.includes('SHOPEE VN'))return'SHOPEEVN';
    return'';
  }
  function visibleRoot(){return[...document.querySelectorAll('.app-page')].find(n=>!n.hidden&&getComputedStyle(n).display!=='none')||null;}
  function selectedRange(){
    const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
    const from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);
    return{from,to};
  }
  function cell(value,available=true,suffix=''){return available&&value!==null&&value!==undefined&&Number.isFinite(Number(value))?`${fmt(value)}${suffix}`:'<span class="v308-missing">—</span>';}
  function rateCell(value){return value===null||value===undefined||!Number.isFinite(Number(value))?'<span class="v308-missing">—</span>':pct(value);}
  function renderTable(root,type,data,rg){
    root.querySelector('#v308DeliveryDailyTable')?.remove();
    const panel=document.createElement('section');panel.id='v308DeliveryDailyTable';panel.className='v18-panel';panel.dataset.key=`${type}|${rg.from}|${rg.to}`;
    const rows=Array.isArray(data?.daily)?data.daily:[];
    const incomplete=rows.some(row=>row?.evidenceIncomplete);
    panel.innerHTML=`<div class="v308-head"><div><h2>每日派次与签收时效明细</h2><p>${type==='SHOPEECN'?'SHOPEE CN':'SHOPEE VN'} · 按日报日期逐日展示，格式统一为总票 / POD / OC / 平均签收天数 / 1、2、3派 / 证据覆盖。</p></div><div class="v308-state ${incomplete?'warn':''}">${incomplete?'部分日期证据仍在补全，未完整指标保持“—”':'当前日期范围证据已完整'}</div></div>`;
    if(!rows.length){panel.insertAdjacentHTML('beforeend','<div class="v308-state">当前所选日期范围暂无该业务日报。</div>');}
    else{
      const body=rows.map(row=>{
        const statusReady=row?.ledgerReady!==false&&row?.ready!==false;
        const attemptReady=statusReady&&row?.attemptEvidenceComplete===true;
        const signingReady=statusReady&&row?.signingEvidenceComplete===true;
        return `<tr><td>${esc(row.reportDate||'')}</td><td>${cell(row.total,true)}</td><td>${cell(row.pod,statusReady)}</td><td>${statusReady?rateCell(row.podRate):'<span class="v308-missing">—</span>'}</td><td>${cell(row.ocCurrent,statusReady)}</td><td>${statusReady?rateCell(row.ocRate):'<span class="v308-missing">—</span>'}</td><td>${signingReady&&row.avgSigningDays!=null?`${Number(row.avgSigningDays).toFixed(2)}天`:'<span class="v308-missing">—</span>'}</td><td>${cell(row.attempt1,attemptReady)}</td><td>${cell(row.attempt2,attemptReady)}</td><td>${cell(row.attempt3,attemptReady)}</td><td>${cell(row.attemptUnknown,statusReady)}</td><td>${rateCell(row.attemptCoverageRate)}</td><td>${rateCell(row.signingCoverageRate)}</td></tr>`;
      }).join('');
      panel.insertAdjacentHTML('beforeend',`<div class="v308-table-wrap"><table><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>OC</th><th>OC率</th><th>平均签收天数</th><th>1派</th><th>2派</th><th>3派+</th><th>未识别POD</th><th>派次覆盖</th><th>签收天数覆盖</th></tr></thead><tbody>${body}</tbody></table></div><div class="v308-foot">派次仍遵守70 START优先、整票无70才允许60、Pending/失败后再次START才进入下一派。1/2/3派覆盖未达到100%时最终派次列显示“—”，避免把部分证据当成完整结果；“未识别POD / 派次覆盖 / 签收天数覆盖”保留用于判断还差多少证据。</div>`);
    }
    const trend=root.querySelector('.v18-trend-section');
    const preview=root.querySelector('.v18-detail-preview');
    if(trend?.parentNode)trend.insertAdjacentElement('afterend',panel);
    else if(preview?.parentNode)preview.parentNode.insertBefore(panel,preview);
    else root.appendChild(panel);
  }
  async function loadTable(force=false){
    installStyle();const type=activeShopeeType(),root=visibleRoot(),rg=selectedRange();
    if(!type||!root||!rg.from||!rg.to||rg.from>rg.to)return;
    const key=`${type}|${rg.from}|${rg.to}`;
    if(!force&&lastTableKey===key&&root.querySelector(`#v308DeliveryDailyTable[data-key="${key}"]`))return;
    let panel=root.querySelector('#v308DeliveryDailyTable');
    if(!panel){panel=document.createElement('section');panel.id='v308DeliveryDailyTable';panel.className='v18-panel';const trend=root.querySelector('.v18-trend-section');if(trend)trend.insertAdjacentElement('afterend',panel);else root.appendChild(panel);}
    panel.innerHTML='<div class="v308-state">正在读取每日派次与签收时效明细…</div>';
    try{
      const r=await global.fetch(`/api/v308/delivery-daily?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`,{cache:'no-store',credentials:'same-origin'});
      const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}
      if(!r.ok||data?.ok===false)throw new Error(data?.error||data?.message||`HTTP ${r.status}`);
      if(activeShopeeType()!==type)return;renderTable(root,type,data,rg);lastTableKey=key;
    }catch(error){if(panel?.isConnected)panel.innerHTML=`<div class="v308-state error">每日派次与签收时效读取失败：${esc(error?.name==='AbortError'?'读取超时':error?.message||error)}。页面不会继续无限等待，可正常切换其他功能。</div>`;}
  }
  function schedule(ms=250,force=false){clearTimeout(tableTimer);tableTimer=setTimeout(()=>loadTable(force),ms);}
  function bind(){installStyle();schedule(500,true);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery')){schedule(300,true);setTimeout(()=>schedule(0,true),1000);}},true);
    document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(300,true);},true);
    global.addEventListener('ce:exact-date-loaded',()=>schedule(80,true));global.addEventListener('popstate',()=>schedule(300,true));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V308_DASHBOARD_READ_BRIDGE__={version:VERSION,nativeFetch,rewrite,loadTable};
  console.info('[CE-QC][V308_DASHBOARD_READ_BRIDGE]',VERSION,'duplicate trend GETs are coalesced; passive V263/V273 deep reads are replaced by lightweight persisted reads; Shopee CN/VN gets a daily attempt/signing table with visible coverage diagnostics.');
})(window);
