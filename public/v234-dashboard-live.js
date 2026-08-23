(function installV234DashboardLive(global){
  if(global.__CE_QC_V234_DASHBOARD_LIVE__)return;
  global.__CE_QC_V234_DASHBOARD_LIVE__=true;
  global.__CE_QC_V237_DASHBOARD_OWNER__=true;
  const VERSION='2026-08-23-v240-daily-rate-ui-v1';
  const PATH_TYPE={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN',whpp:'WHPP'};
  const cache=new Map();let timer=null,activeDetail=0,currentRetryTimer=null,trendRetryTimer=null,trendRetryCount=0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=v=>num(v).toLocaleString('zh-CN');
  const pct=v=>`${num(v).toFixed(2)}%`;
  const nullablePct=v=>v===null||v===undefined?'—':pct(v);
  function type(){return PATH_TYPE[String(location.pathname||'').replace(/^\//,'').toLowerCase()]||'';}
  function range(){const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};}
  async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'same-origin'}),t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{}if(!r.ok||d.ok===false)throw new Error(d.error||`HTTP ${r.status}`);return d;}
  function pageRoot(t=type()){if(t==='WHPP')return document.getElementById('whppFastPage');return t.startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');}
  function removeLegacyTrendPanel(root=document){root?.querySelectorAll?.('#v230MetricTruthPanel')?.forEach?.(node=>node.remove());}
  function ensureTrendStyle(){
    if(document.getElementById('v240DailyTrendStyle'))return;
    const style=document.createElement('style');style.id='v240DailyTrendStyle';style.textContent=`
      #v234DailyTrendTruth{margin-top:18px;border:1px solid #dbe7f5;border-radius:12px;background:#fff;overflow:hidden}
      #v234DailyTrendTruth .v240-trend-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:16px 18px 12px;background:#f8fbff;border-bottom:1px solid #e6eef8}
      #v234DailyTrendTruth .v240-trend-head h3{margin:0 0 5px;font-size:17px;color:#17365d}
      #v234DailyTrendTruth .v240-trend-head p{margin:0;font-size:12px;line-height:1.7;color:#6a7f9b}
      #v234DailyTrendTruth .v240-source{white-space:nowrap;padding:5px 9px;border-radius:999px;background:#edf5ff;color:#2468d8;font-size:11px;font-weight:700}
      #v234DailyTrendTruth .v240-table-wrap{overflow:auto;padding:0 14px 14px}
      #v234DailyTrendTruth .v240-table{width:100%;border-collapse:separate;border-spacing:0;min-width:860px;font-size:13px}
      #v234DailyTrendTruth .v240-table th{position:sticky;top:0;padding:10px 12px;background:#f4f8fd;color:#536b88;font-weight:700;text-align:right;border-bottom:1px solid #dce7f3}
      #v234DailyTrendTruth .v240-table th:first-child,#v234DailyTrendTruth .v240-table td:first-child{text-align:left}
      #v234DailyTrendTruth .v240-table td{padding:11px 12px;text-align:right;border-bottom:1px solid #edf2f8;color:#203957;font-variant-numeric:tabular-nums}
      #v234DailyTrendTruth .v240-table tbody tr:last-child td{border-bottom:0}
      #v234DailyTrendTruth .v240-table tbody tr:hover td{background:#f8fbff}
      #v234DailyTrendTruth .v240-rate{font-weight:800;color:#1769e0}
      #v234DailyTrendTruth .v240-oc{font-weight:800;color:#d97706}
      #v234DailyTrendTruth .v240-first{font-weight:800;color:#6842d9}
      #v234DailyTrendTruth .v240-missing{text-align:center!important;color:#8aa0ba!important}
    `;document.head.appendChild(style);
  }
  function setCard(card,value,unit='件',ratio=''){if(!card)return;const b=card.querySelector('b'),e=card.querySelector('em'),s=card.querySelector('small');if(b)b.textContent=unit==='%'?pct(value):fmt(value);if(e&&ratio)e.textContent=ratio;if(s&&unit==='%')s.textContent='当前比率';}
  function setPendingCard(card){if(!card)return;const b=card.querySelector('b'),e=card.querySelector('em'),s=card.querySelector('small');if(b)b.textContent='—';if(e)e.textContent='等待正式处理结果';if(s)s.textContent='状态读取中';}
  function label(card){return String(card?.querySelector('span')?.textContent||'').trim();}
  function notice(root,text,bad=false){if(!root)return;let n=root.querySelector('.v234-live-notice');if(!n){n=document.createElement('div');n.className='v234-live-notice';n.style.cssText='margin:4px 0 10px;padding:8px 12px;border:1px solid #d9e6f4;border-radius:8px;background:#f7fbff;font-size:12px;color:#607792';const h=root.querySelector('.v18-page-heading');(h?.parentNode||root).insertBefore(n,h?.nextSibling||root.firstChild);}n.style.color=bad?'#a63a2b':'#607792';n.textContent=text;n.hidden=!text;}
  function currentData(payload,t){if(t==='WHPP')return payload?.whpp||null;return payload?.business?.[t]||null;}
  function applyCurrent(payload,t=type()){
    const root=pageRoot(t);if(!root||!t||root.hidden)return;
    removeLegacyTrendPanel(root);
    const m=currentData(payload,t);if(!m)return;
    global.__CE_QC_V237_CURRENT_SUMMARY__=payload;
    const cards=[...root.querySelectorAll('.v18-business-grid .v18-business-card')];
    if(!m.ready){
      notice(root,`${t} 当天标准化结果仍在处理中；这里只显示已确认总票，POD/退回/未闭环不会用假0填充。结果覆盖完整后自动更新。`);
      cards.forEach((card,index)=>{if(index>0)setPendingCard(card);});
      root.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card=>{const b=card.querySelector('b'),s=card.querySelector('small');if(b)b.textContent='—';if(s)s.textContent='等待正式处理结果';});
      return;
    }
    notice(root,'');const total=num(m.total),share=v=>`占本业务 ${total?(num(v)*100/total).toFixed(2):'0.00'}%`;
    for(const c of cards){const l=label(c);
      if(l===t||l==='WHPP本土')setCard(c,total,'件','占本业务 100.00%');
      else if(['签收件数','今日POD'].includes(l))setCard(c,m.pod,'件',share(m.pod));
      else if(l==='POD率'||l==='签收率')setCard(c,m.podRate,'%',`当前比率 ${pct(m.podRate)}`);
      else if(l==='已退回件')setCard(c,m.returned,'件',share(m.returned));
      else if(['退回率','退件率'].includes(l))setCard(c,m.returnRate,'%',`当前比率 ${pct(m.returnRate)}`);
      else if(l==='订单取消')setCard(c,m.cancelled,'件',share(m.cancelled));
      else if(l==='当前未闭环')setCard(c,m.unresolved,'件',share(m.unresolved));
      else if(l==='闭环率')setCard(c,m.closureRate,'%',`当前比率 ${pct(m.closureRate)}`);
      else if(l==='对账差异')setCard(c,Math.max(0,total-num(m.pod)-num(m.returned)-num(m.cancelled)-num(m.unresolved)),'件','应为 0');
    }
    const map={'Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan','已退回件':'returned','当前未闭环':'unresolved','派送中':'deliveryStay','外省未完结POD件':'provinceOpen'};
    root.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(c=>{const l=label(c),key=map[l];if(!key)return;const v=num(m[key]);const b=c.querySelector('b'),s=c.querySelector('small');if(b)b.textContent=fmt(v);if(s)s.textContent=`占本业务 ${total?(v*100/total).toFixed(2):'0.00'}% · 点击查看明细`;});
  }
  function scheduleCurrentRetry(payload,t){clearTimeout(currentRetryTimer);const m=currentData(payload,t);if(m?.ready)return;currentRetryTimer=setTimeout(()=>{cache.delete(`current|${range().to}`);void refreshCurrent(true);},4000);}
  async function refreshCurrent(force=false){const t=type(),r=range();if(!r.to)return;const key=`current|${r.to}`;if(!force&&cache.has(key)){const hit=cache.get(key);applyCurrent(hit,t);scheduleCurrentRetry(hit,t);return hit;}try{const d=await json(`/api/v234/current-summary?reportDate=${encodeURIComponent(r.to)}`);cache.set(key,d);applyCurrent(d,t);scheduleCurrentRetry(d,t);return d;}catch(e){notice(pageRoot(),`当前看板快速状态读取失败：${e.message}`,true);}}
  function series(name,color,values){return{name,color,values:Array.isArray(values)?values:[],numerators:[],denominators:[]};}
  function renderDaily(root,d,t){
    removeLegacyTrendPanel(root);ensureTrendStyle();
    let panel=root.querySelector('#v234DailyTrendTruth');if(!panel){panel=document.createElement('section');panel.id='v234DailyTrendTruth';const section=root.querySelector('.v18-trend-section');section?.appendChild(panel);}if(!panel)return;
    const rows=(d.daily||[]).map(x=>x.ready?`<tr><td>${esc(x.reportDate||x.date||'—')}</td><td>${fmt(x.total)}</td><td>${fmt(x.pod)}</td><td class="v240-rate">${pct(x.podRate)}</td><td>${fmt(x.ocCurrent)}</td><td class="v240-oc">${pct(x.ocRate)}</td><td>${fmt(x.sameDayPod)}</td><td class="v240-first">${pct(x.sameDayPodRate)}</td></tr>`:`<tr><td>${esc(x.reportDate||x.date||'—')}</td><td class="v240-missing" colspan="7">该日精确缓存正在准备</td></tr>`).join('');
    panel.innerHTML=`<div class="v240-trend-head"><div><h3>每日趋势明细</h3><p>固定口径：POD率 = POD ÷ 当日总票；OC率 = 当日真实OC票数 ÷ 当日总票；首日妥投率 = 首日完成POD票数 ÷ 当日总票。</p></div><span class="v240-source">${esc(t)} · 精确日报</span></div><div class="v240-table-wrap"><table class="v240-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>当日OC</th><th>OC率</th><th>首日POD</th><th>首日妥投率</th></tr></thead><tbody>${rows||'<tr><td class="v240-missing" colspan="8">当前区间暂无有效日报</td></tr>'}</tbody></table></div>`;
    removeLegacyTrendPanel(root);
  }
  function renderTrends(d,t){
    const root=pageRoot(t);if(!root||root.hidden)return;removeLegacyTrendPanel(root);
    const section=root.querySelector('.v18-trend-section');if(!section)return;const cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4);const renderer=global.RateTrendCardV18?.render;
    if(renderer&&cards.length>=4){
      const dates=d.dates||[],ready=d.daily||[];
      const pick=(key,fallback)=>ready.length?ready.map(x=>x.ready?(x[key]===null||x[key]===undefined?null:num(x[key])):null):(fallback||[]);
      const specs=[{title:'总票数趋势',type:'count',dates,series:[series('总票数','#1677ff',pick('total',d.ticket))]},{title:'POD率趋势',type:'rate',dates,series:[series('POD率','#16a36a',pick('podRate',d.podRate))]},{title:'OC率趋势',type:'rate',oc:true,dates,series:[series('当日OC率','#ff8a00',pick('ocRate',d.ocRate))]},{title:'首日POD妥投率趋势',type:'rate',dates,series:[series('首日POD妥投率','#6c4cf5',pick('sameDayPodRate',d.sameDayPodRate))]}];
      cards.forEach((c,i)=>renderer(c,specs[i]));
    }
    renderDaily(root,d,t);
  }
  function scheduleTrendRetry(d){clearTimeout(trendRetryTimer);const missing=Array.isArray(d?.missingDates)?d.missingDates.length:(d?.daily||[]).filter(x=>!x?.ready).length;if(!missing){trendRetryCount=0;return;}if(trendRetryCount>=12)return;const delay=trendRetryCount<3?3000:6000;trendRetryCount+=1;trendRetryTimer=setTimeout(()=>{const t=type(),r=range();cache.delete(`trend|${t}|${r.from}|${r.to}`);void refreshTrends(true);},delay);}
  async function refreshTrends(force=false){const t=type(),r=range();if(!t||!r.to)return;const key=`trend|${t}|${r.from}|${r.to}`;if(!force&&cache.has(key)){const hit=cache.get(key);renderTrends(hit,t);scheduleTrendRetry(hit);return;}try{const d=await json(`/api/v234/trends?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`);cache.set(key,d);renderTrends(d,t);scheduleTrendRetry(d);}catch(e){console.warn('[V240 trend]',e);}}
  function tabFor(t,l){if(t.startsWith('SHOPEE')){const m={'SHOPEECN':'all','SHOPEEVN':'all','今日POD':'pod','POD率':'pod','已退回件':'returned','退回率':'returned','当前未闭环':'unresolved','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','派送中':'deliveryStay'};return m[l]||'';}const m={'CE':'allData','CEAF':'allData','TBKH':'allData','ALI1688':'allData','签收件数':'podClosed','签收率':'podClosed','已退回件':'accountingReturned','当前未闭环':'accountingOpen','Pending1+':'pendingAll','Pending2+':'pending2plus','Pending3+':'pending3','OC1+':'ocAll','OC2+':'oc2plus','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan','工单':'workOrderAbnormal','外省未完结POD件':'provinceOpen'};return m[l]||'';}
  function detailHost(t){const root=pageRoot(t);if(!root)return null;let host=root.querySelector('.v234-detail-host');if(!host){host=document.createElement('section');host.className='panel v18-detail-preview v234-detail-host';root.appendChild(host);}return host;}
  async function openDetail(t,l,tab){const host=detailHost(t),r=range();if(!host||!tab)return;const id=++activeDetail;host.hidden=false;host.innerHTML=`<div class="empty-state">正在读取 ${esc(l)} 明细…</div>`;host.scrollIntoView({behavior:'smooth',block:'start'});try{const d=await json(`/api/v234/metric-detail?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}&tab=${encodeURIComponent(tab)}&page=1&pageSize=200`);if(id!==activeDetail)return;const rows=d.rows||[],fields=['shipmentCode','businessType','reportDate','regionCode','POD状态','当前分类','最新节点','最新时间'].filter(k=>rows.some(x=>x[k]!==undefined));host.innerHTML=`<div class="panel-title"><h3>${esc(l)}</h3><span>${fmt(d.total)}票</span></div><div class="preview-table-wrap">${rows.length?`<table class="preview-table"><thead><tr>${fields.map(f=>`<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${fields.map(f=>`<td>${esc(row[f]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配明细</div>'}</div>`;}catch(e){if(id===activeDetail)host.innerHTML=`<div class="empty-state">明细读取失败：${esc(e.message)}</div>`;}}
  function onClick(event){const t=type();if(!t||t==='WHPP')return;const card=event.target?.closest?.('.v18-business-card,.v18-metric-card');if(!card||!pageRoot(t)?.contains(card))return;const l=label(card),tab=tabFor(t,l);if(!tab)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void openDetail(t,l,tab);}
  function schedule(ms=80,force=false){clearTimeout(timer);timer=setTimeout(()=>{removeLegacyTrendPanel(pageRoot());void refreshCurrent(force);void refreshTrends(force);},ms);}
  document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page]'))schedule(120,false);if(event.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery')){trendRetryCount=0;schedule(150,true);}},true);
  global.addEventListener('click',onClick,true);
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo')){trendRetryCount=0;schedule(120,true);}});
  global.addEventListener('popstate',()=>schedule(80,false));
  const observer=new MutationObserver(records=>{
    const root=pageRoot();if(root)removeLegacyTrendPanel(root);
    if(records.some(r=>[...r.addedNodes].some(n=>n?.nodeType===1&&(n.matches?.('.v18-dashboard-page,.v18-trend-section,#v230MetricTruthPanel')||n.querySelector?.('.v18-trend-section,#v230MetricTruthPanel')))))schedule(60,false);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(60,true),{once:true});else schedule(60,true);
  console.info('[CE-QC][V240_DASHBOARD_OWNER]',VERSION,'daily total + POD rate + current OC rate + same-day POD rate; attempt rates stay evidence-only');
})(window);
