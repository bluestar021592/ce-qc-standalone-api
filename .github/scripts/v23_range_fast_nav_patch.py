from pathlib import Path


def replace_once(path, old, new, label):
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Missing patch anchor: {label}')
    text = text.replace(old, new, 1)
    path.write_text(text, encoding='utf-8')

root = Path('.')
index = root / 'public' / 'index.html'
app = root / 'public' / 'app.js'
style = root / 'public' / 'style.css'
server = root / 'server.js'

# 1) Put a real start/end date range selector in the persistent top bar.
replace_once(
    index,
    '''          <label class="top-date"><select id="topHistoryDate" aria-label="日报日期" onchange="loadDashboardDate(this.value)"><option value="">—</option></select><svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-calendar"></use></svg></label>\n          <label class="cycle-wrap"><select id="dashboardPeriodMode" class="cycle-select" aria-label="周期" onchange="changeDashboardPeriod(this.value)"><option value="">周期</option><option value="weekly">周</option><option value="monthly">月</option></select><svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-chevron"></use></svg></label>''',
    '''          <select id="topHistoryDate" aria-label="日报日期" onchange="loadDashboardDate(this.value)" hidden><option value="">—</option></select>\n          <div id="topRangePicker" class="top-range-picker" aria-label="日期范围">\n            <label class="top-range-date"><span>从</span><input id="topRangeFrom" type="date" aria-label="开始日期"></label>\n            <span class="top-range-separator">至</span>\n            <label class="top-range-date"><input id="topRangeTo" type="date" aria-label="结束日期"></label>\n            <button id="topRangeQuery" class="top-range-query" type="button" onclick="applyTopDateRange()">查询</button>\n            <small id="topRangeStatus" class="top-range-status"></small>\n          </div>\n          <label class="cycle-wrap"><select id="dashboardPeriodMode" class="cycle-select" aria-label="周期" onchange="changeDashboardPeriod(this.value)"><option value="">周期</option><option value="weekly">周</option><option value="monthly">月</option></select><svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-chevron"></use></svg></label>''',
    'persistent top date range controls'
)

# 2) Ensure top date inputs stay synchronized with the currently selected range.
replace_once(
    app,
    '''  const rangeFrom = document.getElementById('dashboardRangeFrom');\n  const rangeTo = document.getElementById('dashboardRangeTo');\n  const fallbackDate = current || unifiedImportState?.reportDate || '';\n  if (rangeFrom && !rangeFrom.matches(':focus')) rangeFrom.value = dashboardPeriodRange?.fromDate || rangeFrom.value || fallbackDate;\n  if (rangeTo && !rangeTo.matches(':focus')) rangeTo.value = dashboardPeriodRange?.toDate || rangeTo.value || fallbackDate;\n}''',
    '''  const rangeFrom = document.getElementById('dashboardRangeFrom');\n  const rangeTo = document.getElementById('dashboardRangeTo');\n  const topRangeFrom = document.getElementById('topRangeFrom');\n  const topRangeTo = document.getElementById('topRangeTo');\n  const fallbackDate = current || unifiedImportState?.reportDate || '';\n  const selectedFrom = dashboardPeriodRange?.fromDate || fallbackDate;\n  const selectedTo = dashboardPeriodRange?.toDate || fallbackDate;\n  if (rangeFrom && !rangeFrom.matches(':focus')) rangeFrom.value = selectedFrom;\n  if (rangeTo && !rangeTo.matches(':focus')) rangeTo.value = selectedTo;\n  if (topRangeFrom && !topRangeFrom.matches(':focus')) topRangeFrom.value = selectedFrom;\n  if (topRangeTo && !topRangeTo.matches(':focus')) topRangeTo.value = selectedTo;\n  const topStatus = document.getElementById('topRangeStatus');\n  if (topStatus) topStatus.textContent = dashboardPeriodRange?.fromDate ? `${selectedFrom} ~ ${selectedTo}` : '';\n}''',
    'range input synchronization'
)

# 3) Add a single top-bar action for custom start/end queries.
anchor = "async function loadDashboardDate(reportDate) {"
text = app.read_text(encoding='utf-8')
if 'async function applyTopDateRange()' not in text:
    if anchor not in text:
        raise SystemExit('Missing patch anchor: loadDashboardDate')
    insert = '''async function applyTopDateRange() {\n  const from = document.getElementById('topRangeFrom')?.value || '';\n  const to = document.getElementById('topRangeTo')?.value || '';\n  const button = document.getElementById('topRangeQuery');\n  const status = document.getElementById('topRangeStatus');\n  if (!from || !to) { if (status) status.textContent = '请选择开始和结束日期'; return; }\n  if (from > to) { if (status) status.textContent = '开始日期不能晚于结束日期'; return; }\n  if (button) { button.disabled = true; button.textContent = '读取中'; }\n  if (status) status.textContent = '正在读取…';\n  try {\n    await loadCustomDashboardRange(from, to, true);\n    if (status) status.textContent = `${from} ~ ${to}`;\n  } catch (error) {\n    if (status) status.textContent = `读取失败：${error.message}`;\n  } finally {\n    if (button) { button.disabled = false; button.textContent = '查询'; }\n  }\n}\n\n'''
    app.write_text(text.replace(anchor, insert + anchor, 1), encoding='utf-8')

