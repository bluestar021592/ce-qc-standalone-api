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
  const DELIVERY_KPI_TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
  const fmt=(value,unit='件')=>value===null||value===undefined?'—':unit==='%'?`${Number(value).toFixed(2).replace(/\.00$/,'')}%`:unit==='天'?`${Number(value).toFixed(2)}天`:Number(value).toLocaleString('zh-CN');
  const metricCard=(row,businessType='HOME')=>`<button class="v18-metric-card" data-metric="${row.key}" onclick="window.openV18MetricDetail?.('${businessType}','${row.key}','${row.label}')"><i aria-hidden="true">●</i><span>${row.label}</span><b>${fmt(row.value,row.unit)}</b><small>${row.ratio||'查看明细'}</small></button>`;
  function businessCards(rows){const detailMode=rows.some(row=>row.metricKey!==undefined);const businessType=detailMode?String(rows[0]?.key||'').toUpperCase():'HOME';return `<section class="v18-business-grid">${rows.map(row=>`<button class="v18-business-card ${row.tone||''}" onclick="${detailMode?`window.openV18MetricDetail?.('${businessType}','${row.metricKey??row.key}','${row.label}')`:`window.navigatePage?.('${row.key==='total'?'home':row.key}')`}"><span>${row.label}</span><small>${row.unit==='%'?'当前比率':'今日票数'}</small><b>${fmt(row.value,row.unit)}</b><em>${row.ratio||'占总票数 0.00%'}</em></button>`).join('')}</section>`;}
  function special(model){const rate=(v,total)=>total?`${(v/total*100).toFixed(2)}%`:'—';const total=model.cards?.[0]?.value||0;return `<section class="v18-mid-grid"><article class="v18-panel"><h2>SHOPEE 专项指标</h2><div class="v18-special-grid"><div><h3>Pending不连续（CN/VN）</h3><span>CN <b>${fmt(model.special.pending.cn)}</b><small>${rate(model.special.pending.cn,total)}</small></span><span>VN <b>${fmt(model.special.pending.vn)}</b><small>${rate(model.special.pending.vn,total)}</small></span></div><div><h3>退回件（CN/VN）</h3><span>CN <b>${fmt(model.special.returned.cn)}</b><small>${rate(model.special.returned.cn,total)}</small></span><span>VN <b>${fmt(model.special.returned.vn)}</b><small>${rate(model.special.returned.vn,total)}</small></span></div></div></article></section>`;}
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

  const pct=value=>value===null||value===undefined?'—':`${Number(value).toFixed(2)}%`;
  const count=value=>Number(value||0).toLocaleString('zh-CN');
  function deliveryRange(model){
    const topFrom=String(document.getElementById('topRangeFrom')?.value||'').slice(0,10);
    const topTo=String(document.getElementById('topRangeTo')?.value||'').slice(0,10);
    const report=String(model.reportDate||'').slice(0,10);
    return{from:topFrom||report,to:topTo||report};
  }
  function deliverySummaryHtml(last={}){
    return `<div class="v18-core-grid" data-v263-summary>
      ${[
        ['当前POD',count(last.pod)],['1派签收',count(last.attempt1)],['2派签收',count(last.attempt2)],['3派+签收',count(last.attempt3)],
        ['派次未识别POD',count(last.attemptUnknown)],['派次证据覆盖',pct(last.attemptCoverageRate)],['平均签收天数',last.avgSigningDays==null?'—':`${Number(last.avgSigningDays).toFixed(2)}天`],['签收天数覆盖',pct(last.signingCoverageRate)]
      ].map(([label,value])=>`<div class="v18-metric-card" style="cursor:default"><i aria-hidden="true">●</i><span>${label}</span><b>${value}</b><small>持续追踪账本</small></div>`).join('')}
    </div>`;
  }
  function deliveryTableHtml(data){
    const rows=(data.daily||[]).map(r=>`<tr><td>${r.reportDate||'—'}</td><td>${count(r.total)}</td><td>${count(r.pod)}</td><td>${pct(r.podRate)}</td><td>${count(r.oc)}</td><td>${pct(r.ocRate)}</td><td>${r.avgSigningDays==null?'—':`${Number(r.avgSigningDays).toFixed(2)}天`}</td><td>${count(r.attempt1)}</td><td>${count(r.attempt2)}</td><td>${count(r.attempt3)}</td><td>${count(r.attemptUnknown)}</td><td>${pct(r.attemptCoverageRate)}</td><td>${pct(r.signingCoverageRate)}</td></tr>`).join('');
    return `<div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>OC</th><th>OC率</th><th>平均签收天数</th><th>1派</th><th>2派</th><th>3派+</th><th>未识别POD</th><th>派次覆盖</th><th>签收天数覆盖</th></tr></thead><tbody>${rows||'<tr><td colspan="13">暂无有效日报数据</td></tr>'}</tbody></table></div>`;
  }
  async function hydrateDeliveryKpis(root,model){
    const type=String(model.businessType||'').toUpperCase();
    if(!DELIVERY_KPI_TYPES.has(type))return;
    const rg=deliveryRange(model);if(!rg.to)return;
    const token=`${type}|${rg.from}|${rg.to}|${Date.now()}`;root.dataset.v263Request=token;
    try{
      const response=await fetch(`/api/v263/delivery-trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json();if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);
      if(!root.isConnected||root.dataset.v263Request!==token||String(root.querySelector('.v18-page-heading h2')?.textContent||'').toUpperCase().indexOf(type==='SHOPEECN'?'SHOPEE CN':type==='SHOPEEVN'?'SHOPEE VN':'TBKH')<0)return;
      const trend=root.querySelector('.v18-trend-section');
      if(trend){
        const trendModels=[
          {title:'票数趋势',type:'count',dates:data.dates||[],series:[{name:'票数',color:'#1677ff',values:data.ticket||[]}]},
          {title:'POD率趋势',type:'rate',dates:data.dates||[],series:[{name:'POD率',color:'#16a36a',values:data.podRate||[],numerators:data.pod||[],denominators:data.ticket||[]}]},
          {title:'OC率趋势',type:'rate',oc:true,dates:data.dates||[],series:[{name:'OC率',color:'#ff8a00',values:data.ocRate||[],numerators:data.oc||[],denominators:data.ticket||[]}]},
          {title:'平均签收天数趋势',type:'days',dates:data.dates||[],series:[{name:'平均签收天数',color:'#6d4aff',values:data.avgSigningDays||[]}]}
        ];
        trend.innerHTML=`<h2>趋势图表 <small>TBKH / SHOPEE CN / SHOPEE VN 专项持续追踪</small></h2>${charts(trendModels)}`;
        const cards=trend.querySelectorAll('.v18-chart-card');cards.forEach((node,index)=>global.RateTrendCardV18.render(node,trendModels[index]));
      }
      let panel=root.querySelector('#v263DeliveryKpiPanel');
      if(!panel){panel=document.createElement('section');panel.id='v263DeliveryKpiPanel';panel.className='v18-panel';const preview=root.querySelector('.v18-detail-preview');preview?.parentNode?.insertBefore(panel,preview);if(!panel.isConnected)root.appendChild(panel);}
      const last=(data.daily||[]).at(-1)||{};
      panel.innerHTML=`<h2>1/2/3派与平均签收天数 <small>${type} · 真实轨迹持续追踪</small></h2>${deliverySummaryHtml(last)}<section class="v18-chart-grid"><article class="v18-chart-card" data-v263-attempt></article></section><p class="operation-status">派次：70 START优先，整票无70才用60；只有Pending/失败后再次START才进入下一派。平均签收天数：首次日报锁定日期 → 实际POD日期（含首尾当天）。无真实证据保持“未识别”，不伪造0%。</p>${deliveryTableHtml(data)}`;
      global.RateTrendCardV18.render(panel.querySelector('[data-v263-attempt]'),{title:'1/2/3派签收占POD趋势',type:'rate',dates:data.dates||[],series:[
        {name:'1派',color:'#1677ff',values:data.attempt1Rate||[],numerators:data.attempt1||[],denominators:data.pod||[]},
        {name:'2派',color:'#16a36a',values:data.attempt2Rate||[],numerators:data.attempt2||[],denominators:data.pod||[]},
        {name:'3派+',color:'#ff8a00',values:data.attempt3Rate||[],numerators:data.attempt3||[],denominators:data.pod||[]}
      ]});
      root.dataset.v263DeliveryKpi='ready';
    }catch(error){
      console.warn('[CE-QC][V263_DELIVERY_KPI_UI]',type,error?.message||error);
      if(root.dataset.v263Request!==token)return;
      let panel=root.querySelector('#v263DeliveryKpiPanel');if(!panel){panel=document.createElement('section');panel.id='v263DeliveryKpiPanel';panel.className='v18-panel';root.appendChild(panel);}panel.innerHTML=`<h2>1/2/3派与平均签收天数</h2><div class="empty-state compact">专项持续追踪数据读取失败：${String(error?.message||error).replace(/[<>]/g,'')}</div>`;
    }
  }

  function renderHome(root,model){if(sameRender(root,model))return;root.className='app-page v18-dashboard-page';root.innerHTML=`${businessCards(model.cards)}<section class="v18-panel v18-core"><h2>核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688，不含 SHOPEE CN/VN</small></h2><div class="v18-core-grid">${model.core.map(row=>metricCard(row,'HOME')).join('')}</div></section>${special(model)}<section class="v18-panel v18-trend-section"><h2>趋势图表</h2>${charts(model.charts)}</section>`;mountCharts(root,model.charts);}
  function renderBusiness(root,model){const shopee=String(model.businessType||'').startsWith('SHOPEE');const previewId=shopee?'shopeePreviewPanel':'ccslPreviewPanel';const periodText=model.periodLabel||`日报 ${model.reportDate}`;if(sameRender(root,model)){if(DELIVERY_KPI_TYPES.has(String(model.businessType||'').toUpperCase()))void hydrateDeliveryKpis(root,model);return;}root.className='app-page v18-dashboard-page v18-business-page';root.innerHTML=`<section class="v18-page-heading"><div><h2>${model.label}看板</h2><p>${periodText} · 数据来自当前业务有效快照</p></div></section>${businessCards(model.cards)}<section class="v18-panel v18-core"><h2>核心指标</h2><div class="v18-core-grid">${model.core.map(row=>metricCard(row,model.businessType)).join('')}</div></section>${model.regions||model.dispatch?`<section class="v18-panel"><h2>区域与派次</h2><div class="v18-business-extra">${model.regions||''}${model.dispatch||''}</div></section>`:''}<section class="v18-panel v18-trend-section"><h2>趋势图表</h2>${charts(model.charts)}</section><section id="${previewId}" class="panel v18-detail-preview" aria-live="polite"></section>`;mountCharts(root,model.charts);void protectUnfinishedBusinessDashboard(root,model,periodText);if(DELIVERY_KPI_TYPES.has(String(model.businessType||'').toUpperCase()))void hydrateDeliveryKpis(root,model);}
  global.DashboardV18={renderHome,renderBusiness};
})(window);
