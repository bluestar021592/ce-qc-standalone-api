(function installV171WhppTrendParity(global){
  if(global.__CE_QC_V152_WHPP_TREND__)return;
  const VERSION='2026-08-17-v171-whpp-v18-trend-parity-v1';
  let timer=null,lastKey='',lastAt=0,lastPayload=null,hostObserver=null,observedHost=null;

  const dateNow=()=>String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||new Date().toISOString().slice(0,10)).slice(0,10);
  const host=()=>document.getElementById('whppFastPage');

  function chart(title,type,dates,values,oc=false){
    return {title,type,oc,dates:Array.isArray(dates)?dates:[],series:[{name:'WHPP',values:(Array.isArray(values)?values:[]).map(value=>Number(value||0))}]};
  }

  async function load(){
    const date=dateNow(),key=date;
    if(lastPayload&&lastKey===key&&Date.now()-lastAt<10000)return lastPayload;
    const response=await fetch(`/api/v171/whpp-trends?reportDate=${encodeURIComponent(date)}`,{cache:'no-store',credentials:'same-origin'});
    const text=await response.text();let body={};try{body=text?JSON.parse(text):{};}catch{}
    if(!response.ok||body.ok===false)throw new Error(body.error||body.message||`HTTP ${response.status}`);
    lastKey=key;lastAt=Date.now();lastPayload=body;return body;
  }

  function ensureHostObserver(){
    const page=host();
    if(!page||page===observedHost)return;
    hostObserver?.disconnect?.();
    observedHost=page;
    hostObserver=new MutationObserver(()=>{
      if(location.pathname!=='/whpp'||page.hidden)return;
      if(!document.getElementById('v152WhppTrend'))schedule(80);
    });
    hostObserver.observe(page,{childList:true});
  }

  function upsert(data){
    const page=host();
    if(!page||page.hidden||location.pathname!=='/whpp')return;
    ensureHostObserver();
    let section=document.getElementById('v152WhppTrend');
    if(!section){section=document.createElement('section');section.id='v152WhppTrend';}
    section.className='v18-panel v18-trend-section';
    const dates=Array.isArray(data?.dates)?data.dates:[];
    const charts=[
      chart('今日票数趋势','count',dates,data?.ticket||[]),
      chart('POD率趋势','rate',dates,data?.podRate||[]),
      chart('OC率趋势','rate',dates,data?.ocRate||[],true),
      chart('退回率趋势','rate',dates,data?.returnRate||[])
    ];
    section.innerHTML=`<h2>趋势图表</h2><section class="v18-chart-grid">${charts.map((_,index)=>`<article class="v18-chart-card" data-chart-index="${index}"></article>`).join('')}</section>`;
    const detail=document.getElementById('whppV132Detail');
    if(detail?.parentNode===page)page.insertBefore(section,detail);else page.appendChild(section);
    section.querySelectorAll('.v18-chart-card').forEach((node,index)=>global.RateTrendCardV18?.render?.(node,charts[index]));
  }

  async function refreshTrend(){
    if(location.pathname!=='/whpp')return;
    const page=host();
    if(!page)return schedule(120);
    ensureHostObserver();
    try{upsert(await load());}
    catch(error){
      let section=document.getElementById('v152WhppTrend');
      if(!section){section=document.createElement('section');section.id='v152WhppTrend';}
      section.className='v18-panel v18-trend-section';
      section.innerHTML=`<h2>趋势图表</h2><div class="empty-state">趋势读取失败：${String(error.message||error)}</div>`;
      const detail=document.getElementById('whppV132Detail');
      if(detail?.parentNode===page)page.insertBefore(section,detail);else page.appendChild(section);
    }
  }

  function schedule(ms=120){clearTimeout(timer);timer=setTimeout(refreshTrend,ms);}
  function scheduleBurst(){schedule(100);setTimeout(()=>{if(location.pathname==='/whpp')refreshTrend();},650);setTimeout(()=>{if(location.pathname==='/whpp')refreshTrend();},1600);}

  global.addEventListener('popstate',scheduleBurst);
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="whpp"],#topRangeQuery,#dashboardRangeQuery'))scheduleBurst();});
  document.addEventListener('ce-qc-run-complete',()=>{lastAt=0;scheduleBurst();});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleBurst,{once:true});else scheduleBurst();
  global.__CE_QC_V152_WHPP_TREND__={version:VERSION,refresh:refreshTrend};
  console.info('[CE-QC][V171_WHPP_V18_TREND_PARITY]',VERSION);
})(window);
