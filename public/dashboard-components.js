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

  function storeStrip(values = {}, businessType = 'CCSL', group = 'ALL') {
    const open = tab => businessType === 'SHOPEE'
      ? `openShopeeGroupMetric('${group}','${tab}')`
      : `openBusinessMetric('CCSL','${tab}')`;
    const items = [
      ['在途门店', values.shopTransit, 'shopTransit'], ['到达门店', values.shopArrived ?? values.shopInbound, 'shopArrived'],
      ['门店Pending', values.shopPending, 'shopPending'], ['门店滞留1天+', values.shopRetention1 ?? values.shopInbound1, 'shopRetention1'],
      ['门店滞留2天+', values.shopRetention2 ?? values.shopInbound2, 'shopRetention2'], ['门店滞留3天+', values.shopRetention3 ?? values.shopInbound3plus, 'shopRetention3']
    ];
    return `<section class="store-state-strip"><h3>${icon('store')}<span>门店流转状态</span></h3><div>${items.map(([label, value, tab]) => metric(label, value || 0, '', '', open(tab))).join('')}</div></section>`;
  }

  function ccslOverview(ccsl = {}) {
    const total = Number(ccsl.today || 0);
    const upper = [
      ['今日件数', ccsl.today, ccsl.yesterdayToday !== undefined ? `昨日 ${number(ccsl.yesterdayToday)}  ${ccsl.todayChange || ''}` : '', '', "openBusinessMetric('CCSL','allData')"],
      ['签收件数', ccsl.pod, ccsl.yesterdayPod !== undefined ? `昨日 ${number(ccsl.yesterdayPod)}  ${ccsl.podChange || ''}` : '', '', "openBusinessMetric('CCSL','podClosed')"],
      ['签收率', `${Number(ccsl.podRate || 0).toFixed(2)}%`, ccsl.yesterdayPodRate != null ? `昨日 ${ccsl.yesterdayPodRate}%  ${ccsl.podRateChange || ''}` : '昨日 —', 'blue-text', "openBusinessMetric('CCSL','podClosed')"],
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
    return `<div class="pixel-ccsl-grid">${upper.map(args => metric(...args)).join('')}</div><div class="pixel-divider"></div><div class="pixel-ccsl-grid lower">${lower.map(args => metric(...args)).join('')}</div>${storeStrip(ccsl, 'CCSL')}`;
  }

  function regionCard(code, region = {}) {
    const total = Number(region.today || 0);
    const title = code === 'PP' ? '本省（PP）' : '外省（PV）';
    const tag = code === 'PP' ? '金边/本省' : '外省/省外';
    const fields = [
      ['在途门店', region.shopTransit, ratio(region.shopTransit, total), 'shopTransit'],
      ['到达门店', region.shopArrived, ratio(region.shopArrived, total), 'shopArrived'],
      ['门店Pending', region.shopPending, ratio(region.shopPending, total), 'shopPending'],
      ['门店滞留1天+', region.shopRetention1, ratio(region.shopRetention1, total), 'shopRetention1'],
      ['门店滞留2天+', region.shopRetention2, ratio(region.shopRetention2, total), 'shopRetention2'],
      ['门店滞留3天+', region.shopRetention3, ratio(region.shopRetention3, total), 'shopRetention3'],
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
    return `<div class="pixel-recipient-wrap">${recipientGroups.map(([code, summary]) => recipientCard(code, summary)).join('')}</div>${storeStrip(shopee.all || {}, 'SHOPEE', 'ALL')}<div class="pixel-region-caption">区域维度（与收件人来源独立）</div><div class="pixel-region-wrap compact">${regionCard('PP', shopee.pp || {})}${regionCard('PV', shopee.pv || {})}</div>`;
  }

  function compactShopeeOverview(shopee = {}) {
    const all = shopee.all || {};
    const total = Number(all.today || 0);
    const summary = [['今日件数', all.today, 'all'], ['签收件数', all.pod, 'pod'], ['签收率', `${Number(all.podRate || 0).toFixed(2)}%`, 'pod'], ['入库无扫描', all.inboundNoScan, 'inboundNoScan']];
    const attempts = [['1派签收', all.firstAttemptPod || all.attempt1Pod, all.firstAttemptRate], ['2派签收', all.secondAttemptPod || all.attempt2Pod, all.secondAttemptRate], ['3派签收', all.thirdAttemptPod || all.attempt3Pod, all.thirdAttemptRate], ['3派以上', all.attempt3plus || 0, all.attempt3plusRate], ['派次待确认', all.attemptUnknown || 0, all.attemptUnknownRate], ['派次覆盖率', `${Number(all.attemptCoverageRate || 0).toFixed(2)}%`, '']];
    return `<div class="pixel-shopee-summary">${summary.map(([label, value, tab]) => metric(label, value || 0, typeof value === 'string' ? '' : `占比 ${ratio(value, total)}`, '', `openShopeeGroupMetric('ALL','${tab}')`)).join('')}</div><div class="pixel-source-tabs"><button onclick="openShopeeGroupMetric('ALL','all')">SHOPEE全部</button><button onclick="openShopeeGroupMetric('CN','all')">Shopee CN</button><button onclick="openShopeeGroupMetric('VN','all')">Shopee VN</button></div>${storeStrip(all, 'SHOPEE', 'ALL')}<section class="attempt-strip"><h3>派次签收占比（基于签收件数）</h3><div>${attempts.map(([label, value, rateValue]) => metric(label, value || 0, rateValue === '' ? '' : `占比 ${Number(rateValue || 0).toFixed(2)}%`, '', "openShopeeGroupMetric('ALL','attempts')")).join('')}</div></section>`;
  }

  function ratio(value, total) {
    return total ? `${((Number(value || 0) / total) * 100).toFixed(2)}%` : '0%';
  }

  function chartCard(definition, dates) {
    const width = 350; const height = 166; const left = 38; const right = 14; const top = 22; const bottom = 28;
    const allValues = definition.series.flatMap(series => (series.values || []).filter(value => Number.isFinite(Number(value))).map(Number));
    const min = Number.isFinite(definition.min) ? definition.min : 0;
    const observedMax = Math.max(1, ...allValues);
    const max = Number.isFinite(definition.max) ? Math.max(definition.max, observedMax) : Math.ceil(observedMax * 1.12);
    const unit = definition.unit || '%';
    const axisValue = value => unit === '%' ? `${Number(value).toFixed(0)}%` : number(Math.round(value));
    const pointValue = value => unit === '%' ? `${Number(value).toFixed(2)}%` : number(Math.round(value));
    let svg = `<svg class="pixel-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${text(definition.title)}">`;
    [0, .25, .5, .75, 1].forEach(step => {
      const y = top + (height - top - bottom) * step;
      svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#edf2f7"/><text x="2" y="${y + 3}" font-size="8" fill="#7b8da3">${axisValue(max - (max - min) * step)}</text>`;
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
      plotted.filter(Boolean).forEach((point, index) => {
        const date = dates[index] || '—';
        const numerator = series.numerators?.[index];
        const denominator = series.denominators?.[index];
        const detail = Number.isFinite(Number(numerator)) && Number.isFinite(Number(denominator)) ? `；分子 ${number(numerator)}；分母 ${number(denominator)}` : '';
        svg += `<g class="trend-point" tabindex="0"><title>${text(date)}；${text(series.label)} ${pointValue(point.value)}${detail}</title><circle cx="${point.x}" cy="${point.y}" r="3" fill="${series.color}"/><text x="${point.x}" y="${Math.max(10, point.y - 7)}" text-anchor="middle" font-size="8" font-weight="700" fill="${series.color}">${pointValue(point.value)}</text></g>`;
      });
    });
    svg += '</svg>';
    const current = definition.series[0]?.values?.at(-1);
    const previous = definition.series[0]?.values?.at(-2);
    const change = Number.isFinite(Number(current)) && Number.isFinite(Number(previous)) && Number(previous) !== 0
      ? ((Number(current) - Number(previous)) / Math.abs(Number(previous))) * 100 : null;
    const action = definition.action ? `onclick="openHomeMetricDetail('${definition.action}')"` : '';
    return `<article class="pixel-chart-card" role="button" tabindex="0" ${action}><div class="pixel-chart-title"><b>${text(definition.title)}</b><span>近7天 ${icon('chevron')}</span></div><div class="pixel-legend">${definition.series.map(series => `<span><i style="background:${series.color}"></i>${text(series.label)}</span>`).join('')}</div>${svg}<footer class="v6-chart-footer"><span>当前 <b data-testid="trend-${definition.key}-current">${Number.isFinite(Number(current)) ? pointValue(current) : '—'}</b></span><strong data-testid="trend-${definition.key}-change" class="${change !== null && change < 0 ? 'down' : 'up'}">环比昨日 ${change === null ? '—' : `${change >= 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(2)}%`}</strong></footer></article>`;
  }

  function charts(snapshot) {
    const trends = snapshot.trends || {}; const dates = snapshot.dates || [];
    const series = (key, label, color) => ({ label, color, values: trends[key] || [], numerators: trends[`${key}Numerators`] || [], denominators: trends[`${key}Denominators`] || [] });
    const business = snapshot.businessLabel;
    const definitions = business ? [
      { key:'ticket', title: '今日票数趋势', min: 0, unit: '件', action: 'all', series: [series('ticketTotal', business, COLORS.blue)] },
      { key:'pod', title: 'POD率趋势', min: 0, max: 100, unit: '%', action: 'pod', series: [series('podRate', business, COLORS.green)] },
      { key:'oc', title: 'OC率趋势', min: 0, max: 15, unit: '%', action: 'oc', series: [series('ocRate', business, COLORS.orange)] },
      { key:'first', title: '首次妥投率趋势', min: 0, max: 100, unit: '%', action: 'pod', series: [series('firstRate', business, COLORS.purple)] }
    ] : [
      { key:'ticket', title: '今日票数趋势', min: 0, unit: '件', action: 'all', series: [series('ticketTotal', '今日', COLORS.blue)] },
      { key:'pod', title: 'POD率趋势', min: 60, max: 100, unit: '%', action: 'pod', series: [series('podCcsl', 'CE', COLORS.blue), series('podPp', 'SHOPEE PP', COLORS.green), series('podPv', 'SHOPEE PV', COLORS.orange)] },
      { key:'oc', title: 'OC率趋势', min: 0, max: 15, unit: '%', action: 'oc', series: [series('ocCcsl', 'CE', COLORS.blue), series('ocPp', 'SHOPEE PP', COLORS.green), series('ocPv', 'SHOPEE PV', COLORS.orange)] },
      { key:'first', title: '首次妥投率趋势', min: 60, max: 100, unit: '%', action: 'pod', series: [series('firstCcsl', 'CE', COLORS.purple), series('firstShopee', 'SHOPEE', COLORS.green)] }
    ];
    return definitions.map(definition => chartCard(definition, dates)).join('');
  }

  function carryTable(snapshot) {
    const rows = (snapshot.issues || []).slice(0, 5);
    if (!rows.length) return '<div class="pixel-empty">暂无当前异常</div>';
    return `<table class="pixel-carry-table"><thead><tr><th>运单号</th><th>渠道</th><th>区域</th><th>当前状态</th><th>Pending天数</th><th>OC次数</th><th>入库无扫描</th><th>工单未处理</th><th>是否进入轨迹查询</th><th>最新更新时间</th><th>操作</th></tr></thead><tbody>${rows.map(row => `<tr><td>${text(row.shipmentCode)}</td><td>${text(row.channel)}</td><td>${text(row.region)}</td><td><span class="pixel-tag">${text(row.status)}</span></td><td class="${Number(row.pending) >= 3 ? 'red' : ''}">${number(row.pending)}</td><td class="${Number(row.oc) >= 2 ? 'red' : ''}">${number(row.oc)}</td><td class="${row.inboundNoScan ? 'red' : ''}">${row.inboundNoScan ? '是' : '否'}</td><td class="${row.ticketOpen ? 'red' : ''}">${row.ticketOpen ? '是' : '否'}</td><td class="${row.trackQuery ? 'green' : 'red'}">${row.trackQuery ? '是' : '否'}</td><td>${text(row.updatedAt || '—')}</td><td><button class="text-button" data-testid="view-tracking" onclick="navigatePage('tracking')">查看轨迹</button></td></tr>`).join('')}</tbody></table>`;
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
    const fallbackCards = [
      {key:'total',label:'总览',value:snapshot.ccsl?.today || 0,tone:'blue'}, {key:'ce',label:'CE',value:snapshot.ccsl?.today || 0,tone:'green'},
      {key:'tbkh',label:'TBKH',value:0,tone:'orange'}, {key:'shopeecn',label:'SHOPEE CN',value:snapshot.shopee?.cn?.today || 0,tone:'purple'},
      {key:'shopeevn',label:'SHOPEE VN',value:snapshot.shopee?.vn?.today || 0,tone:'red'}, {key:'ali1688',label:'ALI1688',value:0,tone:'cyan'}
    ];
    const fallbackMetrics = [{key:'self-pickup',label:'仓库自提件',value:0,unit:'件'},{key:'cecn',label:'CECN滞留包裹',value:0,unit:'件'},{key:'cezt',label:'CEZT滞留包裹',value:0,unit:'件'},{key:'580',label:'580滞留包裹',value:0,unit:'件'}];
    document.getElementById('homeBusinessCards').innerHTML = (snapshot.businessCards?.length ? snapshot.businessCards : fallbackCards).map(businessCard).join('');
    document.getElementById('homeCoreMetrics').innerHTML = (snapshot.coreMetrics?.length ? snapshot.coreMetrics : fallbackMetrics).map(coreMetricCard).join('');
    document.getElementById('homeShopeeSpecial').innerHTML = shopeeSpecial(snapshot.shopee || {});
    document.getElementById('homeDispatchDistribution').innerHTML = dispatchDistribution(snapshot.shopee || {});
    document.getElementById('homeTrendGrid').innerHTML = charts(snapshot);
    document.getElementById('homeIssueCount').textContent = number(snapshot.issueCount ?? snapshot.issues?.length ?? 0);
    document.getElementById('homeIssueTable').innerHTML = carryTable(snapshot);
    document.getElementById('homeRules').innerHTML = rules();
  }

  function businessCard(item) {
    const testKey = item.key === 'total' ? 'top-total' : `top-${item.key}`;
    return `<button class="business-summary-card ${text(item.tone || 'blue')}" data-testid="${testKey}" onclick="${item.key === 'total' ? "navigatePage('home')" : `navigatePage('${text(item.key)}')`}"><span>${text(item.label)}</span><small>本期票数</small><b data-testid="${testKey}-value">${number(item.value || 0)}</b><em>占比可追溯</em></button>`;
  }

  function coreMetricCard(item) {
    const testId = ['self-pickup','cecn','cezt','580'].includes(item.key) ? `metric-${item.key}` : `core-${item.key}`;
    return `<button class="core-summary-card" data-testid="${testId}" onclick="openHomeMetricDetail('${text(item.key)}')"><i></i><span>${text(item.label)}</span><b>${display(item.value,item.unit)}</b><small>本月件数</small></button>`;
  }

  function shopeeSpecial(shopee) {
    return `<div class="shopee-special-grid detailed">${[['SHOPEE CN','CN',shopee.cn],['SHOPEE VN','VN',shopee.vn]].map(([label,group,row]) => {
      const items = [
        ['今日件数', row?.today, 'all'], ['今日POD', row?.pod, 'pod'], ['POD率', display(row?.podRate || 0, '%'), 'pod'],
        ['派送中', row?.deliveryStay, 'deliveryStay'], ['派送中率', display(row?.deliveryStayRate || 0, '%'), 'deliveryStay'],
        ['Pending1+', row?.pending1, 'pending1'], ['Pending3+', row?.pending3, 'pending3'],
        ['已退回', row?.returned, 'returned'], ['退回率', display(row?.returnRate || 0, '%'), 'returned']
      ];
      return `<section><header><b>${label}</b><small>${number(row?.today || 0)}票</small></header><div>${items.map(([name,value,tab]) => `<button onclick="openShopeeGroupMetric('${group}','${tab}')"><span>${name}</span><strong>${typeof value === 'string' ? value : number(value || 0)}</strong></button>`).join('')}</div></section>`;
    }).join('')}</div>`;
  }

  function dispatchDistribution(shopee) {
    const groups = [
      ['CN - PP', shopee.cn?.pp || shopee.pp],
      ['CN - PV', shopee.cn?.pv || shopee.pv],
      ['VN - PP', shopee.vn?.pp || shopee.pp],
      ['VN - PV', shopee.vn?.pv || shopee.pv]
    ];
    const rates = row => [row?.firstAttemptRate, row?.secondAttemptRate, row?.thirdAttemptRate].map(value => {
      const numeric = Number(value);
      return value === null || value === undefined || !Number.isFinite(numeric) ? null : numeric;
    });
    return `<div class="dispatch-grid">${groups.map(([label,row]) => `<section><b>${label}</b>${rates(row).map((value,index) => `<span>${index+1}派 <i><em style="width:${value === null ? 0 : Math.max(0,Math.min(100,value))}%"></em></i>${value === null ? '—' : `${value.toFixed(2)}%`}</span>`).join('')}</section>`).join('')}</div>`;
  }

  window.DashboardComponents = { icon, renderHome, miniTrend, charts, carryTable, rules };
})();
