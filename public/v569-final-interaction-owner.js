(function installV569FinalInteractionOwner(global){
  if(!global||!global.document||global.__CE_QC_V569_FINAL_INTERACTION_OWNER__)return;
  const VERSION='2026-09-21-v569-final-interaction-owner-v1';
  const document=global.document;
  global.__CE_QC_V569_FINAL_INTERACTION_OWNER__={version:VERSION};

  const INTERACTIVE_SELECTOR=[
    '.side-link[data-page]',
    'button:not(:disabled)',
    'a[href]',
    'input:not(:disabled)',
    'select:not(:disabled)',
    '[onclick]',
    '.v18-business-card',
    '.v18-metric-card',
    '.region-block button'
  ].join(',');

  let redispatching=false;
  let applying=false;

  function visible(node){
    try{
      if(!node||node.hidden)return false;
      const style=global.getComputedStyle?.(node);
      if(style&&(style.display==='none'||style.visibility==='hidden'))return false;
      const rect=node.getBoundingClientRect?.();
      return Boolean(rect&&rect.width>0&&rect.height>0);
    }catch{return false;}
  }

  function enableNode(node){
    try{
      if(!node)return;
      if(node.hasAttribute?.('inert'))node.removeAttribute('inert');
      if(node.style?.setProperty){
        const value=node.style.getPropertyValue?.('pointer-events');
        const priority=node.style.getPropertyPriority?.('pointer-events');
        if(value!=='auto'||priority!=='important')node.style.setProperty('pointer-events','auto','important');
      }else if(node.style&&node.style.pointerEvents!=='auto')node.style.pointerEvents='auto';
    }catch{}
  }

  function healInteractiveSurface(){
    if(applying)return;
    applying=true;
    try{
      [
        document.documentElement,
        document.body,
        document.querySelector('.app-stage'),
        document.querySelector('.app-shell'),
        document.querySelector('.app-body'),
        document.querySelector('.sidebar'),
        document.querySelector('.topbar'),
        document.querySelector('.main-content')
      ].filter(Boolean).forEach(enableNode);

      document.querySelectorAll(INTERACTIVE_SELECTOR).forEach(enableNode);
      document.documentElement.dataset.ceQcFinalInteractionOwner=VERSION;
    }finally{applying=false;}
  }

  function candidateByGeometry(event){
    const x=Number(event?.clientX);
    const y=Number(event?.clientY);
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    const matches=[];
    for(const node of document.querySelectorAll(INTERACTIVE_SELECTOR)){
      if(!visible(node))continue;
      const rect=node.getBoundingClientRect();
      if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)continue;
      matches.push({node,area:Math.max(1,rect.width*rect.height)});
    }
    matches.sort((a,b)=>a.area-b.area);
    return matches[0]?.node||null;
  }

  function directCandidate(event){
    try{return event.target?.closest?.(INTERACTIVE_SELECTOR)||null;}catch{return null;}
  }

  function invokeOwnedControl(control,event){
    if(!control||control.disabled)return false;

    const side=control.closest?.('.side-link[data-page]');
    if(side){
      const page=String(side.dataset.page||'home');
      const anchor=String(side.dataset.anchor||'');
      if(typeof global.navigatePage==='function'){
        global.navigatePage(page,anchor);
        return true;
      }
    }

    if(control.id==='topRangeQuery'&&typeof global.applyTopDateRange==='function'){
      global.applyTopDateRange();
      return true;
    }

    const inline=control.onclick;
    if(typeof inline==='function'){
      inline.call(control,event);
      return true;
    }

    if(typeof control.click==='function'){
      redispatching=true;
      try{control.click();}finally{redispatching=false;}
      return true;
    }
    return false;
  }

  function onCapturedClick(event){
    if(redispatching)return;
    healInteractiveSurface();

    const direct=directCandidate(event);
    const control=direct||candidateByGeometry(event);
    if(!control)return;

    // Own navigation and inline controls before later legacy document capture
    // handlers can swallow the click. Geometry fallback also works when a stale
    // transparent layer receives the browser hit instead of the visible control.
    const shouldOwn=Boolean(
      control.closest?.('.side-link[data-page]')
      || control.id==='topRangeQuery'
      || control.hasAttribute?.('onclick')
      || (!direct&&control.matches?.('button,a[href],input,select'))
    );
    if(!shouldOwn)return;

    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    try{
      invokeOwnedControl(control,event);
    }catch(error){
      console.warn('[CE-QC][V569_INTERACTION_OWNER]',error?.message||error);
    }
  }

  function onPointerDown(){
    healInteractiveSurface();
  }

  global.addEventListener('pointerdown',onPointerDown,true);
  global.addEventListener('click',onCapturedClick,true);

  let observerTimer=null;
  const observer=new MutationObserver(()=>{
    clearTimeout(observerTimer);
    observerTimer=setTimeout(healInteractiveSurface,30);
  });
  try{observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden','inert']});}catch{}

  healInteractiveSurface();
  [0,100,300,800,1500,3000,5000,8000,12000].forEach(ms=>setTimeout(healInteractiveSurface,ms));
  setInterval(healInteractiveSurface,5000);

  console.info('[CE-QC][V569_FINAL_INTERACTION_OWNER]',VERSION,'window-capture navigation + geometry fallback + persistent clickability active');
})(window);
