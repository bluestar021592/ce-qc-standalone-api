(function installV301RuntimeStability(global){
  if(global.__CE_QC_V301_RUNTIME_STABILITY__)return;
  const VERSION='2026-08-25-v301-nonrecursive-runtime-stability-v1';
  // Fresh V301 HTML does not load V300. Keep this guard so an old cached V300 tag,
  // if it survives in a restored tab, exits before installing its recursive observer.
  if(!global.__CE_QC_V300_RUNTIME_RESCUE__)global.__CE_QC_V300_RUNTIME_RESCUE__={version:'disabled-by-v301'};
  const LEGACY_IDS=['v234DailyTrendTruth','v245ShopeeAttemptTruth','v250ShopeeAttemptTruth','v251ShopeeAttemptTruth','v263DeliveryKpiPanel','v271AttemptPanel'];
  let observer=null,repairTimer=null,firstTimer=null,fetchWrapped=false,repairing=false,lastFirstKey='';
  const date=v=>String(v||'').slice(0,10);
  const path=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const special=()=>['/tbkh','/shopeecn','/shopeevn'].includes(path());
  const businessType=()=>({'/tbkh':'TBKH','/shopeecn':'SHOPEECN','/shopeevn':'SHOPEEVN'})[path()]||'';
  function range(){const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');const from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);return{from,to};}
  function root(){return[...document.querySelectorAll('.app-page')].find(node=>!node.hidden&&getComputedStyle(node).display!=='none')||null;}
  function observe(){if(!observer)return;observer.observe(document.body||document.documentElement,{subtree:true,childList:true});}
  function pauseObserver(fn){if(!observer)return fn();observer.disconnect();try{return fn();}finally{observe();}}
  function installStyle(){if(document.getElementById('v301RuntimeStabilityStyle'))return;const s=document.createElement('style');s.id='v301RuntimeStabilityStyle';s.textContent='#v234DailyTrendTruth,#v245ShopeeAttemptTruth,#v250ShopeeAttemptTruth,#v251ShopeeAttemptTruth,#v263DeliveryKpiPanel,#v271AttemptPanel{display:none!important}.sidebar>.side-link,.sidebar>.side-sub,.sidebar>.side-group,.sidebar>.side-group-title{display:none!important}';document.head.appendChild(s);}
  function canonicalSidebar(){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
    try{global.__CE_QC_V295_FIRST_ATTEMPT_UI__?.canonicalizeNav?.();}catch{}
    const navs=[...sidebar.querySelectorAll('.side-nav')],nav=navs[0];if(!nav)return;
    navs.slice(1).forEach(n=>n.remove());
    sidebar.querySelectorAll('.side-link,.side-sub,.side-group,.side-group-title').forEach(n=>{if(!nav.contains(n))n.remove();});
    [...sidebar.children].forEach(n=>{if(n===nav||n.matches?.('.sidebar-brand,.sidebar-collapse,#sideSystemStatus'))return;if(n.matches?.('nav')||n.querySelector?.('.side-link,.side-sub,.side-group,.side-group-title'))n.remove();});
    sidebar.dataset.v301SingleNav='1';
  }
  function unwrapV251(){for(const name of ['renderShopeePage','renderAll']){let fn=global[name],changed=false;while(fn&&fn.__v251FinalOwner&&typeof fn.__v251Original==='function'){fn=fn.__v251Original;changed=true;}if(changed)global[name]=fn;}}
  function removeLegacy(){const shopee=document.getElementById('shopeePage');if(!shopee)return;for(const id of LEGACY_IDS)shopee.querySelector(`#${id}`)?.remove();shopee.querySelectorAll('section,article').forEach(n=>{if(n.id==='v272AttemptPanel')return;const h=String(n.querySelector(':scope > h2,:scope > h3,.v251-head h2,.v245-attempt-head h2')?.textContent||'').replace(/\s+/g,'');if(/^(SHOPEE(?:CN|VN))?1\/2\/3派(?:成功率|签收占POD)趋势/.test(h))n.remove();});}
  function blankFirstAttempt(){
    const r=root();if(!r)return;
    r.querySelectorAll('.v18-metric-card').forEach(card=>{
      if(String(card.querySelector('span')?.textContent||'').trim()!=='首次妥投率'||card.dataset.v295FirstAttempt==='1')return;
      const value=card.querySelector('b'),note=card.querySelector('small');
      const already=card.dataset.v301FirstAttemptPending==='1'&&String(value?.textContent||'').trim()==='—'&&String(note?.textContent||'').trim()==='首派真实证据读取中，不沿用POD率';
      if(already)return;
      if(value&&value.textContent!=='—')value.textContent='—';
      if(note&&note.textContent!=='首派真实证据读取中，不沿用POD率')note.textContent='首派真实证据读取中，不沿用POD率';
      card.dataset.v301FirstAttemptPending='1';
    });
  }
  function wrongTrend(){if(!special())return false;const section=root()?.querySelector('.v18-trend-section');if(!section)return false;if(section.dataset.v248ShopeeTrend||section.dataset.v251ShopeeTrend||section.querySelector('[data-v248],[data-v251]'))return true;const rg=range();if(rg.from&&rg.from===rg.to){return[...section.querySelectorAll('.v18-chart-head>span')].some(n=>/(?:[2-9]|\d{2,})\s*个有效日报/.test(String(n.textContent||'')));}return false;}
  function patchCard(label,value,ratio=''){const r=root();if(!r)return;r.querySelectorAll('.v18-business-card,.v18-metric-card').forEach(card=>{if(String(card.querySelector('span')?.textContent||'').trim()!==label)return;const b=card.querySelector('b'),em=card.querySelector('em');if(b&&b.textContent!==value)b.textContent=value;if(ratio&&em&&em.textContent!==ratio)em.textContent=ratio;});}
  function syncSpecial(data){const type=businessType();if(!type||String(data?.businessType||'').toUpperCase()!==type)return;const rg=range(),row=(data.daily||[]).filter(x=>{const d=date(x.reportDate);return d&&d>=rg.from&&d<=rg.to;}).at(-1);if(!row)return;const total=Number(row.total),pod=row.pod==null?null:Number(row.pod),rate=row.podRate==null?null:Number(row.podRate);if(Number.isFinite(total))patchCard(type,total.toLocaleString('zh-CN'),'占本业务 100.00%');if(Number.isFinite(pod))patchCard('今日POD',pod.toLocaleString('zh-CN'),Number.isFinite(rate)?`占本业务 ${rate.toFixed(2)}%`:'');if(Number.isFinite(rate))patchCard('POD率',`${rate.toFixed(2)}%`,`当前比率 ${rate.toFixed(2)}%`);}
  function installFetchBridge(){if(fetchWrapped||typeof global.fetch!=='function')return;fetchWrapped=true;const previous=global.fetch.bind(global);global.fetch=function v301ExactReadBridge(input,init){let text='';try{const raw=typeof input==='string'?input:String(input?.url||'');text=raw;if(raw.includes('/api/v246/shopee-trends')&&!/[?&]exact=/.test(raw)){const u=new URL(raw,location.href),from=date(u.searchParams.get('from')),to=date(u.searchParams.get('to'));if(from&&from===to){u.searchParams.set('exact','1');const next=u.pathname+u.search;text=next;input=typeof input==='string'?next:new Request(next,input);}}}catch{}const p=previous(input,init);if(text.includes('/api/v263/delivery-trends'))p.then(r=>r.clone().json()).then(j=>{if(j?.ok!==false)syncSpecial(j);}).catch(()=>{});return p;};}
  function triggerFirst(){blankFirstAttempt();const api=global.__CE_QC_V295_FIRST_ATTEMPT_UI__,rg=range(),key=`${path()}|${rg.from}|${rg.to}`;if(!api?.refresh||key===lastFirstKey)return;if(!root()?.querySelector('.v18-trend-section .v272-status.ok'))return;lastFirstKey=key;clearTimeout(firstTimer);firstTimer=setTimeout(()=>api.refresh(true),350);}
  function repair(forceTrend=false){
    if(repairing)return;repairing=true;
    pauseObserver(()=>{installStyle();unwrapV251();canonicalSidebar();removeLegacy();blankFirstAttempt();const owner=global.__CE_QC_V272_LAYOUT_TREND_FINALIZER__;if(owner?.rehydrateVisible&&(forceTrend||wrongTrend()))owner.rehydrateVisible();});
    repairing=false;setTimeout(triggerFirst,80);
  }
  function scheduleRepair(delay=40,forceTrend=false){clearTimeout(repairTimer);repairTimer=setTimeout(()=>repair(forceTrend),delay);}
  function bind(){
    installFetchBridge();observer=new MutationObserver(records=>{if(repairing)return;const relevant=records.some(record=>[...record.addedNodes].some(n=>n?.nodeType===1&&(n.matches?.('.side-nav,.side-link,.side-sub,.side-group,.v18-metric-card,[data-v248],[data-v251],#v234DailyTrendTruth,#v245ShopeeAttemptTruth,#v250ShopeeAttemptTruth,#v251ShopeeAttemptTruth,#v263DeliveryKpiPanel,#v271AttemptPanel')||n.querySelector?.('.side-nav,.side-link,.side-sub,.side-group,.v18-metric-card,[data-v248],[data-v251],#v234DailyTrendTruth,#v245ShopeeAttemptTruth,#v250ShopeeAttemptTruth,#v251ShopeeAttemptTruth,#v263DeliveryKpiPanel,#v271AttemptPanel'))));if(relevant)scheduleRepair(30,special());});observe();repair(true);
    document.addEventListener('click',e=>{if(e.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery')){lastFirstKey='';scheduleRepair(80,true);}},true);
    document.addEventListener('change',e=>{if(e.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo')){lastFirstKey='';scheduleRepair(80,true);}},true);
    global.addEventListener('popstate',()=>{lastFirstKey='';scheduleRepair(80,true);});
    [400,1400,3500].forEach(ms=>setTimeout(()=>repair(special()&&wrongTrend()),ms));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V301_RUNTIME_STABILITY__={version:VERSION,repair,blankFirstAttempt,canonicalSidebar,triggerFirst};
  console.info('[CE-QC][V301_RUNTIME_STABILITY]',VERSION,'non-recursive DOM repair: observer is disconnected during mutations; first-attempt blanking is idempotent; exact selected-range trend owner remains authoritative.');
})(window);
