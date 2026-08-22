(function (global) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const fmt = (value, type) => value === null ? '—' : type === 'rate' ? `${Number(value).toFixed(2)}%` : Math.round(value).toLocaleString('zh-CN');
  const lastTwo = values => values.filter(value => value !== null).slice(-2);
  const svgNode = (tag, attrs = {}) => { const node = document.createElementNS(svgNs, tag); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); return node; };

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
    const rangeLabel=chart.rangeLabel||`${chart.dates.length||0}个有效日报日`;
    container.innerHTML = `<div class="v18-chart-head"><h3></h3><span>${rangeLabel}</span></div><div class="v18-chart-legend"></div><div class="v18-chart-plot"></div><div class="v18-chart-current"></div><p class="v18-chart-note">当前值与曲线最后有效节点保持一致；短区间百分比直接标在每日节点上</p>`;
    container.querySelector('h3').textContent = chart.title || '趋势';
    const legend = container.querySelector('.v18-chart-legend');
    chart.series.forEach(series => { const item = document.createElement('span'); const mark = document.createElement('i'); mark.style.background = series.color; item.append(mark, document.createTextNode(series.name)); legend.appendChild(item); });

    const width = 360, height = 158, pad = { l: 42, r: 54, t: 18, b: 30 };
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': chart.title || '趋势' });
    const clipId = `v18clip-${Math.random().toString(36).slice(2)}`;
    const defs = svgNode('defs'), clip = svgNode('clipPath', { id: clipId });
    clip.appendChild(svgNode('rect', { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b })); defs.appendChild(clip); svg.appendChild(defs);
    const all = chart.series.flatMap(series => series.values).filter(value => value !== null);
    const maxData = Math.max(...all, 1);
    const max = chart.type === 'rate' ? (chart.oc ? Math.max(3, maxData * 1.25) : 100) : Math.max(1000, Math.ceil(maxData / 1000) * 1000);
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
        if(chart.type==='rate'&&chart.series.length===1&&chart.dates.length<=10){
          const pointLabel=svgNode('text',{x,y:Math.max(11,y-6),'text-anchor':'middle',fill:series.color,'font-size':'7.5','font-weight':'700'});
          pointLabel.textContent=fmt(value,'rate');svg.appendChild(pointLabel);
        }
      });
      if (segment.length >= 2) svg.appendChild(svgNode('polyline', { points: segment.map(point => `${point.x},${point.y}`).join(' '), fill: 'none', stroke: series.color, 'stroke-width': '2.2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'clip-path': `url(#${clipId})` }));
      if (!lastPoint) return;
      const baseY = Math.max(13, Math.min(height - pad.b - 4, lastPoint.y - 7));
      const candidates = [baseY];
      for (let step = 1; step <= 8; step += 1) candidates.push(baseY + step * 13, baseY - step * 13);
      const labelY = candidates
        .map(value => Math.max(13, Math.min(height - pad.b - 4, value)))
        .find(value => !placedLabels.some(y => Math.abs(y - value) < 12)) ?? (16 + seriesIndex * 14);
      placedLabels.push(labelY);
      const label = svgNode('text', { x: width - 4, y: labelY, fill: series.color, class: 'v18-last-label', 'text-anchor': 'end' }); label.textContent = fmt(lastPoint.value, chart.type); svg.appendChild(label);
    });
    const availableDays = new Set(chart.series.flatMap(series => series.values.map((value, index) => value === null ? null : chart.dates[index]).filter(Boolean))).size;
    container.dataset.historyDays = String(availableDays);
    if (availableDays < 2) container.querySelector('.v18-chart-note').textContent = `历史快照不足（${availableDays}/${Math.max(2,chart.dates.length||7)}），累计到2个有效日期后自动显示折线`;
    container.querySelector('.v18-chart-plot').appendChild(svg);

    const current = container.querySelector('.v18-chart-current');
    chart.series.forEach(series => {
      const valid = lastTwo(series.values), value = valid.at(-1) ?? null, previous = valid.at(-2) ?? null, delta = value === null || previous === null ? null : value - previous;
      const item = document.createElement('div'); item.dataset.series = series.name; item.innerHTML = '<span></span><b></b><small></small>';
      item.querySelector('span').textContent = `${series.name} 当前`; item.querySelector('b').style.color = series.color; item.querySelector('b').textContent = fmt(value, chart.type);
      item.querySelector('small').textContent = delta === null ? '较昨日 —' : `较昨日 ${delta >= 0 ? '↑' : '↓'}${Math.abs(delta).toFixed(2)}${chart.type === 'rate' ? '%' : ''}`;
      current.appendChild(item);
      if (global.DashboardDataAdapterV18 && value !== global.DashboardDataAdapterV18.last(series.values)) container.dataset.bindingError = 'true';
    });
  }
  global.RateTrendCardV18 = { render };
})(window);
