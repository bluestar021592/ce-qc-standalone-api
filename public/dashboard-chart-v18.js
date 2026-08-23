(function (global) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const fmt = (value, type) => value === null ? '—' : type === 'rate' ? `${Number(value).toFixed(2)}%` : type === 'days' ? `${Number(value).toFixed(2)}天` : Math.round(value).toLocaleString('zh-CN');
  const lastTwo = values => values.filter(value => value !== null).slice(-2);
  const svgNode = (tag, attrs = {}) => { const node = document.createElementNS(svgNs, tag); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); return node; };
  const isAttemptChart = chart => /1\/2\/3派/.test(String(chart?.title||''));
  function latestAttemptEvidence(chart){
    if(!isAttemptChart(chart)||!chart?.series?.length)return null;
    const lastIndex=Math.max(0,(chart.dates||[]).length-1);
    const denominator=Number(chart.series.find(series=>Number.isFinite(Number(series.denominators?.[lastIndex])))?.denominators?.[lastIndex]||0);
    const known=chart.series.reduce((sum,series)=>sum+Number(series.numerators?.[lastIndex]||0),0);
    return denominator>0?{known,denominator,unknown:Math.max(0,denominator-known),coverage:known*100/denominator}:null;
  }
  function scheduleEvidenceRefresh(panel){
    if(!panel||panel.dataset.v265EvidenceRefresh==='scheduled')return;
    panel.dataset.v265EvidenceRefresh='scheduled';
    const timer=setTimeout(()=>{
      delete panel.dataset.v265EvidenceRefresh;
      if(!panel.isConnected||!panel.querySelector('.v265-attempt-evidence-status.incomplete'))return;
      try{
        if(typeof global.renderAll==='function')global.renderAll();
        else document.querySelector('#topRangeQueryBtn,#queryBtn,.query-btn')?.click?.();
      }catch(error){console.warn('[CE-QC][V265_EVIDENCE_REFRESH]',error?.message||error);}
    },15000);
    if(typeof timer?.unref==='function')timer.unref();
  }
  function syncAttemptEvidenceUi(container,chart){
    const evidence=latestAttemptEvidence(chart);if(!evidence)return;
    const panel=container.closest?.('#v263DeliveryKpiPanel');if(!panel)return;
    let status=panel.querySelector('.v265-attempt-evidence-status');
    if(!status){status=document.createElement('div');status.className='v265-attempt-evidence-status';const grid=panel.querySelector('.v18-chart-grid');grid?.parentNode?.insertBefore(status,grid);}
    const complete=evidence.unknown===0;
    status.classList.toggle('complete',complete);status.classList.toggle('incomplete',!complete);
    status.innerHTML=complete
      ? `<b>派次证据已完整</b><span>已识别 ${evidence.known.toLocaleString('zh-CN')}/${evidence.denominator.toLocaleString('zh-CN')} 票，可以作为正式1/2/3派结果。</span>`
      : `<b>派次证据自动补抓中</b><span>当前已识别 ${evidence.known.toLocaleString('zh-CN')}/${evidence.denominator.toLocaleString('zh-CN')} 票（${evidence.coverage.toFixed(2)}%），仍有 ${evidence.unknown.toLocaleString('zh-CN')} 票待补。下面1/2/3派比例属于当前已获取证据，不是最终结果。</span>`;
    const cards=[...panel.querySelectorAll('[data-v263-summary] .v18-metric-card')];
    for(const card of cards){
      const label=String(card.querySelector('span')?.textContent||'');const small=card.querySelector('small'),value=card.querySelector('b');if(!small)continue;
      if(/^[123]派/.test(label)){
        const currentCount=Number(String(value?.textContent||'0').replace(/[^0-9.-]/g,''))||0;
        small.textContent=complete?'真实轨迹已完整':'当前证据 · 补抓未完成';
        if(!complete&&value)value.textContent=currentCount>0?`${currentCount.toLocaleString('zh-CN')}票（暂）`:'待补抓';
      }
      if(label.includes('派次未识别')){small.textContent=complete?'已清零':'待自动补轨迹证据';card.classList.toggle('v265-warning-card',!complete);}
      if(label.includes('派次证据覆盖'))small.textContent=complete?'证据完整':'未完成前不作为最终派次率';
      if(label.includes('平均签收天数')){
        const coverageCard=cards.find(item=>String(item.querySelector('span')?.textContent||'').includes('签收天数覆盖'));
        const coverage=Number(String(coverageCard?.querySelector('b')?.textContent||'').replace('%',''));
        small.textContent=Number.isFinite(coverage)&&coverage>=100?'真实POD日期已完整':`当前覆盖 ${Number.isFinite(coverage)?coverage.toFixed(2):'—'}% · 暂算`;
      }
    }
    if(!complete)scheduleEvidenceRefresh(panel);
  }

  function render(container, chart) {
    chart = {
      ...(chart || {}),
      dates: Array.isArray(chart?.dates) ? chart.dates : [],
      series: (Array.isArray(chart?.series) ? chart.series : []).map(series => ({
        ...(series || {}),
        values: Array.isArray(series?.values) ? series.values : [],
        numerators: Array.isArray(series?.numerators) ? series.numerators : [],
        denominators: Array.isArray(series?.denominators) ? series.denominators : []
      }))
    };
    const attemptChart=isAttemptChart(chart),attemptEvidence=latestAttemptEvidence(chart);
    const rangeLabel=chart.rangeLabel||`${chart.dates.length||0}个有效日报日`;
    container.innerHTML = `<div class="v18-chart-head"><h3></h3><span>${rangeLabel}</span></div><div class="v18-chart-legend"></div><div class="v18-chart-plot"></div><div class="v18-chart-current"></div><p class="v18-chart-note">当前值与曲线最后有效节点保持一致；短区间每一天的数值直接标在节点上</p>`;
    container.querySelector('h3').textContent = chart.title || '趋势';
    const legend = container.querySelector('.v18-chart-legend');
    chart.series.forEach(series => { const item = document.createElement('span'); const mark = document.createElement('i'); mark.style.background = series.color; item.append(mark, document.createTextNode(series.name)); legend.appendChild(item); });

    const measuredWidth=Math.round(container.getBoundingClientRect?.().width||0);
    const width = attemptChart ? Math.max(640,Math.min(1400,measuredWidth>80?measuredWidth-20:960)) : 360;
    const height = 158, pad = { l: 42, r: attemptChart?72:54, t: 18, b: 30 };
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': chart.title || '趋势' });
    const clipId = `v18clip-${Math.random().toString(36).slice(2)}`;
    const defs = svgNode('defs'), clip = svgNode('clipPath', { id: clipId });
    clip.appendChild(svgNode('rect', { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b })); defs.appendChild(clip); svg.appendChild(defs);
    const all = chart.series.flatMap(series => series.values).filter(value => value !== null);
    const maxData = Math.max(...all, 1);
    const adaptiveAttemptMax=attemptChart&&attemptEvidence&&attemptEvidence.coverage<100?Math.min(100,Math.max(5,Math.ceil(maxData*1.35/5)*5)):100;
    const max = chart.type === 'rate' ? (chart.oc ? Math.max(3, maxData * 1.25) : attemptChart ? adaptiveAttemptMax : 100) : chart.type === 'days' ? Math.max(3, Math.ceil(maxData * 1.25 * 10) / 10) : Math.max(1000, Math.ceil(maxData / 1000) * 1000);
    for (let index = 0; index <= 3; index += 1) {
      const y = pad.t + (height - pad.t - pad.b) * index / 3;
      svg.appendChild(svgNode('line', { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: 'v18-grid' }));
      const label = svgNode('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end', class: 'v18-axis' }); label.textContent = fmt(max * (1 - index / 3), chart.type); svg.appendChild(label);
    }
    chart.dates.forEach((date, index) => { const x = pad.l + (width - pad.l - pad.r) * index / Math.max(1, chart.dates.length - 1); const label = svgNode('text', { x, y: height - 7, 'text-anchor': 'middle', class: 'v18-axis v18-date-axis' }); const rawDate = String(date || ''); label.textContent = (rawDate.length > 5 ? rawDate.slice(5) : rawDate) || '—'; svg.appendChild(label); });

    const placedLabels = [];
    chart.series.forEach((series, seriesIndex) => {
      const segment = [];
      let lastPoint = null;
      series.values.forEach((value, index) => {
        if (value === null) return;
        const x = pad.l + (width - pad.l - pad.r) * index / Math.max(1, chart.dates.length - 1), y = pad.t + (height - pad.t - pad.b) * (1 - value / max);
        segment.push({ x, y }); lastPoint = { x, y, value };
        const dot = svgNode('circle', { cx: x, cy: y, r: 3, fill: series.color, 'clip-path': `url(#${clipId})` }), title = svgNode('title');
        const numerator = series.numerators[index], denominator = series.denominators[index]; title.textContent = `${chart.dates[index] || '—'} · ${series.name} · ${Number.isFinite(numerator) && Number.isFinite(denominator) ? `${numerator}/${denominator} · ` : ''}${fmt(value, chart.type)}`; dot.appendChild(title); svg.appendChild(dot);
        if(chart.series.length===1&&chart.dates.length<=10){
          const pointLabel=svgNode('text',{x,y:Math.max(11,y-6),'text-anchor':'middle',fill:series.color,'font-size':chart.type==='rate'?'7.5':'8','font-weight':'700'});
          pointLabel.textContent=fmt(value,chart.type);svg.appendChild(pointLabel);
        }
      });
      if (segment.length >= 2) svg.appendChild(svgNode('polyline', { points: segment.map(point => `${point.x},${point.y}`).join(' '), fill: 'none', stroke: series.color, 'stroke-width': '2.2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'clip-path': `url(#${clipId})` }));
      if (!lastPoint) return;
      const baseY = Math.max(13, Math.min(height - pad.b - 4, lastPoint.y - 7));
      const candidates = [baseY];
      for (let step = 1; step <= 8; step += 1) candidates.push(baseY + step * 13, baseY - step * 13);
      const labelY = candidates.map(value => Math.max(13, Math.min(height - pad.b - 4, value))).find(value => !placedLabels.some(y => Math.abs(y - value) < 12)) ?? (16 + seriesIndex * 14);
      placedLabels.push(labelY);
      const label = svgNode('text', { x: width - 4, y: labelY, fill: series.color, class: 'v18-last-label', 'text-anchor': 'end' }); label.textContent = fmt(lastPoint.value, chart.type); svg.appendChild(label);
    });
    const availableDays = new Set(chart.series.flatMap(series => series.values.map((value, index) => value === null ? null : chart.dates[index]).filter(Boolean))).size;
    container.dataset.historyDays = String(availableDays);
    if (availableDays < 2) container.querySelector('.v18-chart-note').textContent = `历史快照不足（${availableDays}/${Math.max(2,chart.dates.length||7)}），累计到2个有效日期后自动显示折线`;
    if(attemptChart&&attemptEvidence&&attemptEvidence.coverage<100)container.querySelector('.v18-chart-note').textContent=`证据补抓中：已识别 ${attemptEvidence.known}/${attemptEvidence.denominator}（${attemptEvidence.coverage.toFixed(2)}%），当前曲线只表示已获得的真实轨迹证据，不作为最终派次率。`;
    container.querySelector('.v18-chart-plot').appendChild(svg);

    const current = container.querySelector('.v18-chart-current');
    chart.series.forEach(series => {
      const valid = lastTwo(series.values), value = valid.at(-1) ?? null, previous = valid.at(-2) ?? null, delta = value === null || previous === null ? null : value - previous;
      const item = document.createElement('div'); item.dataset.series = series.name; item.innerHTML = '<span></span><b></b><small></small>';
      item.querySelector('span').textContent = `${series.name} 当前`; item.querySelector('b').style.color = series.color;
      const incompleteAttempt=attemptChart&&attemptEvidence&&attemptEvidence.coverage<100;
      item.querySelector('b').textContent = incompleteAttempt ? (Number(value||0)>0?`${fmt(value,chart.type)} 暂`:'待补抓') : fmt(value, chart.type);
      const deltaUnit = chart.type === 'rate' ? '%' : chart.type === 'days' ? '天' : '';
      item.querySelector('small').textContent = incompleteAttempt ? '证据未完整 · 非最终' : delta === null ? '较昨日 —' : `较昨日 ${delta >= 0 ? '↑' : '↓'}${Math.abs(delta).toFixed(2)}${deltaUnit}`;
      current.appendChild(item);
      if (global.DashboardDataAdapterV18 && value !== global.DashboardDataAdapterV18.last(series.values)) container.dataset.bindingError = 'true';
    });
    if(attemptChart)syncAttemptEvidenceUi(container,chart);
  }
  global.RateTrendCardV18 = { render };

  if(!global.__CE_QC_V234_FETCH_BRIDGE__&&typeof global.fetch==='function'){
    global.__CE_QC_V234_FETCH_BRIDGE__=true;
    const previousFetch=global.fetch.bind(global);
    const rewrite=text=>{
      let next=String(text||'');
      if(next.includes('/api/v61/metric-detail?'))next=next.replace('/api/v61/metric-detail?','/api/v234/metric-detail?');
      if(next.includes('/api/v27/trends?'))next=next.replace('/api/v27/trends?','/api/v234/trends?');
      const match=next.match(/\/api\/business-state\/(CE|CEAF|TBKH|ALI1688|SHOPEECN|SHOPEEVN)(\?[^#]*)/i);
      if(match&&/[?&]compact=1(?:&|$)/.test(match[2]))next=next.replace(`/api/business-state/${match[1]}`,`/api/v234/business-state/${match[1]}`);
      return next;
    };
    global.fetch=function v234FetchBridge(input,init){
      try{
        if(typeof input==='string')input=rewrite(input);
        else if(input instanceof Request){const next=rewrite(input.url);if(next!==input.url)input=new Request(next,input);}
      }catch(error){console.warn('[CE-QC][V234_FETCH_BRIDGE]',error);}
      return previousFetch(input,init);
    };
  }
})(window);