# 4) Let custom range logic read the persistent top controls even though V18 replaces homePage markup.
replace_once(
    app,
    '''  const from = fromDate || document.getElementById('dashboardRangeFrom')?.value || '';\n  const to = toDate || document.getElementById('dashboardRangeTo')?.value || '';\n  const status = document.getElementById('dashboardRangeStatus');''',
    '''  const from = fromDate || document.getElementById('topRangeFrom')?.value || document.getElementById('dashboardRangeFrom')?.value || '';\n  const to = toDate || document.getElementById('topRangeTo')?.value || document.getElementById('dashboardRangeTo')?.value || '';\n  const status = document.getElementById('topRangeStatus') || document.getElementById('dashboardRangeStatus');''',
    'custom range reads persistent controls'
)

# 5) Business navigation must request compact data; full shipment rows are loaded only on detail/report pages.
replace_once(
    app,
    '''        const suffix = unifiedRow?.snapshotId ? `?snapshotId=${encodeURIComponent(unifiedRow.snapshotId)}` : '';\n        const result = await api(`/api/business-state/${type}${suffix}`);''',
    '''        const params = new URLSearchParams();\n        if (unifiedRow?.snapshotId) params.set('snapshotId', unifiedRow.snapshotId);\n        params.set('compact', '1');\n        const result = await api(`/api/business-state/${type}?${params.toString()}`);''',
    'compact business navigation request'
)

# 6) Server-side compact endpoints use SQL aggregate-only state for completed snapshots.
helper_anchor = "app.get('/api/state', async (req, res) => {"
server_text = server.read_text(encoding='utf-8')
if 'function loadFastSqlAggregateState' not in server_text:
    if helper_anchor not in server_text:
        raise SystemExit('Missing patch anchor: api state route')
    helper = '''const fastSqlDashboardCache = new Map();\n\nfunction fastDashboardBatch(snapshotId = '') {\n  const db = getDb();\n  if (String(snapshotId || '').trim()) {\n    return db.prepare(`\n      SELECT b.snapshotId,b.reportDate,s.status AS snapshotStatus\n      FROM unified_import_batches b\n      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId\n      WHERE b.snapshotId=? AND b.status='VALID'\n      LIMIT 1\n    `).get(String(snapshotId).trim()) || null;\n  }\n  return db.prepare(`\n    SELECT b.snapshotId,b.reportDate,s.status AS snapshotStatus\n    FROM unified_import_batches b\n    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId\n    WHERE b.status='VALID'\n    ORDER BY b.createdAt DESC\n    LIMIT 1\n  `).get() || null;\n}\n\nfunction cachedFastRange(batch) {\n  if (!batch || batch.snapshotStatus !== 'COMPLETED' || !batch.reportDate) return null;\n  const key = `${batch.snapshotId}:${batch.reportDate}`;\n  const cached = fastSqlDashboardCache.get(key);\n  if (cached && Date.now() - cached.at < 3000) return cached.value;\n  const value = loadRangeDashboard(batch.reportDate, batch.reportDate);\n  if (fastSqlDashboardCache.size > 12) fastSqlDashboardCache.clear();\n  fastSqlDashboardCache.set(key, { at: Date.now(), value });\n  return value;\n}\n\nfunction loadFastSqlAggregateState(scope) {\n  const batch = fastDashboardBatch();\n  const range = cachedFastRange(batch);\n  if (!range) return null;\n  const state = String(scope || '').toUpperCase() === 'SHOPEE' ? range.aggregates.SHOPEE : range.aggregates.CCSL;\n  return {\n    ...state,\n    reportDate: batch.reportDate,\n    snapshotId: batch.snapshotId,\n    snapshotStatus: 'COMPLETED',\n    processing: { running: false, paused: false, phase: '' },\n    logs: [],\n    _fastSqlSummary: true\n  };\n}\n\nfunction loadFastSqlBusinessState(businessType, snapshotId = '') {\n  const type = String(businessType || '').toUpperCase();\n  if (!['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(type)) return null;\n  const batch = fastDashboardBatch(snapshotId);\n  const range = cachedFastRange(batch);\n  if (!range) return null;\n  const source = range.states[type];\n  if (!source) return null;\n  return {\n    ...source,\n    businessType: type.startsWith('SHOPEE') ? 'SHOPEE' : type,\n    viewBusinessType: type,\n    reportDate: batch.reportDate,\n    snapshotId: batch.snapshotId,\n    snapshotStatus: 'COMPLETED',\n    processing: { running: false, paused: false, phase: '' },\n    logs: [],\n    _fastSqlSummary: true\n  };\n}\n\n'''
    server.write_text(server_text.replace(helper_anchor, helper + helper_anchor, 1), encoding='utf-8')

