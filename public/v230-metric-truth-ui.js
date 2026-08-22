(function installV230MetricTruthUi(global){
  if(global.__CE_QC_V230_METRIC_TRUTH_UI__)return;
  global.__CE_QC_V230_METRIC_TRUTH_UI__=true;
  const VERSION='2026-08-22-v230-daily-metric-truth-ui-v1';
  const TYPE_BY_PATH=new Map([
    ['/','ALL'],['/home','ALL'],['/ce','CE'],['/ceaf','CEAF'],['/tbkh','TBKH'],['/ali1688','ALI1688'],['/whpp','WHPP'],['/shopeecn','SHOPEECN'],['/shopeevn','SHOPEEVN']
  ]);
  let timer=null;
  let controller=null;
  let lastKey='';

  const style=document.createElement('style');
  style.textContent=`
    .v230-truth-panel{margin-top:14px;border:1px solid #d7e5f4;border-radius:10px;background:#fff;overflow:hidden}
    .v230-truth-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:14px 16px;border-bottom:1px solid #e3edf7}
    .v230-truth-head h3{margin:0;color:#123a67;font-size:18px}.v230-truth-head p{margin:5px 0 0;color:#71849a;font-size:12px;line-height:1.55}
    .v230-truth-badge{white-space:nowrap;padding:5px 9px;border-radius:999px;background:#eef6ff;color:#1769c2;font-size:12px;font-weight:700}
    .v230-truth-wrap{overflow:auto;max-height:470px}.v230-truth-table{width:100%;border-collapse:collapse;min-width:1120px;font-size:12px}
    .v230-truth-table th{position:sticky;top:0;z-index:2;background:#f2f7fd;color:#23476c;padding:9px 8px;border-bottom:1px solid #d9e6f3;text-align:center;white-space:nowrap}
    .v230-truth-table td{padding:8px;border-bottom:1px solid #edf2f7;text-align:center;white-space:nowrap}.v230-truth-table tbody tr:hover{background:#f8fbff}
    .v230-truth-table td.rate{font-weight:700;color:#0b57d0}.v230-truth-table td.days{font-weight:700;color:#6c4cf5}
    .v230-truth-note{padding:10px 16px;color:#607792;background:#f8fbff;font-size:12px;line-height:1.6;border-top:1px solid #e3edf7}
    .v230-truth-loading{padding:24px;text-align:center;color:#73869c}.v230-truth-error{padding:16px;color:#b42318;background:#fff5f5}
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
    if(panel)return panel;
    panel=document.createElement('section');
    panel.id='v230MetricTruthPanel';
    panel.className='v230-truth-panel';
    panel.innerHTML='<div class="v230-truth-loading">正在读取每日真实百分比与签收时效…</div>';
    section.appendChild(panel);
    return panel;
  }
  function fmt(value){return Number(value||0).toLocaleString('zh-CN');}
  function pct(value){return `${Number(value||0).toFixed(2)}%`;}
  function days(value){const n=Number(value||0);return n>0?n.toFixed(2):'—';}
  function render(panel,data,type){
    const shopee=type==='ALL'||type.startsWith('SHOPEE');
    const attemptCols=shopee?'<th>1派占POD</th><th>2派占POD</th><th>3派+占POD</th><th>派次未识别POD</th>':'';
    const rows=(data.daily||[]).map(row=>`<tr>
      <td>${row.date}</td><td>${fmt(row.total)}</td>
      <td>${fmt(row.pod)}</td><td class="rate">${pct(row.podRate)}</td>
      <td>${fmt(row.returned)}</td><td class="rate">${pct(row.returnRate)}</td>
      <td>${fmt(row.pending)}</td><td class="rate">${pct(row.pendingRate)}</td>
      <td>${fmt(row.delivering)}</td><td class="rate">${pct(row.deliveringRate)}</td>
      ${shopee?`<td class="rate">${pct(row.attempt1Rate)} <small>(${fmt(row.attempt1Count)})</small></td><td class="rate">${pct(row.attempt2Rate)} <small>(${fmt(row.attempt2Count)})</small></td><td class="rate">${pct(row.attempt3Rate)} <small>(${fmt(row.attempt3Count)})</small></td><td>${fmt(row.attemptUnknownPod)}</td>`:''}
      <td class="days">${days(row.averageSigningDays)}</td><td class="days">${days(row.averageDeliveryDays)}</td>
    </tr>`).join('');
    panel.innerHTML=`
      <div class="v230-truth-head"><div><h3>每日走势口径校验</h3><p>每一天显示真实件数与百分比；SHOPEE派次、平均签收天数与平均派送天数全部使用同一套V230证据规则。</p></div><span class="v230-truth-badge">${type==='ALL'?'总看板·七业务':type}</span></div>
      <div class="v230-truth-wrap"><table class="v230-truth-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>退回</th><th>退回率</th><th>Pending</th><th>Pending率</th><th>派送中</th><th>派送中率</th>${attemptCols}<th>平均签收天数</th><th>平均派送天数</th></tr></thead><tbody>${rows||'<tr><td colspan="16">所选区间没有有效数据</td></tr>'}</tbody></table></div>
      <div class="v230-truth-note">1/2/3派：只认轨迹70的不同派送日期；没有70才看轨迹60不同分配日期；不使用日报W/Y或“过了几天”猜派次。1/2/3派百分比的分母是当日SHOPEE已POD件数。平均签收天数＝首次日报归属日期→实际POD日期（含首尾自然日）；平均派送天数＝首次真实70/60日期→POD日期，无真实派送节点不参与平均。</div>`;
  }
  async function refresh(force=false){
    const type=pageType();if(!type)return;
    const r=range();if(!r.from||!r.to)return;
    const section=targetSection(type);if(!section)return;
    const panel=ensurePanel(section);if(!panel)return;
    const key=`${type}|${r.from}|${r.to}`;
    if(!force&&key===lastKey&&panel.dataset.loaded==='1')return;
    lastKey=key;panel.dataset.loaded='0';panel.innerHTML='<div class="v230-truth-loading">正在后台校验每日真实百分比、SHOPEE派次和签收天数；页面可继续操作…</div>';
    controller?.abort();controller=new AbortController();
    try{
      const q=new URLSearchParams({businessType:type,from:r.from,to:r.to});if(force)q.set('refresh','1');
      const response=await fetch(`/api/v230/metric-truth?${q}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      if(!panel.isConnected)return;render(panel,data,type);panel.dataset.loaded='1';
    }catch(error){if(error?.name==='AbortError')return;if(panel.isConnected)panel.innerHTML=`<div class="v230-truth-error">每日走势口径校验失败：${String(error?.message||error)}</div>`;}
  }
  function schedule(delay=250,force=false){clearTimeout(timer);timer=setTimeout(()=>void refresh(force),delay);}
  const observer=new MutationObserver(records=>{
    if(records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('.v18-trend-section')||node.querySelector?.('.v18-trend-section')))))schedule(180);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(350,true);});
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(350,true);});
  global.addEventListener('popstate',()=>schedule(250));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(350),{once:true});else schedule(350);
  console.info('[CE-QC][V230_METRIC_TRUTH_UI]',VERSION);
})(window);
