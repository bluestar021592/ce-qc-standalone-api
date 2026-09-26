(function installV592EarlySidebarCapture(global){
  'use strict';
  if(global.__CE_QC_V592_EARLY_SIDEBAR__) return;
  const VERSION='2026-09-26-v592-earliest-window-sidebar-capture-v1';
  let navigatingHref='';
  let navigatingAt=0;

  function visibleModalBlocksNavigation(){
    try{
      return [...document.querySelectorAll('.modal,#v303CleanStartOverlay')].some(node=>{
        if(node.hidden) return false;
        const cs=global.getComputedStyle?.(node);
        if(cs && (cs.display==='none' || cs.visibility==='hidden' || Number(cs.opacity||1)===0)) return false;
        const r=node.getBoundingClientRect?.();
        return Boolean(r && r.width>80 && r.height>80);
      });
    }catch{return false;}
  }
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
      const links=[...document.querySelectorAll('.side-nav .side-link[href]')];
      for(const link of links){
        if(link.hidden) continue;
        const cs=global.getComputedStyle?.(link);
        if(cs && (cs.display==='none' || cs.visibility==='hidden' || cs.pointerEvents==='none')) continue;
        const r=link.getBoundingClientRect?.();
        if(!r || r.width<8 || r.height<8) continue;
        if(x>=Math.max(sr.left,r.left) && x<=Math.min(sr.right,r.right) && y>=r.top && y<=r.bottom) return link;
      }
      return null;
    }catch{return null;}
  }
  function route(link,event,source){
    if(!link || visibleModalBlocksNavigation()) return false;
    const href=String(link.href||'').trim();
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
    try{document.documentElement.dataset.ceQcV592LastRoute=String(link.dataset?.page||source||'sidebar');}catch{}
    try{global.location.assign(href);}catch{try{global.location.href=href;}catch{}}
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

  global.__CE_QC_V592_EARLY_SIDEBAR__={version:VERSION,retireBrokenFrames,sidebarLinkAt};
  console.info('[CE-QC][V592_EARLY_SIDEBAR]',VERSION,'window-capture coordinate navigation installed before legacy page handlers');
})(window);
