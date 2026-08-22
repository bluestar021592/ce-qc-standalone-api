(function installV232FastMetricTruthUi(global){
  if(global.__CE_QC_V232_FAST_METRIC_UI__)return;
  global.__CE_QC_V232_FAST_METRIC_UI__=true;
  const VERSION='2026-08-22-v232-fast-daily-percent-ui-v1';
  const TYPE_BY_PATH=new Map([
    ['/','ALL'],['/home','ALL'],['/ce','CE'],['/ceaf','CEAF'],['/tbkh','TBKH'],['/ali1688','ALI1688'],['/whpp','WHPP'],['/shopeecn','SHOPEECN'],['/shopeevn','SHOPEEVN']
  ]);
  let timer=null;
  let fastController=null;
  let deepController=null;
  let lastFastKey='';
  let lastFastData=null;

  const style=document.createElement('style');
  style.textContent=`
    .v232-percent-panel{margin-top:14px;border:1px solid #d7e5f4;border-radius:10px;background:#fff;overflow:hidden}
    .v232-percent-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:13px 16px;border-bottom:1px solid #e3edf7}
    .v232-percent-head h3{margin:0;color:#123a67;font-size:18px}.v232-percent-head p{margin:5px 0 0;color:#71849a;font-size:12px;line-height:1.55}
    .v232-badge{white-space:nowrap;padding:5px 9px;border-radius:999px;background:#eaf7ef;color:#14804a;font-size:12px;font-weight:700}
    .v232-table-wrap{overflow:auto;max-height:430px}.v232-table{width:100%;border-collapse:collapse;min-width:980px;font-size:12px}
    .v232-table th{position:sticky;top:0;z-index:2;background:#f2f7fd;color:#23476c;padding:9px 8px;border-bottom:1px solid #d9e6f3;text-align:center;white-space:nowrap}
    .v232-table td{padding:8px;border-bottom:1px solid #edf2f7;text-align:center;white-space:nowrap}.v232-table tbody tr:hover{background:#f8fbff}
    .v232-table td.rate{font-weight:700;color:#0b57d0}.v232-table td.days{font-weight:700;color:#6c4cf5}
    .v232-note{padding:10px 16px;color:#607792;background:#f8fbff;font-size:12px;line-height:1.65;border-top:1px solid #e3edf7}
    .v232-loading{padding:22px;text-align:center;color:#73869c}.v232-error{padding:16px;color:#b42318;background:#fff5f5}
    .v232-deep-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:11px 16px;border-top:1px solid #e3edf7;background:#fffdf7;color:#715b2f;font-size:12px}
    .v232-deep-btn{border:1px solid #1677ff;background:#1677ff;color:#fff;border-radius:7px;padding:7px 12px;font-weight:700;cursor:pointer}.v232-deep-btn:disabled{opacity:.55;cursor:wait}
    .v232-attempt-body{padding:12px 14px}.v232-attempt-chart{min-height:220px}.v232-attempt-note{padding:12px;color:#667d96;text-align:center;background:#f8fbff;border:1px solid #dce8f4;border-radius:8px}
  `;
  document.head.appendChild(style);

  function pageType(){return TYPE_BY_PATH.get(location.pathname.toLowerCase())||'';}
  function range(){
    const to=document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||document.getElementById('topHistoryDate')?.value||'';
    const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to;
    return{from:String(from).slice(0,10),to:String(to).slice(0,10)};
  }
  function targetSection(type){
    if(type==='ALL')return document.getElementById('homePage')?.querySelector('.v18-trend-section');
    const root=type.startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');
    return root?.querySelector('.v18-trend-section');
  }
  function ensurePanel(section){
    if(!section)return null;
    let panel=section.querySelector('#v230MetricTruthPanel');
    if(panel){panel.className='v232-percent-panel';return panel;}
    panel=document.createElement('section');
    panel.id='v230MetricTruthPanel';
    panel.className='v232-percent-panel';
    panel.innerHTML='<div class="v232-loading">正在读取快速每日百分比…</div>';
    section.appendChild(panel);
    return panel;
  }
  function fmt(value){return Number(value||0).toLocaleString('zh-CN');}
  function pct(value){return `${Number(value||0).toFixed(2)}%`;}
  function days(value){const n=Number(value||0);return n>0?n.toFixed(2):'—';}
  function chartSeries(name,color,values){return{name,color,values:Array.isArray(values)?values:[],numerators:[],denominators:[]};}

  function updateNativeCharts(section,data){
    if(!section||!global.RateTrendCardV18?.render)return;
    const cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4);
    if(cards.length<4)return;
    const dates=Array.isArray(data.dates)?data.dates:[];
    const specs=[
      {title:'今日票数趋势',type:'count',dates,series:[chartSeries('票数','#1677ff',data.ticket)]},
      {title:'POD率趋势',type:'rate',dates,series:[chartSeries('POD率','#16a36a',data.podRate)]},
      {title:'OC率趋势',type:'rate',oc:true,dates,series:[chartSeries('OC率','#ff8a00',data.ocRate)]},
      {title:'首次妥投率趋势',type:'rate',dates,series:[chartSeries('首次妥投率','#6c4cf5',data.firstRate)]}
    ];
    cards.forEach((card,index)=>global.RateTrendCardV18.render(card,specs[index]));
    section.dataset.v232FastTrend='1';
  }

  function fastRows(data){
    if(Array.isArray(data.daily)&&data.daily.length)return data.daily;
    const dates=Array.isArray(data.dates)?data.dates:[];
    return dates.map((date,index)=>({
      date,total:data.ticket?.[index]||0,pod:data.pod?.[index]||0,podRate:data.podRate?.[index]||0,
      returned:data.returned?.[index]||0,returnRate:data.returnRate?.[index]||0,
      pending1:data.pending1?.[index]||0,pendingRate:data.pendingRate?.[index]||0,
      delivering:data.delivering?.[index]||0,deliveringRate:data.deliveringRate?.[index]||0,
      ocRate:data.ocRate?.[index]||0,firstRate:data.firstRate?.[index]||0
    }));
  }

  function renderFast(panel,data,type){
    const rows=fastRows(data).map(row=>`<tr>
      <td>${row.date}</td><td>${fmt(row.total)}</td>
      <td>${fmt(row.pod)}</td><td class="rate">${pct(row.podRate)}</td>
      <td>${fmt(row.returned)}</td><td class="rate">${pct(row.returnRate)}</td>
      <td>${fmt(row.pending1)}</td><td class="rate">${pct(row.pendingRate)}</td>
      <td>${fmt(row.delivering)}</td><td class="rate">${pct(row.deliveringRate)}</td>
      <td class="rate">${pct(row.ocRate)}</td><td class="rate">${pct(row.firstRate)}</td>
    </tr>`).join('');
    const shopee=type.startsWith('SHOPEE');
    panel.innerHTML=`
      <div class="v232-percent-head"><div><h3>每日百分比趋势明细</h3><p>直接读取已完成日报的轻量缓存，不重新扫描运单、不重新读取整条轨迹；上方四张趋势图与这里使用同一批每日数据。</p></div><span class="v232-badge">快速读取 · ${type==='ALL'?'总看板七业务':type}</span></div>
      <div class="v232-table-wrap"><table class="v232-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>退回</th><th>退回率</th><th>Pending1+</th><th>Pending率</th><th>派送中</th><th>派送中率</th><th>OC1+率</th><th>首次妥投率</th></tr></thead><tbody>${rows||'<tr><td colspan="12">所选区间没有有效日报数据</td></tr>'}</tbody></table></div>
      ${shopee?'<div class="v232-deep-bar"><b>SHOPEE严格派次/时效：</b><span class="v232-deep-status">页面不会自动扫描23GB数据库；先读取已缓存严格结果，没有缓存时再手动校验。</span><button type="button" class="v232-deep-btn" data-v232-deep="1">严格校验1/2/3派与签收时效</button></div>':''}
      <div class="v232-note">单日查询显示截至该日最近7个有效日报日；自定义日期范围显示所选范围内全部有效日报日（最多180天）。所有百分比均按当天对应件数 ÷ 当天总票数计算。SHOPEE 1/2/3派不使用这张快速表里的旧派次字段，必须使用下方严格派送循环证据。</div>`;
  }

  function attemptSection(){
    const root=document.getElementById('shopeePage');
    if(!root)return null;
    return [...root.querySelectorAll('section,article')].find(node=>{
      const heading=node.querySelector(':scope > h2,:scope > h3');
      return /1\s*\/\s*2\s*\/\s*3\s*派.*趋势/.test(String(heading?.textContent||''));
    })||null;
  }
  function ensureAttemptBody(){
    const section=attemptSection();if(!section)return null;
    let body=section.querySelector(':scope > .v232-attempt-body');
    if(!body){body=document.createElement('div');body.className='v232-attempt-body';section.appendChild(body);}
    const heading=section.querySelector(':scope > h2,:scope > h3');
    [...section.children].forEach(child=>{if(child!==heading&&child!==body)child.style.display='none';});
    return body;
  }
  function markAttemptAwaiting(){
    const body=ensureAttemptBody();if(!body)return;
    body.innerHTML='<div class="v232-attempt-note">1/2/3派必须按真实派送循环校验：首次START=1派；只有发生失败/Pending后再次START才增加一派；重复START本身不增加派次。为了不拖慢看板，这一步不会自动扫库。<br><br><button type="button" class="v232-deep-btn" data-v232-deep="1">严格校验1/2/3派与签收时效</button></div>';
  }
  function renderDeep(data,type){
    const panel=document.getElementById('v230MetricTruthPanel');
    if(panel){
      const status=panel.querySelector('.v232-deep-status');
      if(status)status.textContent='严格结果已完成并缓存4小时；切换页面时不会重复计算。';
    }
    const body=ensureAttemptBody();if(!body)return;
    const daily=Array.isArray(data.daily)?data.daily:[];
    body.innerHTML='<div class="v232-attempt-chart v18-chart-card"></div><div class="v232-table-wrap"><table class="v232-table"><thead><tr><th>日期</th><th>POD</th><th>1派</th><th>1派占POD</th><th>2派</th><th>2派占POD</th><th>3派+</th><th>3派+占POD</th><th>派次未识别</th><th>平均签收天数</th><th>真实派送→POD天数</th></tr></thead><tbody>'+daily.map(row=>`<tr><td>${row.date}</td><td>${fmt(row.attemptDenominator)}</td><td>${fmt(row.attempt1Count)}</td><td class="rate">${pct(row.attempt1Rate)}</td><td>${fmt(row.attempt2Count)}</td><td class="rate">${pct(row.attempt2Rate)}</td><td>${fmt(row.attempt3Count)}</td><td class="rate">${pct(row.attempt3Rate)}</td><td>${fmt(row.attemptUnknownPod)}</td><td class="days">${days(row.averageSigningDays)}</td><td class="days">${days(row.averageRealDispatchToPodDays)}</td></tr>`).join('')+'</tbody></table></div><div class="v232-note">严格派次：首次真实START为1派；只有该派出现失败/Pending后又出现新的START，才进入下一派。没有START时才用ASSIGN循环兜底；无真实证据的POD保留“派次未识别”。平均签收天数按首次日报归属日→POD日（同日=1天）；“真实派送→POD天数”仅作派送执行诊断，两者不混算。</div>';
    const card=body.querySelector('.v232-attempt-chart');
    if(card&&global.RateTrendCardV18?.render){
      global.RateTrendCardV18.render(card,{title:'1/2/3派成功率趋势',type:'rate',dates:daily.map(row=>row.date),series:[
        chartSeries('1派','#1677ff',daily.map(row=>row.attempt1Rate)),
        chartSeries('2派','#16a36a',daily.map(row=>row.attempt2Rate)),
        chartSeries('3派+','#ff8a00',daily.map(row=>row.attempt3Rate))
      ]});
    }
  }

  async function probeDeepCache(type,r){
    if(!type.startsWith('SHOPEE'))return;
    try{
      const q=new URLSearchParams({businessType:type,from:r.from,to:r.to,cacheOnly:'1'});
      const response=await fetch(`/api/v230/metric-truth?${q}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json();
      if(response.ok&&data.cacheReady)renderDeep(data,type);else markAttemptAwaiting();
    }catch{markAttemptAwaiting();}
  }

  async function loadDeep(){
    const type=pageType();if(!type.startsWith('SHOPEE'))return;
    const r=range();if(!r.from||!r.to)return;
    const buttons=[...document.querySelectorAll('[data-v232-deep="1"]')];
    buttons.forEach(button=>{button.disabled=true;button.textContent='正在严格校验…';});
    const panel=document.getElementById('v230MetricTruthPanel');
    const status=panel?.querySelector('.v232-deep-status');if(status)status.textContent='正在读取真实派送循环与POD证据；这是手动深度校验，不会在普通看板打开时自动执行。';
    deepController?.abort();deepController=new AbortController();
    try{
      const q=new URLSearchParams({businessType:type,from:r.from,to:r.to,refresh:'1'});
      const response=await fetch(`/api/v230/metric-truth?${q}`,{cache:'no-store',credentials:'same-origin',signal:deepController.signal});
      const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      renderDeep(data,type);
    }catch(error){
      if(error?.name==='AbortError')return;
      if(status)status.textContent=`严格校验失败：${String(error?.message||error)}`;
      const body=ensureAttemptBody();if(body)body.innerHTML=`<div class="v232-error">严格派次/签收时效校验失败：${String(error?.message||error)}</div>`;
    }finally{
      [...document.querySelectorAll('[data-v232-deep="1"]')].forEach(button=>{button.disabled=false;button.textContent='严格校验1/2/3派与签收时效';});
    }
  }

  async function refreshFast(force=false){
    const type=pageType();if(!type)return;
    const r=range();if(!r.from||!r.to)return;
    const section=targetSection(type);if(!section)return;
    const panel=ensurePanel(section);if(!panel)return;
    const key=`${type}|${r.from}|${r.to}`;
    if(!force&&key===lastFastKey&&lastFastData){updateNativeCharts(section,lastFastData);return;}
    lastFastKey=key;panel.innerHTML='<div class="v232-loading">正在读取快速每日百分比…</div>';
    fastController?.abort();fastController=new AbortController();
    try{
      const q=new URLSearchParams({businessType:type,from:r.from,to:r.to});
      const response=await fetch(`/api/v27/trends?${q}`,{cache:'no-store',credentials:'same-origin',signal:fastController.signal});
      const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      if(!panel.isConnected)return;
      lastFastData=data;renderFast(panel,data,type);updateNativeCharts(section,data);void probeDeepCache(type,r);
    }catch(error){if(error?.name==='AbortError')return;if(panel.isConnected)panel.innerHTML=`<div class="v232-error">每日百分比趋势读取失败：${String(error?.message||error)}</div>`;}
  }
  function schedule(delay=120,force=false){clearTimeout(timer);timer=setTimeout(()=>void refreshFast(force),delay);}
  const observer=new MutationObserver(records=>{
    const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('.v18-trend-section,.v18-chart-card')||node.querySelector?.('.v18-trend-section'))));
    if(relevant)schedule(80,true);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-v232-deep="1"]')){event.preventDefault();void loadDeep();return;}
    if(event.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(150,true);
  });
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(150,true);});
  global.addEventListener('popstate',()=>schedule(100,true));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(120,true),{once:true});else schedule(120,true);
  console.info('[CE-QC][V232_FAST_METRIC_UI]',VERSION);
})(window);
