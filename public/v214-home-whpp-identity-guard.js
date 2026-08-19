(function installV219UiNavigationGuard(global){
  'use strict';
  if(global.__CE_QC_V219_UI_NAV_GUARD__)return;
  const VERSION='2026-08-19-v219-ui-navigation-guard-v1';
  let patchTimer=null;
  const text=node=>String(node?.textContent||'').trim();
  function navKey(node){
    const page=String(node?.dataset?.page||'').trim();if(page)return page;
    const label=text(node?.querySelector?.('.side-label'));
    if(/未闭环与跨日遗留追踪中心|跨日遗留追踪中心|遗留异常动态/.test(label))return 'carryover-center';
    return label;
  }
  function directLinks(nav){return [...nav.querySelectorAll(':scope > .side-link')];}
  function dedupeNav(nav){const seen=new Set();for(const node of directLinks(nav)){const key=navKey(node);if(!key)continue;if(seen.has(key))node.remove();else seen.add(key);}}
  function ensureWhpp(nav){
    let button=directLinks(nav).find(node=>navKey(node)==='whpp');
    if(button)return;
    button=document.createElement('button');button.type='button';button.className='side-link';button.dataset.page='whpp';button.dataset.path='/whpp';
    button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';
    const cn=directLinks(nav).find(node=>navKey(node)==='shopeecn');if(cn)nav.insertBefore(button,cn);else nav.appendChild(button);
    button.addEventListener('click',event=>{event.preventDefault();if(typeof global.navigateWhppPage==='function')return global.navigateWhppPage();if(typeof global.navigatePage==='function')return global.navigatePage('whpp');location.href='/whpp';});
  }
  function ensureCarry(nav){
    let button=directLinks(nav).find(node=>navKey(node)==='carryover-center');
    if(button||typeof global.openCarryCenter!=='function')return;
    button=document.createElement('button');button.type='button';button.className='side-link';button.dataset.page='carryover-center';
    button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-warning"></use></svg><span class="side-label">未闭环与跨日遗留追踪中心</span>';
    const reports=directLinks(nav).find(node=>navKey(node)==='reports');if(reports)nav.insertBefore(button,reports);else nav.appendChild(button);
    button.addEventListener('click',event=>{event.preventDefault();global.openCarryCenter?.();});
  }
  function patchNavigation(){const nav=document.querySelector('.side-nav');if(!nav)return;dedupeNav(nav);ensureWhpp(nav);ensureCarry(nav);}
  function patchIdentity(){
    let user=null;try{user=typeof accessSession!=='undefined'?accessSession?.user:null;}catch{}
    if(!user)return;const display=String(user.displayName||user.username||user.email||'').trim();if(!display)return;
    const role=String(user.role||'VIEWER').trim(),department=String(user.department||user.departmentCompany||'质控部').trim();
    const name=document.getElementById('headerUserName');if(name)name.textContent=display;
    const meta=document.getElementById('headerUserRole');if(meta)meta.textContent=`${department} · ${role}`;
    const account=document.getElementById('currentAccountSummary');if(account)account.textContent=`${display} · ${role}`;
  }
  function patch(){patchNavigation();patchIdentity();}
  function schedule(delay=100){clearTimeout(patchTimer);patchTimer=setTimeout(patch,delay);}
  function install(){
    patch();
    global.addEventListener('popstate',()=>schedule(50));
    document.addEventListener('ce-qc-run-complete',()=>schedule(80));
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link,.top-user'))schedule(120);},true);
    setTimeout(patch,600);
    global.__CE_QC_V219_UI_NAV_GUARD__={version:VERSION,patchNavigation,patchIdentity};
    global.__CE_QC_V216_UI_STABILITY__=global.__CE_QC_V219_UI_NAV_GUARD__;
    global.__CE_QC_V214_HOME_WHPP_IDENTITY__=global.__CE_QC_V219_UI_NAV_GUARD__;
    console.info('[CE-QC][V219_UI_NAV_GUARD]',VERSION,'passive navigation/identity guard active; no duplicate runtime loader.');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
