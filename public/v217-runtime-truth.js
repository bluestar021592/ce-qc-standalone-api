(function installV217RuntimeTruth(global){
  'use strict';
  if(global.__CE_QC_V217_RUNTIME_TRUTH__)return;
  const VERSION='2026-08-19-v217-runtime-truth-recovery-v1';
  const WHPP_CACHE_KEY='ce_qc_v132_whpp_fast_summary';
  const BUSINESS_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
  let recoverBusy=false;
  let lastRecoverAt=0;
  let whppBusy=false;
  let whppDate='';
  let whppSummary=null;
  let originalWhppNavigate=null;
  let timer=null;

  const text=node=>String(node?.textContent||'').trim();
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||'').slice(0,10));
  const dateOnly=value=>validDate(value)?String(value).slice(0,10):'';
  const num=value=>{const n=Number(String(value??'').replace(/[,%\s]/g,''));return Number.isFinite(n)?n:0;};
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const pct=(value,total)=>total?`${(Number(value||0)*100/Number(total)).toFixed(2)}%`:'0.00%';

  async function jsonFetch(url,timeoutMs=4500){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const raw=await response.text();
      let payload={};try{payload=raw?JSON.parse(raw):{};}catch{}
      if(!response.ok||payload?.ok===false)throw new Error(payload?.error||payload?.message||`HTTP ${response.status}`);
      return payload;
    }finally{clearTimeout(timeout);}
  }

  function currentAuthoritativeDate(){
    const dom=[document.getElementById('topRangeTo')?.value,document.getElementById('dashboardRangeTo')?.value].map(dateOnly).find(Boolean);
    if(dom)return dom;
    try{const selected=dateOnly(typeof historyModeDate!=='undefined'?historyModeDate:'');if(selected)return selected;}catch{}
    try{
      const imported=(typeof unifiedImportState!=='undefined'&&unifiedImportState)?unifiedImportState:null;
      const status=String(imported?.snapshotStatus||imported?.status||'').toUpperCase();
      if(dateOnly(imported?.reportDate)&&(!status||status.startsWith('COMPLETED')))return dateOnly(imported.reportDate);
    }catch{}
    try{const value=dateOnly(typeof appState!=='undefined'?appState?.reportDate:'');if(value)return value;}catch{}
    try{const value=dateOnly(typeof shopeeState!=='undefined'?shopeeState?.reportDate:'');if(value)return value;}catch{}
    return '';
  }

  function latestCompletedHistoryDate(rows=[]){
    return [...(Array.isArray(rows)?rows:[])]
      .filter(row=>dateOnly(row?.reportDate)&&String(row?.snapshotStatus||row?.status||'').toUpperCase().startsWith('COMPLETED'))
      .sort((a,b)=>String(b.reportDate).localeCompare(String(a.reportDate)))[0]||null;
  }

  function setDefaultDate(date){
    if(!validDate(date))return;
    try{if(typeof historyModeDate!=='undefined'&&!dateOnly(historyModeDate))historyModeDate=date;}catch{}
    for(const id of ['topRangeFrom','topRangeTo','dashboardRangeFrom','dashboardRangeTo']){
      const input=document.getElementById(id);if(input&&!dateOnly(input.value))input.value=date;
    }
  }

  function assignRuntime(name,value){
    try{
      if(name==='appState'&&typeof appState!=='undefined'){appState=value;return true;}
      if(name==='shopeeState'&&typeof shopeeState!=='undefined'){shopeeState=value;return true;}
      if(name==='unifiedImportState'&&typeof unifiedImportState!=='undefined'){unifiedImportState=value;return true;}
      if(name==='accessSession'&&typeof accessSession!=='undefined'){accessSession=value;return true;}
    }catch{}
    return false;
  }

  function patchIdentity(){
    let user=null;try{user=typeof accessSession!=='undefined'?accessSession?.user:null;}catch{}
    if(!user)return;
    const display=String(user.displayName||user.username||user.email||'').trim();
    if(!display)return;
    const roleName=String(user.role||'VIEWER').trim();
    const department=String(user.department||user.departmentCompany||'质控部').trim();
    const name=document.getElementById('headerUserName');if(name)name.textContent=display;
    const role=document.getElementById('headerUserRole');if(role)role.textContent=`${department} · ${roleName}`;
    const account=document.getElementById('currentAccountSummary');if(account)account.textContent=`${display} · ${roleName}`;
  }

  function patchNetwork(){
    const target=document.getElementById('networkAccessCards');if(!target)return;
    let network={};try{network=(typeof appState!=='undefined'&&appState?.network)||{};}catch{}
    const current=location.origin;
    const localUrl=String(network.localUrl||current).trim();
    const lan=String(network.lanUrl||'').trim()||'未检测到局域网地址';
    const publicUrl=String(network.publicUrl||'').trim();
    const publicText=network.publicConfigured&&publicUrl?publicUrl:(publicUrl?`${publicUrl}（待完成DNS/Cloudflare）`:'公网尚未配置');
    target.innerHTML=`<div class="access-address-list"><div><span>本机访问</span><b>${esc(localUrl)}</b></div><div><span>同一局域网访问</span><b>${esc(lan)}</b></div><div><span>不同网络 / 外地访问</span><b>${esc(publicText)}</b></div></div><p class="operation-status">以上地址来自当前运行中的5177服务，不再停留在“正在读取”。</p>`;
  }

  function cardByLabel(grid,label){return [...(grid?.querySelectorAll?.('.v18-business-card')||[])].find(card=>text(card.querySelector('span'))===label)||null;}
  function ensureWhppCard(grid){
    let card=cardByLabel(grid,'WHPP本土');
    if(card)return card;
    card=document.createElement('button');card.type='button';card.className='v18-business-card cyan';card.dataset.v217Business='WHPP';
    card.innerHTML='<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';
    card.addEventListener('click',()=>global.navigateWhppPage?.());
    const cn=cardByLabel(grid,'SHOPEE CN');if(cn)grid.insertBefore(card,cn);else grid.appendChild(card);
    return card;
  }

  function reorderHomeCards(grid){
    const order=['总览','CE','CEAF空运','TBKH','ALI1688','WHPP本土','SHOPEE CN','SHOPEE VN'];
    for(const label of order){const card=cardByLabel(grid,label);if(card)grid.appendChild(card);}
  }

  function recomputeHomeTotals(grid,whppValue=0){
    const whpp=ensureWhppCard(grid);const b=whpp.querySelector('b');if(b)b.textContent=fmt(whppValue);
    const labels=['CE','CEAF空运','TBKH','ALI1688','WHPP本土','SHOPEE CN','SHOPEE VN'];
    const total=labels.reduce((sum,label)=>sum+num(cardByLabel(grid,label)?.querySelector('b')?.textContent),0);
    const totalCard=cardByLabel(grid,'总览');if(totalCard){const n=totalCard.querySelector('b');if(n)n.textContent=fmt(total);const em=totalCard.querySelector('em');if(em)em.textContent='占总票数 100.00%';}
    for(const label of labels){const card=cardByLabel(grid,label);if(!card)continue;const value=num(card.querySelector('b')?.textContent);const em=card.querySelector('em');if(em)em.textContent=`占总票数 ${pct(value,total)}`;}
    reorderHomeCards(grid);
    const title=document.querySelector('#homePage .v18-core>h2');
    if(title)title.innerHTML='核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688；WHPP本土与 SHOPEE CN/VN 保持独立业务口径</small>';
  }

  async function patchHomeWhpp(force=false){
    const home=document.getElementById('homePage');if(!home||home.hidden)return;
    const grid=home.querySelector('.v18-business-grid');if(!grid)return;
    const date=currentAuthoritativeDate();
    if(!date){
      try{localStorage.removeItem(WHPP_CACHE_KEY);}catch{}
      whppDate='';whppSummary=null;recomputeHomeTotals(grid,0);return;
    }
    if(!force&&whppSummary&&whppDate===date){recomputeHomeTotals(grid,num(whppSummary?.metrics?.total??whppSummary?.total));return;}
    if(whppBusy)return;whppBusy=true;
    try{
      const payload=await jsonFetch(`/api/v132/whpp-fast-summary?reportDate=${encodeURIComponent(date)}`);
      const returnedDate=dateOnly(payload?.reportDate);
      if(returnedDate&&returnedDate!==date)throw new Error(`WHPP返回日期${returnedDate}与当前日报${date}不一致`);
      whppDate=date;whppSummary=payload;recomputeHomeTotals(grid,num(payload?.metrics?.total??payload?.total));
    }catch(error){
      console.warn('[V217][WHPP_HOME]',error);whppDate=date;whppSummary=null;recomputeHomeTotals(grid,0);
    }finally{whppBusy=false;}
  }

  function showWhppNoDate(push=true){
    try{localStorage.removeItem(WHPP_CACHE_KEY);}catch{}
    let page=document.getElementById('whppFastPage');
    if(!page){page=document.createElement('section');page.id='whppFastPage';page.className='app-page v18-dashboard-page v18-business-page';document.querySelector('main.main-content')?.appendChild(page);}
    document.querySelectorAll('.app-page').forEach(node=>{node.hidden=node!==page;node.classList.toggle('active',node===page);});
    document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));
    try{if(typeof currentPage!=='undefined')currentPage='whpp';}catch{}
    const title=document.getElementById('pageTitle');if(title)title.textContent='WHPP本土看板';
    if(push&&location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');
    page.innerHTML='<section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>当前没有已确认的日报日期，历史缓存已禁止作为当前数据展示。</p></div></section><section class="v18-business-grid"><button class="v18-business-card purple"><span>WHPP本土</span><small>今日票数</small><b>0</b><em>占本业务 100.00%</em></button></section><section class="v18-panel"><div class="empty-state">请先选择已有日报日期，或完成日报导入后再查看WHPP。</div></section>';
  }

  function wrapWhppNavigation(){
    if(global.navigateWhppPage?.__v217Wrapped)return;
    originalWhppNavigate=typeof global.navigateWhppPage==='function'?global.navigateWhppPage:null;
    const wrapped=function(push=true){
      const date=currentAuthoritativeDate();
      if(!date){showWhppNoDate(push);return;}
      setDefaultDate(date);
      if(originalWhppNavigate)return originalWhppNavigate(push);
      if(typeof global.navigatePage==='function')return global.navigatePage('whpp');
      location.href='/whpp';
    };
    wrapped.__v217Wrapped=true;global.navigateWhppPage=wrapped;
  }

  async function recoverRuntimeTruth(force=false){
    if(recoverBusy||(!force&&Date.now()-lastRecoverAt<30000))return;
    recoverBusy=true;lastRecoverAt=Date.now();
    try{
      const [ccslResult,shopeeResult,historyResult,latestResult,sessionResult]=await Promise.allSettled([
        jsonFetch('/api/state?compact=1'),
        jsonFetch('/api/shopee/state?compact=1'),
        jsonFetch('/api/unified-history'),
        jsonFetch('/api/import/unified-latest?compact=1'),
        jsonFetch('/api/session')
      ]);
      const ccsl=ccslResult.status==='fulfilled'?ccslResult.value:null;
      const shopee=shopeeResult.status==='fulfilled'?shopeeResult.value:null;
      const history=historyResult.status==='fulfilled'?historyResult.value:null;
      const latest=latestResult.status==='fulfilled'?latestResult.value:null;
      const session=sessionResult.status==='fulfilled'?sessionResult.value:null;
      if(ccsl?.state)assignRuntime('appState',ccsl.state);
      if(shopee?.state)assignRuntime('shopeeState',shopee.state);
      if(latest?.import)assignRuntime('unifiedImportState',latest.import);
      if(session?.user)assignRuntime('accessSession',session);
      try{
        if(typeof historyCatalog!=='undefined'&&Array.isArray(history?.rows))historyCatalog={...(historyCatalog||{}),UNIFIED:history.rows};
      }catch{}

      const completed=latestCompletedHistoryDate(history?.rows||[]);
      let date=currentAuthoritativeDate()||dateOnly(completed?.reportDate);
      const snapshotId=String(completed?.snapshotId||'').trim();
      if(date)setDefaultDate(date);

      const businessRequests=BUSINESS_TYPES.map(type=>jsonFetch(`/api/business-state/${encodeURIComponent(type)}?compact=1${snapshotId?`&snapshotId=${encodeURIComponent(snapshotId)}`:''}`,5000));
      const businessResults=await Promise.allSettled(businessRequests);
      try{
        if(typeof businessStates!=='undefined'){
          for(let i=0;i<BUSINESS_TYPES.length;i+=1){const item=businessResults[i];if(item.status==='fulfilled'&&item.value?.state)businessStates[BUSINESS_TYPES[i]]=item.value.state;}
        }
      }catch{}

      try{if(typeof global.renderAll==='function')global.renderAll();}catch(error){console.warn('[V217][RENDER]',error);}
      patchIdentity();patchNetwork();wrapWhppNavigation();await patchHomeWhpp(true);
      console.info('[CE-QC][V217_RUNTIME_TRUTH] recovered',{date:currentAuthoritativeDate(),ccsl:dateOnly(ccsl?.state?.reportDate),shopee:dateOnly(shopee?.state?.reportDate),completedHistory:dateOnly(completed?.reportDate)});
    }catch(error){console.warn('[V217][RECOVER]',error);patchIdentity();patchNetwork();wrapWhppNavigation();await patchHomeWhpp(false);}
    finally{recoverBusy=false;}
  }

  function compactDiagnostics(){
    const exact=new Set(['轨迹证据 / 状态闭环完整性','历史日报清洁重建 / 防漏票底账','原始日报永久归档 / 可重建保障','历史数据完整性 / 导出安全检查']);
    const panels=[];
    for(const heading of document.querySelectorAll('h2,h3')){
      if(!exact.has(text(heading)))continue;
      const panel=heading.closest('section.panel,section,article.panel,article');if(panel&&!panels.includes(panel))panels.push(panel);
    }
    if(!panels.length)return;
    let host=document.getElementById('v217AdvancedDiagnostics');
    if(!host){const first=panels[0];host=document.createElement('details');host.id='v217AdvancedDiagnostics';host.className='panel';host.style.margin='12px 0';host.innerHTML='<summary style="cursor:pointer;font-weight:700;padding:14px 16px;color:#183b63">高级数据校验（需要时展开）</summary><div id="v217AdvancedDiagnosticsBody" style="padding:0 12px 12px"></div>';first.parentNode?.insertBefore(host,first);}
    const body=document.getElementById('v217AdvancedDiagnosticsBody');if(body)for(const panel of panels)if(panel.parentNode!==body)body.appendChild(panel);
  }

  function schedule(delay=120){clearTimeout(timer);timer=setTimeout(()=>{patchIdentity();patchNetwork();wrapWhppNavigation();compactDiagnostics();void patchHomeWhpp(false);},delay);}

  function install(){
    wrapWhppNavigation();
    compactDiagnostics();
    void recoverRuntimeTruth(true);
    setTimeout(()=>void recoverRuntimeTruth(true),1800);
    global.addEventListener('popstate',()=>schedule(80));
    document.addEventListener('ce-qc-run-complete',()=>{setTimeout(()=>void recoverRuntimeTruth(true),300);});
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('[data-page="home"],#topRangeQuery,#dashboardRangeTo,#dashboardRangeFrom'))setTimeout(()=>void patchHomeWhpp(true),250);
      if(event.target?.closest?.('[data-page="settings"]'))setTimeout(()=>{patchIdentity();patchNetwork();},250);
    },true);
    global.__CE_QC_V217_RUNTIME_TRUTH__={version:VERSION,recoverRuntimeTruth,patchHomeWhpp,currentAuthoritativeDate,patchNetwork,patchIdentity};
    console.info('[CE-QC][V217_RUNTIME_TRUTH]',VERSION,'persisted state recovery enabled; stale WHPP fallback blocked.');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
