(function installV250ShopeeMetricVisibility(global){
  if(global.__CE_QC_V250_SHOPEE_METRIC_VISIBILITY__)return;
  global.__CE_QC_V250_SHOPEE_METRIC_VISIBILITY__=true;
  const VERSION='2026-08-23-v250-shopee-metric-visibility-v1';
  const PATH_TYPE={shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const cache=new Map();
  let timer=null;
  let observer=null;
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
    return /正在读取派次趋势|首日POD|首日妥投率|首次妥投率趋势|首日POD妥投率趋势/.test(text);
  }
  function ensureRouteRoot(){
    const r=root();if(!type()||!r)return null;
    if(r.hidden)r.hidden=false;
    r.classList.add('active');
    return r;
  }
  function nudgeV248(r){
    if(!r||!legacyVisible(r))return;
    const marker=document.createElement('i');
    marker.hidden=true;
    marker.dataset.v250ShopeeWake=VERSION;
    r.appendChild(marker);
    queueMicrotask(()=>marker.remove());
  }
  function renderDaily(data,r){
    const rows=(data.daily||[]).map(row=>`<tr><td>${esc(row.reportDate)}</td><td>${fmt(row.total)}</td><td>${fmt(row.pod)}</td><td>${pct(row.podRate)}</td><td>${fmt(row.oc)}</td><td>${pct(row.ocRate)}</td><td><b>${days(row.avgPodDays)}</b></td></tr>`).join('');
    let panel=r.querySelector('#v234DailyTrendTruth');
    if(!panel){panel=document.createElement('section');panel.id='v234DailyTrendTruth';(r.querySelector('.v18-trend-section')||r).appendChild(panel);}
    panel.innerHTML=`<div class="v240-trend-head"><div><h3>每日趋势明细</h3><p>平均签收天数 = 第一次日报日期 → 实际POD日期（含首尾当天）；第一次日报日期锁定，不因后续重复上传改变。</p></div><span class="v240-source">${esc(data.businessType)} · V246持续追踪账本</span></div><div class="v240-table-wrap"><table class="v240-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>当日OC</th><th>OC率</th><th>平均签收天数</th></tr></thead><tbody>${rows||'<tr><td colspan="7">当前区间暂无有效日报</td></tr>'}</tbody></table></div>`;
    panel.dataset.v250=VERSION;
  }
  function attemptHost(r){
    const heading=[...r.querySelectorAll('h1,h2,h3,h4')].find(node=>/1\s*\/\s*2\s*\/\s*3\s*派/.test(String(node.textContent||'')));
    if(heading){const section=heading.closest('section');if(section&&section!==r)return section;}
    let host=r.querySelector('#v250ShopeeAttemptTruth,#v245ShopeeAttemptTruth');
    if(host)return host;
    host=document.createElement('section');host.className='v18-panel';
    const daily=r.querySelector('#v234DailyTrendTruth');
    if(daily?.parentNode)daily.parentNode.insertBefore(host,daily.nextSibling);else r.appendChild(host);
    return host;
  }
  function renderAttempts(data,r){
    const host=attemptHost(r);if(!host)return;
    host.id='v250ShopeeAttemptTruth';host.classList.add('v18-panel');
    const rows=(data.daily||[]).map(row=>`<tr><td>${esc(row.reportDate)}</td><td>${fmt(row.pod)}</td><td>${fmt(row.attempt1)}</td><td>${pct(row.attempt1Rate)}</td><td>${fmt(row.attempt2)}</td><td>${pct(row.attempt2Rate)}</td><td>${fmt(row.attempt3)}</td><td>${pct(row.attempt3Rate)}</td><td><b>${fmt(row.attemptUnknown)}</b></td></tr>`).join('');
    host.innerHTML=`<div class="v245-attempt-head"><div><h2>1/2/3派签收占POD趋势</h2><p>真实START/失败循环计算；占比 = 对应派次已POD票 ÷ 当日POD。没有足够派次证据的POD单独列为“派次未识别POD”。</p></div><span class="v245-attempt-tag">${esc(data.businessType)} · V246严格派次</span></div><article class="v18-chart-card v250-attempt-chart"></article><div class="v245-attempt-table-wrap"><table><thead><tr><th>日期</th><th>POD</th><th>1派签收</th><th>1派占POD</th><th>2派签收</th><th>2派占POD</th><th>3派+签收</th><th>3派+占POD</th><th>派次未识别POD</th></tr></thead><tbody>${rows||'<tr><td colspan="9">当前区间暂无有效日报</td></tr>'}</tbody></table></div>`;
    const chart=host.querySelector('.v250-attempt-chart');
    if(global.RateTrendCardV18?.render){
      global.RateTrendCardV18.render(chart,{title:`${data.businessType} 1/2/3派签收占POD趋势`,type:'rate',dates:data.dates||[],series:[
        {name:'1派',color:'#1677ff',values:data.attempt1Rate||[],numerators:data.attempt1||[],denominators:data.pod||[]},
        {name:'2派',color:'#16a36a',values:data.attempt2Rate||[],numerators:data.attempt2||[],denominators:data.pod||[]},
        {name:'3派+',color:'#ff8a00',values:data.attempt3Rate||[],numerators:data.attempt3||[],denominators:data.pod||[]}
      ]});
    }
    host.dataset.v250=VERSION;
  }
  function removeLegacyAssessment(r){
    const duplicate=new Set(['首日POD','首日妥投率','首日POD妥投率','首次妥投率']);
    r.querySelectorAll('.v18-business-card,.v18-metric-card').forEach(card=>{const label=String(card.querySelector('span')?.textContent||'').trim();if(duplicate.has(label))card.remove();});
  }
  function render(data){
    const r=ensureRouteRoot();if(!r)return;
    renderDaily(data,r);
    renderAttempts(data,r);
    removeLegacyAssessment(r);
    r.dataset.v250ShopeeMetricVisibility=VERSION;
  }
  async function refresh(force=false){
    const t=type(),rg=range();if(!t||!rg.to)return;
    const r=ensureRouteRoot();if(!r)return;
    nudgeV248(r);
    const key=`${t}|${rg.from}|${rg.to}`;
    if(!force&&cache.has(key)){render(cache.get(key));return;}
    try{
      const response=await fetch(`/api/v246/shopee-trends?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);
      cache.set(key,data);render(data);
    }catch(error){console.warn('[CE-QC][V250_SHOPEE_METRIC_VISIBILITY]',error);}
  }
  function schedule(delay=80){clearTimeout(timer);timer=setTimeout(()=>void refresh(true),delay);}
  function bind(){
    const body=document.body||document.documentElement;
    if(global.MutationObserver&&body&&!observer){
      observer=new MutationObserver(()=>{const r=root();if(type()&&r&&legacyVisible(r))schedule(160);});
      observer.observe(body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});
    }
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page="shopeecn"],.side-link[data-page="shopeevn"]'))schedule(60);},true);
    document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(120);},true);
    global.addEventListener('popstate',()=>schedule(60));
    [40,180,600,1500].forEach(ms=>setTimeout(()=>{if(type())schedule(0);},ms));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  console.info('[CE-QC][V250_SHOPEE_METRIC_VISIBILITY]',VERSION,'forces visible Shopee route ownership and renders V246 average signing days + strict 1/2/3 attempt truth');
})(window);
