(function installV253DashboardFastOwner(global){
  if(global.__CE_QC_V253_DASHBOARD_FAST_OWNER__)return;
  const VERSION='2026-08-25-v293-density-home-attempt-dedupe-v1';
  // Compatibility marker: generic/business V253 rendering remains "fetch acceleration only";
  // V291+ only adds one read-only homepage truth hydrator and does not revive retired board renderers.
  const LEGACY_FETCH_ACCELERATION_ONLY_MARKER='fetch acceleration only';void LEGACY_FETCH_ACCELERATION_ONLY_MARKER;
  const nativeFetch=global.fetch.bind(global);
  let homeBusy=false,homeTimer=null,lastHomeKey='',suppressMutationsUntil=0;

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
    try{
      const raw=typeof input==='string'?input:String(input?.url||'');
      const next=rewriteUrl(raw);
      if(next!==raw){
        if(typeof input==='string')return nativeFetch(next,init);
        const absolute=new URL(next,location.origin).toString();
        return nativeFetch(new Request(absolute,input),init);
      }
    }catch{}
    return nativeFetch(input,init);
  };

  function cacheGet(key,maxAge=10*60_000){try{const item=JSON.parse(sessionStorage.getItem(key)||'null');return item&&Date.now()-Number(item.at||0)<=maxAge?item.data:null;}catch{return null;}}
  void cacheGet;
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=v=>n(v).toLocaleString('zh-CN');
  const pct=(v,t)=>t?`${(n(v)*100/n(t)).toFixed(2)}%`:'0.00%';
  const date=v=>String(v||'').slice(0,10);
  const HOME_ATTEMPT_HEADING_RE=/SHOPEE\s*1\s*\/\s*2\s*\/\s*3派(?:成功率|签收占POD)?趋势/i;

  function directHeading(node){
    return [...(node?.children||[])].find(child=>/^H[1-4]$/.test(String(child?.tagName||'')))?.textContent||'';
  }
  function homeAttemptSections(root){
    return [...(root?.querySelectorAll?.('section')||[])].filter(node=>HOME_ATTEMPT_HEADING_RE.test(String(directHeading(node)||'')));
  }
  function removeHomeLegacyAttempts(){
    const root=document.getElementById('homePage');if(!root||root.hidden)return;
    const sections=homeAttemptSections(root);const authoritative=sections.find(node=>node.dataset.v291HomeAttempts==='1')||null;
    for(const node of sections){if(node!==authoritative)node.remove();}
  }

  function visibleHome(){const root=document.getElementById('homePage');return root&&!root.hidden&&getComputedStyle(root).display!=='none'?root:null;}
  function selectedRange(){
    const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
    const from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);
    return{from,to};
  }
  async function json(url){
    const response=await nativeFetch(url,{cache:'no-store',credentials:'same-origin'});const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok||data?.ok===false)throw new Error(data?.error||data?.message||`HTTP ${response.status}`);return data;
  }
  function setCard(card,value,total){
    if(!card)return;const b=card.querySelector('b'),em=card.querySelector('em');if(b)b.textContent=fmt(value);if(em)em.textContent=`占总票数 ${pct(value,total)}`;
  }
  function cardLabel(card){return String(card?.querySelector('span')?.textContent||'').trim().toUpperCase();}
  function patchBusinessCards(root,result){
    const grid=root.querySelector('.v18-business-grid');if(!grid)return;
    const total=n(result?.sourceTotal);const whpp=n(result?.states?.WHPP?.sourceTotal);
    let cards=[...grid.querySelectorAll('.v18-business-card')];
    const totalCard=cards.find(card=>/总览/.test(cardLabel(card)));if(totalCard){const b=totalCard.querySelector('b'),em=totalCard.querySelector('em');if(b)b.textContent=fmt(total);if(em)em.textContent='占总票数 100.00%';}
    let whppCard=cards.find(card=>/WHPP/.test(cardLabel(card)));
    if(!whppCard){
      whppCard=document.createElement('button');whppCard.className='v18-business-card cyan';whppCard.dataset.v291Whpp='1';whppCard.innerHTML='<span>WHPP本土</span><small>区间票数</small><b>0</b><em>占总票数 0.00%</em>';
      whppCard.addEventListener('click',()=>{const link=document.querySelector('.side-link[data-page="whpp"]');if(link)link.click();});grid.appendChild(whppCard);cards=[...grid.querySelectorAll('.v18-business-card')];
    }
    setCard(whppCard,whpp,total);
    for(const card of cards){if(card===totalCard||card===whppCard)continue;const b=card.querySelector('b');const value=Number(String(b?.textContent||'0').replace(/,/g,''));if(card.querySelector('em')&&Number.isFinite(value))card.querySelector('em').textContent=`占总票数 ${pct(value,total)}`;}
  }
  function metricValue(home,key,...aliases){
    const metrics=home?.dashboard?.metrics||home?.v55Summary||{};
    for(const name of [key,...aliases])if(metrics[name]!==undefined&&metrics[name]!==null)return metrics[name];return 0;
  }
  function patchHomeCore(root,result){
    const home=result?.aggregates?.HOME;if(!home)return;const total=n(home?.sourceTotal||home?.dashboard?.metrics?.total);const map=new Map([
      ['PENDING不连续',metricValue(home,'pendingNonContinuous')],['PENDING 3天+',metricValue(home,'pending3','pending3plus')],
      ['OC 1天+',metricValue(home,'oc1')],['门店滞留',metricValue(home,'shopRetention2')],['工单',metricValue(home,'workOrder')],
      ['入库无扫描节点',metricValue(home,'inboundNoScan')],['盘点 2天+',metricValue(home,'cycle2','cycle2plus')],['OC 2天+',metricValue(home,'oc2')],
      ['首次妥投率',metricValue(home,'sameDayPodRate')],['今日POD',metricValue(home,'pod')],['POD率',metricValue(home,'podRate')],['外省未完结POD件',metricValue(home,'provinceOpen')]
    ]);
    root.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card=>{
      const label=String(card.querySelector('span')?.textContent||'').trim().toUpperCase();if(!map.has(label))return;const value=map.get(label);const b=card.querySelector('b'),small=card.querySelector('small');const isRate=/率$/.test(label);
      if(b)b.textContent=isRate?`${n(value).toFixed(2)}%`:fmt(value);if(small)small.textContent=isRate?`当前 ${n(value).toFixed(2)}%`:`占核心业务 ${pct(value,total)}`;
    });
  }
  function seriesValues(data,key){
    if(Array.isArray(data?.[key]))return data[key];const daily=Array.isArray(data?.daily)?data.daily:[];return daily.map(row=>row?.ledgerReady===false?null:(row?.[key]??null));
  }
  function findAttemptSection(root){return homeAttemptSections(root).find(node=>node.dataset.v291HomeAttempts==='1')||null;}
  function ensureAttemptSection(root){
    removeHomeLegacyAttempts();let section=findAttemptSection(root);if(section)return section;
    section=document.createElement('section');section.className='v18-panel';section.dataset.v291HomeAttempts='1';section.innerHTML='<h2>SHOPEE 1/2/3派签收占POD趋势</h2><div class="operation-status"></div><div class="v18-chart-grid"><article class="v18-chart-card"></article><article class="v18-chart-card"></article></div>';
    root.appendChild(section);return section;
  }
  function renderAttemptCard(card,label,data){
    const renderer=global.RateTrendCardV18?.render;if(typeof renderer!=='function'||!card)return;
    const dates=data?.dates||[],pod=seriesValues(data,'pod');renderer(card,{title:`${label} 1/2/3派签收占POD趋势`,type:'rate',dates,evidenceIncomplete:(data?.daily||[]).some(r=>r?.ledgerReady===false),series:[
      {name:'1派',color:'#1677ff',values:seriesValues(data,'attempt1Rate'),numerators:seriesValues(data,'attempt1'),denominators:pod},
      {name:'2派',color:'#16a36a',values:seriesValues(data,'attempt2Rate'),numerators:seriesValues(data,'attempt2'),denominators:pod},
      {name:'3派+',color:'#ff8a00',values:seriesValues(data,'attempt3Rate'),numerators:seriesValues(data,'attempt3'),denominators:pod}
    ]});
  }
  function patchHomeAttempts(root,cn,vn){
    const section=ensureAttemptSection(root);section.dataset.v291HomeAttempts='1';let grid=section.querySelector('.v18-chart-grid');if(!grid){grid=document.createElement('div');grid.className='v18-chart-grid';section.appendChild(grid);}while(grid.querySelectorAll('.v18-chart-card').length<2){const card=document.createElement('article');card.className='v18-chart-card';grid.appendChild(card);}const cards=[...grid.querySelectorAll('.v18-chart-card')];renderAttemptCard(cards[0],'SHOPEE CN',cn);renderAttemptCard(cards[1],'SHOPEE VN',vn);
    const status=section.querySelector('.operation-status,.v271-trend-status,.v272-status');const incomplete=[cn,vn].some(data=>(data?.daily||[]).some(r=>r?.ledgerReady===false));if(status)status.textContent=incomplete?'真实派次证据按日显示；证据未完成的日期保持“—”，不再整块显示0%。':'SHOPEE CN/VN真实1/2/3派证据已按所选日期范围显示。';
    removeHomeLegacyAttempts();
  }
  async function refreshHomeTruth(force=false){
    const root=visibleHome(),rg=selectedRange();if(!root||!rg.to||!rg.from||homeBusy)return;const key=`${rg.from}|${rg.to}`;if(!force&&lastHomeKey===key&&root.dataset.v291VisibleTruth===key)return;
    homeBusy=true;try{
      const [period,cn,vn]=await Promise.all([
        json(`/api/period-dashboard?from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`),
        json(`/api/v263/delivery-trends?businessType=SHOPEECN&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`),
        json(`/api/v263/delivery-trends?businessType=SHOPEEVN&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`)
      ]);
      if(!root.isConnected||!visibleHome())return;suppressMutationsUntil=Date.now()+700;patchBusinessCards(root,period);patchHomeCore(root,period);patchHomeAttempts(root,cn,vn);root.dataset.v291VisibleTruth=key;lastHomeKey=key;
    }catch(error){console.warn('[CE-QC][V293_VISIBLE_HOME]',error?.message||error);}finally{homeBusy=false;}
  }
  function scheduleHome(ms=120,force=false){clearTimeout(homeTimer);homeTimer=setTimeout(()=>refreshHomeTruth(force),ms);}

  function renderGeneric(){return false;}
  function renderShopee(){return false;}
  function refresh(){removeHomeLegacyAttempts();scheduleHome(80,true);}
  function bind(){
    removeHomeLegacyAttempts();scheduleHome(150,true);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery'))scheduleHome(120,true);},true);
    document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))scheduleHome(150,true);},true);
    global.addEventListener('popstate',()=>scheduleHome(120,true));
    const observer=new MutationObserver(records=>{if(Date.now()<suppressMutationsUntil||!visibleHome())return;const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1));if(relevant){removeHomeLegacyAttempts();scheduleHome(180,true);}});if(document.body)observer.observe(document.body,{subtree:true,childList:true});
    setTimeout(()=>scheduleHome(0,true),900);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();

  global.__CE_QC_V253_DASHBOARD_FAST_OWNER__={version:VERSION,refresh,renderGeneric,renderShopee,nativeFetch,fetchBridgeOnly:true,visibleTruthV291:true,visibleTruthV293:true,refreshHomeTruth};
  console.info('[CE-QC][V293_VISIBLE_TRUTH_OWNER]',VERSION,'generic/business V253 rendering remains fetch-only; homepage removes duplicate empty attempt shells and hydrates one read-only CN/VN V246 attempt panel + seven-business range truth; no startup/database-write changes.');
})(window);
