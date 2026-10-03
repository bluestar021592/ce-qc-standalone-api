(function (global) {
  const dates = ['07-14', '07-15', '07-16', '07-17', '07-18', '07-19', '07-20'];
  global.DashboardFixtureV18 = {
    dates,
    trends: {
      tickets: [17895, 18120, 18010, 18340, 18190, 18480, 18642],
      podCe: [87.6, 88.1, null, 88.2, 88.6, 88.0, 88.5],
      podPp: [90.3, 90.8, null, 90.1, 89.8, 89.9, 90.1],
      podPv: [81.2, 82.0, null, 83.1, 83.2, 82.9, 83.3],
      ocCe: [0.62, 0.74, null, 0.81, 0.76, 0.83, 0.9],
      ocPp: [0.12, 0.16, null, 0.13, 0.1, 0.08, 0],
      ocPv: [0.21, 0.18, null, 0.14, 0.1, 0.06, 0],
      firstCe: [87.1, 87.8, null, 88.0, 87.9, 88.3, null],
      firstShopee: [82.9, 83.1, null, 83.5, 83.7, 83.8, 84.05]
    }
  };
})(window);

(function installV533FirstPaintStartupGuard(global) {
  if (!global || !global.document || global.__CE_QC_V533_FIRST_PAINT_STARTUP_GUARD__) return;
  const PATCH_ID = '2026-09-14-v533-first-paint-bounded-startup-read-v1';
  const V535_PATCH_ID = '2026-09-14-v535-interactive-first-paint-body-bounded-v1';
  const V564_PATCH_ID = '2026-09-21-v564-startup-interaction-no-toast-v1';
  const V565_PATCH_ID = '2026-09-21-v565-interaction-surface-self-heal-v1';
  global.__CE_QC_V533_FIRST_PAINT_STARTUP_GUARD__ = PATCH_ID;
  global.__CE_QC_V535_INTERACTIVE_FIRST_PAINT__ = V535_PATCH_ID;
  global.__CE_QC_V564_STARTUP_INTERACTION__ = V564_PATCH_ID;
  global.__CE_QC_V565_INTERACTION_SURFACE__ = V565_PATCH_ID;
  const document = global.document;

  const STARTUP_TIMEOUT_MS = 3000;
  const STARTUP_GUARD_WINDOW_MS = 15000;
  const startupGuardDeadline = Date.now() + STARTUP_GUARD_WINDOW_MS;
  const startupRead = pathname => pathname === '/api/bootstrap'
    || pathname === '/api/state'
    || pathname === '/api/shopee/state'
    || pathname === '/api/ce-auth-status'
    || pathname === '/api/session'
    || pathname === '/api/history'
    || pathname === '/api/unified-history'
    || pathname === '/api/import/unified-latest'
    || pathname.startsWith('/api/business-state/');

  const nativeFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
  if (nativeFetch) {
    global.fetch = function v533BoundedStartupFetch(input, init = {}) {
      let pathname = '';
      try {
        const raw = typeof input === 'string' ? input : input?.url;
        pathname = new URL(raw || '', global.location?.href || 'http://127.0.0.1:5177/').pathname;
      } catch {}
      const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();
      if (Date.now() > startupGuardDeadline || method !== 'GET' || !startupRead(pathname) || init?.signal) return nativeFetch(input, init);

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (!controller) return nativeFetch(input, init);
      let fetchSettled = false;
      let timedOut = false;
      let timer = null;
      return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          try { controller.abort(); } catch {}
          // If response headers have not arrived yet, preserve V533 compatibility by
          // returning a finite synthetic failure. If headers already arrived, the
          // abort remains armed against response.text()/json() so a large/stalled
          // body cannot freeze the first interactive render indefinitely.
          if (!fetchSettled) {
            fetchSettled = true;
            const body = JSON.stringify({
              ok: false,
              code: 'V533_STARTUP_READ_TIMEOUT',
              error: '启动数据读取超过3秒，已跳过本次慢请求，页面继续打开。'
            });
            resolve(new Response(body, {
              status: 504,
              headers: {
                'content-type': 'application/json',
                'x-ce-qc-v533': PATCH_ID,
                'x-ce-qc-v535': V535_PATCH_ID
              }
            }));
          }
        }, STARTUP_TIMEOUT_MS);

        nativeFetch(input, { ...init, signal: controller.signal }).then(response => {
          if (fetchSettled) return;
          fetchSettled = true;
          // V535 intentionally does NOT clear the startup timer here. fetch() resolves
          // when headers arrive; keeping the controller alive until the 3-second wall
          // clock expires also bounds response body transfer/consumption.
          resolve(response);
        }).catch(error => {
          if (fetchSettled || timedOut && error?.name === 'AbortError') return;
          fetchSettled = true;
          if (timer) clearTimeout(timer);
          reject(error);
        });
      });
    };
  }

  function forceFirstPaint() {
    try {
      document.documentElement.style.background = '#f4f7fb';
      document.documentElement.style.pointerEvents = 'auto';
      document.body.style.background = '#f4f7fb';
      document.body.style.visibility = 'visible';
      document.body.style.opacity = '1';
      document.body.style.pointerEvents = 'auto';
      const stage = document.querySelector('.app-stage');
      if (stage) {
        stage.style.display = 'block';
        stage.style.visibility = 'visible';
        stage.style.opacity = '1';
        stage.style.minHeight = '100vh';
        stage.style.pointerEvents = 'auto';
      }
      const shell = document.querySelector('.app-shell');
      if (shell) {
        shell.style.display = 'block';
        shell.style.visibility = 'visible';
        shell.style.opacity = '1';
        shell.style.pointerEvents = 'auto';
      }
      document.getElementById('v533StartupNotice')?.remove();
    } catch {}
  }

  function clearNoticeWhenRendered() {
    const cards = document.getElementById('homeBusinessCards');
    if (!cards || !cards.children.length) return false;
    document.getElementById('v533StartupNotice')?.remove();
    return true;
  }

  function forceInteractivePaint() {
    try {
      const nodes = [
        document.documentElement,
        document.body,
        document.querySelector('.app-stage'),
        document.querySelector('.app-shell'),
        document.querySelector('.app-body'),
        document.querySelector('.sidebar'),
        document.querySelector('.topbar'),
        document.querySelector('.main-content')
      ].filter(Boolean);
      for (const node of nodes) {
        if (node.style?.setProperty) node.style.setProperty('pointer-events', 'auto', 'important');
        else node.style.pointerEvents = 'auto';
        try { node.removeAttribute?.('inert'); } catch {}
      }
      document.querySelectorAll?.(
        '.side-link,button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[onclick],.v18-business-card,.v18-metric-card,.region-block button'
      )?.forEach?.(node => {
        if (node.style?.setProperty) node.style.setProperty('pointer-events', 'auto', 'important');
        else if (node.style) node.style.pointerEvents = 'auto';
        try { node.removeAttribute?.('inert'); } catch {}
      });
      document.getElementById('v533StartupNotice')?.remove();
      document.documentElement.dataset.ceQcInteractionReady = V565_PATCH_ID;
    } catch {}
  }

  // V597: interaction ownership was moved to the single early window owner.
  // Keep this startup guard focused on first paint and bounded startup reads only.
  // Do not install a second pointer/click capture chain and do not rescan/rewrite
  // dashboard hit targets after the page has rendered.

  forceFirstPaint();
  forceInteractivePaint();

  if (!clearNoticeWhenRendered()) {
    // Read-only notice cleanup only. No interaction mutation or click ownership lives here.
    [100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(clearNoticeWhenRendered, ms));
  }

  try{if(document.documentElement?.dataset)document.documentElement.dataset.ceQcV597LegacyInteractionRetired='1';}catch{}
  console.info('[CE-QC][V597_STARTUP_GUARD] first-paint/read-timeout guard active; legacy V565 pointer/click owner retired.');
})(window);


