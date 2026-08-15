(function installTrendTruthV56(global){
  if(global.__CE_QC_V56_TREND_TRUTH__)return;
  global.__CE_QC_V56_TREND_TRUTH__=true;
  const VERSION='2026-08-11-v57-trend-truth-v2';
  const TYPE_BY_PATH=new Map([['/ce','CE'],['/ceaf','CEAF'],['/tbkh','TBKH'],['/ali1688','ALI1688'],['/shopeecn','SHOPEECN'],['/shopeevn','SHOPEEVN']]);
  let timer=null;

  const style=document.createElement('style');
  style.textContent=`
    .v56-trend-truth-note{margin:8px 10px 2px;padding:10px 12px;border:1px solid #d9e4f2;border-radius:8px;background:#f7fbff;color:#607792;font-size:13px;line-height:1.55}
    .v56-trend-truth-note b{color:#12365c}.v56-attempt-warning{border-color:#f5d7a6;background:#fffaf0;color:#8a6426}
    .v56-history-blocked{position:relative!important;overflow:hidden!important}
    .v56-trend-blocker{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:22px;text-align:center;background:rgba(255,255,255,.98);color:#6b7f98;border-radius:6px}
    .v56-trend-blocker b{font-size:15px;color:#183b63}.v56-trend-blocker span{font-size:13px;line-height:1.6;max-width:360px}
  `;
  document.head.appendChild(style);

  function pageType(){return TYPE_BY_PATH.get(location.pathname.toLowerCase())||'';}
  function isHome(){return ['/','/home'].includes(location.pathname.toLowerCase());}
  function range(){
    const to=document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'';
    const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to;
    return{from:String(from).slice(0,10),to:String(to).slice(0,10)};
  }
  function last(list){return Array.isArray(list)&&list.length?list[list.length-1]:0;}
  function datesOf(data){return Array.isArray(data?.dates)?data.dates.filter(Boolean):[];}
  function unionDates(...items){return [...new Set(items.flatMap(datesOf))].sort();}
  async function load(businessType){
    const r=range();if(!r.to)return null;
    const q=new URLSearchParams({businessType,from:r.from||r.to,to:r.to});
    const response=await fetch(`/api/v27/trends?${q}`,{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)return null;return response.json();
  }
  function upsert(section,id,text,warning=false){
    if(!section)return;let note=section.querySelector(`#${id}`);if(!note){note=document.createElement('div');note.id=id;const h=section.querySelector('h2');if(h)h.insertAdjacentElement('afterend',note);else section.prepend(note);}
    note.className=`v56-trend-truth-note${warning?' v56-attempt-warning':''}`;note.innerHTML=text;
  }
  function remove(section,id){section?.querySelector(`#${id}`)?.remove();}
  function blockerText(dates,attempt=false,unknown=0,denom=0){
    const count=dates.length;const date=dates[0]||range().to||'当前日期';
    const parts=[count===0?'当前没有有效日报日期。':`当前只有 ${count} 个有效日报日期${count===1?`（${date}）`:''}，无法形成真实趋势线。`,'至少导入 2 个不同日期后才显示折线；系统不会补造前6天数据。'];
    if(attempt){
      if(unknown>0)parts.push(`其中 ${unknown} 票POD缺少可验证的派次证据，不会硬算成1派/2派/3派。`);
      else if(denom===0&&count)parts.push('当前没有可验证的1/2/3派证据，页面不会把它解释成真实0%。');
    }
    return parts.join(' ');
  }
  function applyBlock(card,dates,{attempt=false,unknown=0,denom=0}={}){
    if(!card)return;
    const insufficient=dates.length<2;
    let blocker=card.querySelector(':scope > .v56-trend-blocker');
    if(!insufficient){blocker?.remove();card.classList.remove('v56-history-blocked');return;}
    card.classList.add('v56-history-blocked');
    if(!blocker){blocker=document.createElement('div');blocker.className='v56-trend-blocker';card.appendChild(blocker);}
    blocker.innerHTML=`<b>历史数据不足，暂不显示趋势</b><span>${blockerText(dates,attempt,unknown,denom)}</span>`;
  }
  function applySectionBlocks(section,dates){
    if(!section)return;
    section.querySelectorAll('.v18-chart-card').forEach(card=>applyBlock(card,dates));
  }
  function historyText(dates){
    if(dates.length>=2)return'';
    const date=dates[0]||range().to||'当前日期';
    return `<b>当前没有足够历史数据形成趋势线。</b> 数据库目前只有 ${dates.length} 个有效日报日期${dates.length?`（${date}）`:''}。至少导入 2 个不同日期后才显示真实趋势；系统不会补造前6天数据。`;
  }
  function attemptText(data){
    const unknown=Number(last(data?.attemptUnknownPod)||0),denom=Number(last(data?.attemptDenominator)||0),dates=datesOf(data);
    const parts=[];
    if(dates.length<2)parts.push(`当前只有 ${dates.length} 个有效日报日期，暂时不能形成1/2/3派趋势线。`);
    if(unknown>0)parts.push(`当前有 <b>${unknown}</b> 票POD缺少可验证的派次证据，这些票不会被硬算成1派/2派/3派。`);
    else if(denom===0&&dates.length)parts.push('当前没有可验证的1/2/3派证据，因此不能把页面上的0%理解成真实“零派送”。');
    return parts.join(' ');
  }
  async function inspectBusiness(){
    const businessType=pageType();if(!businessType)return;
    const data=await load(businessType);if(!data)return;
    const dates=datesOf(data);
    const root=businessType.startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');
    const section=root?.querySelector('.v18-trend-section');
    const h=historyText(dates);if(h)upsert(section,'v56TrendHistoryTruth',h);else remove(section,'v56TrendHistoryTruth');
    applySectionBlocks(section,dates);
    if(businessType.startsWith('SHOPEE')){
      const attempt=root?.querySelector('#v27ForcedAttemptTrend');const text=attemptText(data);
      if(text)upsert(attempt,'v56AttemptEvidenceTruth',text,true);else remove(attempt,'v56AttemptEvidenceTruth');
      const card=attempt?.querySelector('.v27-force-attempt-card');
      applyBlock(card,dates,{attempt:true,unknown:Number(last(data?.attemptUnknownPod)||0),denom:Number(last(data?.attemptDenominator)||0)});
    }
  }
  async function inspectHome(){
    if(!isHome())return;
    const [ce,cn,vn]=await Promise.all([load('CE'),load('SHOPEECN'),load('SHOPEEVN')]);
    const root=document.getElementById('homePage');
    const homeDates=unionDates(ce,cn,vn);
    const section=root?.querySelector('.v18-trend-section');
    const h=historyText(homeDates);if(h)upsert(section,'v56HomeTrendHistoryTruth',h);else remove(section,'v56HomeTrendHistoryTruth');
    applySectionBlocks(section,homeDates);

    const attemptSection=document.getElementById('v27ForcedHomeAttemptTrends');
    if(!attemptSection)return;
    const cnText=cn?attemptText(cn):'',vnText=vn?attemptText(vn):'';
    const text=[cnText?`CN：${cnText}`:'',vnText?`VN：${vnText}`:''].filter(Boolean).join('<br>');
    if(text)upsert(attemptSection,'v56HomeAttemptEvidenceTruth',text,true);else remove(attemptSection,'v56HomeAttemptEvidenceTruth');
    const cnDates=datesOf(cn),vnDates=datesOf(vn);
    applyBlock(attemptSection.querySelector('[data-group="CN"]'),cnDates,{attempt:true,unknown:Number(last(cn?.attemptUnknownPod)||0),denom:Number(last(cn?.attemptDenominator)||0)});
    applyBlock(attemptSection.querySelector('[data-group="VN"]'),vnDates,{attempt:true,unknown:Number(last(vn?.attemptUnknownPod)||0),denom:Number(last(vn?.attemptDenominator)||0)});
  }
  function schedule(delay=160){clearTimeout(timer);timer=setTimeout(()=>{void inspectBusiness();void inspectHome();},delay);}
  const observer=new MutationObserver(records=>{
    const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&!node.classList?.contains('v56-trend-blocker')&&(node.matches?.('.v18-trend-section,#v27ForcedAttemptTrend,#v27ForcedHomeAttemptTrends,.v18-chart-card,.v27-force-attempt-card')||node.querySelector?.('.v18-trend-section,#v27ForcedAttemptTrend,#v27ForcedHomeAttemptTrends,.v18-chart-card,.v27-force-attempt-card'))));
    if(relevant)schedule();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery'))schedule(220);});
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(220);});
  global.addEventListener('popstate',()=>schedule(220));
  schedule();
  console.info('[CE-QC][TREND_V57]',VERSION);
})(window);
