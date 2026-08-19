(function installV216UiStabilityGuard(global){
  'use strict';
  if(global.__CE_QC_V216_UI_STABILITY__)return;
  const VERSION='2026-08-19-v216-ui-stability-no-loop-v1';
  let patchTimer=null;
  let identityBusy=false;
  let lastIdentityAt=0;

  const text=node=>String(node?.textContent||'').trim();
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function navKey(node){
    const page=String(node?.dataset?.page||'').trim();
    if(page)return page;
    const label=text(node?.querySelector?.('.side-label'));
    if(/未闭环与跨日遗留追踪中心|跨日遗留追踪中心|遗留异常动态/.test(label))return 'carryover-center';
    return label;
  }

  function directLinks(nav){return [...nav.querySelectorAll(':scope > .side-link')];}

  function dedupeNav(nav){
    const seen=new Set();
    for(const node of directLinks(nav)){
      const key=navKey(node);
      if(!key)continue;
      if(seen.has(key))node.remove();else seen.add(key);
    }
  }

  function ensureWhppNav(nav){
    let button=directLinks(nav).find(node=>navKey(node)==='whpp');
    if(!button){
      button=document.createElement('button');
      button.type='button';
      button.className='side-link';
      button.dataset.page='whpp';
      button.dataset.path='/whpp';
      button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';
      const shopeeCn=directLinks(nav).find(node=>navKey(node)==='shopeecn');
      if(shopeeCn)nav.insertBefore(button,shopeeCn);else nav.appendChild(button);
    }
    if(button.dataset.v216Bound!=='1'){
      button.dataset.v216Bound='1';
      button.addEventListener('click',event=>{
        event.preventDefault();
        if(typeof global.navigateWhppPage==='function'){global.navigateWhppPage();return;}
        if(typeof global.navigatePage==='function'){try{global.navigatePage('whpp');return;}catch{}}
        location.href='/whpp';
      });
    }
  }

  function ensureCarryNav(nav){
    let button=directLinks(nav).find(node=>navKey(node)==='carryover-center');
    if(!button&&typeof global.openCarryCenter==='function'){
      button=document.createElement('button');
      button.type='button';
      button.className='side-link';
      button.dataset.page='carryover-center';
      button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-warning"></use></svg><span class="side-label">未闭环与跨日遗留追踪中心</span>';
      const reports=directLinks(nav).find(node=>navKey(node)==='reports');
      if(reports)nav.insertBefore(button,reports);else nav.appendChild(button);
    }
    if(button&&button.dataset.v216Bound!=='1'){
      button.dataset.v216Bound='1';
      button.addEventListener('click',event=>{
        if(typeof global.openCarryCenter!=='function')return;
        event.preventDefault();
        global.openCarryCenter();
      });
    }
  }

  function patchNavigation(){
    const nav=document.querySelector('.side-nav');
    if(!nav)return;
    dedupeNav(nav);
    ensureWhppNav(nav);
    ensureCarryNav(nav);
    const active=location.pathname.replace(/^\//,'')||'home';
    for(const node of directLinks(nav)){
      const key=navKey(node);
      if(key==='whpp'||key==='carryover-center')node.classList.toggle('active',key===active);
    }
  }

  function currentUser(){
    try{return typeof accessSession!=='undefined'&&accessSession?.user?accessSession.user:null;}catch{return null;}
  }

  function patchIdentity(user=currentUser()){
    if(!user)return;
    const display=String(user.displayName||user.username||user.email||'').trim();
    if(!display)return;
    const roleName=String(user.role||'VIEWER').trim();
    const department=String(user.department||user.departmentCompany||'质控部').trim();
    const name=document.getElementById('headerUserName');
    if(name&&text(name)!==display)name.textContent=display;
    const role=document.getElementById('headerUserRole');
    const roleText=`${department} · ${roleName}`;
    if(role&&text(role)!==roleText)role.textContent=roleText;
    const account=document.getElementById('currentAccountSummary');
    const accountText=`${display} · ${roleName}`;
    if(account&&text(account)!==accountText)account.textContent=accountText;
  }

  async function refreshIdentity(force=false){
    if(identityBusy||(!force&&Date.now()-lastIdentityAt<120000))return;
    identityBusy=true;lastIdentityAt=Date.now();
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),1800);
    try{
      const response=await fetch('/api/session',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const payload=await response.json().catch(()=>({}));
      if(response.ok&&payload?.user){
        try{if(typeof accessSession!=='undefined')accessSession={...(accessSession||{}),...payload,user:payload.user};}catch{}
        patchIdentity(payload.user);
      }else patchIdentity();
    }catch{patchIdentity();}
    finally{clearTimeout(timeout);identityBusy=false;}
  }

  function patchNetworkPanel(){
    if(location.pathname!=='/settings')return;
    const target=document.getElementById('networkAccessCards');
    if(!target||(!/正在读取/.test(text(target))&&target.children.length))return;
    let network={};
    try{network=(typeof appState!=='undefined'&&appState?.network)||{};}catch{}
    const current=location.origin;
    const lan=String(network.lanUrl||'').trim()||'尚未检测到局域网地址';
    const publicUrl=String(network.publicUrl||'').trim();
    const publicText=network.publicConfigured&&publicUrl?publicUrl:(publicUrl?`${publicUrl}（待完成DNS/Cloudflare）`:'公网尚未配置');
    const rows=[['当前访问',current],['同一局域网访问',lan],['不同网络/外地访问',publicText]];
    target.innerHTML=`<div class="access-address-list">${rows.map(([label,url])=>`<div><span>${esc(label)}</span><b>${esc(url)}</b></div>`).join('')}</div><p class="operation-status">本机、局域网、公网分别显示真实可用状态；未配置的公网不会伪装成可用地址。</p>`;
  }

  function clearStaleWhppCacheWhenNoReport(){
    let reportDate='';
    try{
      const top=String(document.getElementById('topRangeTo')?.value||'').slice(0,10);
      const imported=String((typeof unifiedImportState!=='undefined'&&unifiedImportState?.snapshotId)?unifiedImportState.reportDate||'':'').slice(0,10);
      reportDate=/^\d{4}-\d{2}-\d{2}$/.test(top)?top:(/^\d{4}-\d{2}-\d{2}$/.test(imported)?imported:'');
    }catch{}
    if(!reportDate){try{localStorage.removeItem('ce_qc_v132_whpp_fast_summary');}catch{}}
  }

  function compactDuplicateDiagnostics(){
    const exact=new Set(['轨迹证据 / 状态闭环完整性','历史日报清洁重建 / 防漏票底账','原始日报永久归档 / 可重建保障','历史数据完整性 / 导出安全检查']);
    const panels=[];
    for(const heading of document.querySelectorAll('h2,h3')){
      if(!exact.has(text(heading)))continue;
      const panel=heading.closest('section.panel,section,article.panel,article');
      if(panel&&!panels.includes(panel))panels.push(panel);
    }
    if(!panels.length)return;
    let host=document.getElementById('v216AdvancedDiagnostics');
    if(!host){
      const first=panels[0];
      host=document.createElement('details');
      host.id='v216AdvancedDiagnostics';
      host.className='panel';
      host.style.margin='12px 0';
      host.innerHTML='<summary style="cursor:pointer;font-weight:700;padding:14px 16px;color:#183b63">高级数据校验（需要时展开）</summary><div id="v216AdvancedDiagnosticsBody" style="padding:0 12px 12px"></div>';
      first.parentNode?.insertBefore(host,first);
    }
    const body=document.getElementById('v216AdvancedDiagnosticsBody');
    if(body)for(const panel of panels)if(panel.parentNode!==body)body.appendChild(panel);
  }

  function patch(){
    patchNavigation();
    patchIdentity();
    patchNetworkPanel();
    clearStaleWhppCacheWhenNoReport();
    compactDuplicateDiagnostics();
  }

  function schedule(delay=120){
    clearTimeout(patchTimer);
    patchTimer=setTimeout(patch,delay);
  }

  function install(){
    patch();
    void refreshIdentity(true);
    global.addEventListener('popstate',()=>schedule(50));
    document.addEventListener('ce-qc-run-complete',()=>schedule(80));
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('.side-link,#topRangeQuery,#dashboardRangeTo,#dashboardRangeFrom'))schedule(120);
      if(event.target?.closest?.('[data-page="settings"]'))setTimeout(()=>{patchNetworkPanel();void refreshIdentity(true);},250);
    },true);
    setInterval(()=>{patchNavigation();patchIdentity();},15000);
    global.__CE_QC_V216_UI_STABILITY__={version:VERSION,patch,refreshIdentity};
    global.__CE_QC_V215_UI_INTEGRITY__={disabled:true,replacedBy:VERSION};
    global.__CE_QC_V214_HOME_WHPP_IDENTITY__=global.__CE_QC_V216_UI_STABILITY__;
    console.info('[CE-QC][V216_UI_STABILITY]',VERSION,'MutationObserver disabled; navigation patch is event-driven and idempotent.');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
