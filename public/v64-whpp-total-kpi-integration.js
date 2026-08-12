(function installWhppTotalKpiIntegrationV64(global) {
  const VERSION = '2026-08-12-v64-whpp-total-kpi-integration-v1';
  let cache = null;
  let cacheAt = 0;
  let decorating = false;
  let timer = null;

  const num = value => {
    const parsed = Number(String(value ?? '').replace(/[,%\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmt = value => Number(value || 0).toLocaleString('zh-CN');
  const rate = (value, total) => total ? Number(value || 0) * 100 / Number(total) : 0;

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }

  async function truth() {
    if (cache && Date.now() - cacheAt < 1200) return cache;
    const [unified, whpp] = await Promise.all([
      json('/api/import/unified-latest?compact=1').catch(() => ({})),
      json('/api/v51/whpp-state').catch(() => ({}))
    ]);
    const imported = unified?.import || {};
    const whppDate = String(whpp?.state?.reportDate || whpp?.reportDate || '');
    const importedDate = String(imported?.reportDate || '');
    const whppMatches = Boolean(importedDate && whppDate && importedDate === whppDate);
    const whppMetrics = whppMatches ? (whpp?.dashboard?.metrics || {}) : {};
    const whppRows = whppMatches ? (whpp?.dashboard?.detailTabs?.all?.rows || []) : [];
    const counts = { ...(imported?.classificationCounts || {}) };
    const whppTotal = whppMatches ? Number(whppMetrics.total || whpp?.state?.pnhBills?.length || 0) : 0;
    counts.WHPP = whppTotal;
    const coreTypes = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
    const coreCount = coreTypes.reduce((sum, type) => sum + Number(counts[type] || 0), 0);
    const summary = imported?.summary || {};
    const rawUnique = Math.max(0, Number(summary.rawRows || 0) - Number(summary.duplicateRows || 0) - Number(summary.missingWaybillRows || 0));
    const sevenCount = coreCount + whppTotal;
    const fullUnique = rawUnique || sevenCount;
    cache = { imported, whpp, counts, whppMetrics, whppRows, whppTotal, coreCount, sevenCount, fullUnique, reportDate: importedDate };
    cacheAt = Date.now();
    return cache;
  }

  function selectedSingleDay(reportDate) {
    if (!reportDate) return false;
    const from = String(document.getElementById('topRangeFrom')?.value || reportDate);
    const to = String(document.getElementById('topRangeTo')?.value || reportDate);
    return from === reportDate && to === reportDate;
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function ensureImportWhppCard(grid) {
    let card = grid.querySelector('[data-v64-business="WHPP"]') || grid.querySelector('[data-v54-business="WHPP"]');
    if (!card) {
      card = document.createElement('div');
      card.dataset.v64Business = 'WHPP';
      card.innerHTML = '<span>WHPP本土</span><b data-testid="classification-whpp">0</b>';
      grid.appendChild(card);
    }
    return card;
  }

  function patchImportPage(data) {
    const grid = document.querySelector('#unifiedClassificationSummary .unified-count-grid');
    if (!grid) return;
    const whppCard = ensureImportWhppCard(grid);
    setText(whppCard.querySelector('b'), fmt(data.whppTotal));
    setText(grid.querySelector('[data-testid="classification-valid-unique"]'), fmt(data.fullUnique));

    const labels = new Map([
      ['CE','CE'], ['CEAF','CEAF'], ['TBKH','TBKH'], ['ALI1688','ALI1688'],
      ['SHOPEECN','SHOPEECN'], ['SHOPEEVN','SHOPEEVN'], ['WHPP本土','WHPP']
    ]);
    for (const node of grid.children) {
      const label = String(node.querySelector('span')?.textContent || '').trim();
      const type = labels.get(label);
      if (type) setText(node.querySelector('b'), fmt(data.counts[type] || 0));
    }

    const status = document.getElementById('fileStatus');
    if (status) {
      status.querySelectorAll('p').forEach(p => {
        if (/有效唯一单号/.test(p.textContent || '')) p.innerHTML = p.innerHTML.replace(/有效唯一单号\s*[\d,]+/, `有效唯一单号 ${fmt(data.fullUnique)}`);
        if (/当前处理队列/.test(p.textContent || '')) p.innerHTML = p.innerHTML.replace(/当前处理队列\s*<b[^>]*>[\d,]+<\/b>/, `当前处理队列 <b>${fmt(Math.max(num(data.imported?.carryover?.currentOpen), data.fullUnique))}</b>`);
      });
    }
  }

  function ensureHomeWhppCard(grid) {
    let card = [...grid.querySelectorAll('.v18-business-card')].find(node => String(node.querySelector('span')?.textContent || '').trim() === 'WHPP本土');
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
    if (!selectedSingleDay(data.reportDate)) return;
    const grid = document.querySelector('#homePage .v18-business-grid');
    if (!grid) return;
    ensureHomeWhppCard(grid);
    const values = new Map([
      ['总览', data.fullUnique], ['CE', data.counts.CE || 0], ['CEAF空运', data.counts.CEAF || 0],
      ['TBKH', data.counts.TBKH || 0], ['SHOPEE CN', data.counts.SHOPEECN || 0], ['SHOPEE VN', data.counts.SHOPEEVN || 0],
      ['ALI1688', data.counts.ALI1688 || 0], ['WHPP本土', data.whppTotal]
    ]);
    for (const card of grid.querySelectorAll('.v18-business-card')) {
      const label = String(card.querySelector('span')?.textContent || '').trim();
      if (!values.has(label)) continue;
      const value = Number(values.get(label) || 0);
      setText(card.querySelector('b'), fmt(value));
      setText(card.querySelector('em'), `占总票数 ${label === '总览' ? '100.00' : rate(value, data.fullUnique).toFixed(2)}%`);
    }
  }

  function activeWhppStoreRetention(rows) {
    return (rows || []).filter(row => {
      const shopState = String(row?.shopState || row?.storeFlowState || '');
      const days = Number(row?.shopRetentionNaturalDays || 0);
      const terminal = row?.是否POD === '是' || row?.POD状态 === 'POD' || row?.退回状态 === '已退回' || ['POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED'].includes(String(row?.currentState || '').toUpperCase());
      return !terminal && ['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(shopState) && days >= 2;
    }).length;
  }

  function whppSelfPickup(rows) {
    return (rows || []).filter(row => String(row?.specialState || row?.primaryCategory || row?.主分类 || '').toUpperCase() === 'SELF_PICKUP' || String(row?.主分类 || '') === '仓库自提').length;
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
    const ccslTotal = Number(data.counts.CE || 0) + Number(data.counts.CEAF || 0) + Number(data.counts.TBKH || 0) + Number(data.counts.ALI1688 || 0);
    const denominator = ccslTotal + Number(data.whppTotal || 0);
    const m = data.whppMetrics || {};
    const signature = `${data.reportDate}|${data.whppTotal}|${m.pod || 0}|${m.pending3 || 0}|${m.oc2 || 0}`;

    const heading = core.querySelector('h2');
    if (heading) heading.innerHTML = '核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688 + WHPP本土，不含 SHOPEE CN/VN</small>';

    patchCountMetric('Pending不连续', m.pendingNonContinuous, denominator, signature);
    patchCountMetric('Pending 3天+', m.pending3, denominator, signature);
    patchCountMetric('OC 1天+', m.oc1, denominator, signature);
    patchCountMetric('门店滞留', activeWhppStoreRetention(data.whppRows), denominator, signature);
    patchCountMetric('工单', m.workOrder, denominator, signature);
    patchCountMetric('工单未处理', m.workOrder, denominator, signature);
    patchCountMetric('入库无扫描节点', m.inboundNoScan, denominator, signature);
    patchCountMetric('盘点2天+', m.cycle2, denominator, signature);
    patchCountMetric('盘点 2天+', m.cycle2, denominator, signature);
    patchCountMetric('OC 2天+', m.oc2, denominator, signature);
    patchCountMetric('外省未完结POD件', data.whpp?.dashboard?.regions?.PV?.unresolved || 0, denominator, signature);
    patchCountMetric('仓库自提件', whppSelfPickup(data.whppRows), denominator, signature);
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
    // Existing homepage semantics use the same current-day POD completion basis for
    // this card; preserve that behavior while expanding the denominator to WHPP.
    patchRateMetric('首次妥投率', combinedPodRate, signature);
  }

  async function decorate() {
    if (decorating) return;
    if (!document.querySelector('#unifiedClassificationSummary, #homePage')) return;
    decorating = true;
    try {
      const data = await truth();
      patchImportPage(data);
      patchHomeTop(data);
      patchHomeCore(data);
    } catch (error) {
      console.warn('[CE-QC][V64_WHPP_TOTAL_KPI] skipped', error);
    } finally {
      decorating = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => void decorate(), 80);
  }

  function install() {
    void decorate();
    const observer = new MutationObserver(schedule);
    observer.observe(document.querySelector('.app-shell') || document.body, { childList: true, subtree: true });
    document.addEventListener('click', event => {
      if (event.target?.closest?.('#topRangeQuery,[data-page="home"],[data-page="import"]')) {
        cache = null;
        cacheAt = 0;
        setTimeout(() => void decorate(), 120);
      }
    }, true);
    console.info('[CE-QC][V64_WHPP_TOTAL_KPI]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
