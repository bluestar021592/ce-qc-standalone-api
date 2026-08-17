(function ensureExactDrilldownRuntime(global){
  const RUNTIME_ID='ce-qc-v58-drilldown-runtime';
  if(!global?.document)return;
  if(document.documentElement?.dataset?.v58Drilldown||document.getElementById(RUNTIME_ID))return;
  const script=document.createElement('script');
  script.id=RUNTIME_ID;
  script.src='/v58-drilldown-runtime.js?v=20260811-v61-1';
  script.async=false;
  script.dataset.ceQcExactDrilldown='1';
  (document.head||document.documentElement).appendChild(script);
})(window);

(function (global) {
  const renderSignatures=new WeakMap();
  const completedProbeCache=new Map();
  const fmt=(value,unit='件')=>value===null||value===undefined?'—':unit==='%'?`${Number(value).toFixed(2).replace(/\.00$/,'')}%`:Number(value).toLocaleString('zh-CN');
  const metricCard=(row,businessType='HOME')=>`<button class="v18-metric-card" data-metric="${row.key}" onclick="window.openV18MetricDetail?.('${businessType}','${row.key}','${row.label}')"><i aria-hidden="true">●</i><span>${row.label}</span><b>${fmt(row.value,row.unit)}</b><small>${row.ratio||'查看明细'}</small></button>`;
  function businessCards(rows){const detailMode=rows.some(row=>row.metricKey!==undefined);const businessType=detailMode?String(rows[0]?.key||'').toUpperCase():'HOME';return `<section class="v18-business-grid">${rows.map(row=>`<button class="v18-business-card ${row.tone||''}" onclick="${detailMode?`window.openV18MetricDetail?.('${businessType}','${row.metricKey??row.key}','${row.label}')`:`window.navigatePage?.('${row.key==='total'?'home':row.key}')`}"><span>${row.label}</span><small>${row.unit==='%'?'当前比率':'今日票数'}</small><b>${fmt(row.value,row.unit)}</b><em>${row.ratio||'占总票数 0.00%'}</em></button>`).join('')}</section>`;}
  function special(model){const rate=(v,total)=>total?`${(v/total*100).toFixed(2)}%`:'—';const total=model.cards?.[0]?.value||0;const dispatchValue=value=>{const number=Number(value);return value===null||value===undefined||!Number.isFinite(number)?null:number;};return `<section class="v18-mid-grid"><article class="v18-panel"><h2>SHOPEE 专项指标</h2><div class="v18-special-grid"><div><h3>Pending不连续（CN/VN）</h3><span>CN <b>${fmt(model.special.pending.cn)}</b><small>${rate(model.special.pending.cn,total)}</small></span><span>VN <b>${fmt(model.special.pending.vn)}</b><small>${rate(model.special.pending.vn,total)}</small></span></div><div><h3>退回件（CN/VN）</h3><span>CN <b>${fmt(model.special.returned.cn)}</b><small>${rate(model.special.returned.cn,total)}</small></span><span>VN <b>${fmt(model.special.returned.vn)}</b><small>${rate(model.special.returned.vn,total)}</small></span></div></div></article><article class="v18-panel"><h2>派送概率分布（按派次）- 百分比</h2><div class="v18-dispatch-grid">${(model.dispatch||[]).map(group=>`<div><h3>${group.label}</h3>${(group.values||[]).map((raw,index)=>{const value=dispatchValue(raw);return `<span><label>${index+1}派</label><i><b style="width:${value===null?0:Math.max(0,Math.min(100,value))}%"></b></i><em>${value===null?'—':`${value.toFixed(2)}%`}</em></span>`;}).join('')}</div>`).join('')}</div></article></section>`;}
  function charts(rows){return `<section class="v18-chart-grid">${rows.map((_,index)=>`<article class="v18-chart-card" data-chart-index="${index}"></article>`).join('')}</section>`;}
  function mountCharts(root,rows){root.querySelectorAll('.v18-chart-card').forEach((node,index)=>global.RateTrendCardV18.render(node,rows[index]));}
  function signature(model){
    try{return JSON.stringify({page:model.page,businessType:model.businessType,reportDate:model.reportDate,periodLabel:model.periodLabel,cards:model.cards,core:model.core,regions:model.regions,dispatch:model.dispatch,charts:model.charts,special:model.special});}
    catch{return `${model.page||''}|${model.businessType||''}|${model.reportDate||''}|${Date.now()}`;}
  }
  function sameRender(root,model){
    const next=signature(model);const same=renderSignatures.get(root)===next&&root.isConnected&&root.childElementCount>0;
    if(!same)renderSignatures.set(root,next);
    return same;
  }

  function pendingRun(progress, model) {
    if (!progress || progress.ok === false) return false;
    if (String(progress.reportDate || '') !== String(model.reportDate || '')) return false;
    const status = String(progress.runStatus || '').trim().toLowerCase();
    const total = Number(progress.total || 0);
    const done = Number(progress.done || 0);
    return Boolean(progress.running || progress.paused || ['running','paused','failed','processing'].includes(status) || (total > 0 && done < total && !['finished','completed'].includes(status)));
  }

  function knownCompletedBusinessSnapshot(model){
    const type=String(model.businessType||'').toUpperCase();
    try{
      const state=global.businessStates?.[type];
      const status=String(state?.snapshotStatus||'').toUpperCase();
      return String(state?.reportDate||'')===String(model.reportDate||'')&&(status==='COMPLETED'||status==='COMPLETED_WITH_RETRY');
    }catch{return false;}
  }

  async function hasCompletedBusinessSnapshot(model) {
    if(knownCompletedBusinessSnapshot(model))return true;
    const type = String(model.businessType || '').toUpperCase();
    if (!type) return false;
    const cacheKey=`${type}|${model.reportDate||''}`;
    const cached=completedProbeCache.get(cacheKey);
    if(cached&&Date.now()-cached.at<30_000)return cached.value;
    const response = await fetch(`/api/business-state/${encodeURIComponent(type)}?compact=1`, { cache:'no-store', credentials:'same-origin' });
    if (!response.ok) return false;
    const payload = await response.json();
    const reportDate = String(payload?.reportDate || payload?.state?.reportDate || '');
    const snapshotStatus = String(payload?.snapshotStatus || payload?.state?.snapshotStatus || '').toUpperCase();
    const value=reportDate === String(model.reportDate || '') && (snapshotStatus === 'COMPLETED'||snapshotStatus==='COMPLETED_WITH_RETRY');
    completedProbeCache.set(cacheKey,{at:Date.now(),value});
    return value;
  }

  async function protectUnfinishedBusinessDashboard(root, model, periodText) {
    const type = String(model.businessType || '').toUpperCase();
    const scope = type.startsWith('SHOPEE') ? 'SHOPEE' : 'CCSL';
    try {
      if (await hasCompletedBusinessSnapshot(model)) return;
      const response = await fetch(`/api/v33/run-progress?businessType=${encodeURIComponent(scope)}`, { cache:'no-store', credentials:'same-origin' });
      if (!response.ok) return;
      const progress = await response.json();
      if (!pendingRun(progress, model) || !root.isConnected) return;
      const heading = root.querySelector('.v18-page-heading p');
      if (heading) heading.textContent = `${periodText} · 当前任务处理中，正式快照完成前不计算签收、退回和未闭环`;
      const business = [...root.querySelectorAll('.v18-business-card')];
      business.slice(1).forEach(button => {
        const value = button.querySelector('b');
        const ratio = button.querySelector('em');
        if (value) value.textContent = '—';
        if (ratio) ratio.textContent = '处理中，待正式快照';
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      });
      root.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(button => {
        const value = button.querySelector('b');
        const note = button.querySelector('small');
        if (value) value.textContent = '—';
        if (note) note.textContent = '处理中，待正式快照';
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      });
    } catch (error) {
      console.warn('[V18] processing snapshot guard skipped', error);
    }
  }

  function renderHome(root,model){if(sameRender(root,model))return;root.className='app-page v18-dashboard-page';root.innerHTML=`${businessCards(model.cards)}<section class="v18-panel v18-core"><h2>核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688，不含 SHOPEE CN/VN</small></h2><div class="v18-core-grid">${model.core.map(row=>metricCard(row,'HOME')).join('')}</div></section>${special(model)}<section class="v18-panel v18-trend-section"><h2>趋势图表</h2>${charts(model.charts)}</section>`;mountCharts(root,model.charts);}
  function renderBusiness(root,model){const shopee=String(model.businessType||'').startsWith('SHOPEE');const previewId=shopee?'shopeePreviewPanel':'ccslPreviewPanel';const periodText=model.periodLabel||`日报 ${model.reportDate}`;if(sameRender(root,model))return;root.className='app-page v18-dashboard-page v18-business-page';root.innerHTML=`<section class="v18-page-heading"><div><h2>${model.label}看板</h2><p>${periodText} · 数据来自当前业务有效快照</p></div></section>${businessCards(model.cards)}<section class="v18-panel v18-core"><h2>核心指标</h2><div class="v18-core-grid">${model.core.map(row=>metricCard(row,model.businessType)).join('')}</div></section>${model.regions||model.dispatch?`<section class="v18-panel"><h2>区域与派次</h2><div class="v18-business-extra">${model.regions||''}${model.dispatch||''}</div></section>`:''}<section class="v18-panel v18-trend-section"><h2>趋势图表</h2>${charts(model.charts)}</section><section id="${previewId}" class="panel v18-detail-preview" aria-live="polite"></section>`;mountCharts(root,model.charts);void protectUnfinishedBusinessDashboard(root,model,periodText);}
  global.DashboardV18={renderHome,renderBusiness};
})(window);
