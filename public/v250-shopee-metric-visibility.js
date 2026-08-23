(function installV251ShopeeFinalOwner(global){
  if(global.__CE_QC_V251_SHOPEE_FINAL_OWNER__)return;
  global.__CE_QC_V251_SHOPEE_FINAL_OWNER__=true;
  const VERSION='2026-08-23-v251-shopee-final-render-owner-v1';
  const PATH_TYPE={shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const cache=new Map();
  const pending=new Map();
  let timer=null;
  let observer=null;
  let rendering=false;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const pct=value=>value===null||value===undefined?'—':`${num(value).toFixed(2)}%`;
  const fmt=value=>value===null||value===undefined?'—':Math.round(num(value)).toLocaleString('zh-CN');
  const days=value=>value===null||value===undefined?'—':`${num(value).toFixed(2)}天`;
  const type=()=>PATH_TYPE[String(location.pathname||'').replace(/^\//,'').toLowerCase()]||'';
  const root=()=>document.getElementById('shopeePage');
  function range(){
    const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
    const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);
    return {from,to};
  }
  function legacyVisible(r){
    const text=String(r?.textContent||'');
    return /正在读取派次趋势|首日POD|首日妥投率|首次妥投率趋势|首日POD妥投率趋势|POD率趋势|OC率趋势/.test(text);
  }
  function ensureRouteRoot(){
    const r=root();if(!type()||!r)return null;
    if(r.hidden)r.hidden=false;
    r.classList.add('active');
    return r;
  }
  function ensureStyle(){
    if(document.getElementById('v251ShopeeFinalStyle'))return;
    const style=document.createElement('style');style.id='v251ShopeeFinalStyle';style.textContent=`
      #v251ShopeeAttemptTruth{margin-top:18px}
      #v251ShopeeAttemptTruth .v251-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}
      #v251ShopeeAttemptTruth .v251-head h2{margin:0 0 5px;color:#17365d}
      #v251ShopeeAttemptTruth .v251-head p{margin:0;color:#6a7f9b;font-size:12px;line-height:1.7}
      #v251ShopeeAttemptTruth .v251-tag{white-space:nowrap;padding:5px 9px;border-radius:999px;background:#edf5ff;color:#2468d8;font-size:11px;font-weight:700}
      #v251ShopeeAttemptTruth .v251-table-wrap{overflow:auto;margin-top:12px}
      #v251ShopeeAttemptTruth table{width:100%;min-width:1220px;border-collapse:collapse;font-size:13px}
      #v251ShopeeAttemptTruth th,#v251ShopeeAttemptTruth td{padding:10px 9px;border-bottom:1px solid #edf2f8;text-align:right;font-variant-numeric:tabular-nums}
      #v251ShopeeAttemptTruth th:first-child,#v251ShopeeAttemptTruth td:first-child{text-align:left}
      #v251ShopeeAttemptTruth th{background:#f4f8fd;color:#536b88}
      #v251ShopeeAttemptTruth .v251-unknown{font-weight:700;color:#a16207}
      #v234DailyTrendTruth .v251-days{font-weight:800;color:#6842d9}
      #v234DailyTrendTruth .v251-coverage{color:#6a7f9b}
    `;document.head.appendChild(style);
  }
  function svgNode(tag,attrs={}){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));return node;}
  function renderCard(card,{title,kind='count',dates=[],values=[],label}){
    if(!card)return;
    const width=360,height=158,pad={l:42,r:54,t:18,b:30};
    card.innerHTML='<div class="v18-chart-head"><h3></h3><span></span></div><div class="v18-chart-legend"></div><div class="v18-chart-plot"></div><div class="v18-chart-current"></div><p class="v18-chart-note"></p>';
    card.querySelector('h3').textContent=title;
    card.querySelector('.v18-chart-head span').textContent=`${dates.length}个有效日报日`;
    const legend=card.querySelector('.v18-chart-legend');
    const item=document.createElement('span');const mark=document.createElement('i');mark.style.background='#1677ff';item.append(mark,document.createTextNode(label));legend.appendChild(item);
    const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':title});
    const valid=values.filter(v=>v!==null&&v!==undefined).map(num);
    const maxData=Math.max(...valid,1);
    const max=kind==='days'?Math.max(3,Math.ceil(maxData*1.25*10)/10):Math.max(1,Math.ceil(maxData*1.2));
    for(let i=0;i<=3;i++){
      const y=pad.t+(height-pad.t-pad.b)*i/3;
      svg.appendChild(svgNode('line',{x1:pad.l,x2:width-pad.r,y1:y,y2:y,class:'v18-grid'}));
      const text=svgNode('text',{x:pad.l-6,y:y+4,'text-anchor':'end',class:'v18-axis'});text.textContent=kind==='days'?`${(max*(1-i/3)).toFixed(1)}天`:Math.round(max*(1-i/3)).toLocaleString('zh-CN');svg.appendChild(text);
    }
    dates.forEach((date,i)=>{const x=pad.l+(width-pad.l-pad.r)*i/Math.max(1,dates.length-1);const text=svgNode('text',{x,y:height-7,'text-anchor':'middle',class:'v18-axis v18-date-axis'});text.textContent=String(date||'').slice(5)||'—';svg.appendChild(text);});
    const points=[];
    values.forEach((value,i)=>{if(value===null||value===undefined)return;const v=num(value),x=pad.l+(width-pad.l-pad.r)*i/Math.max(1,dates.length-1),y=pad.t+(height-pad.t-pad.b)*(1-v/max);points.push({x,y,v});const dot=svgNode('circle',{cx:x,cy:y,r:3,fill:'#1677ff'});const titleNode=svgNode('title');titleNode.textContent=`${dates[i]} · ${label} · ${kind==='days'?v.toFixed(2)+'天':fmt(v)}`;dot.appendChild(titleNode);svg.appendChild(dot);if(dates.length<=10){const text=svgNode('text',{x,y:Math.max(11,y-6),'text-anchor':'middle',fill:'#1677ff','font-size':'8','font-weight':'700'});text.textContent=kind==='days'?v.toFixed(2):fmt(v);svg.appendChild(text);}});
    if(points.length>=2)svg.appendChild(svgNode('polyline',{points:points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#1677ff','stroke-width':'2.2','stroke-linejoin':'round','stroke-linecap':'round'}));
    card.querySelector('.v18-chart-plot').appendChild(svg);
    const last=points.at(-1)?.v??null,prev=points.at(-2)?.v??null,delta=last===null||prev===null?null:last-prev;
    const current=card.querySelector('.v18-chart-current');const box=document.createElement('div');box.innerHTML='<span></span><b></b><small></small>';box.querySelector('span').textContent=`${label} 当前`;box.querySelector('b').textContent=kind==='days'?days(last):fmt(last);box.querySelector('b').style.color='#1677ff';box.querySelector('small').textContent=delta===null?'较昨日 —':`较昨日 ${delta>=0?'↑':'↓'}${kind==='days'?Math.abs(delta).toFixed(2)+'天':fmt(Math.abs(delta))}`;current.appendChild(box);
    card.querySelector('.v18-chart-note').textContent=points.length<2?`有效节点不足（${points.length}/${Math.max(2,dates.length||7)}），累计到2个有效日期后显示折线`:'锁定第一次日报成员；后续POD/退回/派次持续更新';
    card.dataset.v251=VERSION;
  }
  function renderOperationalCharts(data,r){
    const section=r.querySelector('.v18-trend-section');if(!section)return;
    let cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4);
    if(cards.length<4){section.innerHTML='<div class="v18-trend-grid">'+Array.from({length:4},()=>'<article class="v18-chart-card"></article>').join('')+'</div>';cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4);}
    const dates=data.dates||[];
    renderCard(cards[0],{title:'票数趋势',label:'票数',dates,values:data.ticket||[]});
    renderCard(cards[1],{title:'POD数量趋势',label:'POD数量',dates,values:data.pod||[]});
    renderCard(cards[2],{title:'平均签收天数趋势',label:'平均签收天数',kind:'days',dates,values:data.avgPodDays||[]});
    renderCard(cards[3],{title:'OC数量趋势',label:'OC数量',dates,values:data.oc||[]});
    section.dataset.v251ShopeeTrend=VERSION;
  }
  function renderDaily(data,r){
    const rows=(data.daily||[]).map(row=>{const coverage=row.pod?`${fmt(row.podDaysCount)}/${fmt(row.pod)}`:'—';return `<tr><td>${esc(row.reportDate)}</td><td>${fmt(row.total)}</td><td>${fmt(row.pod)}</td><td>${pct(row.podRate)}</td><td>${fmt(row.oc)}</td><td>${pct(row.ocRate)}</td><td class="v251-coverage">${coverage}</td><td class="v251-days"><b>${days(row.avgPodDays)}</b></td></tr>`;}).join('');
    let panel=r.querySelector('#v234DailyTrendTruth');
    if(!panel){panel=document.createElement('section');panel.id='v234DailyTrendTruth';const trend=r.querySelector('.v18-trend-section');(trend?.parentNode||r).appendChild(panel);}
    panel.innerHTML=`<div class="v240-trend-head"><div><h3>每日趋势明细</h3><p>平均签收天数 = 第一次日报日期 → 实际POD日期（含首尾当天）；第一次日报日期永久锁定。签收天数覆盖显示“有可靠POD日期票数 / 已POD票数”。</p></div><span class="v240-source">${esc(data.businessType)} · V246持续追踪账本</span></div><div class="v240-table-wrap"><table class="v240-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>当日OC</th><th>OC率</th><th>签收天数覆盖</th><th>平均签收天数</th></tr></thead><tbody>${rows||'<tr><td colspan="8">当前区间暂无有效日报</td></tr>'}</tbody></table></div>`;
    panel.dataset.v251=VERSION;
  }
  function attemptHost(r){
    const heading=[...r.querySelectorAll('h1,h2,h3,h4')].find(node=>/1\s*\/\s*2\s*\/\s*3\s*派/.test(String(node.textContent||'')));
    if(heading){const section=heading.closest('section');if(section&&section!==r)return section;}
    let host=r.querySelector('#v251ShopeeAttemptTruth,#v250ShopeeAttemptTruth,#v245ShopeeAttemptTruth');
    if(host)return host;
    host=document.createElement('section');host.className='v18-panel';const daily=r.querySelector('#v234DailyTrendTruth');if(daily?.parentNode)daily.parentNode.insertBefore(host,daily.nextSibling);else r.appendChild(host);return host;
  }
  function renderAttempts(data,r){
    const host=attemptHost(r);if(!host)return;
    host.id='v251ShopeeAttemptTruth';host.classList.add('v18-panel');
    const rows=(data.daily||[]).map(row=>`<tr><td>${esc(row.reportDate)}</td><td>${fmt(row.pod)}</td><td>${fmt(row.attempt1)}</td><td>${pct(row.attempt1Rate)}</td><td>${fmt(row.attempt2)}</td><td>${pct(row.attempt2Rate)}</td><td>${fmt(row.attempt3)}</td><td>${pct(row.attempt3Rate)}</td><td>${pct(row.attemptCoverageRate)}</td><td class="v251-unknown">${fmt(row.attemptUnknown)}</td></tr>`).join('');
    host.innerHTML=`<div class="v251-head"><div><h2>1/2/3派签收占POD趋势</h2><p>严格口径：首次真实70 START=1派；只有发生150 Pending/派送失败后，再出现新的70 START才+1派；整票无70才用60分配节点兜底。占比 = 对应派次已POD票 ÷ 当日POD。</p></div><span class="v251-tag">${esc(data.businessType)} · V246严格派次</span></div><article class="v18-chart-card v251-attempt-chart"></article><div class="v251-table-wrap"><table><thead><tr><th>日期</th><th>POD</th><th>1派签收</th><th>1派占POD</th><th>2派签收</th><th>2派占POD</th><th>3派+签收</th><th>3派+占POD</th><th>派次证据覆盖</th><th>派次未识别POD</th></tr></thead><tbody>${rows||'<tr><td colspan="10">当前区间暂无有效日报</td></tr>'}</tbody></table></div>`;
    const chart=host.querySelector('.v251-attempt-chart');
    if(global.RateTrendCardV18?.render){global.RateTrendCardV18.render(chart,{title:`${data.businessType} 1/2/3派签收占POD趋势`,type:'rate',dates:data.dates||[],series:[{name:'1派',color:'#1677ff',values:data.attempt1Rate||[],numerators:data.attempt1||[],denominators:data.pod||[]},{name:'2派',color:'#16a36a',values:data.attempt2Rate||[],numerators:data.attempt2||[],denominators:data.pod||[]},{name:'3派+',color:'#ff8a00',values:data.attempt3Rate||[],numerators:data.attempt3||[],denominators:data.pod||[]}]});}
    host.dataset.v251=VERSION;
  }
  function removeLegacyAssessment(r){
    const duplicate=new Set(['首日POD','首日妥投率','首日POD妥投率','首次妥投率']);
    r.querySelectorAll('.v18-business-card,.v18-metric-card').forEach(card=>{const label=String(card.querySelector('span')?.textContent||'').trim();if(duplicate.has(label))card.remove();});
  }
  function render(data){
    const r=ensureRouteRoot();if(!r)return;
    rendering=true;
    try{ensureStyle();renderOperationalCharts(data,r);renderDaily(data,r);renderAttempts(data,r);removeLegacyAssessment(r);r.dataset.v251ShopeeFinalOwner=VERSION;}finally{rendering=false;}
  }
  async function refresh(force=false){
    const t=type(),rg=range();if(!t||!rg.to)return;
    const key=`${t}|${rg.from}|${rg.to}`;
    const hit=cache.get(key);if(!force&&hit&&Date.now()-hit.at<5000){render(hit.data);return hit.data;}
    if(pending.has(key))return pending.get(key);
    const task=(async()=>{try{const response=await fetch(`/api/v246/shopee-trends?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`,{cache:'no-store',credentials:'same-origin'});const data=await response.json().catch(()=>({}));if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);cache.set(key,{at:Date.now(),data});render(data);return data;}catch(error){console.warn('[CE-QC][V251_SHOPEE_FINAL_OWNER]',error);return null;}finally{pending.delete(key);}})();pending.set(key,task);return task;
  }
  function schedule(delay=40,force=false){clearTimeout(timer);timer=setTimeout(()=>void refresh(force),delay);}
  function wrapCanonicalRender(){
    const originalShopee=global.renderShopeePage;
    if(typeof originalShopee==='function'&&!originalShopee.__v251FinalOwner){const wrapped=function(...args){const result=originalShopee.apply(this,args);if(type())queueMicrotask(()=>schedule(0,false));return result;};wrapped.__v251FinalOwner=true;wrapped.__v251Original=originalShopee;global.renderShopeePage=wrapped;}
    const originalAll=global.renderAll;
    if(typeof originalAll==='function'&&!originalAll.__v251FinalOwner){const wrapped=function(...args){const result=originalAll.apply(this,args);if(type())queueMicrotask(()=>schedule(0,false));return result;};wrapped.__v251FinalOwner=true;wrapped.__v251Original=originalAll;global.renderAll=wrapped;}
  }
  function bind(){
    wrapCanonicalRender();
    const body=document.body||document.documentElement;
    if(global.MutationObserver&&body&&!observer){observer=new MutationObserver(()=>{if(rendering)return;const r=root();if(type()&&r&&legacyVisible(r))schedule(80,false);});observer.observe(body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});}
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page="shopeecn"],.side-link[data-page="shopeevn"]'))setTimeout(()=>{wrapCanonicalRender();schedule(30,true);},0);},true);
    document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(80,true);},true);
    global.addEventListener('popstate',()=>{wrapCanonicalRender();schedule(30,true);});
    [30,150,500,1200].forEach(ms=>setTimeout(()=>{wrapCanonicalRender();if(type())schedule(0,ms===1200);},ms));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V251_SHOPEE_FINAL_OWNER__={version:VERSION,refresh,render,wrapCanonicalRender};
  console.info('[CE-QC][V251_SHOPEE_FINAL_OWNER]',VERSION,'wraps canonical renderAll/renderShopeePage so legacy Shopee trends cannot overwrite V246 ledger truth');
})(window);
