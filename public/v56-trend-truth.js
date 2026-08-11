(function installTrendTruthV56(global){
  if(global.__CE_QC_V56_TREND_TRUTH__)return;
  global.__CE_QC_V56_TREND_TRUTH__=true;
  const VERSION='2026-08-11-v56-trend-truth-v1';
  const TYPE_BY_PATH=new Map([['/ce','CE'],['/ceaf','CEAF'],['/tbkh','TBKH'],['/ali1688','ALI1688'],['/shopeecn','SHOPEECN'],['/shopeevn','SHOPEEVN']]);
  let timer=null;

  const style=document.createElement('style');
  style.textContent=`.v56-trend-truth-note{margin:8px 10px 2px;padding:10px 12px;border:1px solid #d9e4f2;border-radius:8px;background:#f7fbff;color:#607792;font-size:13px;line-height:1.55}.v56-trend-truth-note b{color:#12365c}.v56-attempt-warning{border-color:#f5d7a6;background:#fffaf0;color:#8a6426}`;
  document.head.appendChild(style);

  function type(){return TYPE_BY_PATH.get(location.pathname.toLowerCase())||'';}
  function range(){
    const to=document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'';
    const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to;
    return{from:String(from).slice(0,10),to:String(to).slice(0,10)};
  }
  function last(list){return Array.isArray(list)&&list.length?list[list.length-1]:0;}
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
  function historyText(data){
    const dates=Array.isArray(data?.dates)?data.dates:[];
    if(dates.length>=2)return'';
    const date=dates[0]||range().to||'当前日期';
    return `<b>当前没有足够历史数据形成趋势线。</b> 数据库目前只有 ${dates.length} 个有效日报日期${dates.length?`（${date}）`:''}。至少导入 2 个不同日期后才显示真实趋势；系统不会补造前6天数据。`;
  }
  function attemptText(data){
    const unknown=Number(last(data?.attemptUnknownPod)||0),denom=Number(last(data?.attemptDenominator)||0),dates=Array.isArray(data?.dates)?data.dates:[];
    const parts=[];
    if(dates.length<2)parts.push(`当前只有 ${dates.length} 个有效日报日期，暂时不能形成1/2/3派趋势线。`);
    if(unknown>0)parts.push(`当前有 <b>${unknown}</b> 票POD缺少可验证的派次证据，这些票不会被硬算成1派/2派/3派。`);
    else if(denom===0&&dates.length)parts.push('当前没有可验证的1/2/3派证据，因此不能把页面上的0%理解成真实“零派送”。');
    return parts.join(' ');
  }
  async function inspectBusiness(){
    const businessType=type();if(!businessType)return;
    const data=await load(businessType);if(!data)return;
    const root=businessType.startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');
    const section=root?.querySelector('.v18-trend-section');const h=historyText(data);
    if(h)upsert(section,'v56TrendHistoryTruth',h);else remove(section,'v56TrendHistoryTruth');
    if(businessType.startsWith('SHOPEE')){
      const attempt=root?.querySelector('#v27ForcedAttemptTrend');const text=attemptText(data);
      if(text)upsert(attempt,'v56AttemptEvidenceTruth',text,true);else remove(attempt,'v56AttemptEvidenceTruth');
    }
  }
  async function inspectHome(){
    if(!['/','/home'].includes(location.pathname.toLowerCase()))return;
    const [cn,vn]=await Promise.all([load('SHOPEECN'),load('SHOPEEVN')]);
    const section=document.getElementById('v27ForcedHomeAttemptTrends');if(!section)return;
    const cnText=cn?attemptText(cn):'',vnText=vn?attemptText(vn):'';
    const text=[cnText?`CN：${cnText}`:'',vnText?`VN：${vnText}`:''].filter(Boolean).join('<br>');
    if(text)upsert(section,'v56HomeAttemptEvidenceTruth',text,true);else remove(section,'v56HomeAttemptEvidenceTruth');
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{void inspectBusiness();void inspectHome();},180);}
  const observer=new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('.v18-trend-section,#v27ForcedAttemptTrend,#v27ForcedHomeAttemptTrends')||node.querySelector?.('.v18-trend-section,#v27ForcedAttemptTrend,#v27ForcedHomeAttemptTrends')))))schedule();});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.getElementById('topRangeQuery')?.addEventListener('click',schedule);
  global.addEventListener('popstate',schedule);schedule();
  console.info('[CE-QC][TREND_V56]',VERSION);
})(window);
