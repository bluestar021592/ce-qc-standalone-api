(function installV237HomeDashboardOwner(global){
  if(global.__CE_QC_V237_HOME_DASHBOARD_OWNER__)return;
  global.__CE_QC_V237_HOME_DASHBOARD_OWNER__=true;
  const VERSION='2026-08-22-v237-home-dashboard-owner-v1';
  const cache=new Map();let timer=null,requestId=0;
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const pct=(value,total)=>total?Number((num(value)*100/num(total)).toFixed(2)):0;
  const currentPath=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const onHome=()=>['/','/home'].includes(currentPath());
  const range=()=>{const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};};
  const series=(name,color,values)=>({name,color,values:Array.isArray(values)?values:[],numerators:[],denominators:[]});
  async function json(url){const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);return data;}
  async function cached(key,url,force=false){if(!force&&cache.has(key))return cache.get(key);const data=await json(url);cache.set(key,data);return data;}
  function homeRoot(){const root=document.getElementById('homePage');return root&&!root.hidden?root:null;}
  function setPair(box,cn,vn,key){
    if(!box)return;const spans=[...box.querySelectorAll(':scope > span')];
    [[spans[0],cn],[spans[1],vn]].forEach(([span,m])=>{if(!span)return;const value=num(m?.[key]),total=num(m?.total);const b=span.querySelector('b'),small=span.querySelector('small');if(b)b.textContent=value.toLocaleString('zh-CN');if(small)small.textContent=`${pct(value,total).toFixed(2)}%`;});
  }
  function attemptRates(region){
    if(!region||!region.ready)return[null,null,null];
    const attempts=[num(region.attempt1),num(region.attempt2),num(region.attempt3)],known=attempts.reduce((a,b)=>a+b,0),total=num(region.total);
    if(!known||!total)return[null,null,null];
    return attempts.map(value=>pct(value,total));
  }
  function setDispatchGroup(node,region){
    if(!node)return;const rates=attemptRates(region),spans=[...node.querySelectorAll(':scope > span')];
    spans.forEach((span,index)=>{const value=rates[index],bar=span.querySelector('i b'),em=span.querySelector('em');if(bar)bar.style.width=value===null?'0%':`${Math.max(0,Math.min(100,value))}%`;if(em)em.textContent=value===null?'—':`${value.toFixed(2)}%`;});
  }
  function applyCurrent(payload){
    const root=homeRoot();if(!root)return;const cn=payload?.business?.SHOPEECN||{},vn=payload?.business?.SHOPEEVN||{};
    const boxes=[...root.querySelectorAll('.v18-special-grid > div')];setPair(boxes[0],cn,vn,'pendingNonContinuous');setPair(boxes[1],cn,vn,'returned');
    const byLabel={
      'CN-PP':cn?.regions?.PP,'CN-PV':cn?.regions?.PV,
      'VN-PP':vn?.regions?.PP,'VN-PV':vn?.regions?.PV
    };
    root.querySelectorAll('.v18-dispatch-grid > div').forEach(node=>setDispatchGroup(node,byLabel[String(node.querySelector('h3')?.textContent||'').trim()]));
  }
  function values(data,key){const daily=Array.isArray(data?.daily)?data.daily:[];return daily.length?daily.map(row=>row?.ready?(row[key]===null||row[key]===undefined?null:num(row[key])):null):(data?.[key]||[]);}
  function firstAttemptValues(data){
    const daily=Array.isArray(data?.daily)?data.daily:[];
    if(!daily.length)return Array.isArray(data?.firstRate)?data.firstRate:[];
    return daily.map(row=>{if(!row?.ready)return null;const a1=num(row.attempt1),a2=num(row.attempt2),a3=num(row.attempt3),known=a1+a2+a3,total=num(row.total);return known&&total?pct(a1,total):null;});
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
  async function refresh(force=false){
    if(!onHome()||!homeRoot())return;const r=range();if(!r.to)return;const id=++requestId;
    try{
      const [current,allTrend,shopeeTrend]=await Promise.all([
        cached(`current|${r.to}`,`/api/v234/current-summary?reportDate=${encodeURIComponent(r.to)}`,force),
        cached(`all|${r.from}|${r.to}`,`/api/v234/trends?businessType=ALL&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,force),
        cached(`shopee|${r.from}|${r.to}`,`/api/v234/trends?businessType=SHOPEE&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,force)
      ]);
      if(id!==requestId)return;applyCurrent(current);renderTrends(allTrend,shopeeTrend);
    }catch(error){console.warn('[V237 home dashboard]',error);}
  }
  function schedule(delay=80,force=false){clearTimeout(timer);timer=setTimeout(()=>void refresh(force),delay);}
  const observer=new MutationObserver(records=>{if(!onHome())return;const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('#homePage,.v18-mid-grid,.v18-trend-section')||node.querySelector?.('.v18-mid-grid,.v18-trend-section'))));if(relevant)schedule(80,false);});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(120,true);if(event.target?.closest?.('.side-link[data-page="home"]'))schedule(100,false);},true);
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(120,true);});
  global.addEventListener('popstate',()=>schedule(80,false));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(100,true),{once:true});else schedule(100,true);
  console.info('[CE-QC][V237_HOME_DASHBOARD_OWNER]',VERSION,'homepage SHOPEE specialty + four trends use V237 exact daily truth');
})(window);
