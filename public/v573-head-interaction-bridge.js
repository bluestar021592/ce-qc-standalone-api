(function installV573HeadInteractionBridge(global){
  'use strict';
  if(!global||!global.document||global.__CE_QC_V573_HEAD_INTERACTION_BRIDGE__)return;

  const VERSION='2026-09-21-v573-head-first-interaction-bridge-v1';
  const document=global.document;
  const ROUTES={
    home:'/',ce:'/ce',ceaf:'/ceaf',tbkh:'/tbkh',ali1688:'/ali1688',whpp:'/whpp',
    shopeecn:'/shopeecn',shopeevn:'/shopeevn',import:'/import',tracking:'/tracking',
    exceptions:'/exceptions',reports:'/reports','data-management':'/data-management',
    settings:'/settings',logs:'/logs'
  };
  const ACTION_SELECTOR=[
    '.side-link[data-page]',
    '.side-sub[data-page]',
    'button:not(:disabled)',
    'a[href]',
    '[role="button"]',
    '[onclick]',
    '.v18-business-card',
    '.v18-metric-card',
    '.pixel-kpi',
    '.pixel-metric',
    '.pixel-chart-card',
    '.region-block button'
  ].join(',');
  const NATIVE_SELECTOR='input,select,textarea,option,label';
  let redispatching=false;
  let lastActionKey='';
  let lastActionAt=0;

  global.__CE_QC_V573_HEAD_INTERACTION_BRIDGE__={
    version:VERSION,
    installedAt:Date.now(),
    lastAction:null,
    lastBlocker:null
  };

  function styleOf(node){
    try{return global.getComputedStyle?.(node)||null;}catch{return null;}
  }
  function rectOf(node){
    try{return node?.getBoundingClientRect?.()||null;}catch{return null;}
  }
  function visible(node){
    if(!node||!node.isConnected)return false;
    try{
      if(node.hidden||node.closest?.('[hidden]'))return false;
      const style=styleOf(node);
      if(style&&(style.display==='none'||style.visibility==='hidden'||Number(style.opacity||1)===0))return false;
      const rect=rectOf(node);
      return Boolean(rect&&rect.width>0&&rect.height>0);
    }catch{return false;}
  }
  function legitimateLayer(node){
    try{
      if(!node)return false;
      if(node.closest?.('.modal:not([hidden]),.tracking-drawer:not([hidden]),#accountDropdown:not([hidden]),#v303CleanStartOverlay'))return true;
      return false;
    }catch{return false;}
  }
  function enable(node){
    try{
      if(!node)return;
      node.removeAttribute?.('inert');
      if(node.style?.setProperty)node.style.setProperty('pointer-events','auto','important');
      if(node.getAttribute?.('aria-disabled')==='true'&&!node.disabled)node.removeAttribute('aria-disabled');
    }catch{}
  }
  function healSurface(){
    try{
      [
        document.documentElement,document.body,
        document.querySelector('.app-stage'),document.querySelector('.app-shell'),
        document.querySelector('.app-body'),document.querySelector('.sidebar'),
        document.querySelector('.side-nav'),document.querySelector('.topbar'),
        document.querySelector('.main-content')
      ].filter(Boolean).forEach(enable);
      document.querySelectorAll(ACTION_SELECTOR).forEach(enable);
      document.documentElement?.setAttribute('data-ce-qc-v573-interaction',VERSION);
    }catch{}
  }
  function ancestorAction(node){
    try{
      const candidate=node?.closest?.(ACTION_SELECTOR)||null;
      return visible(candidate)?candidate:null;
    }catch{return null;}
  }
  function actionsAtPoint(x,y){
    const result=[];
    const seen=new Set();
    const add=node=>{
      const candidate=ancestorAction(node);
      if(!candidate||seen.has(candidate))return;
      seen.add(candidate);
      result.push(candidate);
    };
    try{for(const node of document.elementsFromPoint?.(x,y)||[])add(node);}catch{}
    try{
      for(const node of document.querySelectorAll(ACTION_SELECTOR)){
        if(seen.has(node)||!visible(node))continue;
        const rect=rectOf(node);if(!rect)continue;
        if(x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom){seen.add(node);result.push(node);}
      }
    }catch{}
    const score=node=>{
      let value=100;
      if(node.matches?.('.side-link[data-page],.side-sub[data-page]'))value-=80;
      if(node.id==='topRangeQuery')value-=70;
      if(node.closest?.('.sidebar,.topbar,.app-page:not([hidden])'))value-=30;
      if(node.hasAttribute?.('onclick'))value-=10;
      const rect=rectOf(node);const area=rect?Math.max(1,rect.width*rect.height):999999999;
      return [value,area];
    };
    result.sort((a,b)=>{const A=score(a),B=score(b);return A[0]-B[0]||A[1]-B[1];});
    return result;
  }
  function neutralizeBlockers(x,y,control){
    if(!control)return;
    try{
      const stack=document.elementsFromPoint?.(x,y)||[];
      for(const node of stack){
        if(node===control||control.contains?.(node)||node.contains?.(control))continue;
        if(ancestorAction(node))continue;
        if(legitimateLayer(node))continue;
        const rect=rectOf(node);if(!rect||rect.width<=0||rect.height<=0)continue;
        const vw=Math.max(1,global.innerWidth||document.documentElement?.clientWidth||1);
        const vh=Math.max(1,global.innerHeight||document.documentElement?.clientHeight||1);
        const ratio=(rect.width*rect.height)/(vw*vh);
        const style=styleOf(node);
        const positioned=/fixed|absolute|sticky/i.test(String(style?.position||''));
        const z=Number.parseInt(style?.zIndex||'0',10)||0;
        if(ratio<0.20&&!(positioned&&z>=100))continue;
        if(node.closest?.('.app-shell,.sidebar,.topbar,.main-content')===node)continue;
        node.style?.setProperty?.('pointer-events','none','important');
        node.setAttribute?.('data-ce-qc-v573-neutralized','1');
        global.__CE_QC_V573_HEAD_INTERACTION_BRIDGE__.lastBlocker={
          tag:String(node.tagName||''),id:String(node.id||''),className:String(node.className||''),ratio,z,at:Date.now()
        };
      }
    }catch{}
  }
  function normalizedPath(value){
    const text=String(value||'/').toLowerCase().replace(/\/+$/,'');
    return text||'/';
  }
  function forceRoute(page){
    const target=ROUTES[page]||'/';
    const now=normalizedPath(global.location?.pathname||'/');
    if(page==='whpp'){
      try{
        if(now!==target)global.history?.pushState?.({page},'',target);
        try{global.currentPage='whpp';}catch{}
        const lazy=global.__CE_QC_V108_ROUTE_LAZY__?.ensurePage;
        if(typeof lazy==='function'){
          Promise.resolve(lazy('whpp')).then(()=>{
            const nav=global.__CE_QC_V90_INSTANT_WHPP_NAV__?.navigate;
            if(typeof nav==='function')nav(false);
            else if(normalizedPath(global.location?.pathname)!==target)global.location.assign(target);
          }).catch(()=>global.location.assign(target));
        }else{
          const nav=global.__CE_QC_V90_INSTANT_WHPP_NAV__?.navigate;
          if(typeof nav==='function')nav(now!==target);
          else global.location.assign(target);
        }
      }catch{try{global.location.assign(target);}catch{}}
      return true;
    }

    try{
      const nav=global.navigatePage;
      if(typeof nav==='function'){
        nav(page);
        setTimeout(()=>{
          if(normalizedPath(global.location?.pathname)!==normalizedPath(target)){
            try{global.location.assign(target);}catch{}
          }
        },120);
        return true;
      }
      global.location.assign(target);
      return true;
    }catch{
      try{global.location.assign(target);return true;}catch{return false;}
    }
  }
  function actionKey(control,eventType){
    const page=control?.dataset?.page||'';
    const id=control?.id||'';
    const text=String(control?.textContent||'').trim().slice(0,40);
    return [eventType,page,id,text].join('|');
  }
  function invoke(control,event){
    if(!control||control.disabled)return false;
    if(control.matches?.(NATIVE_SELECTOR)||control.closest?.(NATIVE_SELECTOR))return false;

    const side=control.closest?.('.side-link[data-page],.side-sub[data-page]');
    if(side){
      const page=String(side.dataset.page||'home').toLowerCase();
      global.__CE_QC_V573_HEAD_INTERACTION_BRIDGE__.lastAction={kind:'route',page,at:Date.now()};
      return forceRoute(page);
    }

    if(control.id==='topRangeQuery'&&typeof global.applyTopDateRange==='function'){
      global.__CE_QC_V573_HEAD_INTERACTION_BRIDGE__.lastAction={kind:'top-range',at:Date.now()};
      global.applyTopDateRange();
      return true;
    }

    const inline=control.onclick;
    if(typeof inline==='function'){
      global.__CE_QC_V573_HEAD_INTERACTION_BRIDGE__.lastAction={kind:'onclick',id:control.id||'',at:Date.now()};
      inline.call(control,event);
      return true;
    }

    if(control.matches?.('a[href]')){
      const href=control.getAttribute('href');
      if(href){global.location.assign(href);return true;}
    }

    if(typeof control.click==='function'){
      global.__CE_QC_V573_HEAD_INTERACTION_BRIDGE__.lastAction={kind:'redispatch',id:control.id||'',at:Date.now()};
      redispatching=true;
      try{control.click();}finally{redispatching=false;}
      return true;
    }
    return false;
  }
  function handle(event){
    if(redispatching)return;
    healSurface();
    const x=Number(event?.clientX),y=Number(event?.clientY);
    if(!Number.isFinite(x)||!Number.isFinite(y))return;

    const direct=ancestorAction(event.target);
    const candidates=actionsAtPoint(x,y);
    const control=direct||candidates[0]||null;
    if(!control)return;

    const native=control.matches?.(NATIVE_SELECTOR)||control.closest?.(NATIVE_SELECTOR);
    if(native)return;

    neutralizeBlockers(x,y,control);

    const key=actionKey(control,event.type);
    const now=Date.now();
    if(lastActionKey===key&&now-lastActionAt<300)return;

    // pointerup/mouseup are emergency fallbacks only for sidebar navigation.
    if(event.type!=='click'&&!control.closest?.('.side-link[data-page],.side-sub[data-page]'))return;

    if(invoke(control,event)){
      lastActionKey=key;lastActionAt=now;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
    }
  }

  function installStyle(){
    try{
      if(document.getElementById('ce-qc-v573-interaction-style'))return;
      const style=document.createElement('style');
      style.id='ce-qc-v573-interaction-style';
      style.textContent=`
        html,body,.app-stage,.app-shell,.app-body,.sidebar,.side-nav,.topbar,.main-content{pointer-events:auto!important}
        .side-link,.side-sub,button:not(:disabled),a[href],[role="button"],[onclick],
        .v18-business-card,.v18-metric-card,.pixel-kpi,.pixel-metric,.pixel-chart-card,.region-block button{
          pointer-events:auto!important;touch-action:manipulation
        }
        [data-ce-qc-v573-neutralized="1"]{pointer-events:none!important}
      `;
      (document.head||document.documentElement).appendChild(style);
    }catch{}
  }

  installStyle();
  healSurface();
  global.addEventListener('pointerdown',healSurface,true);
  global.addEventListener('pointerup',handle,true);
  global.addEventListener('mouseup',handle,true);
  global.addEventListener('click',handle,true);
  global.addEventListener('pageshow',()=>{installStyle();healSurface();},true);

  if(typeof MutationObserver==='function'){
    let timer=0;
    const observer=new MutationObserver(()=>{
      clearTimeout(timer);
      timer=setTimeout(healSurface,20);
    });
    try{observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden','inert','aria-hidden','disabled']});}catch{}
  }

  [0,50,150,400,1000,2500,5000,10000].forEach(ms=>setTimeout(()=>{installStyle();healSurface();},ms));
  console.info('[CE-QC][V573_HEAD_INTERACTION_BRIDGE]',VERSION,'installed before injected head runtimes; sidebar has hard route fallback; blockers are neutralized by pointer geometry.');
})(window);