replace_once(
    server,
    '''app.get('/api/state', async (req, res) => {\n  const state = loadLightweightAggregateState('CCSL');\n  const summary = summarizeLightweightCcslState(state, {\n    dbStatus: getDbStatus(),\n    network: buildNetworkInfo(getRuntimeConfig()),\n    shopCodes: getShopCodeSummary()\n  });\n  res.json({ ok: true, state: req.query.compact === '1' ? compactDashboardState(summary) : summary });\n});''',
    '''app.get('/api/state', async (req, res) => {\n  if (req.query.compact === '1') {\n    const fast = loadFastSqlAggregateState('CCSL');\n    if (fast) {\n      fast.dbStatus = getDbStatus();\n      fast.network = buildNetworkInfo(getRuntimeConfig());\n      fast.shopCodes = getShopCodeSummary();\n      return res.json({ ok: true, state: fast });\n    }\n  }\n  const state = loadLightweightAggregateState('CCSL');\n  const summary = summarizeLightweightCcslState(state, {\n    dbStatus: getDbStatus(),\n    network: buildNetworkInfo(getRuntimeConfig()),\n    shopCodes: getShopCodeSummary()\n  });\n  res.json({ ok: true, state: req.query.compact === '1' ? compactDashboardState(summary) : summary });\n});''',
    'fast compact CCSL aggregate'
)

replace_once(
    server,
    '''app.get('/api/shopee/state', async (req, res) => {\n  const state = loadLightweightAggregateState('SHOPEE');\n  const summary = summarizeLightweightShopeeState(state, { dbStatus: getDbStatus() });\n  res.json({ ok: true, state: req.query.compact === '1' ? compactDashboardState(summary) : summary });\n});''',
    '''app.get('/api/shopee/state', async (req, res) => {\n  if (req.query.compact === '1') {\n    const fast = loadFastSqlAggregateState('SHOPEE');\n    if (fast) { fast.dbStatus = getDbStatus(); return res.json({ ok: true, state: fast }); }\n  }\n  const state = loadLightweightAggregateState('SHOPEE');\n  const summary = summarizeLightweightShopeeState(state, { dbStatus: getDbStatus() });\n  res.json({ ok: true, state: req.query.compact === '1' ? compactDashboardState(summary) : summary });\n});''',
    'fast compact SHOPEE aggregate'
)

business_route_old = '''app.get('/api/business-state/:businessType', (req, res) => {\n  try {\n    const source = loadLightweightUnifiedBusinessState(req.params.businessType, String(req.query.snapshotId || ''));\n    const shopee = /^SHOPEE/.test(source.businessType);'''
business_route_new = '''app.get('/api/business-state/:businessType', (req, res) => {\n  try {\n    const requestedSnapshotId = String(req.query.snapshotId || '');\n    if (req.query.compact === '1') {\n      const fast = loadFastSqlBusinessState(req.params.businessType, requestedSnapshotId);\n      if (fast) return res.json({ ok: true, businessType: fast.viewBusinessType || fast.businessType, reportDate: fast.reportDate, snapshotId: fast.snapshotId, snapshotStatus: fast.snapshotStatus, state: fast });\n    }\n    const source = loadLightweightUnifiedBusinessState(req.params.businessType, requestedSnapshotId);\n    const shopee = /^SHOPEE/.test(source.businessType);'''
replace_once(server, business_route_old, business_route_new, 'fast compact business route')

# 7) Version marker for diagnosis.
server_text = server.read_text(encoding='utf-8')
server_text = server_text.replace("patchId: '2026-08-08-v22-memory-safe-dashboard'", "patchId: '2026-08-08-v23-range-fast-nav'", 1)
server.write_text(server_text, encoding='utf-8')

# 8) Top bar styling; persistent outside V18 home renderer.
css = style.read_text(encoding='utf-8')
marker = '/* V23 persistent date range + fast navigation */'
if marker not in css:
    css += '''\n\n/* V23 persistent date range + fast navigation */\n.top-range-picker{display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 6px 4px 10px;border:1px solid #d7e2f0;border-radius:10px;background:#fff;box-shadow:0 1px 2px rgba(16,48,86,.04)}\n.top-range-date{display:flex;align-items:center;gap:6px;color:#70839a;font-size:12px;font-weight:600;white-space:nowrap}\n.top-range-date input{width:138px;height:34px;border:0;background:transparent;color:#16395f;font:600 14px/1.2 "Microsoft YaHei",sans-serif;outline:none;padding:0 4px}\n.top-range-date input:focus{background:#f4f8fd;border-radius:6px}\n.top-range-separator{color:#8ba0b7;font-size:13px}\n.top-range-query{height:34px;padding:0 14px;border:0;border-radius:7px;background:#0b6ffb;color:#fff;font:600 13px/34px "Microsoft YaHei",sans-serif;cursor:pointer}\n.top-range-query:hover{background:#075fd8}.top-range-query:disabled{opacity:.65;cursor:wait}\n.top-range-status{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6f8297;font-size:11px}\n@media(max-width:1180px){.top-range-status{display:none}.top-range-date input{width:124px}}\n@media(max-width:980px){.top-range-picker{gap:4px}.top-range-date span{display:none}.top-range-date input{width:118px}.top-range-query{padding:0 10px}}\n'''
    style.write_text(css, encoding='utf-8')

print('V23 patch applied')
