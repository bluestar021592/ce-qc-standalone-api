(function installRangeTrendsV137(global){
  if(global.__CE_QC_V137_RANGE_TRENDS__)return;
  const VERSION='2026-08-15-v137-range-trends-v1';
  const TYPE_BY_PATH=new Map([['/ce','CE'],['/ceaf','CEAF'],['/tbkh','TBKH'],['/ali1688','ALI1688'],['/shopeecn','SHOPEECN'],['/shopeevn','SHOPEEVN'],['/whpp','WHPP']]);
  const LABELS={CE:'CE',CEAF:'CEAF空运',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN',WHPP:'WHPP本土',TOTAL:'七业务合计'};
  let timer=null,requestSeq=0;

  function range(){const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};}
  function type(){const path=location.pathname.toLowerCase();return ['/','/home'].includes(path)?'TOTAL':TYPE_BY_PATH.get(path)||'';}
  async function load(businessType){const r=range();if(!r.to)return null;const q=new URLSearchParams({businessType,from:r.from||r.to,to:r.to});const response=await fetch(`/api/v137/trends?${q}`,{cache:'no-store',credentials:'same-origin'});if(!response.ok)return null;const data=await response.json();return data?.ok===false?null:data;}
  function chart(title,typeName,dates,name,values,extra={}){return{title,type:typeName,dates,oc:Boolean(extra.oc),series:[{name,color:extra.color||'#1677ff',values:Array.isArray(values)?values:[],numerators:[],denominators:[]}]};}
  function models(data,businessType){const dates=data?.dates||[],name=LABELS[businessType]||businessType;return[
    chart('今日票数趋势','count',dates,name,data?.ticket,{color:'#1677ff'}),
    chart('POD率趋势','rate',dates,name,data?.podRate,{color:'#16a36a'}),
    chart('OC率趋势','rate',dates,name,data?.ocRate,{color:'#ff8a00',oc:true}),
    chart('首次妥投率趋势','rate',dates,name,data?.firstRate,{color:'#6c4cf5'})
  ];}
  function ensureSection(businessType){
    let root=null;
    if(businessType==='TOTAL')root=document.getElementById('homePage');
    else if(businessType==='WHPP')root=document.getElementById('whppFastPage');
    else if(businessType.startsWith('SHOPEE'))root=document.getElementById('shopeePage');
    else root=document.getElementById('ccslPage');
    if(!root||root.hidden)return null;
    let section=root.querySelector('.v18-trend-section');
    if(!section&&businessType==='WHPP'){
      section=document.createElement('section');section.className='v18-panel v18-trend-section v137-whpp-trends';section.innerHTML='<h2>趋势图表</h2><section class="v18-chart-grid"></section>';
      const detail=root.querySelector('#whppV132Detail');if(detail)root.insertBefore(section,detail);else root.appendChild(section);
    }
    if(!section)return null;
    let grid=section.querySelector('.v18-chart-grid');if(!grid){grid=document.createElement('section');grid.className='v18-chart-grid';section.appendChild(grid);}
    while(grid.querySelectorAll('.v18-chart-card').length<4){const card=document.createElement('article');card.className='v18-chart-card';grid.appendChild(card);}
    return section;
  }
  function rangeLabel(data){const n=Array.isArray(data?.dates)?data.dates.length:0;if(!n)return'暂无有效日报';return data?.trendPolicy==='LAST_7_VALID_DAYS'?`最近 ${n} 个有效日报日`:`本期 ${n} 个有效日报日`;}
  function render(section,data,businessType){if(!section||!global.RateTrendCardV18?.render)return;const cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4),list=models(data,businessType);cards.forEach((node,index)=>{global.RateTrendCardV18.render(node,list[index]);const head=node.querySelector('.v18-chart-head span');if(head)head.textContent=rangeLabel(data);});
    section.querySelector('.v137-trend-quality')?.remove();const unknown=(data?.attemptUnknownPod||[]).reduce((sum,value)=>sum+Number(value||0),0);if(unknown>0){const note=document.createElement('div');note.className='v56-trend-truth-note v56-attempt-warning v137-trend-quality';note.innerHTML=`首次妥投率中有 <b>${unknown.toLocaleString('zh-CN')}</b> 票POD缺少可验证派次/日期证据，该日期点显示为“—”，系统不会硬猜。`;section.appendChild(note);}}
  async function refresh(){const businessType=type();if(!businessType)return;const seq=++requestSeq;const data=await load(businessType).catch(()=>null);if(seq!==requestSeq||!data)return;const section=ensureSection(businessType);render(section,data,businessType);}
  function schedule(delay=100){clearTimeout(timer);timer=setTimeout(()=>void refresh(),delay);}

  const previousRenderAll=global.renderAll;if(typeof previousRenderAll==='function')global.renderAll=function v137RenderAll(...args){const result=previousRenderAll.apply(this,args);schedule(80);return result;};
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery,.side-link'))schedule(260);});
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(180);});
  document.addEventListener('ce-qc-run-complete',()=>schedule(300));
  global.addEventListener('popstate',()=>schedule(220));
  const main=document.querySelector('main.main-content');if(main){const observer=new MutationObserver(records=>{const whppChanged=records.some(record=>record.target?.id==='whppFastPage'||[...record.addedNodes].some(node=>node?.nodeType===1&&(node.id==='whppFastPage'||node.matches?.('#whppFastPage > .v18-page-heading,#whppFastPage > .v18-business-grid,#whppFastPage > .v18-panel:not(.v18-trend-section)'))));if(whppChanged&&location.pathname==='/whpp')schedule(120);});observer.observe(main,{childList:true,subtree:true});}
  global.__CE_QC_V137_RANGE_TRENDS__={version:VERSION,refresh};schedule(180);
  console.info('[CE-QC][V137_RANGE_TRENDS]',VERSION);
})(window);