(function installV598PassiveInteractionForensics(global){
  'use strict';
  if(!global||!global.document||global.__CE_QC_V598_PASSIVE_FORENSICS__)return;
  const VERSION='2026-09-29-v598-passive-interaction-forensics-v1';
  const doc=global.document;
  global.__CE_QC_V598_PASSIVE_FORENSICS__={version:VERSION};
  if(typeof global.addEventListener!=='function'||typeof global.setTimeout!=='function'||typeof global.setInterval!=='function'){
    global.__CE_QC_V598_PASSIVE_FORENSICS__.skipped='NON_BROWSER_RUNTIME';
    return;
  }
  let sequence=0;
  let lastMoveAt=0;
  let expectedTick=(global.performance?.now?.()||Date.now())+1000;

  function label(node){
    try{
      if(!node)return '-';
      const tag=String(node.tagName||node.nodeName||'?').toLowerCase();
      const id=node.id?'#'+String(node.id).slice(0,34):'';
      const cls=String(node.className||'').trim().split(/\s+/).filter(Boolean).slice(0,2).join('.');
      return (tag+id+(cls?'.'+cls:'')).slice(0,72);
    }catch{return '?';}
  }
  function send(event,extra=''){
    try{
      const q=new URLSearchParams({
        event:String(event||'').slice(0,48),
        page:String(global.location?.pathname||'/').replace(/^\//,'').slice(0,32)||'home',
        extra:String(extra||'').slice(0,220),
        v:'598'
      });
      fetch('/api/client-diag?'+q.toString(),{cache:'no-store',credentials:'same-origin',keepalive:true}).catch(()=>{});
    }catch{}
  }
  function pointSnapshot(event){
    try{
      const x=Math.round(Number(event?.clientX||0)),y=Math.round(Number(event?.clientY||0));
      const target=event?.target||null;
      const top=doc.elementFromPoint?.(x,y)||null;
      const cs=top?global.getComputedStyle?.(top):null;
      const root=global.getComputedStyle?.(doc.documentElement);
      const body=global.getComputedStyle?.(doc.body);
      const overlay=doc.querySelector('.modal:not([hidden]),.tracking-drawer:not([hidden]),#v303CleanStartOverlay:not([hidden])');
      return [
        'n='+(++sequence),
        'xy='+x+','+y,
        't='+label(target),
        'top='+label(top),
        'pe='+(cs?.pointerEvents||'-'),
        'z='+(cs?.zIndex||'-'),
        'pos='+(cs?.position||'-'),
        'inert='+(top?.closest?.('[inert]')?'1':'0'),
        'root='+(root?.pointerEvents||'-')+'/'+(body?.pointerEvents||'-'),
        'ov='+label(overlay)
      ].join('|');
    }catch(error){return 'snapshot_error='+String(error?.message||error).slice(0,90);}
  }
  function record(type){
    return event=>send(type,pointSnapshot(event));
  }

  global.addEventListener('pointerdown',record('V598_POINTERDOWN'),{capture:true,passive:true});
  global.addEventListener('pointerup',record('V598_POINTERUP'),{capture:true,passive:true});
  global.addEventListener('click',record('V598_CLICK'),{capture:true,passive:true});
  global.addEventListener('mousemove',event=>{
    const now=Date.now();
    if(now-lastMoveAt<2500)return;
    lastMoveAt=now;
    send('V598_MOUSEMOVE',pointSnapshot(event));
  },{capture:true,passive:true});
  global.addEventListener('error',event=>send('V598_WINDOW_ERROR',String(event?.message||event?.error?.message||'error').slice(0,200)),true);
  global.addEventListener('unhandledrejection',event=>send('V598_REJECTION',String(event?.reason?.message||event?.reason||'rejection').slice(0,200)),true);

  function v607SelfCheck(){
    try{
      const card=doc.querySelector('.v18-business-card[href]');
      const r=card?.getBoundingClientRect?.();
      const x=r?Math.round(r.left+r.width/2):-1;
      const y=r?Math.round(r.top+r.height/2):-1;
      const top=r?doc.elementFromPoint?.(x,y):null;
      send('V607_SELF_CHECK','focus='+(doc.hasFocus?.()?1:0)+'|inner='+global.innerWidth+'x'+global.innerHeight+'|early='+(global.__CE_QC_V596_EARLY_INTERACTION__?1:0)+'|v603='+(doc.documentElement?.dataset?.ceQcV603RealEdgeRescue||'-')+'|card='+label(card)+'|top='+label(top));
    }catch(error){send('V607_SELF_CHECK_ERROR',String(error?.message||error).slice(0,160));}
  }
  setTimeout(v607SelfCheck,500);
  setTimeout(v607SelfCheck,3000);

  function v620CeHitCheck(){
    try{
      const card=doc.querySelector('.main-content .v18-business-card[href^="/ce?"]')||doc.querySelector('.v18-business-card[href^="/ce?"]');
      const r=card?.getBoundingClientRect?.();
      const x=r?Math.round(r.left+r.width/2):-1;
      const y=r?Math.round(r.top+r.height/2):-1;
      const top=r?doc.elementFromPoint?.(x,y):null;
      send('V620_CE_HIT','x='+x+'|y='+y+'|w='+(r?Math.round(r.width):0)+'|h='+(r?Math.round(r.height):0)+'|card='+label(card)+'|top='+label(top)+'|ready='+doc.readyState);
    }catch(error){send('V620_CE_HIT_ERROR',String(error?.message||error).slice(0,160));}
  }
  setTimeout(v620CeHitCheck,700);
  setTimeout(v620CeHitCheck,2600);

  send('V598_START',[
    'ready='+doc.readyState,
    'vis='+doc.visibilityState,
    'owners='+(global.__CE_QC_V596_EARLY_INTERACTION__?'early':'-')+'/'+(global.__CE_QC_V581_STABLE_SHELL__?'stable':'-'),
    'retired='+(doc.documentElement?.dataset?.ceQcV597LegacyInteractionRetired||'-')
  ].join('|'));

  [2000,8000,20000].forEach(ms=>setTimeout(()=>{
    send('V598_HEARTBEAT','ms='+ms+'|ready='+doc.readyState+'|vis='+doc.visibilityState+'|owners='+(global.__CE_QC_V596_EARLY_INTERACTION__?'early':'-')+'/'+(global.__CE_QC_V581_STABLE_SHELL__?'stable':'-'));
  },ms));

  setInterval(()=>{
    const now=global.performance?.now?.()||Date.now();
    const lag=Math.max(0,Math.round(now-expectedTick));
    expectedTick=now+1000;
    if(lag>=700)send('V598_MAINTHREAD_LAG','lagMs='+lag+'|ready='+doc.readyState+'|vis='+doc.visibilityState);
  },1000);

  console.info('[CE-QC][V598_PASSIVE_FORENSICS]',VERSION,'passive only; no preventDefault/stopPropagation/style mutation/business writes.');
})(window);
