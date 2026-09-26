(function installV592EarlySidebarCapture(global){
  'use strict';
  if(global.__CE_QC_V593_EARLY_SIDEBAR__) return;
  const VERSION='2026-09-26-v593-unconditional-sidebar-coordinate-route-v1';
  let navigatingHref='';
  let navigatingAt=0;

  function retireBrokenFrames(){
    try{document.getElementById('ce-qc-v590-sidebar-frame')?.remove();}catch{}
    try{document.getElementById('ce-qc-v591-sidebar-frame')?.remove();}catch{}
    try{document.getElementById('ce-qc-v587-sidebar-hit-surface')?.remove();}catch{}
  }
  function sidebarLinkAt(x,y){
    try{
      const sidebar=document.querySelector('.sidebar');
      if(!sidebar) return null;
      const sr=sidebar.getBoundingClientRect();
      if(x<sr.left || x>sr.right || y<sr.top || y>sr.bottom) return null;
      const links=[...document.querySelectorAll('.side-nav .side-link[href]')].filter(link=>!link.hidden);
      let nearest=null,nearestDistance=Infinity;
      for(const link of links){
        const r=link.getBoundingClientRect?.();
        if(!r || r.width<2 || r.height<2) continue;
        if(y>=r.top && y<=r.bottom) return link;
        const cy=r.top+r.height/2;
        const distance=Math.abs(y-cy);
        if(distance<nearestDistance){nearest=link;nearestDistance=distance;}
      }
      // Only use nearest fallback while inside the nav's vertical band. This survives
      // stale pointer-events/stacking mutations without turning the whole sidebar into
      // a random route target.
      const nav=document.querySelector('.side-nav');
      const nr=nav?.getBoundingClientRect?.();
      if(nearest&&nr&&y>=nr.top-4&&y<=nr.bottom+4&&nearestDistance<=28)return nearest;
      return null;
    }catch{return null;}
  }
  function route(link,event,source){
    if(!link) return false;
    const path=String(link.dataset?.path||'').trim();
    let href=String(link.href||'').trim();
    if(path){
      const q=new URLSearchParams(global.location?.search||'');
      q.set('auth','v581');
      q.delete('t');
      href=path+(q.toString()?'?'+q.toString():'');
    }
    if(!href) return false;
    const now=Date.now();
    if(href===navigatingHref && now-navigatingAt<1200){
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      event?.stopPropagation?.();
      return true;
    }
    navigatingHref=href;
    navigatingAt=now;
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    event?.stopPropagation?.();
    try{
      document.documentElement.dataset.ceQcV593LastRoute=String(link.dataset?.page||source||'sidebar');
      document.documentElement.dataset.ceQcV593LastHref=href;
    }catch{}
    try{global.location.href=href;}catch{}
    // A second browser-native navigation attempt is intentional. Some legacy handlers
    // mutate history synchronously later in the same input turn on older workstations.
    setTimeout(()=>{
      try{
        const target=new URL(href,global.location.href);
        if(global.location.pathname!==target.pathname)global.location.replace(href);
      }catch{}
    },80);
    return true;
  }
  function pointerOwner(event){
    if(event?.metaKey||event?.ctrlKey||event?.shiftKey||event?.altKey) return;
    if(Number(event?.button||0)!==0) return;
    retireBrokenFrames();
    const link=sidebarLinkAt(Number(event.clientX),Number(event.clientY));
    if(link) route(link,event,'pointer');
  }
  function keyboardOwner(event){
    if(!['Enter',' '].includes(String(event.key||''))) return;
    const link=document.activeElement?.closest?.('.side-nav .side-link[href]');
    if(link) route(link,event,'keyboard');
  }

  // Install on window capture as soon as this head script executes. Window capture is
  // earlier in the event path than document/body/overlay handlers added by legacy code.
  global.addEventListener('pointerdown',pointerOwner,true);
  global.addEventListener('mousedown',pointerOwner,true);
  global.addEventListener('click',pointerOwner,true);
  global.addEventListener('keydown',keyboardOwner,true);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',retireBrokenFrames,{once:true});
  else retireBrokenFrames();

  global.__CE_QC_V593_EARLY_SIDEBAR__={version:VERSION,retireBrokenFrames,sidebarLinkAt};
  console.info('[CE-QC][V593_EARLY_SIDEBAR]',VERSION,'unconditional coordinate navigation installed before legacy page handlers');
})(window);
