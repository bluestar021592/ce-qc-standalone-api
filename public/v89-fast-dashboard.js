(function installFastDashboardV89(global) {
  if (global.__CE_QC_V89_FAST_DASHBOARD__) return;
  const VERSION = '2026-08-23-v239-retired-by-dashboard-owner-v1';
  const LEGACY_VERSION = '2026-08-21-v205-fast-dashboard-interactive-first-v1';
  const CACHE_KEY = 'ce_qc_v89_instant_dashboard';
  const STARTUP_REFRESH_DELAY_MS = 120_000;
  let summary = loadCached();
  let inflight = null;
  let rerenderedKey = '';

  const ownerActive = () => Boolean(global.__CE_QC_V237_DASHBOARD_OWNER__);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const fmt = value => Number(value || 0).toLocaleString('zh-CN');

  function loadCached() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return value?.reportDate ? value : null;
    } catch { return null; }
  }
  function saveCached(value) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch {}
  }
  function currentDate() {
    const dom = String(document.getElementById('topRangeTo')?.value || document.getElementById('dashboardRangeTo')?.value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dom)) return dom;
    try {
      const date = String(unifiedImportState?.reportDate || appState?.reportDate || shopeeState?.reportDate || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    } catch {}
    return '';
  }
  function routeType() {
    return ({ '/shopeecn':'SHOPEECN', '/shopeevn':'SHOPEEVN' })[location.pathname.toLowerCase()] || '';
  }
  function summaryForDate(date) {
    return summary && (!date || summary.reportDate === date) ? summary : null;
  }
  function ratio(value, total) {
    return total ? `占总票数 ${(Number(value || 0) * 100 / Number(total)).toFixed(2)}%` : '占总票数 0.00%';
  }
  function businessTotal(model) { return Number(model?.cards?.[0]?.value || 0); }

  function patchHomeModel(model) {
    if (ownerActive()) return model;
    const data = summaryForDate(String(model?.reportDate || ''));
    if (!data?.counts) return model;
    const labels = {
      'CE':'CE', 'CEAF空运':'CEAF', 'TBKH':'TBKH', 'ALI1688':'ALI1688',
      'SHOPEE CN':'SHOPEECN', 'SHOPEE VN':'SHOPEEVN', 'WHPP本土':'WHPP'
    };
    const cards = Array.isArray(model.cards) ? model.cards.map(card => ({ ...card })) : [];
    for (const card of cards) {
      if (card.label === '总览') card.value = Number(data.total || 0);
      const type = labels[card.label];
      if (type) card.value = Number(data.counts[type] || 0);
    }
    if (!cards.some(card => card.label === 'WHPP本土')) {
      cards.push({ key:'whpp', label:'WHPP本土', value:Number(data.counts.WHPP || 0), tone:'cyan' });
    }
    const total = Number(data.total || 0);
    cards.forEach((card, index) => { card.ratio = index === 0 ? '占总票数 100.00%' : ratio(card.value, total); });
    return { ...model, cards };
  }

  function stateWhppValue(type) {
    try {
      const state = businessStates?.[type] || {};
      const metrics = state.dashboard?.recipientGroups?.ALL?.metrics || state.dashboard?.metrics || state.metrics || {};
      const value = Number(metrics.whppRetention ?? metrics.shopeeWhppRetention);
      return Number.isFinite(value) ? value : null;
    } catch { return null; }
  }

  function strictWhppValue(data, type) {
    if (!data?.shopeeWhpp || !Object.prototype.hasOwnProperty.call(data.shopeeWhpp, type)) return null;
    const value = Number(data.shopeeWhpp[type]);
    return Number.isFinite(value) ? value : null;
  }

  function patchShopeeModel(model) {
    if (ownerActive()) return model;
    const type = String(model?.businessType || '').toUpperCase();
    if (!['SHOPEECN', 'SHOPEEVN'].includes(type)) return model;
    const remove = new Set(['580滞留包裹','CCSL580分流','CCSL580滞留包裹','CCSLCN分流','CCSLCN','CECN滞留包裹']);
    const core = (Array.isArray(model.core) ? model.core : []).filter(row => !remove.has(String(row?.label || '').trim())).map(row => ({ ...row }));
    const data = summaryForDate(String(model.reportDate || ''));
    const strict = strictWhppValue(data, type);
    const fromState = stateWhppValue(type);
    const whppValue = strict !== null ? strict : (fromState !== null ? fromState : 0);
    const existing = core.find(row => String(row?.label || '').trim() === 'WHPP滞留包裹');
    const metric = {
      key: `${type}-whpp-retention`, metricKey: 'whppRetention', label: 'WHPP滞留包裹',
      value: Number(whppValue || 0), unit: '件',
      ratio: businessTotal(model) ? `占本业务 ${(Number(whppValue || 0) * 100 / businessTotal(model)).toFixed(2)}% · WHPP责任` : 'WHPP责任 · PP/PV合并'
    };
    if (existing) Object.assign(existing, metric); else core.push(metric);
    return { ...model, core };
  }

  function patchVisibleHome() {
    if (ownerActive()) return;
    const data = summaryForDate(currentDate());
    if (!data?.counts) return;
    const map = new Map([
      ['总览', data.total], ['CE', data.counts.CE], ['CEAF空运', data.counts.CEAF], ['TBKH', data.counts.TBKH],
      ['SHOPEE CN', data.counts.SHOPEECN], ['SHOPEE VN', data.counts.SHOPEEVN], ['ALI1688', data.counts.ALI1688], ['WHPP本土', data.counts.WHPP]
    ]);
    const total = Number(data.total || 0);
    document.querySelectorAll('.v18-business-card').forEach(card => {
      const label = String(card.querySelector('span')?.textContent || '').trim();
      if (!map.has(label)) return;
      const value = Number(map.get(label) || 0);
      const number = card.querySelector('b');
      const note = card.querySelector('em');
      if (number) number.textContent = fmt(value);
      if (note) note.textContent = label === '总览' ? '占总票数 100.00%' : ratio(value, total);
    });
  }

  async function fetchSummary(date = '') {
    if (ownerActive()) return global.__CE_QC_V237_LIVE_CURRENT__ || null;
    if (inflight) return inflight;
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    inflight = fetch(`/api/v89/instant-dashboard${query}`, { cache:'no-store', credentials:'same-origin' })
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        summary = payload;
        saveCached(payload);
        patchVisibleHome();
        const key = `${location.pathname}|${payload.reportDate}|${payload.generatedAt || ''}`;
        if (['/shopeecn','/shopeevn'].includes(location.pathname.toLowerCase()) && rerenderedKey !== key && typeof global.renderAll === 'function') {
          rerenderedKey = key;
          global.renderAll();
        }
        return payload;
      })
      .catch(error => { console.warn('[CE-QC][V89_FAST_DASHBOARD] summary skipped', error); return null; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  function installRenderHooks() {
    if (ownerActive()) return;
    if (global.DashboardV18 && !global.DashboardV18.__v89Wrapped) {
      const oldHome = global.DashboardV18.renderHome;
      const oldBusiness = global.DashboardV18.renderBusiness;
      global.DashboardV18.renderHome = function v89RenderHome(root, model) {
        return oldHome.call(this, root, patchHomeModel(model));
      };
      global.DashboardV18.renderBusiness = function v89RenderBusiness(root, model) {
        return oldBusiness.call(this, root, patchShopeeModel(model));
      };
      global.DashboardV18.__v89Wrapped = true;
    }
  }

  async function openWhppDetail(type) {
    const date = currentDate();
    const dialog = document.getElementById('metricDetailDialog');
    const title = document.getElementById('metricDetailTitle');
    const body = document.getElementById('metricDetailBody');
    if (!dialog || !title || !body || !date) return;
    title.textContent = `${type === 'SHOPEECN' ? 'SHOPEE CN' : 'SHOPEE VN'} · WHPP滞留包裹`;
    body.innerHTML = '<div class="empty-state">正在读取WHPP责任明细…</div>';
    dialog.hidden = false;
    try {
      const response = await fetch(`/api/v89/shopee-whpp-detail?businessType=${encodeURIComponent(type)}&date=${encodeURIComponent(date)}&page=1&pageSize=200`, { cache:'no-store', credentials:'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      body.innerHTML = rows.length
        ? `<table class="preview-table"><thead><tr><th>日期</th><th>运单号</th><th>原区域</th><th>责任</th><th>最后节点</th><th>最后节点时间</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.reportDate)}</td><td>${esc(row.shipmentCode)}</td><td>${esc(row.regionCode || '—')}</td><td>WHPP</td><td>${esc(row.最后节点 || 'CE:WHPP')}</td><td>${esc(row.最后节点时间 || '—')}</td></tr>`).join('')}</tbody></table>${Number(payload.total || 0) > rows.length ? `<div class="empty-state">共${fmt(payload.total)}票，当前预览前${fmt(rows.length)}票。</div>` : ''}`
        : '<div class="empty-state">当前日期没有WHPP滞留包裹</div>';
    } catch (error) {
      body.innerHTML = `<div class="empty-state">WHPP明细读取失败：${esc(error.message || error)}</div>`;
    }
  }

  installRenderHooks();
  document.addEventListener('click', event => {
    const card = event.target?.closest?.('.v18-metric-card');
    if (!card) return;
    if (String(card.querySelector('span')?.textContent || '').trim() !== 'WHPP滞留包裹') return;
    const type = routeType();
    if (!type) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void openWhppDetail(type);
  }, true);

  document.addEventListener('click', event => {
    if (ownerActive()) return;
    const rangeAction = event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery');
    const side = event.target?.closest?.('.side-link');
    const page = String(side?.dataset?.page || '').toLowerCase();
    if (rangeAction || ['home','shopeecn','shopeevn'].includes(page)) setTimeout(() => void fetchSummary(currentDate()), 40);
  }, true);
  global.addEventListener('popstate', () => {
    if (ownerActive()) return;
    const path = location.pathname.toLowerCase();
    if (['/','/shopeecn','/shopeevn'].includes(path)) setTimeout(() => void fetchSummary(currentDate()), 40);
  });
  global.addEventListener('ce-qc-startup-truth-ready', event => {
    if (ownerActive()) return;
    const requested = String(event?.detail?.reportDate || currentDate());
    if (!summaryForDate(requested)) void fetchSummary(requested);
  });

  setTimeout(() => {
    if (ownerActive()) {
      console.info('[CE-QC][V239_V89_RETIRED]', VERSION, 'legacy /api/v89/instant-dashboard polling disabled; WHPP detail click retained');
      return;
    }
    installRenderHooks();
    patchVisibleHome();
    const date = currentDate();
    if (!summaryForDate(date)) void fetchSummary(date);
    else setTimeout(() => void fetchSummary(currentDate()), STARTUP_REFRESH_DELAY_MS);
  }, 20);

  global.__CE_QC_V89_FAST_DASHBOARD__ = { version: VERSION, legacyVersion:LEGACY_VERSION, fetchSummary, retiredByOwner:ownerActive };
  console.info('[CE-QC][V89_FAST_DASHBOARD]', VERSION);
})(window);
