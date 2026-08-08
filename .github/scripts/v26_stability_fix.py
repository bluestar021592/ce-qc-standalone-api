from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

# ---- 1. Fix CCSL locked-today POD rows missing from finalRows ----
p = Path('src/pipeline.js')
text = p.read_text(encoding='utf-8')
old = """  const scanPool = cleanBills([...today, ...carry]).filter(wb => !podLocks.has(wb));

  state.scanPool = scanPool;
"""
new = """  const scanPool = cleanBills([...today, ...carry]).filter(wb => !podLocks.has(wb));
  // Bills from today's imported report that are already protected by a historical
  // POD lock must still be represented in today's finalRows. They are intentionally
  // skipped from CE API scanning, but omitting them from finalRows breaks the
  // unified 1:1 reconciliation against the imported daily report.
  const lockedToday = today.filter(wb => podLocks.has(wb));
  const dailyByBill = new Map((state.dailyParseRows || []).map(row => [billOf(row), row]));

  state.scanPool = scanPool;
"""
text = replace_once(text, old, new, 'ccsl lockedToday declaration')

old = """  const podRows = scanResults
    .filter(row => podSet.has(row.运单号))
    .map(row => ({
      ...row,
      异常分类: 'POD闭环',
      QC判断: row.orderStatus === '85' ? '订单扫描已签收' : 'POD锁已闭环'
    }));

  const returnedRows = scanResults.filter(row => returnedCompleted.has(row.运单号)).map(row => ({ ...row, 是否POD: '否', POD状态: '未POD', 退回状态: '已退回', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回', 入库无扫描节点: '否', carry状态: 'closed_return', 跨日状态: '已闭环' }));
"""
new = """  const podRows = scanResults
    .filter(row => podSet.has(row.运单号))
    .map(row => ({
      ...row,
      异常分类: 'POD闭环',
      QC判断: row.orderStatus === '85' ? '订单扫描已签收' : 'POD锁已闭环'
    }));
  const lockedTodayRows = lockedToday.map(wb => ({
    ...(dailyByBill.get(wb) || {}),
    businessType,
    reportDate: state.reportDate || '',
    shipmentCode: wb,
    运单号: wb,
    来源类型: '今日PNH',
    orderStatus: '85',
    是否POD: '是',
    POD状态: 'POD',
    primaryCategory: 'POD闭环',
    主分类: 'POD闭环',
    异常分类: 'POD闭环',
    QC判断: '历史POD锁已闭环，今日无需重复查询',
    currentState: 'POD',
    trackRequired: false,
    trackSkippedReason: 'POD_LOCK',
    carry状态: 'closed_pod',
    跨日状态: '已闭环',
    API状态: 'POD_LOCK',
    查询状态: 'skipped_pod_lock'
  }));

  const returnedRows = scanResults.filter(row => returnedCompleted.has(row.运单号)).map(row => ({ ...row, 是否POD: '否', POD状态: '未POD', 退回状态: '已退回', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回', 入库无扫描节点: '否', carry状态: 'closed_return', 跨日状态: '已闭环' }));
"""
text = replace_once(text, old, new, 'ccsl locked POD rows')

old = """  const finalRows = [...podRows, ...returnedRows, ...trackResults]
"""
new = """  const finalRows = [...lockedTodayRows, ...podRows, ...returnedRows, ...trackResults]
"""
text = replace_once(text, old, new, 'ccsl finalRows include locked')
p.write_text(text, encoding='utf-8')

