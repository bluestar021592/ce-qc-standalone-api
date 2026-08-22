(function installV237HomeDashboardOwner(global){
  if(global.__CE_QC_V237_HOME_DASHBOARD_OWNER__)return;
  global.__CE_QC_V237_HOME_DASHBOARD_OWNER__=true;
  const VERSION='2026-08-22-v237-home-dashboard-owner-v3';
  const cache=new Map();let timer=null,requestId=0;
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const pct=(value,total)=>total?Number((num(value)*100/num(total)).toFixed(2)):0;
  const currentPath=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const onHome=()=>['/','/home'].includes(currentPath());
  const shopeeType=()=>currentPath()==='/shopeecn'?'SHOPEECN':currentPath()==='/shopeevn'?'SHOPEEVN':'';
  const range=()=>{const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};};
  const series=(name,color,values)=>({name,color,values:Array.isArray(values)?values:[],numerators:[],denominators:[]});
  async function json(url){const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);return data;}
  async function cached(key,url,force=false){if(!force&&cache.has(key))return cache.get(key);const data=await json(url);cache.set(key,data);return data;}
  function homeRoot(){const root=document.getElementById('homePage');return root&&!root.hidden?root:null;}
  function shopeeRoot(){const root=document.getElementById('shopeePage');return root&&!root.hidden?root:null;}
  function normalizeLabel(value=''){return String(value||'').trim().toUpperCase().replace(/[\s_-]+/g,'');}
  function setBusinessCards(root,payload){
    const byType={...(payload?.business||{}),WHPP:payload?.whpp||{}};
    const aliases={CE:'CE',CEAF:'CEAF',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEECN',SHOPEEVN:'SHOPEEVN',WHPP:'WHPP'};
    const grand=Object.values(byType).reduce((sum,row)=>sum+num(row?.total),0);
    root.querySelectorAll('.v18-business-grid .v18-business-card').forEach(card=>{
      const type=aliases[normalizeLabel(card.querySelector('span')?.textContent||'')];if(!type)return;
      const row=byType[type]||{},b=card.querySelector('b'),em=card.querySelector('em');
      if(b)b.textContent=num(row.total).toLocaleString('zh-CN');
      if(em)em.textContent=`占总票数 ${grand?pct(row.total,grand).toFixed(2):'0.00'}%`;
    });
  }
  function setPair(box,cn,vn,key){
    if(!box)return;const spans=[...box.querySelectorAll(':scope > span')];
    [[spans[0],cn],[spans[1],vn]].forEach(([span,m])=>{if(!span)return;const value=num(m?.[key]),total=num(m?.total);const b=span.querySelector('b'),small=span.querySelector('small');if(b)b.textContent=value.toLocaleString('zh-CN');if(small)small.textContent=`${pct(value,total).toFixed(2)}%`;});
  }
  function attemptRates(region){
    if(!region||!region.ready)return[null,null,null];
    const attempts=[num(region.attempt1),num(region.attempt2),num(region.attempt3)],known=attempts.reduce((a,b)=>a+b,0),pod=num(region.pod);
    if(!known||!pod)return[null,null,null];
    return attempts.map(value=>pct(value,pod));
  }
  function setDispatchGroup(node,region){
    if(!node)return;const rates=attemptRates(region),spans=[...node.querySelectorAll(':scope > span')];
    spans.forEach((span,index)=>{const value=rates[index],bar=span.querySelector('i b'),em=span.querySelector('em');if(bar)bar.style.width=value===null?'0%':`${Math.max(0,Math.min(100,value))}%`;if(em)em.textContent=value===null?'—':`${value.toFixed(2)}%`;});
  }
  function applyHomeCurrent(payload){
    const root=homeRoot();if(!root)return;setBusinessCards(root,payload);
    const cn=payload?.business?.SHOPEECN||{},vn=payload?.business?.SHOPEEVN||{};
    const boxes=[...root.querySelectorAll('.v18-special-grid > div')];setPair(boxes[0],cn,vn,'pendingNonContinuous');setPair(boxes[1],cn,vn,'returned');
    const byLabel={'CN-PP':cn?.regions?.PP,'CN-PV':cn?.regions?.PV,'VN-PP':vn?.regions?.PP,'VN-PV':vn?.regions?.PV};
    root.querySelectorAll('.v18-dispatch-grid > div').forEach(node=>setDispatchGroup(node,byLabel[String(node.querySelector('h3')?.textContent||'').trim()]));
  }
  const REGION_KEYS={'今日件数':['total','件'],'签收率':['podRate','%'],'签收件数':['pod','件'],'Pending1+':['pending1','件'],'Pending2+':['pending2','件'],'Pending3+':['pending3','件'],'OC1+':['oc1','件'],'OC2+':['oc2','件'],'OC3+':['oc3','件'],'入库无扫描':['inboundNoScan','件'],'已退回件':['returned','件']};
  function setRegionBlock(block,row){
    if(!block||!row?.ready)return;
    block.querySelectorAll('button').forEach(button=>{
      const label=String(button.querySelector('span')?.textContent||'').trim(),spec=REGION_KEYS[label];if(!spec)return;
      const [key,unit]=spec,b=button.querySelector('b'),value=row[key];if(!b)return;
      b.textContent=unit==='%'?`${num(value).toFixed(2)}%`:num(value).toLocaleString('zh-CN');
    });
  }
  function applyShopeeBusiness(payload){
    const type=shopeeType(),root=shopeeRoot();if(!type||!root)return;
    const metric=payload?.business?.[type];if(!metric?.ready)return;
    for(const code of ['PP','PV']){
      const block=root.querySelector(`.region-block.${code.toLowerCase()}`);setRegionBlock(block,metric?.regions?.[code]);
    }
    root.querySelectorAll('.v18-dispatch-grid > div').forEach(node=>{
      const title=String(node.querySelector('h3')?.textContent||'').toUpperCase();
      if(title.includes('CN')&&type!=='SHOPEECN')return;if(title.includes('VN')&&type!=='SHOPEEVN')return;
      const code=title.includes('PV')?'PV':title.includes('PP')?'PP':'';if(code)setDispatchGroup(node,metric?.regions?.[code]);
    });
  }
  function values(data,key){const daily=Array.isArray(data?.daily)?data.daily:[];return daily.length?daily.map(row=>row?.ready?(row[key]===null||row[key]===undefined?null:num(row[key])):null):(data?.[key]||[]);}
  function firstAttemptValues(data){
    const daily=Array.isArray(data?.daily)?data.daily:[];
    if(!daily.length)return Array.isArray(data?.firstRate)?data.firstRate:[];
    return daily.map(row=>{if(!row?.ready)return null;const a1=num(row.attempt1),a2=num(row.attempt2),a3=num(row.attempt3),known=a1+a2+a3,pod=num(row.pod);return known&&pod?pct(a1,pod):null;});
  }
  function renderTrends(allTrend,shopeeTrend){
    const root=homeRoot();if(!root||!global.RateTrendCardV18?.render)return;const cards=[...root.querySelectorAll('.v18-trend-section .v18-chart-card')].slice(0,4);if(cards.length<4)return;
    const dates=allTrend?.dates||shopeeTrend?.dates||[];
    const specs=[
      {title:'今日票数趋势',type:'count',dates,series:[series('票数','#1677ff',values(allTrend,'total'))]},
      {title:'POD率趋势',type:'rate',dates,series:[series('POD率','#16a36a',values(allTrend,'podRate'))]},
      {title:'OC率趋势',type:'rate',oc:true,dates,series:[series('OC率','#ff8a00',values(allTrend,'ocRate'))]},
      {title:'首次妥投率趋势',type:'rate',dates,series:[series('SHOPEE首次妥投率','#6c4cf5',firstAttemptValues(shopeeTrend))]}
    ];
    cards.forEach((card,index)=>global.RateTrendCardV18.render(card,specs[index]));
    root.querySelectorAll('#v230MetricTruthPanel').forEach(node=>node.remove());
  }
  async function currentPayload(r,force=false){
    const live=global.__CE_QC_V237_CURRENT_SUMMARY__;
    if(!force&&live&&String(live.reportDate||'')===r.to)return live;
    return cached(`current|${r.to}`,`/api/v234/current-summary?reportDate=${encodeURIComponent(r.to)}`,force);
  }
  async function refreshHome(force=false){
    if(!onHome()||!homeRoot())return;const r=range();if(!r.to)return;const id=++requestId;
    try{
      const [current,allTrend,shopeeTrend]=await Promise.all([
        currentPayload(r,force),
        cached(`all|${r.from}|${r.to}`,`/api/v234/trends?businessType=ALL&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,force),
        cached(`shopee|${r.from}|${r.to}`,`/api/v234/trends?businessType=SHOPEE&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,force)
      ]);
      if(id!==requestId)return;applyHomeCurrent(current);renderTrends(allTrend,shopeeTrend);
    }catch(error){console.warn('[V237 home dashboard]',error);}
  }
  async function refreshShopeeRegions(force=false){
    if(!shopeeType()||!shopeeRoot())return;const r=range();if(!r.to)return;
    try{applyShopeeBusiness(await currentPayload(r,force));}catch(error){console.warn('[V237 shopee regions]',error);}
  }
  function schedule(delay=80,force=false){clearTimeout(timer);timer=setTimeout(()=>{if(onHome())void refreshHome(force);else if(shopeeType())void refreshShopeeRegions(force);},delay);}
  const observer=new MutationObserver(records=>{
    const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('#homePage,#shopeePage,.v18-business-grid,.v18-mid-grid,.v18-trend-section,.region-block,.v18-dispatch-grid')||node.querySelector?.('.v18-business-grid,.v18-mid-grid,.v18-trend-section,.region-block,.v18-dispatch-grid'))));
    if(relevant)schedule(80,false);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(120,true);if(event.target?.closest?.('.side-link[data-page]'))schedule(100,false);},true);
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(120,true);});
  global.addEventListener('popstate',()=>schedule(80,false));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(100,true),{once:true});else schedule(100,true);
  console.info('[CE-QC][V237_HOME_DASHBOARD_OWNER]',VERSION,'homepage + SHOPEE PP/PV visible blocks use V237 exact current/trend truth');
})(window);
