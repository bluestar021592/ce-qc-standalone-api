(function installBusinessRuleUiV85(global) {
  if (global.__CE_QC_V85_BUSINESS_RULE_UI__) return;
  const VERSION = '2026-08-13-v85-business-rule-ui-v3';
  const cache = new Map();
  let busy = false;
  let timer = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const fmt = value => Number(value || 0).toLocaleString('zh-CN');
  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };

  function routeType() {
    const path = location.pathname.toLowerCase();
    if (path === '/shopeecn') return 'SHOPEECN';
    if (path === '/shopeevn') return 'SHOPEEVN';
    if (path === '/whpp') return 'WHPP';
    return '';
  }

  function selectedRange() {
    const from = String(document.getElementById('topRangeFrom')?.value || document.getElementById('dashboardRangeFrom')?.value || '').slice(0, 10);
    const to = String(document.getElementById('topRangeTo')?.value || document.getElementById('dashboardRangeTo')?.value || from).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to ? { from, to } : null;
  }

  function removeMetricCards(labels) {
    const unwanted = new Set(labels);
    document.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card => {
      const label = String(card.querySelector('span')?.textContent || '').trim();
      if (unwanted.has(label)) card.remove();
    });
  }

  function cleanupWhppOptions() {
    if (routeType() !== 'WHPP') return;
    removeMetricCards(['CCSLCN分流', 'CCSLZT分流', '580滞留包裹', 'CECN滞留包裹', 'CEZT滞留包裹']);
  }

  function cleanupShopeeImpossibleOptions() {
    const type = routeType();
    if (!['SHOPEECN', 'SHOPEEVN'].includes(type)) return;
    // CN/VN不使用580和CECN；CEZT保持现有业务事实兼容，不在此误删。
    removeMetricCards(['580滞留包裹', 'CCSLCN分流', 'CECN滞留包裹']);
  }

  async function readWhppMetric(type, range) {
    const key = `${type}|${range.from}|${range.to}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 30000) return cached.value;
    const url = `/api/v85/shopee-whpp-retention?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&page=1&pageSize=1000`;
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    cache.set(key, { at: Date.now(), value: payload });
    return payload;
  }

  function ensureShopeeWhppCard(payload, type, range) {
    const grid = document.querySelector('.v18-business-page .v18-core-grid');
    if (!grid || !['SHOPEECN', 'SHOPEEVN'].includes(type)) return;
    let card = [...grid.querySelectorAll('.v18-metric-card')].find(node => String(node.querySelector('span')?.textContent || '').trim() === 'WHPP滞留包裹');
    if (!card) {
      card = document.createElement('button');
      card.type = 'button';
      card.className = 'v18-metric-card';
      card.dataset.v85Metric = 'shopee-whpp-retention';
      card.innerHTML = '<i aria-hidden="true">●</i><span>WHPP滞留包裹</span><b>0</b><small>WHPP责任 · PP/PV合并</small>';
      grid.appendChild(card);
    }
    setText(card.querySelector('b'), fmt(payload.total));
    setText(card.querySelector('small'), 'WHPP责任 · PP/PV合并');
    card.onclick = () => showRows(type, payload, range);
  }

  function showRows(type, payload, range) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const dialog = document.getElementById('metricDetailDialog');
    const title = document.getElementById('metricDetailTitle');
    const body = document.getElementById('metricDetailBody');
    if (!dialog || !title || !body) return;
    title.textContent = `${type === 'SHOPEECN' ? 'SHOPEE CN' : 'SHOPEE VN'} · WHPP滞留包裹 · ${fmt(payload.total)}票`;
    const fields = [
      ['日期', row => row.reportDate || '—'],
      ['运单号', row => row.shipmentCode || row.运单号 || '—'],
      ['原区域', row => row.regionCode || '—'],
      ['责任归属', () => 'WHPP'],
      ['最后节点', row => row.最后节点 || row.latestEventDesc || 'CE:WHPP'],
      ['最后节点时间', row => row.最后节点时间 || row.latestEventTime || '—']
    ];
    body.innerHTML = rows.length
      ? `<table class="preview-table"><thead><tr>${fields.map(([label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${fields.map(([, pick]) => `<td>${esc(pick(row))}</td>`).join('')}</tr>`).join('')}</tbody></table>${Number(payload.total || 0) > rows.length ? `<div class="empty-state">${esc(range.from)} 至 ${esc(range.to)} 共${fmt(payload.total)}票；页面仅预览前${fmt(rows.length)}票，完整明细通过报表导出。</div>` : ''}`
      : '<div class="empty-state">当前范围没有最后有效节点位于CE:WHPP且尚未POD/退回的包裹</div>';
    dialog.hidden = false;
  }

  async function decorate() {
    if (busy) return;
    busy = true;
    try {
      cleanupWhppOptions();
      cleanupShopeeImpossibleOptions();
      const type = routeType();
      if (!['SHOPEECN', 'SHOPEEVN'].includes(type)) return;
      const range = selectedRange();
      if (!range) return;
      const payload = await readWhppMetric(type, range);
      ensureShopeeWhppCard(payload, type, range);
    } catch (error) {
      console.warn('[CE-QC][V85_BUSINESS_RULE_UI] skipped', error);
    } finally {
      busy = false;
    }
  }

  function schedule(delay = 0, invalidate = false) {
    if (invalidate) cache.clear();
    clearTimeout(timer);
    timer = setTimeout(() => void decorate(), Math.max(0, delay));
  }

  const observer = new MutationObserver(() => schedule(60, false));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  global.addEventListener('popstate', () => schedule(20, true));
  document.addEventListener('click', event => {
    if (event.target?.closest?.('.side-link,#topRangeQuery')) schedule(100, true);
  }, true);
  document.getElementById('topRangeFrom')?.addEventListener('change', () => schedule(50, true));
  document.getElementById('topRangeTo')?.addEventListener('change', () => schedule(50, true));
  schedule(0, true);
  global.__CE_QC_V85_BUSINESS_RULE_UI__ = { version: VERSION };
  console.info('[CE-QC][V85_BUSINESS_RULE_UI]', VERSION);
})(window);
