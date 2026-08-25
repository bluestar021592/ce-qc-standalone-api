(function (global) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const fmt = (value, type) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : type === 'rate' ? `${Number(value).toFixed(2)}%` : type === 'days' ? `${Number(value).toFixed(2)}天` : Math.round(value).toLocaleString('zh-CN');
  const lastTwo = values => values.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))).slice(-2);
  const svgNode = (tag, attrs = {}) => { const node = document.createElementNS(svgNs, tag); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); return node; };
  const isAttemptChart = chart => /1\/2\/3派/.test(String(chart?.title||''));
  function latestAttemptEvidence(chart){
    if(!isAttemptChart(chart)||!chart?.series?.length)return null;
    const lastIndex=Math.max(0,(chart.dates||[]).length-1);
    const denominator=Number(chart.series.find(series=>Number.isFinite(Number(series.denominators?.[lastIndex])))?.denominators?.[lastIndex]||0);
    const known=chart.series.reduce((sum,series)=>sum+(Number.isFinite(Number(series.numerators?.[lastIndex]))?Number(series.numerators[lastIndex]):0),0);
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
    const panel=container.closest?.('#v263DeliveryKpiPanel,#v271AttemptPanel,#v272AttemptPanel');if(!panel)return;
    let status=panel.querySelector('.v265-attempt-evidence-status');
    if(!status){status=document.createElement('div');status.className='v265-attempt-evidence-status';const grid=panel.querySelector('.v18-chart-grid,.v272-attempt-chart');grid?.parentNode?.insertBefore(status,grid);}
    const complete=evidence.unknown===0;
    status.classList.toggle('complete',complete);status.classList.toggle('incomplete',!complete);
    status.innerHTML=complete
      ? `<b>派次证据已完整</b><span>已识别 ${evidence.known.toLocaleString('zh-CN')}/${evidence.denominator.toLocaleString('zh-CN')} 票，可以作为正式1/2/3派结果。</span>`
      : `<b>派次证据自动补抓中</b><span>当前已识别 ${evidence.known.toLocaleString('zh-CN')}/${evidence.denominator.toLocaleString('zh-CN')} 票（${evidence.coverage.toFixed(2)}%），仍有 ${evidence.unknown.toLocaleString('zh-CN')} 票待补抓。证据未完整前1/2/3派件数与比例统一显示“—”，不发布部分样本结果。</span>`;
    if(!complete)scheduleEvidenceRefresh(panel);
  }
  function pointSpacing(chart){
    const days=Math.max(1,chart.dates?.length||1);
    const multi=(chart.series?.length||0)>1;
    if(days<=14)return multi?78:66;
    if(days<=31)return multi?66:56;
    if(days<=62)return multi?52:46;
    return multi?42:36;
  }
  function pointLabelY(y,seriesIndex,seriesCount,height,pad){
    const offsets=seriesCount<=1?[-7]:[-10,10,-20,20,-30,30];
    const offset=offsets[seriesIndex%offsets.length]||-7;
    return Math.max(12,Math.min(height-pad.b-3,y+offset));
  }

  function render(container, chart) {
    chart = {
      ...(chart || {}),
      dates: Array.isArray(chart?.dates) ? chart.dates : [],
      series: (Array.isArray(chart?.series) ? chart.series : []).map(series => ({
        ...(series || {}),
        values: Array.isArray(series?.values) ? series.values.map(value=>value===null||value===undefined||!Number.isFinite(Number(value))?null:Number(value)) : [],
        numerators: Array.isArray(series?.numerators) ? series.numerators : [],
        denominators: Array.isArray(series?.denominators) ? series.denominators : []
      }))
    };
    const attemptChart=isAttemptChart(chart),attemptEvidence=latestAttemptEvidence(chart);
    const rangeLabel=chart.rangeLabel||`${chart.dates.length||0}个有效日报日`;
    container.innerHTML = `<div class="v18-chart-head"><h3></h3><span>${rangeLabel}</span></div><div class="v18-chart-legend"></div><div class="v18-chart-plot"></div><div class="v18-chart-current"></div><p class="v18-chart-note">按所选日报日期逐日绘制；每个有效百分比节点直接显示数值，日期较多时横向展开保持走势清晰</p>`;
    container.querySelector('h3').textContent = chart.title || '趋势';
    const legend = container.querySelector('.v18-chart-legend');
    chart.series.forEach(series => { const item = document.createElement('span'); const mark = document.createElement('i'); mark.style.background = series.color; item.append(mark, document.createTextNode(series.name)); legend.appendChild(item); });

    const measuredWidth=Math.round(container.getBoundingClientRect?.().width||0);
    const baseWidth=Math.max(360,measuredWidth>80?measuredWidth-20:360);
    const spacing=pointSpacing(chart);
    const contentWidth=chart.dates.length<=1?baseWidth:42+(chart.dates.length-1)*spacing+(attemptChart?82:62);
    const width=Math.max(baseWidth,Math.min(7600,contentWidth));
    const height = chart.type==='rate'&&chart.series.length>1?178:164;
    const pad = { l: 46, r: attemptChart?82:62, t: 24, b: 32 };
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, width:String(width), height:String(height), role: 'img', 'aria-label': chart.title || '趋势' });
    svg.style.display='block';
    svg.style.maxWidth='none';
    const clipId = `v18clip-${Math.random().toString(36).slice(2)}`;
    const defs = svgNode('defs'), clip = svgNode('clipPath', { id: clipId });
    clip.appendChild(svgNode('rect', { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b })); defs.appendChild(clip); svg.appendChild(defs);
    const all = chart.series.flatMap(series => series.values).filter(value => value !== null);
    const maxData = Math.max(...all, 1);
    const adaptiveAttemptMax=attemptChart&&attemptEvidence&&attemptEvidence.coverage<100?Math.min(100,Math.max(5,Math.ceil(maxData*1.35/5)*5)):100;
    const max = chart.type === 'rate' ? (chart.oc ? Math.max(3, maxData * 1.25) : attemptChart ? adaptiveAttemptMax : 100) : chart.type === 'days' ? Math.max(3, Math.ceil(maxData * 1.25 * 10) / 10) : Math.max(10, Math.ceil(maxData / Math.max(10,10**Math.max(0,String(Math.round(maxData)).length-2))) * Math.max(10,10**Math.max(0,String(Math.round(maxData)).length-2)));
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
        const dot = svgNode('circle', { cx: x, cy: y, r: 3.2, fill: series.color, 'clip-path': `url(#${clipId})` }), title = svgNode('title');
        const numerator = Number(series.numerators[index]), denominator = Number(series.denominators[index]); title.textContent = `${chart.dates[index] || '—'} · ${series.name} · ${Number.isFinite(numerator) && Number.isFinite(denominator) ? `${numerator}/${denominator} · ` : ''}${fmt(value, chart.type)}`; dot.appendChild(title); svg.appendChild(dot);
        const showPointLabel=chart.type==='rate'||chart.type==='days'||chart.dates.length<=14;
        if(showPointLabel){
          const pointLabel=svgNode('text',{
            x,
            y:pointLabelY(y,seriesIndex,chart.series.length,height,pad),
            'text-anchor':'middle',
            fill:series.color,
            'font-size':chart.type==='rate'?'8':'8.5',
            'font-weight':'700',
            stroke:'#ffffff',
            'stroke-width':'2.5',
            'paint-order':'stroke',
            'stroke-linejoin':'round'
          });
          pointLabel.textContent=fmt(value,chart.type);svg.appendChild(pointLabel);
        }
      });
      if (segment.length >= 2) svg.appendChild(svgNode('polyline', { points: segment.map(point => `${point.x},${point.y}`).join(' '), fill: 'none', stroke: series.color, 'stroke-width': '2.2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'clip-path': `url(#${clipId})` }));
      if (!lastPoint) return;
      const baseY = Math.max(13, Math.min(height - pad.b - 4, lastPoint.y - 7));
      const candidates = [baseY];
      for (let step = 1; step <= 8; step += 1) candidates.push(baseY + step * 13, baseY - step * 13);
      const labelY = candidates.map(value => Math.max(13,Math.min(height-pad.b-4,value))).find(value=>!placedLabels.some(y=>Math.abs(y-value)<12))??(16+seriesIndex*14);
      placedLabels.push(labelY);
      const label = svgNode('text', { x: width - 4, y: labelY, fill: series.color, class: 'v18-last-label', 'text-anchor': 'end', stroke:'#fff', 'stroke-width':'2.5', 'paint-order':'stroke' }); label.textContent = fmt(lastPoint.value, chart.type); svg.appendChild(label);
    });
    const availableDays = new Set(chart.series.flatMap(series => series.values.map((value, index) => value === null ? null : chart.dates[index]).filter(Boolean))).size;
    container.dataset.historyDays = String(availableDays);
    if (availableDays < 2) container.querySelector('.v18-chart-note').textContent = `当前选择范围内只有 ${availableDays} 个有效日报点；有值就显示，不把缺失日期补成0`;
    if(attemptChart&&attemptEvidence&&attemptEvidence.coverage<100)container.querySelector('.v18-chart-note').textContent=`派次证据补抓中：已识别 ${attemptEvidence.known}/${attemptEvidence.denominator}（${attemptEvidence.coverage.toFixed(2)}%）；当前曲线只表示已获得的真实轨迹证据，不作为最终派次率；未完整日期保持“—”，不绘制部分样本派次率。`;
    const plot=container.querySelector('.v18-chart-plot');
    plot.style.overflowX='auto';
    plot.style.overflowY='hidden';
    plot.style.paddingBottom='4px';
    plot.appendChild(svg);

    const current = container.querySelector('.v18-chart-current');
    chart.series.forEach(series => {
      const valid = lastTwo(series.values), value = valid.at(-1) ?? null, previous = valid.at(-2) ?? null, delta = value === null || previous === null ? null : value - previous;
      const item = document.createElement('div'); item.dataset.series = series.name; item.innerHTML = '<span></span><b></b><small></small>';
      item.querySelector('span').textContent = `${series.name} 当前`; item.querySelector('b').style.color = series.color;
      const incompleteAttempt=attemptChart&&attemptEvidence&&attemptEvidence.coverage<100;
      item.querySelector('b').textContent = incompleteAttempt ? '—' : fmt(value, chart.type);
      const deltaUnit = chart.type === 'rate' ? '%' : chart.type === 'days' ? '天' : '';
      item.querySelector('small').textContent = incompleteAttempt ? '证据未完整 · 不发布部分结果' : delta === null ? '较上一有效日报 —' : `较上一有效日报 ${delta >= 0 ? '↑' : '↓'}${Math.abs(delta).toFixed(2)}${deltaUnit}`;
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
