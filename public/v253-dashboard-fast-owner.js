(function installV253DashboardFastOwner(global){
  if(global.__CE_QC_V253_DASHBOARD_FAST_OWNER__)return;
  global.__CE_QC_V253_DASHBOARD_FAST_OWNER__=true;
  const VERSION='2026-08-23-v253-final-fast-dashboard-owner-v1';
  const PATH_TYPE={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',whpp:'WHPP',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const nativeFetch=global.fetch.bind(global);
  let timer=null,rendering=false,lastShopeeData=null;
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const currentPath=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const type=()=>PATH_TYPE[currentPath().replace(/^\//,'')]||'';
  const onHome=()=>['/','/home'].includes(currentPath());
  function range(){const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};}
  function rewriteUrl(raw){
    if(!raw)return raw;let u;try{u=new URL(raw,location.origin);}catch{return raw;}
    if(u.pathname==='/api/v89/instant-dashboard'){u.pathname='/api/v253/instant-dashboard';return u.pathname+u.search;}
    if(u.pathname==='/api/v234/trends'){u.pathname='/api/v253/trends';return u.pathname+u.search;}
    if(u.pathname==='/api/v246/shopee-trends'&&u.searchParams.get('regions')==='1'&&u.searchParams.get('exact')==='1'){
      const businessType=u.searchParams.get('businessType')||'';const date=u.searchParams.get('to')||u.searchParams.get('from')||'';
      return `/api/v253/shopee-region?businessType=${encodeURIComponent(businessType)}&date=${encodeURIComponent(date)}`;
    }
    return raw;
  }
  global.fetch=function v253DashboardFetch(input,init){
    try{const raw=typeof input==='string'?input:String(input?.url||'');const next=rewriteUrl(raw);if(next!==raw){if(typeof input==='string')return nativeFetch(next,init);const absolute=new URL(next,location.origin).toString();return nativeFetch(new Request(absolute,input),init);}}catch{}
    return nativeFetch(input,init);
  };

  function cacheKey(prefix,t,r){return `CEQC_V253_${prefix}_${t}_${r.from}_${r.to}`;}
  function cacheGet(key,maxAge=10*60_000){try{const item=JSON.parse(sessionStorage.getItem(key)||'null');return item&&Date.now()-Number(item.at||0)<=maxAge?item.data:null;}catch{return null;}}
  function cacheSet(key,data){try{sessionStorage.setItem(key,JSON.stringify({at:Date.now(),data}));}catch{}}
  function rootFor(t=type()){
    if(t==='WHPP')return [...document.querySelectorAll('#whppFastPage,#whppPage')].find(r=>!r.hidden)||document.getElementById('whppFastPage')||document.getElementById('whppPage');
    if(t.startsWith('SHOPEE'))return document.getElementById('shopeePage');
    return document.getElementById('ccslPage');
  }
  function ensureStyle(){if(document.getElementById('v253FastOwnerStyle'))return;const style=document.createElement('style');style.id='v253FastOwnerStyle';style.textContent=`
    .v253-trend-status{margin:8px 2px 0;color:#7a8da7;font-size:11px;line-height:1.5}
    .v253-loading-card{min-height:235px!important;display:flex;flex-direction:column}
    .v253-loading-body{flex:1;min-height:125px;display:flex;align-items:center;justify-content:center;color:#8aa0ba;font-size:12px;border-top:1px solid #eef3f8;margin-top:8px}
    #v252HomeShopeeLifecycle{margin-top:14px!important}
    #v252HomeShopeeLifecycle .v252-wrap{padding-bottom:12px!important}
    #v252HomeShopeeLifecycle table{min-width:1050px!important}
    #shopeePage [data-v253-compact-loading="1"]{min-height:110px!important;height:auto!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:24px!important;color:#8aa0ba!important}
  `;document.head.appendChild(style);}
  function series(name,color,values){return{name,color,values:Array.isArray(values)?values:[],numerators:[],denominators:[]};}
  function ensureCards(t){const root=rootFor(t);if(!root||root.hidden)return[];let section=root.querySelector('.v18-trend-section');if(!section)return[];let cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4);if(cards.length<4){const grid=document.createElement('div');grid.className='v18-trend-grid';grid.innerHTML=Array.from({length:4},()=>'<article class="v18-chart-card"></article>').join('');section.innerHTML='';section.appendChild(grid);cards=[...grid.querySelectorAll('.v18-chart-card')];}section.style.minHeight='0';section.dataset.v253=VERSION;return cards;}
  function placeholder(t){if(!t||t.startsWith('SHOPEE'))return;const cards=ensureCards(t);const titles=['票数趋势','POD率趋势','OC率趋势','首日POD妥投率趋势'];cards.forEach((card,i)=>{if(card.dataset.v253Loaded==='1')return;card.classList.add('v253-loading-card');card.innerHTML=`<div class="v18-chart-head"><h3>${titles[i]}</h3><span>近7个有效日报日</span></div><div class="v253-loading-body">读取已落库日报数据…</div>`;});}
  function renderGeneric(data,t){const root=rootFor(t);if(!root||root.hidden||!global.RateTrendCardV18?.render)return;const cards=ensureCards(t);if(cards.length<4)return;const dates=data?.dates||[],daily=data?.daily||[];const pick=(key,fallback=[])=>daily.length?daily.map(row=>row?.ready?(row[key]===null||row[key]===undefined?null:num(row[key])):null):fallback;const specs=[
    {title:'票数趋势',type:'count',dates,series:[series(`${t}票数`,'#1677ff',pick('total',data.ticket))]},
    {title:'POD率趋势',type:'rate',dates,series:[series(`${t} POD率`,'#16a36a',pick('podRate',data.podRate))]},
    {title:'OC率趋势',type:'rate',oc:true,dates,series:[series(`${t} OC率`,'#ff8a00',pick('ocRate',data.ocRate))]},
    {title:'首日POD妥投率趋势',type:'rate',dates,series:[series(`${t} 首日POD`,'#6c4cf5',pick('sameDayPodRate',data.sameDayPodRate))]}
  ];cards.forEach((card,i)=>{card.classList.remove('v253-loading-card');card.dataset.v253Loaded='1';global.RateTrendCardV18.render(card,specs[i]);});let note=root.querySelector('.v253-trend-status');if(!note){note=document.createElement('div');note.className='v253-trend-status';root.querySelector('.v18-trend-section')?.appendChild(note);}const ready=daily.filter(r=>r?.ready).length;note.textContent=ready===dates.length?`${t}：${ready}个日报日已直接从落库事实读取；页面不依赖后台趋势缓存。`:`${t}：已读取 ${ready}/${dates.length} 个完整日报日，其余日期仍在补齐最终状态。`;}
  async function readJson(url){const r=await nativeFetch(url,{cache:'no-store',credentials:'same-origin'}),data=await r.json().catch(()=>({}));if(!r.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${r.status}`);return data;}
  async function refreshGeneric(t,r){const key=cacheKey('TREND',t,r),cached=cacheGet(key);if(cached)renderGeneric(cached,t);else placeholder(t);try{const data=await readJson(`/api/v253/trends?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`);cacheSet(key,data);renderGeneric(data,t);}catch(error){console.warn('[CE-QC][V253_GENERIC]',t,error?.message||error);}}

  function compactShopeeLegacy(root){if(!root)return;for(const node of root.querySelectorAll('*')){const text=String(node.textContent||'').trim();if(text==='正在读取派次趋势...'||text==='正在读取派次趋势…'||text==='正在读取近7日趋势...'||text==='正在读取近7日趋势…'){node.dataset.v253CompactLoading='1';const parent=node.parentElement;if(parent&&parent.getBoundingClientRect().height>260){parent.style.minHeight='130px';parent.style.height='auto';}}}}
  function renderShopee(data){lastShopeeData=data;const owner=global.__CE_QC_V251_SHOPEE_FINAL_OWNER__;if(owner?.render){owner.render(data);compactShopeeLegacy(rootFor(type()));return true;}return false;}
  async function refreshShopee(t,r){const key=cacheKey('SHOPEE',t,r),cached=cacheGet(key);if(cached)renderShopee(cached);compactShopeeLegacy(rootFor(t));try{const data=await readJson(`/api/v246/shopee-trends?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}&regions=0`);cacheSet(key,data);if(!renderShopee(data))setTimeout(()=>renderShopee(data),80);}catch(error){console.warn('[CE-QC][V253_SHOPEE]',t,error?.message||error);}}

  function removeHomeLegacyAttempts(){const root=document.getElementById('homePage');if(!root||root.hidden)return;const candidates=[...root.querySelectorAll('section,article,.v18-panel')];for(const node of candidates){if(node.id==='v252HomeShopeeLifecycle')continue;const heading=[...node.querySelectorAll('h1,h2,h3,h4')].map(h=>String(h.textContent||'')).join(' ');if(/SHOPEE\s*1\s*\/\s*2\s*\/\s*3派签收占POD趋势|SHOPEE\s*1\/2\/3派签收占POD趋势/i.test(heading)){node.remove();}}const summary=root.querySelector('#v252HomeShopeeLifecycle');if(summary){summary.style.minHeight='0';summary.style.height='auto';}}
  function refreshHome(){removeHomeLegacyAttempts();const lifecycle=global.__CE_QC_V252_LIFECYCLE_UI__;if(lifecycle?.refresh)lifecycle.refresh();setTimeout(removeHomeLegacyAttempts,150);setTimeout(removeHomeLegacyAttempts,600);}
  function refresh(){if(rendering)return;rendering=true;try{ensureStyle();const t=type(),r=range();if(onHome()){refreshHome();return;}if(!t||!r.to)return;if(t.startsWith('SHOPEE'))void refreshShopee(t,r);else void refreshGeneric(t,r);}finally{rendering=false;}}
  function schedule(delay=40){clearTimeout(timer);timer=setTimeout(refresh,delay);}
  function bind(){ensureStyle();document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(30);},true);document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(50);},true);global.addEventListener('popstate',()=>schedule(30));const observer=new MutationObserver(records=>{if(rendering)return;const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('.v18-trend-section,#v247HomeShopeeAttempts,#v252HomeShopeeLifecycle')||node.querySelector?.('.v18-trend-section,#v247HomeShopeeAttempts,#v252HomeShopeeLifecycle'))));if(relevant){if(lastShopeeData&&type().startsWith('SHOPEE'))setTimeout(()=>renderShopee(lastShopeeData),0);schedule(60);}});if(document.body)observer.observe(document.body,{subtree:true,childList:true});[0,120,500].forEach(ms=>setTimeout(refresh,ms));}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V253_DASHBOARD_FAST_OWNER__={version:VERSION,refresh,renderGeneric,renderShopee,nativeFetch};
  console.info('[CE-QC][V253_DASHBOARD_FAST_OWNER]',VERSION,'stale-while-revalidate first paint + cache-independent seven-day trends + compact home/Shopee loading ownership enabled');
})(window);
