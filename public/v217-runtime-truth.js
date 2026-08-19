(function installV219RuntimeStability(global){
  'use strict';
  if(global.__CE_QC_V219_RUNTIME_STABILITY__)return;
  const VERSION='2026-08-19-v221-passive-runtime-cleanup-v2';
  const WHPP_CACHE_KEY='ce_qc_v132_whpp_fast_summary';
  let patchTimer=null;

  const dateOnly=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||'').slice(0,10))?String(value).slice(0,10):'';
  function currentDate(){
    const dom=[document.getElementById('topRangeTo')?.value,document.getElementById('dashboardRangeTo')?.value].map(dateOnly).find(Boolean);
    if(dom)return dom;
    try{const value=dateOnly(typeof historyModeDate!=='undefined'?historyModeDate:'');if(value)return value;}catch{}
    try{const value=dateOnly(typeof unifiedImportState!=='undefined'?unifiedImportState?.reportDate:'');if(value)return value;}catch{}
    try{const value=dateOnly(typeof appState!=='undefined'?appState?.reportDate:'');if(value)return value;}catch{}
    try{const value=dateOnly(typeof shopeeState!=='undefined'?shopeeState?.reportDate:'');if(value)return value;}catch{}
    return '';
  }
  function whppStateDate(){
    try{return dateOnly(typeof businessStates!=='undefined'?businessStates?.WHPP?.reportDate:'');}catch{return'';}
  }

  function patchLayout(){
    let style=document.getElementById('v221RuntimeCleanupStyle');
    if(!style){
      style=document.createElement('style');style.id='v221RuntimeCleanupStyle';
      style.textContent='.home-admin-actions,.dashboard-range-toolbar{display:none!important}';
      document.head.appendChild(style);
    }
  }

  function patchIdentity(){
    let user=null;try{user=typeof accessSession!=='undefined'?accessSession?.user:null;}catch{}
    if(!user)return;
    const display=String(user.displayName||user.username||user.email||'').trim();
    if(!display)return;
    const role=String(user.role||'VIEWER').trim();
    const department=String(user.department||user.departmentCompany||'质控部').trim();
    const name=document.getElementById('headerUserName');if(name)name.textContent=display;
    const meta=document.getElementById('headerUserRole');if(meta)meta.textContent=`${department} · ${role}`;
    const account=document.getElementById('currentAccountSummary');if(account)account.textContent=`${display} · ${role}`;
  }

  async function refreshIdentityOnce(){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1800);
    try{
      const response=await fetch('/api/session',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      if(!response.ok)return;
      const session=await response.json();
      if(!session?.user)return;
      try{if(typeof accessSession!=='undefined')accessSession=session;}catch{}
      patchIdentity();
    }catch{}finally{clearTimeout(timer);}
  }

  function patchNetwork(){
    const target=document.getElementById('networkAccessCards');if(!target)return;
    let network={};try{network=(typeof appState!=='undefined'&&appState?.network)||{};}catch{}
    const localUrl=String(network.localUrl||network.currentOrigin||location.origin||'').trim();
    const lan=String(network.lanUrl||'').trim()||'未检测到局域网地址';
    const publicUrl=String(network.publicUrl||'').trim();
    const publicText=network.publicConfigured&&publicUrl?publicUrl:(publicUrl?`${publicUrl}（待完成DNS/Cloudflare）`:'公网尚未配置');
    const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    target.innerHTML=`<div class="access-address-list"><div><span>本机访问</span><b>${esc(localUrl)}</b></div><div><span>同一局域网访问</span><b>${esc(lan)}</b></div><div><span>不同网络 / 外地访问</span><b>${esc(publicText)}</b></div></div>`;
  }

  function showWhppNoDate(requestedDate='',availableDate=''){
    try{localStorage.removeItem(WHPP_CACHE_KEY);}catch{}
    let page=document.getElementById('whppFastPage');
    if(!page){page=document.createElement('section');page.id='whppFastPage';page.className='app-page v18-dashboard-page v18-business-page';document.querySelector('main.main-content')?.appendChild(page);}
    document.querySelectorAll('.app-page').forEach(node=>{node.hidden=node!==page;});
    document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));
    const title=document.getElementById('pageTitle');if(title)title.textContent='WHPP本土看板';
    if(location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');
    const req=requestedDate?`所选日期 ${requestedDate}`:'当前';
    const available=availableDate?`；WHPP当前已确认底账日期为 ${availableDate}`:'';
    page.innerHTML=`<section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>${req}没有同日WHPP已确认日报${available}。系统不会拿其他日期缓存冒充。</p></div></section><section class="v18-panel"><div class="empty-state">请选择WHPP实际存在的日报日期后查看；不同日期的数据不会相互顶替。</div></section>`;
  }

  function guardWhppClick(event){
    const link=event.target?.closest?.('.side-link[data-page="whpp"]');
    if(!link)return;
    const wanted=currentDate(),available=whppStateDate();
    if(wanted&&available===wanted)return;
    event.preventDefault();event.stopImmediatePropagation();showWhppNoDate(wanted,available);
  }

  function patch(){patchLayout();patchIdentity();patchNetwork();}
  function schedule(delay=120){clearTimeout(patchTimer);patchTimer=setTimeout(patch,delay);}
  function install(){
    // V217 previously launched a second startup recovery fan-out here: /api/unified-history
    // plus six business-state reads, twice. On the 20GB+ SQLite database that duplicated
    // the real V43 /api/bootstrap and could block the 5177 event loop. V219/V221 stay
    // deliberately passive: one bootstrap owns data and this layer only fixes presentation.
    patch();
    void refreshIdentityOnce();
    document.addEventListener('click',guardWhppClick,true);
    document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="settings"],.top-user')){schedule(100);void refreshIdentityOnce();}},true);
    global.addEventListener('popstate',()=>schedule(80));
    document.addEventListener('ce-qc-run-complete',()=>schedule(120));
    setTimeout(patch,500);
    setTimeout(patch,1800);
    setTimeout(patch,5000);
    global.__CE_QC_V219_RUNTIME_STABILITY__={version:VERSION,patchIdentity,patchNetwork,patchLayout,currentDate,whppStateDate,refreshIdentityOnce};
    global.__CE_QC_V217_RUNTIME_TRUTH__={disabled:true,replacedBy:VERSION};
    console.info('[CE-QC][V219_RUNTIME_STABILITY]',VERSION,'core bootstrap owns data; no startup database fan-out.');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);