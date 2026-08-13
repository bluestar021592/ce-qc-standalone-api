(function installBusinessRuleUiV85(global) {
  if (global.__CE_QC_V85_BUSINESS_RULE_UI__) return;
  const VERSION = '2026-08-13-v85-business-rule-ui-v1';
  const cache = new Map();
  let busy = false;
  let timer = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const fmt = value => Number(value || 0).toLocaleString('zh-CN');

  function routeType() {
    const path = location.pathname.toLowerCase();
    if (path === '/shopeecn') return 'SHOPEECN';
    if (path === '/shopeevn') return 'SHOPEEVN';
    if (path === '/whpp') return 'WHPP';
    return '';
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
    // WHPP本土业务只有POD、退回、取消订单和开放派送状态；它不会进入
    // CCSL的580/CEZT/CECN特殊分流，因此这些选项不能出现在WHPP看板。
    removeMetricCards(['CCSLCN分流', 'CCSLZT分流', '580滞留包裹', 'CECN滞留包裹', 'CEZT滞留包裹']);
  }

  function cleanupShopeeImpossibleOptions() {
    const type = routeType();
    if (!['SHOPEECN', 'SHOPEEVN'].includes(type)) return;
    // Shopee CN/VN不使用580和CECN业务分流；不要把其它板块的特殊节点卡片
    // 误带进Shopee业务页。CEZT不在此处强删，保持独立业务事实兼容。
    removeMetricCards(['580滞留包裹', 'CCSLCN分流', 'CECN滞留包裹']);
  }

  function rowBill(row = {}) {
    return String(row.shipmentCode || row.运单号 || row.运单编号 || '').trim().toUpperCase();
  }

  function isTerminal(row = {}) {
    const state = String(row.currentState || row.scanNormalizedState || '').toUpperCase();
    return row.是否POD === '是' || row.POD状态 === 'POD' || ['POD', 'RETURNED', 'RETURN_COMPLETED'].includes(state) || row.退回状态 === '已退回';
  }

  function normalizeNode(value) {
    return String(value || '').normalize('NFKC').toUpperCase().replace(/^CEL?\s*:\s*/, '').replace(/[^A-Z0-9]/g, '');
  }

  function isWhppRetention(row = {}) {
    if (isTerminal(row)) return false;
    if (row.whppRetention === true || row.WHPP滞留 === '是' || String(row.specialState || '') === 'SHOPEE_WHPP_RETENTION') return true;
    const node = normalizeNode(row.lastEventTargetNode || row.latestEventTargetNode || row.currentHub || row.responsibilityHub || '');
    if (node === 'WHPP') return true;
    const text = [row.latestEventDesc, row.最后节点, row.lastEventDesc, row.lastEvent, row.currentState].map(value => String(value || '')).join(' ');
    return /(?:CE|CEL)\s*:\s*WHPP\b/i.test(text) || /到达网点[^\n]*WHPP/i.test(text);
  }

  async function readBusiness(type) {
    const cached = cache.get(type);
    if (cached && Date.now() - cached.at < 30000) return cached.value;
    const response = await fetch(`/api/business-state/${encodeURIComponent(type)}`, { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    cache.set(type, { at: Date.now(), value: payload });
    return payload;
  }

  function ensureShopeeWhppCard(rows, type) {
    const grid = document.querySelector('.v18-business-page .v18-core-grid');
    if (!grid || !['SHOPEECN', 'SHOPEEVN'].includes(type)) return;
    const matched = rows.filter(isWhppRetention);
    let card = [...grid.querySelectorAll('.v18-metric-card')].find(node => String(node.querySelector('span')?.textContent || '').trim() === 'WHPP滞留包裹');
    if (!card) {
      card = document.createElement('button');
      card.type = 'button';
      card.className = 'v18-metric-card';
      card.dataset.v85Metric = 'shopee-whpp-retention';
      card.innerHTML = '<i aria-hidden="true">●</i><span>WHPP滞留包裹</span><b>0</b><small>WHPP责任 · PP/PV合并</small>';
      grid.appendChild(card);
    }
    card.querySelector('b').textContent = fmt(matched.length);
    card.querySelector('small').textContent = 'WHPP责任 · PP/PV合并';
    card.onclick = () => showRows(type, matched);
  }

  function showRows(type, rows) {
    const dialog = document.getElementById('metricDetailDialog');
    const title = document.getElementById('metricDetailTitle');
    const body = document.getElementById('metricDetailBody');
    if (!dialog || !title || !body) return;
    title.textContent = `${type === 'SHOPEECN' ? 'SHOPEE CN' : 'SHOPEE VN'} · WHPP滞留包裹 · ${fmt(rows.length)}票`;
    const fields = [
      ['运单号', row => rowBill(row)],
      ['区域', row => row.regionCode || row.regionType || row.区域 || '—'],
      ['当前状态', row => row.primaryCategory || row.主分类 || row.currentState || 'WHPP滞留包裹'],
      ['最后节点', row => row.最后节点 || row.latestEventDesc || row.lastEventDesc || 'CE:WHPP'],
      ['最后节点时间', row => row.最后节点时间 || row.latestEventTime || row.lastEventTime || '—']
    ];
    body.innerHTML = rows.length
      ? `<table class="preview-table"><thead><tr>${fields.map(([label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 1000).map(row => `<tr>${fields.map(([, pick]) => `<td>${esc(pick(row))}</td>`).join('')}</tr>`).join('')}</tbody></table>${rows.length > 1000 ? `<div class="empty-state">页面仅预览前1000票，完整数据请使用导出。</div>` : ''}`
      : '<div class="empty-state">当前没有到达CE:WHPP且尚未POD/退回的包裹</div>';
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
      const payload = await readBusiness(type);
      const rows = Array.isArray(payload?.state?.finalRows) ? payload.state.finalRows : [];
      ensureShopeeWhppCard(rows, type);
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

  const observer = new MutationObserver(() => schedule(40, false));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  global.addEventListener('popstate', () => schedule(20, true));
  document.addEventListener('click', event => {
    if (event.target?.closest?.('.side-link,#topRangeQuery')) schedule(80, true);
  }, true);
  schedule(0, true);
  global.__CE_QC_V85_BUSINESS_RULE_UI__ = { version: VERSION };
  console.info('[CE-QC][V85_BUSINESS_RULE_UI]', VERSION);
})(window);
