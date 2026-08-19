(function installV215UiIntegrityGuard(global){
  'use strict';
  if(global.__CE_QC_V215_UI_INTEGRITY__)return;
  const VERSION='2026-08-19-v215-ui-integrity-guard-v1';
  let timer=null;
  let identityBusy=false;
  let lastIdentityAt=0;
  let whppRefreshAt=0;

  const text=node=>String(node?.textContent||'').trim();
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||'').slice(0,10));
  const num=value=>{const n=Number(String(value??'').replace(/[,%\s]/g,''));return Number.isFinite(n)?n:0;};
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=(value,total)=>total?`${(Number(value||0)*100/Number(total)).toFixed(2)}%`:'0.00%';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function navKey(node){
    const page=String(node?.dataset?.page||'').trim();
    if(page)return page;
    const label=text(node?.querySelector?.('.side-label'));
    if(/未闭环与跨日遗留追踪中心|跨日遗留追踪中心|遗留异常动态/.test(label))return 'carryover-center';
    return label;
  }

  function ensureWhppButton(nav){
    let button=[...nav.querySelectorAll(':scope > .side-link')].find(node=>navKey(node)==='whpp');
    if(button)return button;
    button=document.createElement('button');
    button.type='button';button.className='side-link';button.dataset.page='whpp';button.dataset.path='/whpp';
    button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';
    nav.appendChild(button);
    return button;
  }

  function normalizeNav(){
    const nav=document.querySelector('.side-nav');if(!nav)return;
    const whpp=ensureWhppButton(nav);
    whpp.onclick=event=>{event?.preventDefault?.();if(typeof global.navigateWhppPage==='function')return global.navigateWhppPage();if(typeof global.navigatePage==='function')return global.navigatePage('whpp');location.href='/whpp';};

    const seen=new Map();
    [...nav.querySelectorAll(':scope > .side-link')].forEach(node=>{
      const key=navKey(node);
      if(!key)return;
      if(seen.has(key)){node.remove();return;}
      seen.set(key,node);
    });

    const order=['home','ce','ceaf','tbkh','ali1688','whpp','shopeecn','shopeevn','import','tracking','exceptions','carryover-center','reports','data-management','settings','logs'];
    for(const key of order){const node=seen.get(key);if(node)nav.appendChild(node);}
    [...nav.querySelectorAll(':scope > .side-link')].forEach(node=>{if(!order.includes(navKey(node)))nav.appendChild(node);});
    const activePath=location.pathname.replace(/^\//,'')||'home';
    nav.querySelectorAll(':scope > .side-link').forEach(node=>{
      const key=navKey(node);node.classList.toggle('active',key===activePath||(activePath==='whpp'&&key==='whpp'));
    });
  }

  function currentUser(){
    try{return typeof accessSession!=='undefined'&&accessSession?.user?accessSession.user:null;}catch{return null;}
  }
  function patchIdentity(user=currentUser()){
    if(!user)return;
    const display=String(user.displayName||user.username||user.email||'本地用户').trim();
    const roleText=`${user.department||user.departmentCompany||'质控部'} · ${user.role||'VIEWER'}`;
    const name=document.getElementById('headerUserName');if(name&&text(name)!==display)name.textContent=display;
    const role=document.getElementById('headerUserRole');if(role&&text(role)!==roleText)role.textContent=roleText;
    const account=document.getElementById('currentAccountSummary');if(account){const wanted=`${display} · ${user.role||'VIEWER'}`;if(text(account)!==wanted)account.textContent=wanted;}
  }
  async function refreshIdentity(force=false){
    if(identityBusy||(!force&&Date.now()-lastIdentityAt<30000))return;
    identityBusy=true;lastIdentityAt=Date.now();
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),2200);
    try{
      const response=await fetch('/api/session',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const payload=await response.json().catch(()=>({}));
      if(response.ok&&payload?.user){
        try{if(typeof accessSession!=='undefined')accessSession={...(accessSession||{}),...payload,user:payload.user};}catch{}
        patchIdentity(payload.user);
      } else patchIdentity();
    }catch{patchIdentity();}finally{clearTimeout(timeout);identityBusy=false;}
  }

  function findCard(grid,label){return [...(grid?.querySelectorAll?.('.v18-business-card')||[])].find(card=>text(card.querySelector('span'))===label)||null;}
  function ensureWhppHomeCard(){
    const home=document.getElementById('homePage');if(!home||home.hidden)return;
    const grid=home.querySelector('.v18-business-grid');if(!grid)return;
    let whpp=findCard(grid,'WHPP本土');
    if(!whpp){
      whpp=document.createElement('button');whpp.type='button';whpp.className='v18-business-card cyan';whpp.dataset.v215Business='WHPP';
      whpp.innerHTML='<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';
      whpp.onclick=()=>typeof global.navigateWhppPage==='function'?global.navigateWhppPage():global.navigatePage?.('whpp');
      const shopeeCn=findCard(grid,'SHOPEE CN');if(shopeeCn)grid.insertBefore(whpp,shopeeCn);else grid.appendChild(whpp);
    }
    const total=findCard(grid,'总览');
    if(total){
      const totalValue=num(total.querySelector('b')?.textContent);
      const known=['CE','CEAF空运','TBKH','ALI1688','SHOPEE CN','SHOPEE VN'].reduce((sum,label)=>sum+num(findCard(grid,label)?.querySelector('b')?.textContent),0);
      const residual=Math.max(0,totalValue-known);
      const existing=num(whpp.querySelector('b')?.textContent);
      const value=residual>0?residual:(totalValue===0?0:existing);
      const b=whpp.querySelector('b');if(b&&text(b)!==fmt(value))b.textContent=fmt(value);
      const em=whpp.querySelector('em');const share=`占总票数 ${pct(value,totalValue)}`;if(em&&text(em)!==share)em.textContent=share;
    }
    const coreTitle=home.querySelector('.v18-core>h2');
    if(coreTitle&&!/WHPP本土/.test(coreTitle.textContent||''))coreTitle.innerHTML='核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688 + WHPP本土，不含 SHOPEE CN/VN</small>';
  }

  function authoritativeDate(){
    const dom=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
    if(validDate(dom))return dom;
    try{
      const selected=String(typeof historyModeDate!=='undefined'?historyModeDate:'').slice(0,10);
      if(validDate(selected))return selected;
      const current=(typeof unifiedImportState!=='undefined'&&unifiedImportState?.snapshotId)?String(unifiedImportState.reportDate||'').slice(0,10):'';
      if(validDate(current))return current;
    }catch{}
    return '';
  }
  function whppRenderedDate(){
    const page=document.getElementById('whppFastPage')||document.getElementById('shopeePage');
    const match=text(page?.querySelector?.('.v18-page-heading p')).match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    return match?.[1]||'';
  }
  function renderNoCurrentWhpp(){
    const page=document.getElementById('whppFastPage');if(!page||location.pathname!=='/whpp')return;
    try{localStorage.removeItem('ce_qc_v132_whpp_fast_summary');}catch{}
    page.innerHTML=`<section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>当前没有选中的日报；旧缓存不会作为当前质控数据展示。</p></div></section><section class="v18-business-grid"><button class="v18-business-card purple"><span>WHPP本土</span><small>今日票数</small><b>0</b><em>占本业务 100.00%</em></button><button class="v18-business-card blue"><span>今日POD</span><small>今日票数</small><b>0</b><em>占本业务 0.00%</em></button><button class="v18-business-card blue"><span>POD率</span><small>当前比率</small><b>0%</b><em>当前比率 0%</em></button><button class="v18-business-card blue"><span>已退回件</span><small>今日票数</small><b>0</b><em>占本业务 0.00%</em></button><button class="v18-business-card blue"><span>订单取消</span><small>今日票数</small><b>0</b><em>占本业务 0.00%</em></button><button class="v18-business-card blue"><span>当前未闭环</span><small>今日票数</small><b>0</b><em>占本业务 0.00%</em></button></section><section class="v18-panel"><div class="empty-state">请先导入日报，或在顶部选择明确日期后再查看WHPP数据。</div></section>`;
  }
  function protectWhppFreshness(){
    if(location.pathname!=='/whpp')return;
    const wanted=authoritativeDate();
    if(!wanted){renderNoCurrentWhpp();return;}
    const shown=whppRenderedDate();
    if(shown&&shown!==wanted&&Date.now()-whppRefreshAt>3000){
      whppRefreshAt=Date.now();
      const page=document.getElementById('whppFastPage');if(page)page.innerHTML=`<div class="empty-state">正在切换到当前日报 ${esc(wanted)}，旧的 ${esc(shown)} 数据已禁止继续显示…</div>`;
      setTimeout(()=>{try{global.navigateWhppPage?.(false);}catch{}},50);
    }
  }

  function fixNetworkPanel(){
    if(location.pathname!=='/settings')return;
    const target=document.getElementById('networkAccessCards');if(!target)return;
    if(target.children.length&& !/正在读取/.test(text(target)))return;
    let network={};try{network=(typeof appState!=='undefined'&&appState?.network)||{};}catch{}
    const current=location.origin;
    const lan=String(network.lanUrl||'').trim()||'尚未检测到局域网地址';
    const publicUrl=String(network.publicUrl||'').trim();
    const publicText=network.publicConfigured&&publicUrl?publicUrl:(publicUrl?`${publicUrl}（待完成DNS/Cloudflare）`:'公网尚未配置');
    const rows=[['当前访问',current],['同一局域网访问',lan],['不同网络/外地访问',publicText]];
    target.innerHTML=`<div class="access-address-list">${rows.map(([label,url])=>`<div><span>${esc(label)}</span><b>${esc(url)}</b></div>`).join('')}</div><p class="operation-status">局域网与公网是两条独立访问通道；公网配置完成前不会把临时地址显示成可用正式地址。</p>`;
  }

  function patch(){normalizeNav();patchIdentity();ensureWhppHomeCard();protectWhppFreshness();fixNetworkPanel();void refreshIdentity(false);}
  function schedule(delay=30){clearTimeout(timer);timer=setTimeout(patch,delay);}
  function install(){
    patch();void refreshIdentity(true);
    const observer=new MutationObserver(()=>schedule());observer.observe(document.body,{childList:true,subtree:true});
    global.addEventListener('popstate',()=>schedule(0));
    document.addEventListener('ce-qc-run-complete',()=>schedule(0));
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link,#topRangeQuery'))schedule(80);},true);
    setInterval(()=>{patchIdentity();protectWhppFreshness();},5000);
    global.__CE_QC_V215_UI_INTEGRITY__={version:VERSION,patch,refreshIdentity,authoritativeDate};
    global.__CE_QC_V214_HOME_WHPP_IDENTITY__=global.__CE_QC_V215_UI_INTEGRITY__;
    console.info('[CE-QC][V215_UI_INTEGRITY]',VERSION);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
