(function (global) {
  const VERSION='2026-08-10-v42-whpp-ui-v1';
  let active=false;
  let cached=null;
  let reportDate='';

  function fmt(value){return Number(value||0).toLocaleString('zh-CN');}
  function pct(value){return `${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;}
  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function rate(value,total){return total?`${(Number(value||0)*100/Number(total)).toFixed(2)}%`:'0.00%';}

  function installStyle(){
    if(document.getElementById('whppV42Style'))return;
    const style=document.createElement('style');style.id='whppV42Style';style.textContent=`
      .whpp-toolbar{display:flex;gap:10px;align-items:end;margin-bottom:14px}.whpp-toolbar label{font-size:12px;color:#72839b}.whpp-toolbar input{display:block;margin-top:4px;border:1px solid #dce6f2;border-radius:8px;padding:8px 10px}.whpp-toolbar button{border:0;border-radius:8px;padding:9px 16px;background:#1677ff;color:#fff;font-weight:700;cursor:pointer}
      .whpp-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:14px}.whpp-card{background:#fff;border:1px solid #dde7f2;border-top:4px solid #1677ff;border-radius:10px;padding:14px;text-align:center;cursor:pointer}.whpp-card span{display:block;font-weight:700;color:#16324f}.whpp-card b{display:block;font-size:28px;margin:7px 0;color:#102d4d}.whpp-card small{color:#8191a8}.whpp-card.cancel{border-top-color:#f04b64}.whpp-card.return{border-top-color:#ff8a00}.whpp-card.pod{border-top-color:#14a66f}.whpp-card.open{border-top-color:#7b61ff}
      .whpp-panel{background:#fff;border:1px solid #dde7f2;border-radius:10px;margin-bottom:14px;overflow:hidden}.whpp-panel h2{font-size:18px;margin:0;padding:14px 16px;border-bottom:1px solid #e7eef6}.whpp-core{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}.whpp-metric{border:0;border-right:1px solid #edf2f8;border-bottom:1px solid #edf2f8;background:#fff;text-align:left;padding:14px;min-height:92px;cursor:pointer}.whpp-metric span{display:block;font-weight:700;color:#264563}.whpp-metric b{display:block;font-size:24px;margin-top:7px;color:#102d4d}.whpp-metric small{color:#8b9aae}
      .whpp-regions{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px}.whpp-region{border:1px solid #e0e9f3;border-radius:10px;padding:12px}.whpp-region h3{margin:0 0 10px}.whpp-region-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.whpp-region-grid div{background:#f8fbff;border:1px solid #edf2f8;border-radius:8px;padding:9px}.whpp-region-grid span{display:block;font-size:12px;color:#71839a}.whpp-region-grid b{display:block;margin-top:3px;color:#183b61}
      .whpp-note{padding:10px 14px;background:#f7fbff;color:#62758e;font-size:12px}.whpp-runbar{display:flex;gap:8px;margin-left:auto}.whpp-runbar button.secondary{background:#fff;color:#1677ff;border:1px solid #1677ff}
      @media(max-width:1200px){.whpp-grid,.whpp-core{grid-template-columns:repeat(3,1fr)}}
    `;document.head.appendChild(style);
  }

  function ensureNav(){
    const nav=document.querySelector('.side-nav');if(!nav||nav.querySelector('[data-page="whpp"]'))return;
    const button=document.createElement('button');button.className='side-link';button.dataset.page='whpp';button.onclick=()=>navigateWhpp();
    button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';
    const anchor=nav.querySelector('[data-page="ali1688"]')||nav.querySelector('[data-page="shopee"]');
    if(anchor?.nextSibling)nav.insertBefore(button,anchor.nextSibling);else nav.appendChild(button);
  }

  function ensurePage(){
    let page=document.getElementById('whppPage');if(page)return page;
    page=document.createElement('section');page.id='whppPage';page.className='app-page v18-dashboard-page v18-business-page';page.hidden=true;
    document.querySelector('main.main-content')?.appendChild(page);return page;
  }

  async function fetchState(date=''){
    const q=date?`?reportDate=${encodeURIComponent(date)}`:'';
    const response=await fetch(`/api/whpp/state${q}`,{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||`HTTP ${response.status}`);
    return response.json();
  }

  async function navigateWhpp(date=''){
    active=true;ensureNav();const page=ensurePage();
    document.querySelectorAll('.app-page').forEach(node=>{node.hidden=node!==page;node.classList.toggle('active',node===page);});
    document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));
    if(location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');
    reportDate=date||reportDate||'';
    page.innerHTML='<div class="empty-state">正在读取WHPP本土数据...</div>';
    try{cached=await fetchState(reportDate);reportDate=cached.state?.reportDate||reportDate;renderPage();}catch(error){page.innerHTML=`<div class="empty-state">WHPP读取失败：${esc(error.message)}</div>`;}
  }

  function renderPage(){
    const page=ensurePage(),m=cached?.dashboard?.metrics||{},r=cached?.dashboard?.regions||{},processing=cached?.state?.processing||{};
    const card=(label,value,cls,tab,note)=>`<button class="whpp-card ${cls||''}" onclick="window.openWhppDetail('${tab}')"><span>${label}</span><b>${typeof value==='string'?value:fmt(value)}</b><small>${note||'点击查看明细'}</small></button>`;
    const metric=(label,key,tab,note='占本业务')=>`<button class="whpp-metric" onclick="window.openWhppDetail('${tab}')"><span>${label}</span><b>${fmt(m[key])}</b><small>${note} ${rate(m[key],m.total)}</small></button>`;
    page.innerHTML=`
      <section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>日报 ${esc(reportDate||'—')} · CE开头运单独立统计 · 订单取消为独立终态</p></div></section>
      <div class="whpp-toolbar"><label>日报日期<input id="whppDate" type="date" value="${esc(reportDate)}"></label><button onclick="window.reloadWhppDate()">查询</button><div class="whpp-runbar"><button class="secondary" onclick="window.pauseWhppRun()">暂停</button><button onclick="window.startWhppRun()">${processing.paused?'继续处理':'开始/继续处理'}</button></div></div>
      <div class="whpp-grid">
        ${card('WHPP本土',m.total,'','all','今日票数')}${card('今日POD',m.pod,'pod','pod',`POD率 ${pct(m.podRate)}`)}${card('POD率',pct(m.podRate),'pod','pod','当前比率')}${card('已退回件',m.returned,'return','returned',`退回率 ${pct(m.returnRate)}`)}${card('订单取消',m.cancelled,'cancel','cancelled',`取消率 ${pct(m.cancelRate)}`)}${card('当前未闭环',m.unresolved,'open','unresolved','不含正常分流/取消/退回/POD')}
      </div>
      <section class="whpp-panel"><h2>核心指标</h2><div class="whpp-core">
        ${metric('Pending不连续','pendingNonContinuous','pendingNonContinuous')}${metric('Pending1+','pending1','pending1')}${metric('Pending2+','pending2','pending2')}${metric('Pending3+','pending3','pending3')}${metric('OC1+','oc1','oc1')}${metric('OC2+','oc2','oc2')}
        ${metric('OC3+','oc3','oc3')}${metric('盘点2天+','cycle2','cycle2')}${metric('入库无扫描','inboundNoScan','inboundNoScan')}${metric('工单','workOrder','workOrder')}${metric('派送中','delivery','delivery')}${metric('金边门店','phnomPenhShop','phnomPenhShop','当前位置')}
        ${metric('CCSLCN分流','ccslCnDiversion','ccslCnDiversion','正常分流')}${metric('CCSLZT分流','ccslZtDiversion','ccslZtDiversion','正常分流')}${metric('CCSL580分流','ccsl580Diversion','ccsl580Diversion','正常分流')}${metric('580滞留','ccsl580Retention','ccsl580Retention','滞留阈值未锁定')}${metric('1派POD','dispatchAttempt1','attempt1')}${metric('2派POD','dispatchAttempt2','attempt2')}
      </div><div class="whpp-note">CEL:CCSLCN / CEL:CCSLZT / CEL:CCSL580 都是正常分流去处；到达580本身不等于580滞留。门店统一归“金边门店”，收件地址PP/PV只用于区域分析。</div></section>
      <section class="whpp-panel"><h2>区域与派次</h2><div class="whpp-regions">${regionBlock('PP 本省（金边）',r.PP||{})}${regionBlock('PV 外省收件地址',r.PV||{})}</div></section>
      <section class="whpp-panel"><h2>WHPP对账</h2><div class="whpp-note">总票 ${fmt(m.total)} = POD ${fmt(m.pod)} + 退回 ${fmt(m.returned)} + 订单取消 ${fmt(m.cancelled)} + 正常分流 ${fmt(m.normalDiversion)} + 当前未闭环 ${fmt(m.unresolved)}；差额 <b>${fmt(m.accountingDifference)}</b>。</div></section>`;
  }

  function regionBlock(label,row){return `<div class="whpp-region"><h3>${label}</h3><div class="whpp-region-grid">${[['总票',row.total],['POD',row.pod],['POD率',pct(row.podRate)],['订单取消',row.cancelled],['退回',row.returned],['未闭环',row.unresolved],['Pending1+',row.pending1],['OC1+',row.oc1],['金边门店',row.phnomPenhShop]].map(([k,v])=>`<div><span>${k}</span><b>${typeof v==='string'?v:fmt(v)}</b></div>`).join('')}</div></div>`;}

  async function openDetail(tab){
    const response=await fetch(`/api/whpp/metric-detail?reportDate=${encodeURIComponent(reportDate||'')}&tab=${encodeURIComponent(tab)}&pageSize=300`,{cache:'no-store',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.error||'明细读取失败');
    const dialog=document.getElementById('metricDetailDialog'),title=document.getElementById('metricDetailTitle'),body=document.getElementById('metricDetailBody');if(!dialog||!title||!body)return;
    title.textContent=`WHPP · ${data.label||tab} · ${fmt(data.total)}票`;
    const fields=tab==='cancelled'?['shipmentCode','取消状态','cancelOrderStatus','cancellationExceptionType','cancellationStatusCode','cancellationReasonCode','cancellationChildReasonCode','cancellationReason','cancellationChildReason','cancellationReportShop','cancellationConfirmedAt','latestEventTime','最后节点']:['shipmentCode','regionCode','primaryCategory','currentState','POD状态','退回状态','Pending当前次数','OC天数','shopState','latestEventTime','最后节点'];
    body.innerHTML=data.rows?.length?`<table class="preview-table"><thead><tr>${fields.map(f=>`<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(row=>`<tr>${fields.map(f=>`<td>${esc(row?.[f]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">暂无明细</div>';
    dialog.hidden=false;
  }

  async function startRun(){
    const button=event?.currentTarget;if(button)button.disabled=true;
    try{const response=await fetch('/api/whpp/run/start',{method:'POST',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.error||'WHPP处理失败');cached=await fetchState(reportDate);renderPage();alert(`WHPP处理完成：POD ${fmt(data.summary?.pod)}，退回 ${fmt(data.summary?.returned)}，订单取消 ${fmt(data.summary?.cancelled)}`);}catch(error){alert(error.message);}finally{if(button)button.disabled=false;}
  }
  async function pauseRun(){await fetch('/api/whpp/run/pause',{method:'POST',credentials:'same-origin'});cached=await fetchState(reportDate);renderPage();}
  async function reloadDate(){reportDate=document.getElementById('whppDate')?.value||'';await navigateWhpp(reportDate);}

  function addHomeCard(){
    if(active)return;const grid=document.querySelector('#homePage .v18-business-grid');if(!grid||grid.querySelector('[data-v42-whpp]')||!cached?.dashboard)return;const m=cached.dashboard.metrics||{};
    const btn=document.createElement('button');btn.className='v18-business-card';btn.dataset.v42Whpp='1';btn.onclick=()=>navigateWhpp();btn.innerHTML=`<span>WHPP本土</span><small>今日票数</small><b>${fmt(m.total)}</b><em>占总票数由V42合并</em>`;grid.appendChild(btn);
    const total=grid.querySelector('.v18-business-card');const totalValue=total?.querySelector('b');if(totalValue){const base=Number(String(totalValue.textContent||'0').replace(/,/g,''))||0;totalValue.textContent=fmt(base+Number(m.total||0));}
  }

  async function refreshHomeWhpp(){try{cached=await fetchState('');addHomeCard();}catch{} }

  function install(){
    installStyle();ensureNav();ensurePage();
    global.navigateWhppPage=navigateWhpp;global.openWhppDetail=tab=>openDetail(tab).catch(error=>alert(error.message));global.startWhppRun=startRun;global.pauseWhppRun=pauseRun;global.reloadWhppDate=reloadDate;
    const originalNavigate=global.navigatePage;if(typeof originalNavigate==='function'){global.navigatePage=function(page){if(page==='whpp')return navigateWhpp();active=false;const result=originalNavigate.apply(this,arguments);setTimeout(refreshHomeWhpp,50);return result;};}
    global.addEventListener('popstate',()=>{if(location.pathname==='/whpp')navigateWhpp();else active=false;});
    refreshHomeWhpp();
    if(location.pathname==='/whpp')navigateWhpp();
    console.info('[CE-QC][WHPP_UI]',VERSION);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
