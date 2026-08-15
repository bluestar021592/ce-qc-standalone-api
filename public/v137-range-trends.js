(function installRangeTrendsV137(global){
  if(global.__CE_QC_V137_RANGE_TRENDS__)return;
  const VERSION='2026-08-15-v142-range-trends-lifecycle-v4';
  const TYPE_BY_PATH=new Map([['/ce','CE'],['/ceaf','CEAF'],['/tbkh','TBKH'],['/ali1688','ALI1688'],['/shopeecn','SHOPEECN'],['/shopeevn','SHOPEEVN'],['/whpp','WHPP']]);
  const LABELS={CE:'CE',CEAF:'CEAF空运',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN',WHPP:'WHPP本土',TOTAL:'七业务合计'};
  const cache=new Map(),active=new Map();
  const CACHE_MS=8_000;
  let timer=null,requestSeq=0;

  const style=document.createElement('style');
  style.textContent=`
    .v141-no-day-data{margin:0 0 14px;padding:14px 16px;border:1px solid #f0c36d;border-radius:9px;background:#fffaf0;color:#7a581d;line-height:1.6}
    .v141-no-day-data b{color:#9b5c00}.v141-no-day-data small{display:block;margin-top:3px;color:#8c744c}
    .v141-no-day-data[data-state="failed"]{border-color:#ef9a9a;background:#fff6f6;color:#8a3333}.v141-no-day-data[data-state="failed"] b{color:#b42318}
  `;
  document.head.appendChild(style);

  function valid(value){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
  function range(){const to=valid(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value);const from=valid(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value)||to;return{from,to};}
  function type(){const path=location.pathname.toLowerCase();return ['/','/home'].includes(path)?'TOTAL':TYPE_BY_PATH.get(path)||'';}
  function key(businessType,r){return`${businessType}|${r.from}|${r.to}`;}
  async function load(businessType){
    const r=range();if(!r.to)return null;const k=key(businessType,r),now=Date.now();const hit=cache.get(k);if(hit&&now-hit.at<CACHE_MS)return hit.data;if(active.has(k))return active.get(k);
    const q=new URLSearchParams({businessType,from:r.from||r.to,to:r.to});
    const promise=fetch(`/api/v137/trends?${q}`,{cache:'no-store',credentials:'same-origin'}).then(async response=>{if(!response.ok)return null;const data=await response.json();if(data?.ok===false)return null;cache.set(k,{at:Date.now(),data});return data;}).finally(()=>active.delete(k));
    active.set(k,promise);return promise;
  }
  function chart(title,typeName,dates,name,values,extra={}){return{title,type:typeName,dates,oc:Boolean(extra.oc),series:[{name,color:extra.color||'#1677ff',values:Array.isArray(values)?values:[],numerators:[],denominators:[]}]};}
  function models(data,businessType){const dates=data?.dates||[],name=LABELS[businessType]||businessType;return[
    chart('今日票数趋势','count',dates,name,data?.ticket,{color:'#1677ff'}),
    chart('POD率趋势','rate',dates,name,data?.podRate,{color:'#16a36a'}),
    chart('OC率趋势','rate',dates,name,data?.ocRate,{color:'#ff8a00',oc:true}),
    chart('首次妥投率趋势','rate',dates,name,data?.firstRate,{color:'#6c4cf5'})
  ];}
  function rootFor(businessType){if(businessType==='TOTAL')return document.getElementById('homePage');if(businessType==='WHPP')return document.getElementById('whppFastPage');if(businessType.startsWith('SHOPEE'))return document.getElementById('shopeePage');return document.getElementById('ccslPage');}
  function hideLegacy(root){
    if(!root)return;
    root.querySelectorAll('.v18-trend-section:not(.v137-exclusive-trends)').forEach(node=>{node.hidden=true;node.style.display='none';node.dataset.replacedBy='V142';});
    root.querySelectorAll('#v27ForcedHomeAttemptTrends,#v27ForcedAttemptTrend,.v27-force-trend,.v27-force-attempt,.v27-attempt-section').forEach(node=>{node.hidden=true;node.style.display='none';node.dataset.replacedBy='V142';});
    root.querySelectorAll('.v56-trend-blocker,#v56TrendHistoryTruth,#v56HomeTrendHistoryTruth,#v56AttemptEvidenceTruth,#v56HomeAttemptEvidenceTruth').forEach(node=>node.remove());
  }
  function ensureSection(businessType){
    const root=rootFor(businessType);if(!root||root.hidden)return null;hideLegacy(root);
    let section=root.querySelector(':scope > .v137-exclusive-trends');
    if(!section){section=document.createElement('section');section.className='v18-panel v137-exclusive-trends';section.innerHTML='<h2>趋势图表</h2><section class="v18-chart-grid"></section>';const legacy=root.querySelector('.v18-trend-section');if(legacy)legacy.insertAdjacentElement('afterend',section);else{const detail=root.querySelector('#whppV132Detail,.v18-detail-preview');if(detail)root.insertBefore(section,detail);else root.appendChild(section);}}
    const grid=section.querySelector('.v18-chart-grid');while(grid.querySelectorAll('.v18-chart-card').length<4){const card=document.createElement('article');card.className='v18-chart-card';grid.appendChild(card);}return section;
  }
  function rangeLabel(data){const n=Array.isArray(data?.dates)?data.dates.length:0;if(!n)return'暂无有效日报';return data?.trendPolicy==='LAST_7_VALID_DAYS'?`最近 ${n} 个有效日报日`:`本期 ${n} 个有效日报日`;}
  function render(section,data,businessType){if(!section||!global.RateTrendCardV18?.render)return;const cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4),list=models(data,businessType);cards.forEach((node,index)=>{global.RateTrendCardV18.render(node,list[index]);const head=node.querySelector('.v18-chart-head span');if(head)head.textContent=rangeLabel(data);});section.querySelector('.v137-trend-quality')?.remove();const unknown=(data?.attemptUnknownPod||[]).reduce((sum,value)=>sum+Number(value||0),0);if(unknown>0&&['TOTAL','SHOPEECN','SHOPEEVN'].includes(businessType)){const note=document.createElement('div');note.className='v56-trend-truth-note v56-attempt-warning v137-trend-quality';note.innerHTML=`1/2/3派中仍有 <b>${unknown.toLocaleString('zh-CN')}</b> 票POD缺少可验证派次证据；系统已按“数据库派次字段 → 真实轨迹派送节点 → POD日期”继续识别，剩余无证据票不会硬猜。`;section.appendChild(note);}}
  function attemptModel(label,data){return{title:`${label} 1/2/3派成功率趋势`,type:'rate',dates:data?.dates||[],series:[
    {name:'1派',color:'#1677ff',values:data?.attempt1||[],numerators:data?.attempt1Count||[],denominators:data?.attemptDenominator||[]},
    {name:'2派',color:'#16a36a',values:data?.attempt2||[],numerators:data?.attempt2Count||[],denominators:data?.attemptDenominator||[]},
    {name:'3派',color:'#ff8a00',values:data?.attempt3||[],numerators:data?.attempt3Count||[],denominators:data?.attemptDenominator||[]}
  ]};}
  function ensureAttemptSection(root,count){
    if(!root)return null;let section=root.querySelector(':scope > .v137-attempt-trends');if(!section){section=document.createElement('section');section.className='v18-panel v137-attempt-trends';section.innerHTML='<h2>SHOPEE 1/2/3派成功率趋势</h2><section class="v137-attempt-grid"></section>';const trends=root.querySelector(':scope > .v137-exclusive-trends');trends?.insertAdjacentElement('afterend',section);}const grid=section.querySelector('.v137-attempt-grid');while(grid.children.length<count){const card=document.createElement('article');card.className='v18-chart-card';grid.appendChild(card);}while(grid.children.length>count)grid.lastElementChild.remove();return section;
  }
  function renderAttempts(data,businessType){
    const root=rootFor(businessType);if(!root||!global.RateTrendCardV18?.render)return;
    if(businessType==='TOTAL'){
      const cn=data?.related?.SHOPEECN,vn=data?.related?.SHOPEEVN;if(!cn&&!vn)return;const section=ensureAttemptSection(root,2),cards=[...section.querySelectorAll('.v18-chart-card')];global.RateTrendCardV18.render(cards[0],attemptModel('SHOPEE CN',cn||{}));global.RateTrendCardV18.render(cards[1],attemptModel('SHOPEE VN',vn||{}));
    }else if(['SHOPEECN','SHOPEEVN'].includes(businessType)){
      const section=ensureAttemptSection(root,1),card=section.querySelector('.v18-chart-card');global.RateTrendCardV18.render(card,attemptModel(LABELS[businessType],data));
    }
  }
  function availabilityTargets(root){
    if(!root)return[];
    return [...root.children].filter(node=>node?.nodeType===1&&(
      node.classList.contains('v18-business-grid')||node.classList.contains('v18-core')||node.classList.contains('v18-mid-grid')||node.classList.contains('v18-page-heading')
    ));
  }
  function lifecycleMessage(data,date,latest){
    const life=data?.requestedDateLifecycle||{};
    if(life.status==='NOT_IMPORTED'||life.imported===false){
      return {state:'missing',title:`${date} 尚未导入日报。`,detail:`数据库中没有这一天的有效日报导入，因此不能显示当天指标。${latest?`下方趋势继续显示最近有效日报，最新到 ${latest}。`:''}`};
    }
    if(life.status==='PROCESSING'){
      const missing=(life.missing||[]).join(' + ')||'业务处理链';
      return {state:'processing',title:`${date} 日报已导入，正在等待处理完成。`,detail:`当前缺少 ${missing} 的 VALID + COMPLETED 子快照。系统会每60秒自动复核并补成正式统一快照，不需要重新上传日报。${latest?`完成前，下方趋势暂时显示到 ${latest}。`:''}`};
    }
    if(life.status==='RECONCILIATION_FAILED'){
      return {state:'failed',title:`${date} 已处理，但统一快照一致性检查未通过。`,detail:`系统没有把错误数据伪装成“0”。需要继续修复对账差异后才能正式展示当天指标。${life.error?` 原因：${life.error}`:''}`};
    }
    return {state:'missing',title:`${date} 没有 VALID + COMPLETED 的有效日报快照。`,detail:`因此本日核心指标不能按“0”解释，系统已隐藏这批0值卡片。${latest?`下方趋势仅展示最近有效日报，最新到 ${latest}。`:''}`};
  }
  function applySelectedDateAvailability(data,businessType){
    const root=rootFor(businessType);if(!root)return;
    const r=range();const single=Boolean(r.from&&r.to&&r.from===r.to);const missing=single&&data?.requestedDateAvailable===false;
    let banner=root.querySelector(':scope > .v141-no-day-data');
    if(!missing){
      banner?.remove();
      root.querySelectorAll('[data-v141-hidden-for-no-data="1"]').forEach(node=>{node.hidden=false;node.style.removeProperty('display');delete node.dataset.v141HiddenForNoData;});
      return;
    }
    const latest=(data?.dates||[]).at(-1)||'';
    const message=lifecycleMessage(data,r.to,latest);
    if(!banner){banner=document.createElement('section');banner.className='v141-no-day-data';root.prepend(banner);}
    banner.dataset.state=message.state;
    banner.innerHTML=`<b>${message.title}</b><small>${message.detail}</small>`;
    availabilityTargets(root).forEach(node=>{node.dataset.v141HiddenForNoData='1';node.hidden=true;node.style.display='none';});
  }
  async function refresh(){const businessType=type();if(!businessType)return;const seq=++requestSeq;const data=await load(businessType).catch(()=>null);if(seq!==requestSeq||!data)return;applySelectedDateAvailability(data,businessType);const section=ensureSection(businessType);render(section,data,businessType);renderAttempts(data,businessType);hideLegacy(rootFor(businessType));}
  function schedule(delay=60){clearTimeout(timer);timer=setTimeout(()=>void refresh(),delay);}
  function invalidate(){cache.clear();requestSeq++;schedule(50);}

  const previousRenderAll=global.renderAll;if(typeof previousRenderAll==='function')global.renderAll=function v142RenderAll(...args){const result=previousRenderAll.apply(this,args);schedule(30);return result;};
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery,.side-link'))invalidate();});
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))invalidate();});
  document.addEventListener('ce-qc-run-complete',invalidate);
  global.addEventListener('popstate',invalidate);
  const main=document.querySelector('main.main-content');if(main){const observer=new MutationObserver(records=>{const changed=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.id==='whppFastPage'||node.classList?.contains('v18-trend-section')||node.querySelector?.('#whppFastPage,.v18-trend-section'))));if(changed)schedule(40);});observer.observe(main,{childList:true,subtree:true});}
  global.__CE_QC_V137_RANGE_TRENDS__={version:VERSION,refresh,invalidate,cacheSize:()=>cache.size};schedule(40);
  console.info('[CE-QC][V142_RANGE_TRENDS]',VERSION);
})(window);
