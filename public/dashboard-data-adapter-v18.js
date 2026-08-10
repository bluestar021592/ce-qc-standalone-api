(function (global) {
  const number = value => {
    if (value === null || value === undefined || value === '' || value === '—') return null;
    const parsed = Number(String(value).replace(/[,%]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const values = input => (Array.isArray(input) ? input : []).map(item => {
    if (item && typeof item === 'object') return item.hasData === false ? null : number(item.value);
    return number(item);
  });
  const last = input => [...values(input)].reverse().find(value => value !== null) ?? null;
  const coreOrder = [
    ['pendingGap', 'Pending不连续'], ['pending3', 'Pending 3天+'], ['oc1', 'OC 1天+'],
    ['storeStay', '门店滞留'], ['ticketOpen', '工单'], ['inboundNoScan', '入库无扫描节点'],
    ['stock2', '盘点2天+'], ['oc2', 'OC 2天+'], ['firstRate', '首次妥投率'],
    ['todayPod', '今日POD'], ['podRate', 'POD率'], ['pvOpen', '外省未完结POD件']
  ];

  function metricLookup(snapshot) {
    const map = new Map();
    [...(snapshot.coreMetrics || []), ...(snapshot.topKpis || [])].forEach(row => {
      map.set(row.key, row); map.set(row.label, row);
    });
    return map;
  }

  function coreMetrics(snapshot) {
    const map = metricLookup(snapshot);
    const aliases = {
      pendingGap: ['pendingGap', 'Pending不连续'], pending3: ['pending3', 'Pending3+'], oc1: ['oc1', 'OC1+'],
      storeStay: ['storeStay', '门店滞留'], ticketOpen: ['ticketOpen', '工单未处理'], inboundNoScan: ['inboundNoScan', '入库无扫描'],
      stock2: ['stock2', '盘点2天+'], oc2: ['oc2', 'OC2+'], firstRate: ['firstRate', '首次妥投率'],
      todayPod: ['todayPod', '今日POD'], podRate: ['podRate', 'POD率'], pvOpen: ['pvOpen', '外省未完结POD件']
    };
    return coreOrder.map(([key, label]) => {
      const source = aliases[key].map(alias => map.get(alias)).find(Boolean) || {};
      const fallback = key === 'todayPod' ? snapshot.ccsl?.pod : key === 'podRate' ? snapshot.ccsl?.podRate : 0;
      return { key, label, value: number(source.value ?? fallback) ?? 0, unit: String(label).includes('率') ? '%' : '件', ratio: source.change || source.ratio || '查看明细' };
    });
  }

  function normalizeSeries(name, color, input, options = {}) {
    const seriesValues = values(input);
    return {
      name, color, values: seriesValues,
      numerators: values(options.numerators || []), denominators: values(options.denominators || [])
    };
  }

  function mapHome(snapshot, visualTest) {
    const fixture = global.DashboardFixtureV18 || {};
    const dates = snapshot.dates?.length ? snapshot.dates : fixture.dates || [];
    const t = snapshot.trends || {};
    const fixtureTrends = fixture.trends || {};
    const choose = (value, fallback) => visualTest ? (fallback || value || []) : (value || []);
    const cards = (snapshot.businessCards || []).map((row, index) => ({ ...row, key: row.key || String(index), value: number(row.value) || 0 }));
    return {
      page: 'home', reportDate: snapshot.reportDate || '—', cards, core: coreMetrics(snapshot),
      special: {
        pending: { cn: number(snapshot.shopee?.cn?.pending3 || snapshot.shopee?.cn?.pending1) || 0, vn: number(snapshot.shopee?.vn?.pending3 || snapshot.shopee?.vn?.pending1) || 0 },
        returned: { cn: number(snapshot.shopee?.cn?.returned || snapshot.shopee?.cn?.returnPending) || 0, vn: number(snapshot.shopee?.vn?.returned || snapshot.shopee?.vn?.returnPending) || 0 }
      },
      dispatch: [
        ['CN-PP', snapshot.shopee?.cn?.pp], ['CN-PV', snapshot.shopee?.cn?.pv],
        ['VN-PP', snapshot.shopee?.vn?.pp], ['VN-PV', snapshot.shopee?.vn?.pv]
      ].map(([label,row]) => ({ label, values:[row?.firstAttemptRate,row?.secondAttemptRate,row?.thirdAttemptRate], counts:[row?.firstAttemptCount,row?.secondAttemptCount,row?.thirdAttemptCount], denominator:row?.denominator || row?.today || 0 })),
      charts: [
        { title:'今日票数趋势', type:'count', dates, series:[normalizeSeries('今日','#1677ff',choose(t.ticketTotal, fixtureTrends.tickets))] },
        { title:'POD率趋势', type:'rate', dates, series:[normalizeSeries('CE','#1677ff',choose(t.podCcsl,fixtureTrends.podCe)),normalizeSeries('SHOPEE PP','#16a36a',choose(t.podPp,fixtureTrends.podPp)),normalizeSeries('SHOPEE PV','#ff8a00',choose(t.podPv,fixtureTrends.podPv))] },
        { title:'OC率趋势', type:'rate', oc:true, dates, series:[normalizeSeries('CE','#1677ff',choose(t.ocCcsl,fixtureTrends.ocCe)),normalizeSeries('SHOPEE PP','#16a36a',choose(t.ocPp,fixtureTrends.ocPp)),normalizeSeries('SHOPEE PV','#ff8a00',choose(t.ocPv,fixtureTrends.ocPv))] },
        { title:'首次妥投率趋势', type:'rate', dates, series:[normalizeSeries('CE','#6c4cf5',choose(t.firstCcsl,fixtureTrends.firstCe)),normalizeSeries('SHOPEE','#16a36a',choose(t.firstShopee,fixtureTrends.firstShopee))] }
      ]
    };
  }

  function stateForBusiness(type) {
    try {
      if (typeof businessStates !== 'undefined' && businessStates?.[type]) return businessStates[type];
    } catch {}
    return {};
  }

  function sourceMetrics(type) {
    const state = stateForBusiness(type);
    const dashboard = state?.dashboard || {};
    const metrics = dashboard?.recipientGroups?.ALL?.metrics || dashboard?.metrics || state?.metrics || {};
    return { state, dashboard, metrics, routing: dashboard?.routing || {} };
  }

  function coreValue(core, labels) {
    const row = (core || []).find(item => labels.includes(String(item?.label || '')));
    return number(row?.value) || 0;
  }

  function routingCore(input) {
    const type = String(input.businessType || '').toUpperCase();
    const shopee = type.startsWith('SHOPEE');
    const original = (input.core || []).map(item => ({ ...item }));
    const { metrics, routing } = sourceMetrics(type);
    const hasRouting = routing && Object.keys(routing).length > 0;

    const ccslCn = hasRouting
      ? Number(routing.ccslCnDiversion || 0)
      : Number(metrics.ccslCnDiversion || coreValue(original, ['CCSLCN分流', 'CECN滞留包裹']));
    const ccslZt = hasRouting
      ? Number(routing.ccslZtDiversion || 0)
      : Number(metrics.ccslZtDiversion || coreValue(original, ['CCSLZT分流', 'CEZT滞留包裹']));
    const phnomPenhShop = hasRouting
      ? Number(routing.phnomPenhShop || 0)
      : Number(metrics.phnomPenhShop || 0) || (
          shopee
            ? Number(metrics.shopTransit || 0) + Number(metrics.shopArrived || 0)
            : coreValue(original, ['门店途中']) + coreValue(original, ['门店入库'])
        );

    const remove = shopee
      ? new Set(['外省门店滞留', '外省门店入库无节点', 'CCSLCN分流', 'CCSLZT分流', 'CECN滞留包裹', 'CEZT滞留包裹', '金边门店'])
      : new Set(['CECN滞留包裹', 'CEZT滞留包裹', 'CCSLCN分流', 'CCSLZT分流', '门店途中', '门店入库', '门店滞留', '金边门店']);
    const core = original.filter(item => !remove.has(String(item?.label || '')));
    const total = Number(input.cards?.[0]?.value || metrics.total || 0);
    const ratioText = value => total ? `占本业务 ${(Number(value || 0) * 100 / total).toFixed(2)}%` : '占本业务 0.00%';

    core.push(
      { key:`${type}-ccslcn-routing`, metricKey:'ccslCnDiversion', label:'CCSLCN分流', value:ccslCn, unit:'件', ratio:ratioText(ccslCn) },
      { key:`${type}-ccslzt-routing`, metricKey:'ccslZtDiversion', label:'CCSLZT分流', value:ccslZt, unit:'件', ratio:ratioText(ccslZt) },
      { key:`${type}-phnom-penh-shop`, metricKey:'phnomPenhShop', label:'金边门店', value:phnomPenhShop, unit:'件', ratio:ratioText(phnomPenhShop) }
    );
    return core;
  }

  function mapBusiness(input, visualTest) {
    const base = mapHome(input.trendSnapshot || {}, visualTest);
    return {
      page:'business', businessType:input.businessType, label:input.label, reportDate:input.reportDate || '—',
      periodLabel:input.periodLabel || '', cards:(input.cards || []).slice(0,6), core:routingCore(input), charts:base.charts,
      regions:input.regions || null, dispatch:input.dispatch || null
    };
  }

  global.DashboardDataAdapterV18 = { mapSnapshotToDashboardModel: mapHome, mapBusiness, values, last };
})(window);
