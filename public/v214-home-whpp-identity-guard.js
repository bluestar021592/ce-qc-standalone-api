(function installV214HomeWhppIdentityGuard(global){
  'use strict';
  if(global.__CE_QC_V214_HOME_WHPP_IDENTITY__)return;
  const VERSION='2026-08-19-v214-home-whpp-identity-guard-v1';
  let scheduled=false;

  const text=node=>String(node?.textContent||'').trim();
  const num=value=>{const n=Number(String(value??'').replace(/[,%\s]/g,''));return Number.isFinite(n)?n:0;};
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=(value,total)=>total?`${(Number(value||0)*100/Number(total)).toFixed(2)}%`:'0.00%';

  function ensureWhppNav(){
    const nav=document.querySelector('.side-nav');if(!nav)return;
    let button=nav.querySelector('[data-page="whpp"]');
    if(!button){
      button=document.createElement('button');
      button.type='button';button.className='side-link';button.dataset.page='whpp';button.dataset.path='/whpp';
      button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';
      const after=nav.querySelector('[data-page="ali1688"]');
      const before=nav.querySelector('[data-page="shopeecn"]');
      if(before)nav.insertBefore(button,before);else if(after?.nextSibling)nav.insertBefore(button,after.nextSibling);else nav.appendChild(button);
    }
    button.onclick=event=>{event?.preventDefault?.();if(typeof global.navigateWhppPage==='function')return global.navigateWhppPage();if(typeof global.navigatePage==='function')return global.navigatePage('whpp');location.href='/whpp';};
    button.classList.toggle('active',location.pathname==='/whpp');
  }

  function userIdentity(){
    try{return typeof accessSession!=='undefined'&&accessSession?.user?accessSession.user:null;}catch{return null;}
  }
  function fixIdentity(){
    const user=userIdentity();if(!user)return;
    const name=document.getElementById('headerUserName');
    const role=document.getElementById('headerUserRole');
    const display=String(user.displayName||user.username||user.email||'本地用户').trim();
    if(name&&text(name)!==display)name.textContent=display;
    if(role){const wanted=`${user.department||'质控部'} · ${user.role||'VIEWER'}`;if(text(role)!==wanted)role.textContent=wanted;}
  }

  function findCard(grid,label){return [...(grid?.querySelectorAll?.('.v18-business-card')||[])].find(card=>text(card.querySelector('span'))===label)||null;}
  function ensureWhppHomeCard(){
    const home=document.getElementById('homePage');if(!home||home.hidden)return;
    const grid=home.querySelector('.v18-business-grid');if(!grid)return;
    let whpp=findCard(grid,'WHPP本土');
    if(!whpp){
      whpp=document.createElement('button');whpp.type='button';whpp.className='v18-business-card cyan';whpp.dataset.v214Business='WHPP';
      whpp.innerHTML='<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';
      whpp.onclick=()=>typeof global.navigateWhppPage==='function'?global.navigateWhppPage():global.navigatePage?.('whpp');
      const ali=findCard(grid,'ALI1688');const shopeeCn=findCard(grid,'SHOPEE CN');
      if(shopeeCn)grid.insertBefore(whpp,shopeeCn);else if(ali?.nextSibling)grid.insertBefore(whpp,ali.nextSibling);else grid.appendChild(whpp);
    }
    const total=findCard(grid,'总览');
    if(total){
      const totalValue=num(total.querySelector('b')?.textContent);
      const known=['CE','CEAF空运','TBKH','ALI1688','SHOPEE CN','SHOPEE VN'].reduce((sum,label)=>sum+num(findCard(grid,label)?.querySelector('b')?.textContent),0);
      const residual=Math.max(0,totalValue-known);
      const old=num(whpp.querySelector('b')?.textContent);
      const value=residual>0?residual:old;
      whpp.querySelector('b').textContent=fmt(value);
      whpp.querySelector('em').textContent=`占总票数 ${pct(value,totalValue)}`;
    }
    const coreTitle=home.querySelector('.v18-core>h2');
    if(coreTitle&&/CE \+ CEAF空运 \+ TBKH \+ ALI1688/.test(coreTitle.textContent||''))coreTitle.innerHTML='核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688 + WHPP本土，不含 SHOPEE CN/VN</small>';
  }

  function patch(){scheduled=false;ensureWhppNav();fixIdentity();ensureWhppHomeCard();}
  function schedule(delay=0){if(scheduled&&delay===0)return;scheduled=true;setTimeout(patch,delay);}
  function install(){
    patch();
    const observer=new MutationObserver(()=>schedule(0));observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    global.addEventListener('popstate',()=>schedule(0));
    document.addEventListener('ce-qc-run-complete',()=>schedule(0));
    setInterval(()=>schedule(0),5000);
    global.__CE_QC_V214_HOME_WHPP_IDENTITY__={version:VERSION,patch};
    console.info('[CE-QC][V214_HOME_WHPP_IDENTITY]',VERSION);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
