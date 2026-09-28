(function installV596EarlyInteractionOwner(global){
  'use strict';
  if(global.__CE_QC_V596_EARLY_INTERACTION__)return;
  const VERSION='2026-09-28-v596-unified-coordinate-interaction-v1';
  const doc=global.document;
  const ACTION_SELECTOR=[
    '.topbar button:not(:disabled)',
    '.topbar a[href]',
    '.topbar [role="button"]',
    '.topbar [onclick]',
    '.topbar input:not(:disabled)',
    '.topbar select:not(:disabled)',
    '.main-content button:not(:disabled)',
    '.main-content a[href]',
    '.main-content [role="button"]',
    '.main-content [onclick]',
    '.main-content input:not(:disabled)',
    '.main-content select:not(:disabled)',
    '.main-content textarea:not(:disabled)'
  ].join(',');
  const LEGITIMATE_OVERLAY='.modal:not([hidden]),.tracking-drawer:not([hidden]),#accountDropdown:not([hidden]),#v303CleanStartOverlay:not([hidden])';
  let navigatingHref='';
  let navigatingAt=0;
  let redispatching=false;
  let fallbackControl=null;
  let fallbackAt=0;
  let diagCount=0;

  function retireBrokenFrames(){
    try{doc.getElementById('ce-qc-v590-sidebar-frame')?.remove();}catch{}
    try{doc.getElementById('ce-qc-v591-sidebar-frame')?.remove();}catch{}
    try{doc.getElementById('ce-qc-v587-sidebar-hit-surface')?.remove();}catch{}
  }

  function diag(event,extra=''){
    if(diagCount>=24)return;
    diagCount+=1;
    try{
      fetch('/api/client-diag?'+new URLSearchParams({
        event:String(event||'').slice(0,48),
        page:String(global.location?.pathname||'/').slice(0,32),
        extra:String(extra||'').slice(0,160),
        v:'596'
      }),{credentials:'same-origin',cache:'no-store',keepalive:true}).catch(()=>{});
    }catch{}
  }

  function visible(node){
    try{
      if(!node||!node.isConnected||node.hidden||node.disabled||node.closest?.('[hidden],[inert]'))return false;
      const cs=global.getComputedStyle?.(node);
      if(!cs||cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity||1)===0)return false;
      const r=node.getBoundingClientRect?.();
      if(!r||r.width<1||r.height<1)return false;
      return r.bottom>=0&&r.right>=0&&r.top<=(global.innerHeight||r.bottom)&&r.left<=(global.innerWidth||r.right);
    }catch{return false;}
  }

  function sidebarLinkAt(x,y){
    try{
      const sidebar=doc.querySelector('.sidebar');
      if(!sidebar)return null;
      const sr=sidebar.getBoundingClientRect();
      if(x<sr.left||x>sr.right||y<sr.top||y>sr.bottom)return null;
      const links=[...doc.querySelectorAll('.side-nav .side-link[href]')].filter(visible);
      let nearest=null,nearestDistance=Infinity;
      for(const link of links){
        const r=link.getBoundingClientRect?.();
        if(!r||r.width<2||r.height<2)continue;
        if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return link;
        const cy=r.top+r.height/2,distance=Math.abs(y-cy);
        if(distance<nearestDistance){nearest=link;nearestDistance=distance;}
      }
      const nav=doc.querySelector('.side-nav'),nr=nav?.getBoundingClientRect?.();
      if(nearest&&nr&&y>=nr.top-4&&y<=nr.bottom+4&&nearestDistance<=28)return nearest;
      return null;
    }catch{return null;}
  }

  function controlAt(x,y){
    try{
      const candidates=[];
      for(const node of doc.querySelectorAll(ACTION_SELECTOR)){
        if(!visible(node))continue;
        const r=node.getBoundingClientRect();
        if(x<r.left||x>r.right||y<r.top||y>r.bottom)continue;
        const surface=node.closest?.('.topbar')?0:1;
        const explicit=(node.id==='topRangeQuery'||node.hasAttribute?.('onclick')||node.matches?.('button,a[href],[role="button"]'))?0:1;
        candidates.push({node,surface,explicit,area:Math.max(1,r.width*r.height)});
      }
      candidates.sort((a,b)=>a.surface-b.surface||a.explicit-b.explicit||a.area-b.area);
      return candidates[0]?.node||null;
    }catch{return null;}
  }

  function directControl(target){
    try{
      const node=target?.closest?.(ACTION_SELECTOR)||null;
      return visible(node)?node:null;
    }catch{return null;}
  }

  function route(link,event,source='sidebar'){
    if(!link)return false;
    const path=String(link.dataset?.path||'').trim();
    let href=String(link.href||'').trim();
    if(path){
      const q=new URLSearchParams(global.location?.search||'');
      q.set('auth','v581');
      q.delete('t');
      href=path+(q.toString()?'?'+q.toString():'');
    }
    if(!href)return false;
    const now=Date.now();
    if(href===navigatingHref&&now-navigatingAt<1200){
      event?.preventDefault?.();event?.stopImmediatePropagation?.();event?.stopPropagation?.();
      return true;
    }
    navigatingHref=href;navigatingAt=now;
    fallbackControl=link;fallbackAt=now;
    event?.preventDefault?.();event?.stopImmediatePropagation?.();event?.stopPropagation?.();
    try{
      doc.documentElement.dataset.ceQcV596LastRoute=String(link.dataset?.page||source);
      doc.documentElement.dataset.ceQcV596LastHref=href;
    }catch{}
    diag('V596_SIDEBAR_ROUTE',(link.dataset?.page||'')+'|'+href);
    try{global.location.href=href;}catch{}
    setTimeout(()=>{
      try{
        const target=new URL(href,global.location.href);
        if(global.location.pathname!==target.pathname)global.location.replace(href);
      }catch{}
    },80);
    return true;
  }

  function invokeControl(control,event,source='geometry'){
    if(!control||control.disabled)return false;
    try{doc.documentElement.dataset.ceQcV596Fallback=(control.id||control.className||control.tagName||'control')+'|'+source;}catch{}
    if(control.matches?.('input,select,textarea')){
      try{control.focus?.({preventScroll:true});}catch{try{control.focus?.();}catch{}}
      try{
        if(typeof control.showPicker==='function')control.showPicker();
        else{
          redispatching=true;
          try{control.click?.();}finally{redispatching=false;}
        }
      }catch{}
      fallbackControl=control;fallbackAt=Date.now();
      diag('V596_NATIVE_FALLBACK',(control.id||control.tagName||'native')+'|'+source);
      return true;
    }
    const inline=control.onclick;
    if(typeof inline==='function'){
      fallbackControl=control;fallbackAt=Date.now();
      diag('V596_ACTION_FALLBACK',(control.id||control.className||control.tagName||'control')+'|'+source);
      inline.call(control,event);
      return true;
    }
    if(control.matches?.('a[href]')){
      const href=String(control.getAttribute('href')||'').trim();
      if(href){
        fallbackControl=control;fallbackAt=Date.now();
        diag('V596_ANCHOR_FALLBACK',href);
        global.location.assign(href);
        return true;
      }
    }
    if(typeof control.click==='function'){
      fallbackControl=control;fallbackAt=Date.now();
      diag('V596_CLICK_FALLBACK',(control.id||control.className||control.tagName||'control')+'|'+source);
      redispatching=true;
      try{control.click();}finally{redispatching=false;}
      return true;
    }
    return false;
  }

  function recentFallbackAt(event){
    if(!fallbackControl||Date.now()-fallbackAt>800)return false;
    const x=Number(event?.clientX),y=Number(event?.clientY);
    try{
      const r=fallbackControl.getBoundingClientRect?.();
      return Boolean(r&&x>=r.left-2&&x<=r.right+2&&y>=r.top-2&&y<=r.bottom+2);
    }catch{return false;}
  }

  function blockedByLegitimateOverlay(target){
    try{return Boolean(target?.closest?.(LEGITIMATE_OVERLAY));}catch{return false;}
  }

  function pointerOwner(event){
    if(redispatching||event?.metaKey||event?.ctrlKey||event?.shiftKey||event?.altKey)return;
    if(Number(event?.button||0)!==0)return;
    retireBrokenFrames();
    const x=Number(event?.clientX),y=Number(event?.clientY);
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const side=sidebarLinkAt(x,y);
    if(side){route(side,event,'pointer');return;}
    if(blockedByLegitimateOverlay(event.target))return;
    if(directControl(event.target))return;
    const intended=controlAt(x,y);
    if(!intended)return;
    if(invokeControl(intended,event,'pointerdown')){
      event.preventDefault?.();event.stopPropagation?.();event.stopImmediatePropagation?.();
    }
  }

  function clickOwner(event){
    if(redispatching)return;
    if(recentFallbackAt(event)){
      event.preventDefault?.();event.stopPropagation?.();event.stopImmediatePropagation?.();
      fallbackControl=null;
      return;
    }
    const x=Number(event?.clientX),y=Number(event?.clientY);
    const side=sidebarLinkAt(x,y);
    if(side){route(side,event,'click');return;}
    if(blockedByLegitimateOverlay(event.target)||directControl(event.target))return;
    const intended=controlAt(x,y);
    if(intended&&invokeControl(intended,event,'click')){
      event.preventDefault?.();event.stopPropagation?.();event.stopImmediatePropagation?.();
    }
  }

  function keyboardOwner(event){
    if(!['Enter',' '].includes(String(event.key||'')))return;
    const link=doc.activeElement?.closest?.('.side-nav .side-link[href]');
    if(link)route(link,event,'keyboard');
  }

  global.addEventListener('pointerdown',pointerOwner,true);
  if(!('PointerEvent' in global))global.addEventListener('mousedown',pointerOwner,true);
  global.addEventListener('click',clickOwner,true);
  global.addEventListener('keydown',keyboardOwner,true);
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',retireBrokenFrames,{once:true});
  else retireBrokenFrames();

  const api={version:VERSION,retireBrokenFrames,sidebarLinkAt,controlAt,route,invokeControl};
  global.__CE_QC_V596_EARLY_INTERACTION__=api;
  global.__CE_QC_V593_EARLY_SIDEBAR__=api;
  console.info('[CE-QC][V596_EARLY_INTERACTION]',VERSION,'one early window-capture owner: native clicks stay native; blocked sidebar/topbar/main controls fall back by real geometry.');
})(window);
