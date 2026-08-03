(function () {
  const ICONS = '/assets/ui-icons.svg';
  const COLORS = {
    blue: '#1677ff', green: '#16a765', purple: '#7a52e8', orange: '#ff7a00',
    red: '#f04455', cyan: '#1299d8'
  };

  function icon(name, className = '') {
    return `<svg class="ui-icon ${className}" aria-hidden="true"><use href="${ICONS}#icon-${name}"></use></svg>`;
  }

  function text(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
  }

  function display(value, unit = '件') {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
    if (unit === '%') return `${Number(Number(value).toFixed(2))}%`;
    return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  function points(values, width, height, top = 4, bottom = 4) {
    const valid = values.filter(value => Number.isFinite(Number(value))).map(Number);
    if (!valid.length) return [];
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    return values.map((value, index) => {
      if (!Number.isFinite(Number(value))) return null;
      const x = 4 + index * (width - 8) / Math.max(1, values.length - 1);
      const y = height - bottom - ((Number(value) - min) / (max - min || 1)) * (height - top - bottom);
      return { x, y, value: Number(value) };
    });
  }

  function miniTrend(trend, color) {
    const values = (trend || []).slice(0, 7).map(item => typeof item === 'object' ? (item.hasData === false ? null : item.value) : item);
    const plotted = points(values, 130, 26, 5, 5);
    const segments = [];
    let current = [];
    plotted.forEach(point => {
      if (point) current.push(point);
      else if (current.length) { segments.push(current); current = []; }
    });
    if (current.length) segments.push(current);
    return `<svg class="mini-trend" viewBox="0 0 130 26" preserveAspectRatio="none" aria-label="7天迷你走势">${segments.map(segment => `<polyline points="${segment.map(point => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`).join('')}${plotted.filter(Boolean).map(point => `<circle cx="${point.x}" cy="${point.y}" r="1.8" fill="${color}"/>`).join('')}</svg>`;
  }

  function metricIcon(metric) {
    const map = {
      total: ['briefcase', 'blue'], podRate: ['check', 'green'], pending1: ['clock', 'blue'],
      pending2: ['clock', 'purple'], pending3: ['clock', 'purple'], oc1: ['package-x', 'orange'],
      oc2: ['package-x', 'orange'], oc3: ['package-x', 'orange'], inboundNoScan: ['scan', 'cyan'],
      ticketOpen: ['alert', 'red']
    };
    return map[metric] || ['briefcase', 'blue'];
  }

  function kpiCard(item) {
    const [iconName, colorName] = metricIcon(item.key);
    const color = COLORS[colorName];
    const action = item.action ? `role="button" tabindex="0" onclick="openHomeMetricDetail('${text(item.action)}')" onkeydown="if(event.key==='Enter')this.click()"` : '';
    const direction = item.changeTone || (String(item.change || '').includes('↓') ? 'good' : 'bad');
    return `<article class="pixel-kpi ${colorName}" ${action}>
      <div class="pixel-kpi-head"><span class="pixel-kpi-icon" style="background:${color}">${icon(iconName)}</span><span>${text(item.label)}</span></div>
      <b class="pixel-kpi-value">${display(item.value, item.unit)}</b>
      <small>${text(item.metaLabel || '昨日')} ${display(item.metaValue, item.metaUnit || item.unit)} <strong class="${direction}">${text(item.change || '—')}</strong></small>
      <div class="pixel-mini">${miniTrend(item.trend, color)}</div>
    </article>`;
  }

  function metric(label, value, note = '', className = '', action = '') {
    return `<button class="pixel-metric ${className}" ${action ? `onclick="${action}"` : ''}><span>${text(label)}</span><b>${typeof value === 'string' ? text(value) : number(value)}</b>${note ? `<small>${text(note)}</small>` : ''}</button>`;
  }

  function ccslOverview(ccsl = {}) {
    const total = Number(ccsl.today || 0);
    const upper = [
      ['今日件数', ccsl.today, ccsl.yesterdayToday !== undefined ? `昨日 ${number(ccsl.yesterdayToday)}  ${ccsl.todayChange || ''}` : '', '', "openBusinessMetric('CCSL','allData')"],
      ['签收件数', ccsl.pod, ccsl.yesterdayPod !== undefined ? `昨日 ${number(ccsl.yesterdayPod)}  ${ccsl.podChange || ''}` : '', '', "openBusinessMetric('CCSL','podClosed')"],
      ['签收率', `${Number(ccsl.podRate || 0).toFixed(2)}%`, ccsl.yesterdayPodRate !== undefined ? `昨日 ${ccsl.yesterdayPodRate}%  ${ccsl.podRateChange || ''}` : '', 'blue-text', "openBusinessMetric('CCSL','podClosed')"],
      ['Pending1+', ccsl.pending1, `占比 ${ratio(ccsl.pending1, total)}`, '', "openBusinessMetric('CCSL','pendingAll')"],
      ['Pending2+', ccsl.pending2, `占比 ${ratio(ccsl.pending2, total)}`, '', "openBusinessMetric('CCSL','pending2plus')"],
      ['Pending3+', ccsl.pending3, `占比 ${ratio(ccsl.pending3, total)}`, '', "openBusinessMetric('CCSL','pending3')"]
    ];
    const lower = [
      ['OC1+', ccsl.oc1, `占比 ${ratio(ccsl.oc1, total)}`, '', "openBusinessMetric('CCSL','ocAll')"],
      ['OC2+', ccsl.oc2, `占比 ${ratio(ccsl.oc2, total)}`, '', "openBusinessMetric('CCSL','oc2plus')"],
      ['OC3+', ccsl.oc3, `占比 ${ratio(ccsl.oc3, total)}`, '', "openBusinessMetric('CCSL','oc3')"],
      ['入库无扫描', ccsl.inboundNoScan, `占比 ${ratio(ccsl.inboundNoScan, total)}`, '', "openBusinessMetric('CCSL','inboundNoScan')"],
      ['工单未处理', ccsl.ticketOpen, `占比 ${ratio(ccsl.ticketOpen, total)}`, 'danger', "openBusinessMetric('CCSL','workOrderAbnormal')"]
    ];
    return `<div class="pixel-ccsl-grid">${upper.map(args => metric(...args)).join('')}</div><div class="pixel-divider"></div><div class="pixel-ccsl-grid lower">${lower.map(args => metric(...args)).join('')}</div>`;
  }

  function regionCard(code, region = {}) {
    const total = Number(region.today || 0);
    const title = code === 'PP' ? '本省（PP）' : '外省（PV）';
    const tag = code === 'PP' ? '金边/本省' : '外省/省外';
    const fields = [
      ['Pending1+', region.pending1, ratio(region.pending1, total), 'pending1'],
      ['Pending2+', region.pending2, ratio(region.pending2, total), 'pending2'],
      ['Pending3+', region.pending3, ratio(region.pending3, total), 'pending3'],
      ['OC1+', region.oc1, ratio(region.oc1, total), 'oc1'],
      ['OC2+', region.oc2, ratio(region.oc2, total), 'oc2'],
      ['OC3+', region.oc3, ratio(region.oc3, total), 'oc3'],
      ['入库无扫描', region.inboundNoScan, ratio(region.inboundNoScan, total), 'inboundNoScan'],
      ['退回待处理', region.returnPending, ratio(region.returnPending, total), 'returnRequired']
    ];
    return `<section class="pixel-region ${code.toLowerCase()}"><h3>${title}<span>${tag}</span></h3>
      <div class="pixel-region-top">${metric('今日件数', region.today, '', '', `openRegionDetail('${code}','all')`)}${metric('签收率', `${Number(region.podRate || 0).toFixed(2)}%`, '', 'pod-rate', `openRegionDetail('${code}','pod')`)}${metric('签收件数', region.pod, '', '', `openRegionDetail('${code}','pod')`)}</div>
      <div class="pixel-region-grid">${fields.map(([label, value, share, tab]) => metric(label, value, `占比 ${share}`, label === '退回待处理' ? 'danger' : '', `openRegionDetail('${code}','${tab}')`)).join('')}</div>
    </section>`;
  }

  function recipientCard(code, summary = {}) {
    const total = Number(summary.today || 0);
    const group = ['CN', 'VN', 'OTHER'].includes(code) ? code : 'ALL';
    const title = summary.label || ({ ALL: 'SHOPEE全部', CN: 'Shopee CN', VN: 'Shopee VN', OTHER: '其他待确认' })[group];
    const tone = ({ ALL: 'all', CN: 'cn', VN: 'vn', OTHER: 'other' })[group];
    const detail = tab => `openShopeeGroupMetric('${group}','${tab}')`;
    return `<section class="pixel-recipient ${tone}"><h3>${text(title)}<span>${group}</span></h3>
      <div class="pixel-recipient-main">${metric('今日件数', summary.today, '', '', detail('all'))}${metric('今日POD', summary.pod, '', '', detail('pod'))}${metric('POD率', `${Number(summary.podRate || 0).toFixed(2)}%`, '', 'pod-rate', detail('pod'))}</div>
      <div class="pixel-recipient-sub">${metric('首派成功率', `${Number(summary.firstAttemptRate || 0).toFixed(2)}%`, '', '', detail('firstAttempt'))}${metric('Pending1+', summary.pending1, `占比 ${ratio(summary.pending1, total)}`, '', detail('pending1'))}${metric('Pending3+', summary.pending3, `占比 ${ratio(summary.pending3, total)}`, '', detail('pending3'))}${metric('OC1+', summary.oc1, `占比 ${ratio(summary.oc1, total)}`, '', detail('oc1'))}${metric('OC3+', summary.oc3, `占比 ${ratio(summary.oc3, total)}`, '', detail('oc3'))}${metric('入库无扫描', summary.inboundNoScan, `占比 ${ratio(summary.inboundNoScan, total)}`, '', detail('inboundNoScan'))}</div>
    </section>`;
  }

  function shopeeOverview(shopee = {}) {
    const hasRecipientDimension = shopee.all || shopee.cn || shopee.vn || shopee.other;
    if (!hasRecipientDimension) return `<div class="pixel-region-wrap">${regionCard('PP', shopee.pp || {})}${regionCard('PV', shopee.pv || {})}</div>`;
    const recipientGroups = [['ALL', shopee.all || {}], ['CN', shopee.cn || {}], ['VN', shopee.vn || {}]];
    if (Number(shopee.other?.today || 0) > 0) recipientGroups.push(['OTHER', shopee.other]);
    return `<div class="pixel-recipient-wrap">${recipientGroups.map(([code, summary]) => recipientCard(code, summary)).join('')}</div><div class="pixel-region-caption">区域维度（与收件人来源独立）</div><div class="pixel-region-wrap compact">${regionCard('PP', shopee.pp || {})}${regionCard('PV', shopee.pv || {})}</div>`;
  }

  function ratio(value, total) {
    return total ? `${((Number(value || 0) / total) * 100).toFixed(2)}%` : '0%';
  }

  function chartCard(definition, dates) {
    const width = 350; const height = 150; const left = 34; const right = 8; const top = 12; const bottom = 24;
    const min = definition.min; const max = definition.max;
    let svg = `<svg class="pixel-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${text(definition.title)}">`;
    [0, .25, .5, .75, 1].forEach(step => {
      const y = top + (height - top - bottom) * step;
      svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#edf2f7"/><text x="2" y="${y + 3}" font-size="8" fill="#7b8da3">${Math.round(max - (max - min) * step)}%</text>`;
    });
    dates.forEach((date, index) => {
      const x = left + index * (width - left - right) / 6;
      svg += `<text x="${x - 12}" y="${height - 4}" font-size="8" fill="#7b8da3">${text(String(date).slice(5))}</text>`;
    });
    definition.series.forEach(series => {
      const values = (series.values || []).slice(0, 7);
      const plotted = values.map((value, index) => {
        if (!Number.isFinite(Number(value))) return null;
        return { x: left + index * (width - left - right) / 6, y: top + (max - Number(value)) / (max - min || 1) * (height - top - bottom), value: Number(value) };
      });
      const segments = []; let current = [];
      plotted.forEach(point => { if (point) current.push(point); else if (current.length) { segments.push(current); current = []; } });
      if (current.length) segments.push(current);
      svg += segments.map(segment => `<polyline points="${segment.map(point => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${series.color}" stroke-width="2"/>`).join('');
      plotted.filter(Boolean).forEach(point => { svg += `<circle cx="${point.x}" cy="${point.y}" r="2.2" fill="${series.color}"/><text x="${point.x - 9}" y="${point.y - 7}" font-size="8" font-weight="700" fill="${series.color}">${Number(point.value.toFixed(1))}%</text>`; });
    });
    svg += '</svg>';
    return `<article class="pixel-chart-card"><div class="pixel-chart-title"><b>${text(definition.title)}</b><span>近7天 ${icon('chevron')}</span></div><div class="pixel-legend">${definition.series.map(series => `<span><i style="background:${series.color}"></i>${text(series.label)}</span>`).join('')}</div>${svg}</article>`;
  }

  function charts(snapshot) {
    const trends = snapshot.trends || {}; const dates = snapshot.dates || [];
    const series = (key, label, color) => ({ label, color, values: trends[key] || [] });
    const definitions = [
      { title: '签收率趋势', min: 60, max: 100, series: [series('podCcsl', 'CCSL', COLORS.blue), series('podPp', 'SHOPEE 本省（PP）', COLORS.green), series('podPv', 'SHOPEE 外省（PV）', COLORS.orange)] },
      { title: 'Pending率趋势', min: 0, max: 20, series: [series('pendingCcsl', 'CCSL', COLORS.blue), series('pendingPp', 'SHOPEE 本省（PP）', COLORS.green), series('pendingPv', 'SHOPEE 外省（PV）', COLORS.orange)] },
      { title: 'OC率趋势', min: 0, max: 15, series: [series('ocCcsl', 'CCSL', COLORS.blue), series('ocPp', 'SHOPEE 本省（PP）', COLORS.green), series('ocPv', 'SHOPEE 外省（PV）', COLORS.orange)] },
      { title: '本省/外省 对比（SHOPEE）', min: 60, max: 100, series: [series('podPp', '本省（PP）签收率', COLORS.green), series('podPv', '外省（PV）签收率', COLORS.orange)] }
    ];
    return definitions.map(definition => chartCard(definition, dates)).join('');
  }

  function carryTable(snapshot) {
    const rows = (snapshot.issues || []).slice(0, 5);
    if (!rows.length) return '<div class="pixel-empty">暂无当前异常</div>';
    return `<table class="pixel-carry-table"><thead><tr><th>运单号</th><th>渠道</th><th>区域</th><th>当前状态</th><th>Pending次数</th><th>OC次数</th><th>入库无扫描</th><th>工单未处理</th><th>是否进入轨迹查询</th><th>最新更新时间</th><th>操作</th></tr></thead><tbody>${rows.map(row => `<tr><td>${text(row.shipmentCode)}</td><td>${text(row.channel)}</td><td>${text(row.region)}</td><td><span class="pixel-tag">${text(row.status)}</span></td><td class="${Number(row.pending) >= 3 ? 'red' : ''}">${number(row.pending)}</td><td class="${Number(row.oc) >= 2 ? 'red' : ''}">${number(row.oc)}</td><td class="${row.inboundNoScan ? 'red' : ''}">${row.inboundNoScan ? '是' : '否'}</td><td class="${row.ticketOpen ? 'red' : ''}">${row.ticketOpen ? '是' : '否'}</td><td class="${row.trackQuery ? 'green' : 'red'}">${row.trackQuery ? '是' : '否'}</td><td>${text(row.updatedAt || '—')}</td><td><a href="${text(row.href || '#')}" ${row.href ? 'target="_blank"' : ''}>查看</a></td></tr>`).join('')}</tbody></table>`;
  }

  function rules() {
    const rows = [
      ['info', 'blue', 'Pending连续性', '按不同自然日Pending次数统计。'],
      ['alert', 'red', '3次退回规则', '连续3次Pending且仍未成功派送，自动进入退回待处理。'],
      ['pin', 'orange', 'PV归属外省', 'SHOPEE外省（PV）数据与本省（PP）严格分离。'],
      ['clock', 'green', '当日遗留次日自动进入', '次日自动进入扫描与轨迹查询，便于问题追踪。']
    ];
    return rows.map(([name, color, title, note]) => `<div class="pixel-rule"><i class="${color}">${icon(name)}</i><div><b>${title}</b><span>${note}</span></div></div>`).join('');
  }

  function renderHome(snapshot) {
    document.getElementById('homeKpis').innerHTML = (snapshot.topKpis || []).map(kpiCard).join('');
    document.getElementById('homeCcslOverview').innerHTML = ccslOverview(snapshot.ccsl || {});
    document.getElementById('homeShopeeOverview').innerHTML = shopeeOverview(snapshot.shopee || {});
    document.getElementById('homeTrendGrid').innerHTML = charts(snapshot);
    document.getElementById('homeIssueCount').textContent = number(snapshot.issueCount ?? snapshot.issues?.length ?? 0);
    document.getElementById('homeIssueTable').innerHTML = carryTable(snapshot);
    document.getElementById('homeRules').innerHTML = rules();
  }

  window.DashboardComponents = { icon, renderHome, miniTrend, charts, carryTable, rules };
})();
