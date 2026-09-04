(function installWhppTotalKpiIntegrationV64(global) {
  const VERSION = '2026-09-04-v426-unified-import-truth-kpi-v1';
  const TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const CORE_TYPES = TYPES.filter(type => type !== 'WHPP');
  const HOME_TYPE_BY_LABEL = {
    'CE':'CE', 'CEAF空运':'CEAF', 'TBKH':'TBKH', 'ALI1688':'ALI1688',
    'SHOPEE CN':'SHOPEECN', 'SHOPEE VN':'SHOPEEVN', 'WHPP本土':'WHPP'
  };
  const summaryCache = new Map();
  let decorating = false;
  let timer = null;

  const num = value => {
    const parsed = Number(String(value ?? '').replace(/[,%\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmt = value => Number(value || 0).toLocaleString('zh-CN');
  const rate = (value, total) => total ? Number(value || 0) * 100 / Number(total) : 0;

  function importState() {
    try {
      if (typeof unifiedImportState !== 'undefined') return unifiedImportState;
    } catch {}
    return global.unifiedImportState || null;
  }

  function authoritativeImportTruth(state = importState()) {
    const counts = state?.classificationCounts || null;
    const reconciliation = state?.sourceReconciliation || null;
    if (!counts || !reconciliation || reconciliation.balanced !== true) return null;
    if (!TYPES.every(type => Object.prototype.hasOwnProperty.call(counts, type))) return null;
    const declaredTypes = new Set((Array.isArray(reconciliation.businessTypes) ? reconciliation.businessTypes : []).map(type => String(type || '').toUpperCase()));
    if (!TYPES.every(type => declaredTypes.has(type))) return null;
    const normalized = Object.fromEntries(TYPES.map(type => [type, Math.max(0, num(counts[type]))]));
    const total = TYPES.reduce((sum, type) => sum + normalized[type], 0);
    if (num(reconciliation.validUniqueWaybills) !== total || num(reconciliation.classifiedWaybills) !== total) return null;
    return {
      counts: normalized,
      total,
      whppTotal: normalized.WHPP,
      coreTotal: CORE_TYPES.reduce((sum, type) => sum + normalized[type], 0),
      reportDate: String(state?.reportDate || '').slice(0, 10),
      source: 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH'
    };
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function importGrid() {
    return document.querySelector('#unifiedClassificationSummary .unified-count-grid');
  }

  function importCardCount(label) {
    const grid = importGrid();
    if (!grid) return 0;
    const card = [...grid.children].find(node => String(node.querySelector('span')?.textContent || '').trim() === label);
    return num(card?.querySelector('b')?.textContent);
  }

  function importStats() {
    const protectedTruth = authoritativeImportTruth();
    if (protectedTruth) {
      const state = importState();
      return {
        rawRows: Math.max(0, num(state?.summary?.rawRows)),
        duplicateRows: Math.max(0, num(state?.summary?.duplicateRows)),
        missingWaybillRows: Math.max(0, num(state?.summary?.missingWaybillRows)),
        coreCount: protectedTruth.coreTotal,
        rawUnique: protectedTruth.total,
        whppTotal: protectedTruth.whppTotal,
        fullUnique: protectedTruth.total,
        authoritativeImport: true,
        classificationCounts: protectedTruth.counts
      };
    }

    const root = document.getElementById('unifiedClassificationSummary');
    const text = String(root?.textContent || '');
    const pick = label => {
      const match = text.match(new RegExp(`${label}\\s*([\\d,]+)`));
      return match ? num(match[1]) : 0;
    };
    const rawRows = pick('原始行');
    const duplicateRows = pick('重复');
    const missingWaybillRows = pick('无单号');
    const coreLabels = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
    const coreCount = coreLabels.reduce((sum, label) => sum + importCardCount(label), 0);
    const rawUnique = Math.max(0, rawRows - duplicateRows - missingWaybillRows);
    const whppTotal = rawUnique >= coreCount ? rawUnique - coreCount : 0;
    return { rawRows, duplicateRows, missingWaybillRows, coreCount, rawUnique, whppTotal, fullUnique: rawUnique || coreCount + whppTotal, authoritativeImport: false };
  }

  function ensureImportWhppCard(grid) {
    let card = [...grid.children].find(node => String(node.querySelector('span')?.textContent || '').trim() === 'WHPP本土');
    if (!card) {
      card = document.createElement('div');
      card.dataset.v64Business = 'WHPP';
      card.innerHTML = '<span>WHPP本土</span><b data-testid="classification-whpp">0</b>';
      grid.appendChild(card);
    }
    card.dataset.v64Business = 'WHPP';
    return card;
  }

  function patchImportPage() {
    const grid = importGrid();
    if (!grid) return null;
    const data = importStats();
    const whppCard = ensureImportWhppCard(grid);
    setText(whppCard.querySelector('b'), fmt(data.whppTotal));
    setText(grid.querySelector('[data-testid="classification-valid-unique"]'), fmt(data.fullUnique));
    const status = document.getElementById('fileStatus');
    status?.querySelectorAll('p').forEach(p => {
      if (/有效唯一单号/.test(p.textContent || '')) p.innerHTML = p.innerHTML.replace(/有效唯一单号\s*[\d,]+/, `有效唯一单号 ${fmt(data.fullUnique)}`);
    });
    document.documentElement.dataset.v64ImportTruth = data.authoritativeImport ? 'authoritative-seven-business' : 'legacy-compat';
    document.documentElement.dataset.v64UnifiedTotal = String(data.fullUnique);
    return data;
  }

  function protectWhppSummary(value, reportDate) {
    const date = String(reportDate || '').slice(0, 10);
    const protectedTruth = authoritativeImportTruth();
    if (!protectedTruth || protectedTruth.reportDate !== date) return value;
    return {
      ...(value || {}),
      reportDate: date,
      total: protectedTruth.whppTotal,
      classificationTotal: protectedTruth.total,
      classificationCounts: protectedTruth.counts,
      classificationSource: protectedTruth.source
    };
  }

  async function readWhppSummary(reportDate) {
    const date = String(reportDate || '').slice(0, 10);
    if (!date) return { reportDate: '', total: 0, metrics: {}, regions: {}, regionPvUnresolved: 0, activeStoreRetention: 0, selfPickup: 0 };
    const cached = summaryCache.get(date);
    if (cached && Date.now() - cached.at < 30000) return protectWhppSummary(cached.value, date);
    const response = await fetch(`/api/v132/whpp-fast-summary?reportDate=${encodeURIComponent(date)}`, { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    const payloadDate = String(payload.reportDate || date).slice(0, 10);
    if (payloadDate !== date) throw new Error(`WHPP summary date mismatch: expected ${date}, got ${payloadDate}`);
    const metrics = payload.metrics || {};
    const normalized = {
      ...payload,
      reportDate: date,
      activeStoreRetention: Number(metrics.activeStoreRetention || 0),
      selfPickup: Number(metrics.selfPickup || 0),
      regionPvUnresolved: Number(payload.regions?.PV?.unresolved || 0)
    };
    summaryCache.set(date, { at: Date.now(), value: normalized });
    return protectWhppSummary(normalized, date);
  }

  function selectedReportDate() {
    return String(document.getElementById('topRangeTo')?.value || document.getElementById('dashboardRangeTo')?.value || '').slice(0, 10);
  }

  function selectedSingleDay(reportDate) {
    if (!reportDate) return false;
    const from = String(document.getElementById('topRangeFrom')?.value || reportDate).slice(0, 10);
    const to = String(document.getElementById('topRangeTo')?.value || reportDate).slice(0, 10);
    return from === reportDate && to === reportDate;
  }

  function homeCard(label) {
    return [...document.querySelectorAll('#homePage .v18-business-grid .v18-business-card')]
      .find(card => String(card.querySelector('span')?.textContent || '').trim() === label) || null;
  }

  function homeCardValue(label) {
    return num(homeCard(label)?.querySelector('b')?.textContent);
  }

  function ensureHomeWhppCard(grid) {
    let card = homeCard('WHPP本土');
    if (card) return card;
    card = document.createElement('button');
    card.type = 'button';
    card.className = 'v18-business-card cyan';
    card.dataset.v64Business = 'WHPP';
    card.onclick = () => typeof global.navigateWhppPage === 'function' ? global.navigateWhppPage() : (typeof global.navigatePage === 'function' ? global.navigatePage('whpp') : null);
    card.innerHTML = '<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';
    grid.appendChild(card);
    return card;
  }

  function patchHomeTop(data) {
    const grid = document.querySelector('#homePage .v18-business-grid');
    if (!grid || !selectedSingleDay(data.reportDate)) return 0;
    ensureHomeWhppCard(grid);

    const protectedCounts = data.classificationSource === 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH' && data.classificationCounts
      ? data.classificationCounts
      : null;
    if (protectedCounts) {
      for (const [label, type] of Object.entries(HOME_TYPE_BY_LABEL)) {
        const card = homeCard(label);
        if (card) setText(card.querySelector('b'), fmt(protectedCounts[type]));
      }
    } else {
      setText(homeCard('WHPP本土')?.querySelector('b'), fmt(Number(data.total || 0)));
    }

    const whppTotal = protectedCounts ? Number(protectedCounts.WHPP || 0) : Number(data.total || 0);
    const sixLabels = ['CE','CEAF空运','TBKH','SHOPEE CN','SHOPEE VN','ALI1688'];
    const fullTotal = protectedCounts
      ? Number(data.classificationTotal || TYPES.reduce((sum, type) => sum + num(protectedCounts[type]), 0))
      : sixLabels.reduce((sum, label) => sum + homeCardValue(label), 0) + whppTotal;
    for (const card of grid.querySelectorAll('.v18-business-card')) {
      const label = String(card.querySelector('span')?.textContent || '').trim();
      const value = label === '总览' ? fullTotal : (label === 'WHPP本土' ? whppTotal : num(card.querySelector('b')?.textContent));
      if (label === '总览') setText(card.querySelector('b'), fmt(fullTotal));
      if (label === '总览' || sixLabels.includes(label) || label === 'WHPP本土') {
        setText(card.querySelector('em'), `占总票数 ${label === '总览' ? '100.00' : rate(value, fullTotal).toFixed(2)}%`);
      }
    }
    document.documentElement.dataset.v64HomeClassificationSource = protectedCounts ? 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH' : 'LEGACY_WHPP_FAST_SUMMARY';
    document.documentElement.dataset.v64HomeUnifiedTotal = String(fullTotal);
    return fullTotal;
  }

  function metricCardByLabel(label) {
    return [...document.querySelectorAll('#homePage .v18-core-grid .v18-metric-card')].find(card => String(card.querySelector('span')?.textContent || '').trim() === label);
  }

  function normalizeDiversionLabels() {
    const aliases = [
      ['CECN滞留包裹', 'CCSLCN分流'],
      ['CEZT滞留包裹', 'CCSLZT分流']
    ];
    for (const [legacy, canonical] of aliases) {
      const card = metricCardByLabel(legacy);
      if (card) setText(card.querySelector('span'), canonical);
    }
  }

  function baseValue(card, signature) {
    if (!card) return 0;
    if (card.dataset.v64BaseSignature !== signature) {
      card.dataset.v64BaseSignature = signature;
      card.dataset.v64BaseValue = String(num(card.querySelector('b')?.textContent));
    }
    return Number(card.dataset.v64BaseValue || 0);
  }

  function patchCountMetric(label, addValue, denominator, signature) {
    const card = metricCardByLabel(label);
    if (!card) return;
    const value = baseValue(card, signature) + Number(addValue || 0);
    setText(card.querySelector('b'), fmt(value));
    setText(card.querySelector('small'), `占CCSL+WHPP ${rate(value, denominator).toFixed(2)}%`);
  }

  function patchRateMetric(label, value, signature) {
    const card = metricCardByLabel(label);
    if (!card) return;
    baseValue(card, signature);
    setText(card.querySelector('b'), `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}%`);
    setText(card.querySelector('small'), `当前 ${Number(value || 0).toFixed(2)}%`);
  }

  function patchHomeCore(data) {
    if (!selectedSingleDay(data.reportDate)) return;
    const core = document.querySelector('#homePage .v18-core');
    if (!core) return;
    normalizeDiversionLabels();
    const ccslTotal = homeCardValue('CE') + homeCardValue('CEAF空运') + homeCardValue('TBKH') + homeCardValue('ALI1688');
    const denominator = ccslTotal + Number(data.total || 0);
    const m = data.metrics || {};
    const signature = `${data.reportDate}|${data.total || 0}|${m.pod || 0}|${m.pending3 || 0}|${m.oc2 || 0}`;
    const heading = core.querySelector('h2');
    if (heading) heading.innerHTML = '核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688 + WHPP本土，不含 SHOPEE CN/VN</small>';

    patchCountMetric('Pending不连续', m.pendingNonContinuous, denominator, signature);
    patchCountMetric('Pending 3天+', m.pending3, denominator, signature);
    patchCountMetric('OC 1天+', m.oc1, denominator, signature);
    patchCountMetric('门店滞留', data.activeStoreRetention, denominator, signature);
    patchCountMetric('工单', m.workOrder, denominator, signature);
    patchCountMetric('工单未处理', m.workOrder, denominator, signature);
    patchCountMetric('入库无扫描节点', m.inboundNoScan, denominator, signature);
    patchCountMetric('盘点2天+', m.cycle2, denominator, signature);
    patchCountMetric('盘点 2天+', m.cycle2, denominator, signature);
    patchCountMetric('OC 2天+', m.oc2, denominator, signature);
    patchCountMetric('外省未完结POD件', data.regionPvUnresolved, denominator, signature);
    patchCountMetric('仓库自提件', data.selfPickup, denominator, signature);
    patchCountMetric('CCSLCN分流', m.ccslCnDiversion, denominator, signature);
    patchCountMetric('CCSLZT分流', m.ccslZtDiversion, denominator, signature);
    patchCountMetric('580滞留包裹', m.ccsl580Retention, denominator, signature);

    const podCard = metricCardByLabel('今日POD');
    const ccslPod = baseValue(podCard, signature);
    const combinedPod = ccslPod + Number(m.pod || 0);
    if (podCard) {
      setText(podCard.querySelector('b'), fmt(combinedPod));
      setText(podCard.querySelector('small'), `占CCSL+WHPP ${rate(combinedPod, denominator).toFixed(2)}%`);
    }
    const combinedPodRate = rate(combinedPod, denominator);
    patchRateMetric('POD率', combinedPodRate, signature);
    patchRateMetric('首次妥投率', combinedPodRate, signature);
  }

  async function decorate() {
    if (decorating) return;
    decorating = true;
    try {
      patchImportPage();
      const home = document.getElementById('homePage');
      if (!home || home.hidden) return;
      const reportDate = selectedReportDate();
      if (!reportDate) return;
      const summary = await readWhppSummary(reportDate);
      patchHomeTop(summary);
      patchHomeCore(summary);
    } catch (error) {
      console.warn('[CE-QC][V64_WHPP_TOTAL_KPI] skipped', error);
    } finally {
      decorating = false;
    }
  }

  function schedule(delay = 0, invalidate = false) {
    if (invalidate) summaryCache.clear();
    clearTimeout(timer);
    timer = setTimeout(() => void decorate(), Math.max(0, delay));
  }

  function install() {
    const originalRenderAll = global.renderAll;
    if (typeof originalRenderAll === 'function' && !originalRenderAll.__v64WhppWrapped) {
      const wrapped = function () {
        const result = originalRenderAll.apply(this, arguments);
        schedule(0, false);
        return result;
      };
      wrapped.__v64WhppWrapped = true;
      global.renderAll = wrapped;
    }

    document.addEventListener('click', event => {
      if (event.target?.closest?.('#topRangeQuery,[data-page="home"],[data-page="import"]')) schedule(20, true);
    }, true);
    document.addEventListener('ce-qc-run-complete', () => schedule(0, true));
    schedule(0, false);
    console.info('[CE-QC][V64_WHPP_TOTAL_KPI]', VERSION, 'balanced seven-business import truth owns import/HOME classification totals; WHPP fast-summary remains metrics-only for the same imported date.');
  }

  global.__CE_QC_V64_WHPP_TOTAL_KPI__ = {
    version: VERSION,
    refresh: decorate,
    importStats,
    readWhppSummary,
    protectWhppSummary,
    authoritativeImportTruth
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);