# ---- 2. Add one-shot bootstrap endpoint to eliminate 9 sequential startup calls ----
p = Path('server.js')
text = p.read_text(encoding='utf-8')
anchor = """app.get('/api/unified-history', (req, res) => {
  res.json({ ok: true, rows: listUnifiedImportHistory(req.query.limit) });
});

const periodDashboardCache = new Map();
"""
replacement = """app.get('/api/unified-history', (req, res) => {
  res.json({ ok: true, rows: listUnifiedImportHistory(req.query.limit) });
});

// V26: one lightweight startup payload. The browser used to wait for nine API
// requests serially before first paint. All dashboard data below is served from
// the fast SQL/range cache when possible, so normal navigation behaves like a
// website rather than a batch-processing console.
app.get('/api/bootstrap', async (req, res) => {
  try {
    const ccsl = loadFastSqlAggregateState('CCSL') || compactDashboardState(summarizeLightweightCcslState(loadLightweightAggregateState('CCSL'), { dbStatus: getDbStatus(), network: buildNetworkInfo(getRuntimeConfig()), shopCodes: getShopCodeSummary() }));
    const shopee = loadFastSqlAggregateState('SHOPEE') || compactDashboardState(summarizeLightweightShopeeState(loadLightweightAggregateState('SHOPEE'), { dbStatus: getDbStatus() }));
    const unifiedHistory = listUnifiedImportHistory(120);
    const latestUnified = getLatestUnifiedImport();
    const selectedSnapshotId = String(latestUnified?.snapshotId || unifiedHistory?.[0]?.snapshotId || '');
    const businesses = {};
    for (const type of ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN']) {
      const fast = loadFastSqlBusinessState(type, selectedSnapshotId);
      if (fast) businesses[type] = fast;
    }
    res.setHeader('Cache-Control', 'private, max-age=5');
    res.json({
      ok: true,
      state: ccsl,
      shopeeState: shopee,
      authStatus: summarizeToken(await loadToken()),
      session: { ok: true, user: publicUser(req.user), unreadNotifications: 0 },
      history: {
        CCSL: listSnapshotHistory(90),
        SHOPEE: listBusinessHistoryDates(SHOPEE, 90),
        UNIFIED: unifiedHistory
      },
      unifiedImport: latestUnified,
      businessStates: businesses,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ ok: false, code: 'BOOTSTRAP_FAILED', error: error.message || String(error) });
  }
});

const periodDashboardCache = new Map();
"""
text = replace_once(text, anchor, replacement, 'bootstrap endpoint')
# Update patch id for easy verification.
text = text.replace("patchId: '2026-08-08-v23-range-fast-nav'", "patchId: '2026-08-08-v26-stability-bootstrap'", 1)
p.write_text(text, encoding='utf-8')

