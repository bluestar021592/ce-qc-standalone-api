(function installWhppTotalKpiIntegrationV64(global) {
  const VERSION = '2026-08-15-v140-whpp-home-only-v3';
  const summaryCache = new Map();
  let decorating = false;
  let timer = null;

  const num = value => {
    const parsed = Number(String(value ?? '').replace(/[,%\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmt = value => Number(value || 0).toLocaleString('zh-CN');
  const rate = (value, total) => total ? Number(value || 0) * 100 / Number(total) : 0;
  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };

  async function readWhppSummary(reportDate) {
    const date = String(reportDate || '').slice(0, 10);
    if (!date) return { reportDate: '', total: 0, metrics: {}, regionPvUnresolved: 0, activeStoreRetention: 0, selfPickup: 0 };
    const cached = summaryCache.get(date);
    if (cached && Date.now() - cached.at < 15000) return cached.value;
    const response = await fetch(`/api/v71/whpp-summary?reportDate=${encodeURIComponent(date)}`, { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    summaryCache.set(date, { at: Date.now(), value: payload });
    return payload;
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

  function homeCardValue(label) { return num(homeCard(label)?.querySelector('b')?.textContent); }

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
    const whppTotal = Number(data.total || 0);
    setText(homeCard('WHPP本土')?.querySelector('b'), fmt(whppTotal));
    const sixLabels = ['CE','CEAF空运','TBKH','SHOPEE CN','SHOPEE VN','ALI1688'];
    const fullTotal = sixLabels.reduce((sum, label) => sum + homeCardValue(label), 0) + whppTotal;
    for (const card of grid.querySelectorAll('.v18-business-card')) {
      const label = String(card.querySelector('span')?.textContent || '').trim();
      const value = label === '总览' ? fullTotal : (label === 'WHPP本土' ? whppTotal : num(card.querySelector('b')?.textContent));
      if (label === '总览') setText(card.querySelector('b'), fmt(fullTotal));
      if (label === '总览' || sixLabels.includes(label) || label === 'WHPP本土') {
        setText(card.querySelector('em'), `占总票数 ${label === '总览' ? '100.00' : rate(value, fullTotal).toFixed(2)}%`);
      }
    }
    return fullTotal;
  }

  function metricCardByLabel(label) {
    return [...document.querySelectorAll('#homePage .v18-core-grid .v18-metric-card')].find(card => String(card.querySelector('span')?.textContent || '').trim() === label);
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
    patchCountMetric('CECN滞留包裹', m.ccslCnDiversion, denominator, signature);
    patchCountMetric('CEZT滞留包裹', m.ccslZtDiversion, denominator, signature);
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
      const home = document.getElementById('homePage');
      if (!home || home.hidden) return;
      const reportDate = selectedReportDate();
      if (!reportDate) return;
      const summary = await readWhppSummary(reportDate);
      patchHomeTop(summary);
      patchHomeCore(summary);
    } catch (error) {
      console.warn('[CE-QC][V140_WHPP_TOTAL_KPI] skipped', error);
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
      if (event.target?.closest?.('#topRangeQuery,[data-page="home"]')) schedule(10, true);
    }, true);
    document.addEventListener('ce-qc-run-complete', () => schedule(0, true));
    schedule(0, false);
    console.info('[CE-QC][V140_WHPP_TOTAL_KPI_HOME_ONLY]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
