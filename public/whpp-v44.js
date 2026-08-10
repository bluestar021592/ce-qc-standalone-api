(function (global) {
  const VERSION='2026-08-10-v44-whpp-fast-ui-v1';
  let cached=null;
  let activeDate='';
  let observer=null;

  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=value=>`${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const rate=(value,total)=>total?`${(Number(value||0)*100/Number(total)).toFixed(2)}%`:'0.00%';

  function page(){
    let node=document.getElementById('whppPage');
    if(!node){node=document.createElement('section');node.id='whppPage';node.className='app-page v18-dashboard-page v18-business-page';document.querySelector('main.main-content')?.appendChild(node);}
    return node;
  }

  function forceVisibility(){
    if(location.pathname!=='/whpp')return;
    const target=page();
    document.querySelectorAll('.app-page').forEach(node=>{node.hidden=node!==target;node.classList.toggle('active',node===target);});
    document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));
    const title=document.getElementById('pageTitle');if(title)title.textContent='WHPP本土看板';
  }

  function zeroDashboard(){
    return {metrics:{total:0,pod:0,podRate:0,returned:0,returnRate:0,cancelled:0,cancelRate:0,unresolved:0,pendingNonContinuous:0,pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,workOrder:0,delivery:0,phnomPenhShop:0,ccslCnDiversion:0,ccslZtDiversion:0,ccsl580Diversion:0,ccsl580Retention:0,dispatchAttempt1:0,dispatchAttempt2:0},regions:{PP:{},PV:{}}};
  }

  function render(data=cached,loading=false,error=''){
    const target=page();
    const state=data?.state||{};
    const dashboard=data?.dashboard||zeroDashboard();
    const m=dashboard.metrics||{};
    const r=dashboard.regions||{};
    const date=state.reportDate||activeDate||'';
    const oldDbEmpty=!state.reportDate && Number(m.total||0)===0;
    const card=(label,value,cls,tab,note)=>`<button class="whpp-card ${cls||''}" onclick="window.openWhppDetail&&window.openWhppDetail('${tab}')"><span>${label}</span><b>${typeof value==='string'?value:fmt(value)}</b><small>${note||'点击查看明细'}</small></button>`;
    const metric=(label,key,tab,note='占本业务')=>`<button class="whpp-metric" onclick="window.openWhppDetail&&window.openWhppDetail('${tab}')"><span>${label}</span><b>${fmt(m[key])}</b><small>${note} ${rate(m[key],m.total)}</small></button>`;
    const regionBlock=(label,row={})=>`<div class="whpp-region"><h3>${label}</h3><div class="whpp-region-grid">${[['总票',row.total],['POD',row.pod],['POD率',pct(row.podRate)],['订单取消',row.cancelled],['退回',row.returned],['未闭环',row.unresolved],['Pending1+',row.pending1],['OC1+',row.oc1],['金边门店',row.phnomPenhShop]].map(([k,v])=>`<div><span>${k}</span><b>${typeof v==='string'?v:fmt(v)}</b></div>`).join('')}</div></div>`;
    const notice=error
      ? `<div class="whpp-note" style="color:#c0392b">WHPP读取失败：${esc(error)}。页面结构已保留，可刷新重试。</div>`
      : loading
        ? '<div class="whpp-note">正在读取WHPP本土数据，页面无需等待其他看板加载…</div>'
        : oldDbEmpty
          ? '<div class="whpp-note">当前旧数据库没有WHPP独立历史数据。旧日报不会自动重分类；正式 Fresh Start 后重新导入时，CE开头运单会自动进入WHPP本土看板。</div>'
          : '<div class="whpp-note">WHPP本土独立读取完成。CE开头运单归WHPP；订单取消为独立闭环终态。</div>';
    target.innerHTML=`
      <section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>日报 ${esc(date||'—')} · CE开头运单独立统计 · 订单取消独立终态</p></div></section>
      <div class="whpp-toolbar"><label>日报日期<input id="whppDateV44" type="date" value="${esc(date)}"></label><button onclick="window.reloadWhppV44()">查询</button><div class="whpp-runbar"><button class="secondary" onclick="window.pauseWhppRun&&window.pauseWhppRun()">暂停</button><button onclick="window.startWhppRun&&window.startWhppRun()">开始/继续处理</button></div></div>
      ${notice}
      <div class="whpp-grid">
        ${card('WHPP本土',m.total,'','all','今日票数')}${card('今日POD',m.pod,'pod','pod',`POD率 ${pct(m.podRate)}`)}${card('POD率',pct(m.podRate),'pod','pod','当前比率')}${card('已退回件',m.returned,'return','returned',`退回率 ${pct(m.returnRate)}`)}${card('订单取消',m.cancelled,'cancel','cancelled',`取消率 ${pct(m.cancelRate)}`)}${card('当前未闭环',m.unresolved,'open','unresolved','不含正常分流/取消/退回/POD')}
      </div>
      <section class="whpp-panel"><h2>核心指标</h2><div class="whpp-core">
        ${metric('Pending不连续','pendingNonContinuous','pendingNonContinuous')}${metric('Pending1+','pending1','pending1')}${metric('Pending2+','pending2','pending2')}${metric('Pending3+','pending3','pending3')}${metric('OC1+','oc1','oc1')}${metric('OC2+','oc2','oc2')}
        ${metric('OC3+','oc3','oc3')}${metric('盘点2天+','cycle2','cycle2')}${metric('入库无扫描','inboundNoScan','inboundNoScan')}${metric('工单','workOrder','workOrder')}${metric('派送中','delivery','delivery')}${metric('金边门店','phnomPenhShop','phnomPenhShop','当前位置')}
        ${metric('CCSLCN分流','ccslCnDiversion','ccslCnDiversion','正常分流')}${metric('CCSLZT分流','ccslZtDiversion','ccslZtDiversion','正常分流')}${metric('CCSL580分流','ccsl580Diversion','ccsl580Diversion','正常分流')}${metric('580滞留','ccsl580Retention','ccsl580Retention','仅超时后统计')}${metric('1派POD','dispatchAttempt1','attempt1')}${metric('2派POD','dispatchAttempt2','attempt2')}
      </div><div class="whpp-note">CEL:CCSLCN / CEL:CCSLZT / CEL:CCSL580 均为正常分流；金边门店属于金边运营位置，PP/PV仅表示收件地址区域。</div></section>
      <section class="whpp-panel"><h2>区域与派次</h2><div class="whpp-regions">${regionBlock('PP 本省（金边）',r.PP||{})}${regionBlock('PV 外省收件地址',r.PV||{})}</div></section>
      <section class="whpp-panel"><h2>WHPP对账</h2><div class="whpp-note">总票 ${fmt(m.total)} = POD ${fmt(m.pod)} + 退回 ${fmt(m.returned)} + 订单取消 ${fmt(m.cancelled)} + 正常分流 ${fmt(m.normalDiversion)} + 当前未闭环 ${fmt(m.unresolved)}；差额 <b>${fmt(m.accountingDifference)}</b>。</div></section>`;
    forceVisibility();
  }

  async function fetchState(date=''){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const q=date?`?reportDate=${encodeURIComponent(date)}`:'';
      const response=await fetch(`/api/whpp/state${q}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
      return data;
    }finally{clearTimeout(timer);}
  }

  async function navigate(date=''){
    activeDate=date||activeDate||'';
    if(location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');
    forceVisibility();
    render(cached||{state:{reportDate:activeDate},dashboard:zeroDashboard()},true);
    try{
      cached=await fetchState(activeDate);
      activeDate=cached?.state?.reportDate||activeDate;
      render(cached,false);
    }catch(error){
      render(cached||{state:{reportDate:activeDate},dashboard:zeroDashboard()},false,error.name==='AbortError'?'读取超过5秒，已停止等待':error.message);
    }
  }

  function wireNav(){
    const button=document.querySelector('.side-link[data-page="whpp"]');
    if(button)button.onclick=event=>{event?.preventDefault?.();navigate();};
  }

  function install(){
    const previousNavigate=global.navigatePage;
    if(typeof previousNavigate==='function'&&!previousNavigate.__whppV44){
      const wrapped=function(page){if(page==='whpp')return navigate();return previousNavigate.apply(this,arguments);};
      wrapped.__whppV44=true;global.navigatePage=wrapped;
    }
    global.navigateWhppPage=navigate;
    global.reloadWhppV44=()=>{activeDate=document.getElementById('whppDateV44')?.value||'';return navigate(activeDate);};
    wireNav();
    observer=new MutationObserver(()=>{if(location.pathname==='/whpp'){wireNav();forceVisibility();}});
    const root=document.querySelector('.app-shell')||document.body;
    observer.observe(root,{subtree:true,attributes:true,attributeFilter:['hidden','class']});
    global.addEventListener('popstate',()=>{if(location.pathname==='/whpp')navigate(activeDate);});
    if(location.pathname==='/whpp')navigate(activeDate);
    console.info('[CE-QC][WHPP_UI_FAST]',VERSION);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