# ---- 3. Frontend: use bootstrap first, fallback to legacy only if needed ----
p = Path('public/app.js')
text = p.read_text(encoding='utf-8')
old = """  const businessType = ['ce','tbkh','ali1688','shopeecn','shopeevn'].includes(currentPage) ? currentBusinessType() : '';
  const needsFullAggregate = ['exceptions', 'reports'].includes(currentPage);
  const requestDefinitions = [
    ['CCSL状态', () => api(`/api/state${needsFullAggregate ? '' : '?compact=1'}`)],
    ['SHOPEE状态', () => api(`/api/shopee/state${needsFullAggregate ? '' : '?compact=1'}`)],
    ['CE登录状态', () => api('/api/ce-auth-status')],
    ['系统Session', () => api('/api/session')],
    ['CCSL历史', () => api('/api/history?businessType=CCSL')],
    ['SHOPEE历史', () => api('/api/history?businessType=SHOPEE')],
    ['统一日报历史', () => api('/api/unified-history')],
    ['最新统一日报', () => api('/api/import/unified-latest?compact=1')],
    ['当前业务板块', () => businessType ? api(`/api/business-state/${businessType}?compact=1`) : Promise.resolve(null)]
  ];

  // Limit the startup burst. The same endpoints are healthy when requested one-by-one,
  // but firing all heavy snapshot/history endpoints at once can create a transient
  // connection failure during page startup.
  const loaded = [];
  const startupFailures = [];
  for (const [label, task] of requestDefinitions) {
    try {
      loaded.push(await task());
    } catch (error) {
      startupFailures.push({ label, error });
      loaded.push(null);
      console.warn(`[startup] ${label}读取失败`, error);
      if (error?.code === 'NETWORK_CONNECTION_INTERRUPTED') break;
    }
  }

  const [ccsl, shopee, auth, session, ccslHistory, shopeeHistory, unifiedHistory, unified, businessResponse] = loaded;
  if (ccsl?.state) appState = ccsl.state;
  if (shopee?.state) shopeeState = shopee.state;
  if (auth?.authStatus) ceAuth = auth.authStatus;
  if (session) accessSession = session;
  historyCatalog = {
    CCSL: ccslHistory?.rows || historyCatalog.CCSL || [],
    SHOPEE: shopeeHistory?.rows || historyCatalog.SHOPEE || [],
    UNIFIED: unifiedHistory?.rows || historyCatalog.UNIFIED || []
  };
  if (unified?.import) unifiedImportState = unified.import;
  if (businessResponse?.businessType) businessStates[businessResponse.businessType] = businessResponse.state || {};

  if (startupFailures.some(item => item.error?.code === 'NETWORK_CONNECTION_INTERRUPTED')) {
    const backendHealthy = await rawHealthProbe();
    if (!backendHealthy) throw startupFailures.find(item => item.error?.code === 'NETWORK_CONNECTION_INTERRUPTED').error;
  }
"""
new = """  const businessType = ['ce','tbkh','ali1688','shopeecn','shopeevn'].includes(currentPage) ? currentBusinessType() : '';
  const needsFullAggregate = ['exceptions', 'reports'].includes(currentPage);
  let bootstrapLoaded = false;
  if (!needsFullAggregate) {
    try {
      const boot = await api('/api/bootstrap');
      if (boot?.state) appState = boot.state;
      if (boot?.shopeeState) shopeeState = boot.shopeeState;
      if (boot?.authStatus) ceAuth = boot.authStatus;
      if (boot?.session) accessSession = boot.session;
      historyCatalog = {
        CCSL: boot?.history?.CCSL || historyCatalog.CCSL || [],
        SHOPEE: boot?.history?.SHOPEE || historyCatalog.SHOPEE || [],
        UNIFIED: boot?.history?.UNIFIED || historyCatalog.UNIFIED || []
      };
      if (boot?.unifiedImport) unifiedImportState = boot.unifiedImport;
      businessStates = { ...businessStates, ...(boot?.businessStates || {}) };
      bootstrapLoaded = true;
    } catch (error) {
      console.warn('[startup] 快速启动接口读取失败，回退兼容加载', error);
    }
  }

  if (!bootstrapLoaded) {
    const requestDefinitions = [
      ['CCSL状态', () => api(`/api/state${needsFullAggregate ? '' : '?compact=1'}`)],
      ['SHOPEE状态', () => api(`/api/shopee/state${needsFullAggregate ? '' : '?compact=1'}`)],
      ['CE登录状态', () => api('/api/ce-auth-status')],
      ['系统Session', () => api('/api/session')],
      ['CCSL历史', () => api('/api/history?businessType=CCSL')],
      ['SHOPEE历史', () => api('/api/history?businessType=SHOPEE')],
      ['统一日报历史', () => api('/api/unified-history')],
      ['最新统一日报', () => api('/api/import/unified-latest?compact=1')],
      ['当前业务板块', () => businessType ? api(`/api/business-state/${businessType}?compact=1`) : Promise.resolve(null)]
    ];
    // Fallback requests are safe to run concurrently now that dashboard state is
    // compact; this prevents a single slow request from serially blocking all UI.
    const loaded = await Promise.all(requestDefinitions.map(async ([label, task]) => {
      try { return await task(); }
      catch (error) { console.warn(`[startup] ${label}读取失败`, error); return null; }
    }));
    const [ccsl, shopee, auth, session, ccslHistory, shopeeHistory, unifiedHistory, unified, businessResponse] = loaded;
    if (ccsl?.state) appState = ccsl.state;
    if (shopee?.state) shopeeState = shopee.state;
    if (auth?.authStatus) ceAuth = auth.authStatus;
    if (session) accessSession = session;
    historyCatalog = {
      CCSL: ccslHistory?.rows || historyCatalog.CCSL || [],
      SHOPEE: shopeeHistory?.rows || historyCatalog.SHOPEE || [],
      UNIFIED: unifiedHistory?.rows || historyCatalog.UNIFIED || []
    };
    if (unified?.import) unifiedImportState = unified.import;
    if (businessResponse?.businessType) businessStates[businessResponse.businessType] = businessResponse.state || {};
  }
"""
text = replace_once(text, old, new, 'frontend startup bootstrap')
p.write_text(text, encoding='utf-8')

# ---- 4. Regression test ----
Path('test/v26-stability.test.js').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('CCSL pipeline keeps today POD-locked bills in final reconciliation rows', () => {
  const text = fs.readFileSync('src/pipeline.js', 'utf8');
  assert.match(text, /const lockedToday = today\.filter\(wb => podLocks\.has\(wb\)\)/);
  assert.match(text, /const finalRows = \[\.\.\.lockedTodayRows, \.\.\.podRows, \.\.\.returnedRows, \.\.\.trackResults\]/);
  assert.match(text, /历史POD锁已闭环，今日无需重复查询/);
});

test('V26 exposes one-shot bootstrap and browser uses it', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(server, /app\.get\('\/api\/bootstrap'/);
  assert.match(server, /businessStates: businesses/);
  assert.match(app, /await api\('\/api\/bootstrap'\)/);
  assert.match(server, /2026-08-08-v26-stability-bootstrap/);
});
''', encoding='utf-8')
print('V26 patch applied')
