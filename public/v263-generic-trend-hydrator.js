(function installV263GenericTrendHydrator(global){
  if(global.__CE_QC_V263_GENERIC_TREND_HYDRATOR__)return;
  global.__CE_QC_V263_GENERIC_TREND_HYDRATOR__=true;
  const VERSION='2026-08-23-v263-generic-nontarget-trends-v1';
  const PAGE_TYPE={ce:'CE',ceaf:'CEAF',ali1688:'ALI1688'};
  let timer=null,busy=false,lastKey='';
  const n=v=>Number.isFinite(Number(v))?Number(v):0;

  function activePage(){
    const nav=String(document.querySelector('.side-link.active[data-page]')?.dataset?.page||'').toLowerCase();
    if(nav)return nav;
    const title=String(document.getElementById('pageTitle')?.textContent||'').toUpperCase();
    if(title.includes('CEAF'))return'ceaf';
    if(title.includes('ALI1688'))return'ali1688';
    if(/^CE看板/.test(title))return'ce';
    return String(location.pathname||'').replace(/^\/+|\/+$/g,'').toLowerCase();
  }
  const type=()=>PAGE_TYPE[activePage()]||'';
  function range(){const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};}
  function root(){return document.getElementById('ccslPage');}
  const series=(name,color,values,numerators=[],denominators=[])=>({name,color,values:Array.isArray(values)?values:[],numerators,denominators});
  function values(data,key,fallback=[]){const daily=Array.isArray(data?.daily)?data.daily:[];return daily.length?daily.map(r=>r?.ready?(r[key]===null||r[key]===undefined?null:n(r[key])):null):fallback;}
  function render(data,t){
    const r=root();if(!r||r.hidden||type()!==t)return false;
    const section=r.querySelector('.v18-trend-section');const renderer=global.RateTrendCardV18?.render;if(!section||typeof renderer!=='function')return false;
    let cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4);
    if(cards.length<4){section.innerHTML='<h2>趋势图表</h2><section class="v18-chart-grid">'+Array.from({length:4},(_,i)=>`<article class="v18-chart-card" data-chart-index="${i}"></article>`).join('')+'</section>';cards=[...section.querySelectorAll('.v18-chart-card')];}
    const dates=data?.dates||[],ticket=values(data,'total',data?.ticket||[]),pod=values(data,'pod',data?.pod||[]),oc=values(data,'ocCurrent',data?.oc||[]);
    const specs=[
      {title:'票数趋势',type:'count',dates,series:[series(`${t}票数`,'#1677ff',ticket)]},
      {title:'POD率趋势',type:'rate',dates,series:[series(`${t} POD率`,'#16a36a',values(data,'podRate',data?.podRate||[]),pod,ticket)]},
      {title:'OC率趋势',type:'rate',oc:true,dates,series:[series(`${t} OC率`,'#ff8a00',values(data,'ocRate',data?.ocRate||[]),oc,ticket)]},
      {title:'首日POD妥投率趋势',type:'rate',dates,series:[series(`${t} 首日POD`,'#6d4aff',values(data,'sameDayPodRate',data?.sameDayPodRate||[]),values(data,'sameDayPod',data?.sameDayPod||[]),ticket)]}
    ];
    cards.forEach((card,i)=>renderer(card,specs[i]));section.dataset.v263Generic=t;return true;
  }
  async function refresh(force=false){
    if(busy)return;const t=type(),rg=range(),r=root();if(!t||!rg.to||!r||r.hidden)return;const key=`${t}|${rg.from}|${rg.to}`;if(!force&&lastKey===key&&r.querySelector('.v18-trend-section')?.dataset?.v263Generic===t)return;
    busy=true;try{const response=await fetch(`/api/v253/trends?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`,{cache:'no-store',credentials:'same-origin'});const data=await response.json();if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);if(render(data,t))lastKey=key;}catch(error){console.warn('[CE-QC][V263_GENERIC_TREND]',t,error?.message||error);}finally{busy=false;}
  }
  function schedule(ms=80,force=false){clearTimeout(timer);timer=setTimeout(()=>refresh(force),ms);}
  function bind(){
    document.addEventListener('click',e=>{if(e.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(80,true);},true);
    document.addEventListener('change',e=>{if(e.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(100,true);},true);
    global.addEventListener('popstate',()=>schedule(80,true));
    const observer=new MutationObserver(records=>{if(busy||!type())return;const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('.v18-trend-section')||node.querySelector?.('.v18-trend-section'))));if(relevant)schedule(60,false);});
    if(document.body)observer.observe(document.body,{subtree:true,childList:true});
    [50,350,1000].forEach(ms=>setTimeout(()=>refresh(false),ms));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V263_GENERIC_TREND_HYDRATOR__={version:VERSION,refresh,scope:['CE','CEAF','ALI1688']};
  console.info('[CE-QC][V263_GENERIC_TREND]',VERSION,'scoped to CE + CEAF + ALI1688 only; no attempt/signing metrics');
})(window);
