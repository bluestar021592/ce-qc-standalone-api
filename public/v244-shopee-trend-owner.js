(function installV248ShopeeTrendOwner(global){
  if(global.__CE_QC_V245_SHOPEE_TREND_OWNER__)return;
  global.__CE_QC_V245_SHOPEE_TREND_OWNER__=true;
  global.__CE_QC_V244_SHOPEE_TREND_OWNER__=true;
  global.__CE_QC_V248_SHOPEE_TREND_OWNER__=true;
  const VERSION='2026-09-18-stability-shopee-readonly-trend-v1';
  const PATH_TYPE={shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const cache=new Map();
  let timer=null;
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=v=>v===null||v===undefined?'—':`${num(v).toFixed(2)}%`;
  const type=()=>PATH_TYPE[String(location.pathname||'').replace(/^\//,'').toLowerCase()]||'';
  const range=()=>{const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};};
  const root=()=>document.getElementById('shopeePage');
  const fmt=(value,kind)=>value===null||value===undefined?'—':kind==='days'?`${num(value).toFixed(2)}天`:Math.round(num(value)).toLocaleString('zh-CN');

  function ensureStyle(){
    if(document.getElementById('v245ShopeeTrendStyle'))return;
    const style=document.createElement('style');style.id='v245ShopeeTrendStyle';style.textContent=`
      #v245ShopeeAttemptTruth{margin-top:18px}
      #v245ShopeeAttemptTruth .v245-attempt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}
      #v245ShopeeAttemptTruth .v245-attempt-head h2{margin:0 0 5px;color:#17365d}
      #v245ShopeeAttemptTruth .v245-attempt-head p{margin:0;color:#6a7f9b;font-size:12px;line-height:1.7}
      #v245ShopeeAttemptTruth .v245-attempt-tag{white-space:nowrap;padding:5px 9px;border-radius:999px;background:#edf5ff;color:#2468d8;font-size:11px;font-weight:700}
      #v245ShopeeAttemptTruth .v245-attempt-table-wrap{overflow:auto;margin-top:12px}
      #v245ShopeeAttemptTruth table{width:100%;min-width:1080px;border-collapse:collapse;font-size:13px}
      #v245ShopeeAttemptTruth th,#v245ShopeeAttemptTruth td{padding:10px 9px;border-bottom:1px solid #edf2f8;text-align:right;font-variant-numeric:tabular-nums}
      #v245ShopeeAttemptTruth th:first-child,#v245ShopeeAttemptTruth td:first-child{text-align:left}
      #v245ShopeeAttemptTruth th{background:#f4f8fd;color:#536b88}
      #v245ShopeeAttemptTruth .v245-unknown{font-weight:700;color:#a16207}
      #v234DailyTrendTruth .v245-avg-days{font-weight:800;color:#6842d9}
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
      const text=svgNode('text',{x:pad.l-6,y:y+4,'text-anchor':'end',class:'v18-axis'});text.textContent=fmt(max*(1-i/3),kind);svg.appendChild(text);
    }
    dates.forEach((date,i)=>{const x=pad.l+(width-pad.l-pad.r)*i/Math.max(1,dates.length-1);const text=svgNode('text',{x,y:height-7,'text-anchor':'middle',class:'v18-axis v18-date-axis'});text.textContent=String(date||'').slice(5)||'—';svg.appendChild(text);});
    const points=[];
    values.forEach((value,i)=>{if(value===null||value===undefined)return;const v=num(value),x=pad.l+(width-pad.l-pad.r)*i/Math.max(1,dates.length-1),y=pad.t+(height-pad.t-pad.b)*(1-v/max);points.push({x,y,v});const dot=svgNode('circle',{cx:x,cy:y,r:3,fill:'#1677ff'});const titleNode=svgNode('title');titleNode.textContent=`${dates[i]} · ${label} · ${fmt(v,kind)}`;dot.appendChild(titleNode);svg.appendChild(dot);if(dates.length<=10){const text=svgNode('text',{x,y:Math.max(11,y-6),'text-anchor':'middle',fill:'#1677ff','font-size':'8','font-weight':'700'});text.textContent=fmt(v,kind);svg.appendChild(text);}});
    if(points.length>=2)svg.appendChild(svgNode('polyline',{points:points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#1677ff','stroke-width':'2.2','stroke-linejoin':'round','stroke-linecap':'round'}));
    card.querySelector('.v18-chart-plot').appendChild(svg);
    const last=points.at(-1)?.v??null,prev=points.at(-2)?.v??null,delta=last===null||prev===null?null:last-prev;
    const current=card.querySelector('.v18-chart-current');const box=document.createElement('div');box.innerHTML='<span></span><b></b><small></small>';box.querySelector('span').textContent=`${label} 当前`;box.querySelector('b').textContent=fmt(last,kind);box.querySelector('b').style.color='#1677ff';box.querySelector('small').textContent=delta===null?'较昨日 —':`较昨日 ${delta>=0?'↑':'↓'}${kind==='days'?Math.abs(delta).toFixed(2)+'天':Math.round(Math.abs(delta)).toLocaleString('zh-CN')}`;current.appendChild(box);
    card.querySelector('.v18-chart-note').textContent=points.length<2?`有效节点不足（${points.length}/${Math.max(2,dates.length||7)}），累计到2个有效日期后显示折线`:'按每日锁定日报成员与持续追踪事实计算；当前值与曲线最后有效节点保持一致';
    card.dataset.v248=VERSION;
  }

  function removeDuplicateAssessmentCards(r){
    const duplicate=new Set(['首日POD','首日妥投率','首日POD妥投率','首次妥投率']);
    r.querySelectorAll('.v18-business-card,.v18-metric-card').forEach(card=>{const label=String(card.querySelector('span')?.textContent||'').trim();if(duplicate.has(label))card.remove();});
  }

  function renderDaily(data,r){
    ensureStyle();
    const rows=(data.daily||[]).map(x=>`<tr><td>${esc(x.reportDate)}</td><td>${fmt(x.total)}</td><td>${fmt(x.pod)}</td><td class="v240-rate">${pct(x.podRate)}</td><td>${fmt(x.oc)}</td><td class="v240-oc">${pct(x.ocRate)}</td><td class="v245-avg-days">${fmt(x.avgPodDays,'days')}</td></tr>`).join('');
    let panel=r.querySelector('#v234DailyTrendTruth');
    if(!panel){panel=document.createElement('section');panel.id='v234DailyTrendTruth';const trend=r.querySelector('.v18-trend-section');(trend||r).appendChild(panel);}
    panel.innerHTML=`<div class="v240-trend-head"><div><h3>每日趋势明细</h3><p>固定口径：POD率 = POD ÷ 锁定日报成员总票；OC率 = 当前真实OC ÷ 锁定日报成员总票；平均签收天数 = 第一次日报日期 → 实际POD日期（含首尾当天）。</p></div><span class="v240-source">${esc(data.businessType)} · V246持续追踪账本</span></div><div class="v240-table-wrap"><table class="v240-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>当日OC</th><th>OC率</th><th>平均签收天数</th></tr></thead><tbody>${rows||'<tr><td class="v240-missing" colspan="7">当前区间暂无有效日报</td></tr>'}</tbody></table></div>`;
    panel.dataset.v248=VERSION;
  }

  function findAttemptHost(r){
    const headings=[...r.querySelectorAll('h1,h2,h3,h4')];
    const heading=headings.find(node=>/1\s*\/\s*2\s*\/\s*3\s*派/.test(String(node.textContent||'')));
    if(heading){const section=heading.closest('section');if(section&&section!==r)return section;}
    return r.querySelector('#v245ShopeeAttemptTruth');
  }

  function renderAttempts(data,r){
    ensureStyle();
    let host=findAttemptHost(r);
    if(!host){host=document.createElement('section');host.className='v18-panel';const daily=r.querySelector('#v234DailyTrendTruth'),trend=r.querySelector('.v18-trend-section');if(daily?.parentNode)daily.parentNode.insertBefore(host,daily.nextSibling);else(trend||r).appendChild(host);}
    host.id='v245ShopeeAttemptTruth';host.classList.add('v18-panel');host.dataset.v248ShopeeAttempt=VERSION;
    const rows=(data.daily||[]).map(x=>`<tr><td>${esc(x.reportDate)}</td><td>${fmt(x.pod)}</td><td>${fmt(x.attempt1)}</td><td>${pct(x.attempt1Rate)}</td><td>${fmt(x.attempt2)}</td><td>${pct(x.attempt2Rate)}</td><td>${fmt(x.attempt3)}</td><td>${pct(x.attempt3Rate)}</td><td class="v245-unknown">${fmt(x.attemptUnknown)}</td></tr>`).join('');
    host.innerHTML=`<div class="v245-attempt-head"><div><h2>1/2/3派签收占POD趋势</h2><p>1/2/3派只使用真实派次证据；占比 = 对应派次已POD票数 ÷ 当日POD。无法确认派次的已POD票单独列为“派次未识别POD”，不再把无证据显示成真实0%。</p></div><span class="v245-attempt-tag">${esc(data.businessType)} · V246严格派次</span></div><article class="v18-chart-card v245-attempt-chart"></article><div class="v245-attempt-table-wrap"><table><thead><tr><th>日期</th><th>POD</th><th>1派签收</th><th>1派占POD</th><th>2派签收</th><th>2派占POD</th><th>3派+签收</th><th>3派+占POD</th><th>派次未识别POD</th></tr></thead><tbody>${rows||'<tr><td colspan="9">当前区间暂无有效日报</td></tr>'}</tbody></table></div>`;
    const chart=host.querySelector('.v245-attempt-chart');
    if(global.RateTrendCardV18?.render){
      global.RateTrendCardV18.render(chart,{title:`${data.businessType} 1/2/3派签收占POD趋势`,type:'rate',dates:data.dates||[],series:[
        {name:'1派',color:'#1677ff',values:data.attempt1Rate||[],numerators:data.attempt1||[],denominators:data.pod||[]},
        {name:'2派',color:'#16a36a',values:data.attempt2Rate||[],numerators:data.attempt2||[],denominators:data.pod||[]},
        {name:'3派+',color:'#ff8a00',values:data.attempt3Rate||[],numerators:data.attempt3||[],denominators:data.pod||[]}
      ]});
    }
  }

  function render(data){
    const t=type(),r=root();if(!t||!r||r.hidden)return;
    ensureStyle();
    const section=r.querySelector('.v18-trend-section');
    if(section){const cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4),dates=data.dates||[];if(cards.length>=4){
      renderCard(cards[0],{title:'票数趋势',label:'票数',dates,values:data.ticket||[]});
      renderCard(cards[1],{title:'POD数量趋势',label:'POD数量',dates,values:data.pod||[]});
      renderCard(cards[2],{title:'平均签收天数趋势',label:'平均签收天数',kind:'days',dates,values:data.avgPodDays||[]});
      renderCard(cards[3],{title:'OC数量趋势',label:'OC数量',dates,values:data.oc||[]});
      section.dataset.v248ShopeeTrend=VERSION;
    }}
    renderDaily(data,r);
    renderAttempts(data,r);
    removeDuplicateAssessmentCards(r);
  }

  async function refresh(force=false){
    const t=type(),rg=range();if(!t||!rg.to)return;
    const key=`${t}|${rg.from}|${rg.to}`;
    if(!force&&cache.has(key)){render(cache.get(key));return;}
    try{
      const response=await fetch(`/api/v319/trends?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      cache.set(key,data);render(data);
    }catch(error){console.warn('[V248 Shopee trend]',error);}
  }
  function schedule(delay=180){clearTimeout(timer);timer=setTimeout(()=>void refresh(true),delay);}
  function activateIfShopee(delay=80){if(type())schedule(delay);}
  function bind(){
    for(const id of ['topRangeFrom','topRangeTo','dashboardRangeFrom','dashboardRangeTo']){
      const node=document.getElementById(id);if(node&&!node.dataset.v248ShopeeBound){node.dataset.v248ShopeeBound='1';node.addEventListener('change',()=>activateIfShopee(160));}
    }
    const r=root();
    if(r&&global.MutationObserver&&!r.__v248ShopeeObserver){
      const observer=new MutationObserver(records=>{
        if(!type()||r.hidden)return;
        const becameVisible=records.some(record=>record.type==='attributes'&&record.attributeName==='hidden');
        const text=String(r.textContent||'');
        const legacy=/当前没有可验证的1\/2\/3派证据|历史快照不足（0\/|正在读取派次趋势|首次妥投率趋势|首日POD妥投率趋势/.test(text);
        if(becameVisible||legacy)schedule(becameVisible?80:180);
      });
      observer.observe(r,{attributes:true,attributeFilter:['hidden'],childList:true,subtree:true});
      r.__v248ShopeeObserver=observer;
    }
    if(!document.documentElement.dataset.v248ShopeeNavBound){
      document.documentElement.dataset.v248ShopeeNavBound='1';
      document.addEventListener('click',event=>{
        if(event.target?.closest?.('.side-link[data-page="shopeecn"],.side-link[data-page="shopeevn"],.v18-business-card'))setTimeout(()=>activateIfShopee(60),0);
      },true);
      global.addEventListener('popstate',()=>setTimeout(()=>activateIfShopee(60),0));
    }
    const previousNavigate=global.navigatePage;
    if(typeof previousNavigate==='function'&&!previousNavigate.__v248ShopeeOwner){
      const wrapped=function(page,...args){const result=previousNavigate.call(this,page,...args);if(['shopeecn','shopeevn'].includes(String(page||'').toLowerCase()))schedule(60);return result;};
      wrapped.__v248ShopeeOwner=true;global.navigatePage=wrapped;
    }
    activateIfShopee(120);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  const previousFetch=global.fetch?.bind(global);
  if(previousFetch){global.fetch=function v248ShopeeTrendFetchBridge(input,init){const text=typeof input==='string'?input:String(input?.url||'');const promise=previousFetch(input,init);if(type()&&text.includes('/api/v234/trends?'))promise.then(()=>schedule(120)).catch(()=>{});return promise;};}
  console.info('[CE-QC][STABILITY_SHOPEE_TREND_OWNER]',VERSION,'SHOPEECN/VN visible trends read /api/v319/trends only; browser navigation never launches V246/V263 evidence work.');
})(window);
