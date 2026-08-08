import fs from 'node:fs';

const APP_PATH = 'public/app.js';
const SERVER_PATH = 'server.js';
const MARKER = 'V21_FASTLOAD_20260808';

function replaceOrThrow(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`V21 patch target not found: ${label}`);
  return text.replace(pattern, replacement);
}

let app = fs.readFileSync(APP_PATH, 'utf8');
let server = fs.readFileSync(SERVER_PATH, 'utf8');

if (!app.includes(MARKER)) {
  const optimizedRefresh = `async function refreshInternal() {
  if (visualMode) {
    visualFixture ||= await fetch('/visual-dashboard-fixture.json', { cache: 'no-store' }).then(response => response.json());
    appState = buildVisualCcslState(visualFixture);
    shopeeState = buildVisualShopeeState(visualFixture);
    ceAuth = { loggedIn: true, account: '张三', role: '运营专员' };
    accessSession = { user: { displayName: '张三', department: '质控部', role: 'OPERATOR', devMode: true }, unreadNotifications: 0 };
    historyCatalog = { CCSL: [{ reportDate: visualFixture.reportDate }], SHOPEE: [{ reportDate: visualFixture.reportDate }] };
    renderAll();
    return;
  }

  // V21_FASTLOAD_20260808
  // Startup must render the visible dashboard first. History, CE auth and other
  // non-visible metadata are loaded afterwards and never block first paint.
  const businessPage = ['ce','tbkh','ali1688','shopeecn','shopeevn'].includes(currentPage);
  const fastDashboardPage = currentPage === 'home' || businessPage;
  const businessType = businessPage ? currentBusinessType() : '';
  const bootstrapScope = currentPage === 'home' ? 'ALL' : businessType;

  try {
    const [sessionResult, bootstrapResult] = await Promise.all([
      api('/api/session'),
      fastDashboardPage
        ? api(\`/api/dashboard/bootstrap?scope=\${encodeURIComponent(bootstrapScope)}\`)
        : Promise.resolve(null)
    ]);

    if (sessionResult) accessSession = sessionResult;

    if (bootstrapResult?.states) {
      unifiedImportState = bootstrapResult.import || unifiedImportState;
      Object.assign(businessStates, bootstrapResult.states || {});
      const reportDate = bootstrapResult.reportDate || unifiedImportState?.reportDate || '';
      const snapshotId = bootstrapResult.snapshotId || unifiedImportState?.snapshotId || '';
      if (reportDate) historyModeDate = reportDate;

      if (currentPage === 'home') {
        const ccslTypes = ['CE','TBKH','ALI1688'];
        const shopeeTypes = ['SHOPEECN','SHOPEEVN'];
        if (ccslTypes.every(type => businessStates[type])) {
          appState = aggregateBusinessStates(ccslTypes.map(type => businessStates[type]), 'CCSL', reportDate, snapshotId);
        }
        if (shopeeTypes.every(type => businessStates[type])) {
          shopeeState = aggregateBusinessStates(shopeeTypes.map(type => businessStates[type]), 'SHOPEE', reportDate, snapshotId);
        }
      } else if (businessType && businessStates[businessType]) {
        if (/^SHOPEE/.test(businessType)) shopeeState = businessStates[businessType];
        else appState = businessStates[businessType];
      }

      renderAll();
      void loadDeferredStartupMetadata();
      return;
    }
  } catch (error) {
    console.warn('[V21 fast startup] 快速看板读取失败，转入兼容读取。', error);
    const backendHealthy = await rawHealthProbe();
    if (!backendHealthy) throw error;
  }

  // Compatibility path for pages without a unified snapshot or non-dashboard pages.
  const needsFullAggregate = ['exceptions', 'reports'].includes(currentPage);
  const tasks = [
    api('/api/session'),
    api('/api/import/unified-latest?compact=1'),
    api(\`/api/state\${needsFullAggregate ? '' : '?compact=1'}\`),
    api(\`/api/shopee/state\${needsFullAggregate ? '' : '?compact=1'}\`)
  ];
  const [sessionSettled, unifiedSettled, ccslSettled, shopeeSettled] = await Promise.allSettled(tasks);
  if (sessionSettled.status === 'fulfilled') accessSession = sessionSettled.value;
  if (unifiedSettled.status === 'fulfilled' && unifiedSettled.value?.import) unifiedImportState = unifiedSettled.value.import;
  if (ccslSettled.status === 'fulfilled' && ccslSettled.value?.state) appState = ccslSettled.value.state;
  if (shopeeSettled.status === 'fulfilled' && shopeeSettled.value?.state) shopeeState = shopeeSettled.value.state;
  if (unifiedImportState?.reportDate && !historyModeDate) historyModeDate = unifiedImportState.reportDate;
  renderAll();
  void loadDeferredStartupMetadata();
  if (currentPage === 'tracking') void loadTrackingWorkspace();
}

function loadDeferredStartupMetadata() {
  return runSingleFlight('v21-deferred-startup-metadata', async () => {
    const requests = await Promise.allSettled([
      api('/api/ce-auth-status'),
      api('/api/history?businessType=CCSL'),
      api('/api/history?businessType=SHOPEE'),
      api('/api/unified-history')
    ]);
    const [auth, ccslHistory, shopeeHistory, unifiedHistory] = requests;
    if (auth.status === 'fulfilled' && auth.value?.authStatus) ceAuth = auth.value.authStatus;
    historyCatalog = {
      CCSL: ccslHistory.status === 'fulfilled' ? (ccslHistory.value?.rows || []) : (historyCatalog.CCSL || []),
      SHOPEE: shopeeHistory.status === 'fulfilled' ? (shopeeHistory.value?.rows || []) : (historyCatalog.SHOPEE || []),
      UNIFIED: unifiedHistory.status === 'fulfilled' ? (unifiedHistory.value?.rows || []) : (historyCatalog.UNIFIED || [])
    };
    renderHistoryOptions();
    renderTopbar();
    renderSystemStatus();
    renderAuthPanels();
  }).catch(error => console.warn('[V21 deferred metadata] 非阻塞元数据读取失败', error));
}

function runSingleFlight`;

  app = replaceOrThrow(
    app,
    /async function refreshInternal\(\) \{[\s\S]*?\n\}\n\nfunction runSingleFlight/,
    optimizedRefresh,
    'refreshInternal'
  );

  const optimizedSync = `async function syncUnifiedSelection(reportDate, snapshotId, shouldRender = true) {
  const normalizedDate = String(reportDate || '').trim();
  const normalizedSnapshotId = String(snapshotId || '').trim();
  if (!normalizedDate || !normalizedSnapshotId) return false;
  const types = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];

  // V21: one lightweight request replaces five sequential business-state requests.
  try {
    const result = await api(\`/api/dashboard/bootstrap?scope=ALL&snapshotId=\${encodeURIComponent(normalizedSnapshotId)}\`);
    Object.assign(businessStates, result.states || {});
    const ccslTypes = types.slice(0, 3);
    const shopeeTypes = types.slice(3);
    if (ccslTypes.every(type => businessStates[type])) {
      appState = aggregateBusinessStates(ccslTypes.map(type => businessStates[type]), 'CCSL', normalizedDate, normalizedSnapshotId);
    }
    if (shopeeTypes.every(type => businessStates[type])) {
      shopeeState = aggregateBusinessStates(shopeeTypes.map(type => businessStates[type]), 'SHOPEE', normalizedDate, normalizedSnapshotId);
    }
    historyModeDate = normalizedDate;
    window.__cePartialLoadFailures = [];
    if (shouldRender) renderAll();
    return true;
  } catch (error) {
    console.warn('[V21 unified bootstrap] 合并快照读取失败，使用双并发兼容模式。', error);
    const backendHealthy = await rawHealthProbe();
    if (!backendHealthy) throw error;
  }

  const loadedTypes = new Set();
  const failures = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < types.length) {
      const index = cursor++;
      const type = types[index];
      try {
        const result = await api(\`/api/business-state/\${type}?snapshotId=\${encodeURIComponent(normalizedSnapshotId)}&compact=1\`);
        businessStates[type] = result.state || {};
        loadedTypes.add(type);
      } catch (error) {
        failures.push({ type, error });
        console.warn(\`[snapshot] \${type}读取失败\`, error);
      }
    }
  };
  await Promise.all([worker(), worker()]);

  const ccslTypes = types.slice(0, 3);
  const shopeeTypes = types.slice(3);
  if (ccslTypes.every(type => loadedTypes.has(type))) {
    appState = aggregateBusinessStates(ccslTypes.map(type => businessStates[type]), 'CCSL', normalizedDate, normalizedSnapshotId);
  }
  if (shopeeTypes.every(type => loadedTypes.has(type))) {
    shopeeState = aggregateBusinessStates(shopeeTypes.map(type => businessStates[type]), 'SHOPEE', normalizedDate, normalizedSnapshotId);
  }
  window.__cePartialLoadFailures = failures.map(item => ({ type: item.type, message: item.error?.message || '读取失败' }));
  historyModeDate = normalizedDate;
  if (shouldRender) renderAll();
  return failures.length === 0;
}

async function loadTrackingWorkspace`;

  app = replaceOrThrow(
    app,
    /async function syncUnifiedSelection\(reportDate, snapshotId, shouldRender = true\) \{[\s\S]*?\n\}\n\nasync function loadTrackingWorkspace/,
    optimizedSync,
    'syncUnifiedSelection'
  );

  app = app.replace(
    'const result = await api(`/api/business-state/${type}${suffix}`);',
    'const result = await api(`/api/business-state/${type}${suffix ? `${suffix}&compact=1` : `?compact=1`}`);'
  );

  fs.writeFileSync(APP_PATH, app);
}

if (!server.includes(MARKER)) {
  const bootstrapBlock = `const periodDashboardCache = new Map();
const dashboardBootstrapCache = new Map(); // V21_FASTLOAD_20260808

function buildFastBusinessState(type, snapshotId = '') {
  const source = loadUnifiedBusinessState(type, snapshotId);
  const shopee = /^SHOPEE/.test(source.businessType);
  const shopeeDashboard = shopee ? buildShopeeDashboard({ ...source, businessType: 'SHOPEE' }) : null;
  const state = shopee
    ? {
        ...source,
        businessType: 'SHOPEE',
        viewBusinessType: source.businessType,
        total: source.pnhBills?.length || 0,
        dailySummary: source.dailyParseSummary || {},
        dashboard: shopeeDashboard,
        detailTabs: shopeeDashboard.detailTabs
      }
    : { ...source, viewBusinessType: source.businessType, dashboard: buildDashboardData(source), detailTabs: buildDetailTabs(source) };
  if (!shopee) state.detailTabs.dashboard = { label: \`${'${source.businessType}'}总看板\`, rows: buildDashboardRows(source), total: buildDashboardRows(source).length };
  return {
    businessType: source.businessType,
    reportDate: source.reportDate,
    snapshotId: source.snapshotId,
    snapshotStatus: source.snapshotStatus,
    state: compactDashboardState(state)
  };
}

app.get('/api/dashboard/bootstrap', (req, res) => {
  const startedAt = Date.now();
  try {
    const latest = getLatestUnifiedImport();
    const requestedSnapshotId = String(req.query.snapshotId || '').trim();
    const snapshotId = requestedSnapshotId || latest?.snapshotId || '';
    const allowedTypes = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];
    const requestedScope = String(req.query.scope || 'ALL').trim().toUpperCase();
    const types = requestedScope === 'ALL' ? allowedTypes : allowedTypes.includes(requestedScope) ? [requestedScope] : allowedTypes;
    if (!snapshotId) {
      return res.json({ ok: true, reportDate: latest?.reportDate || '', snapshotId: '', import: latest || null, states: {}, generatedAt: new Date().toISOString(), cache: 'MISS' });
    }

    const cacheKey = \`${'${snapshotId}'}:\${'${types.join(",")}'}\`;
    const cached = dashboardBootstrapCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      res.setHeader('X-Dashboard-Cache', 'HIT');
      res.setHeader('Server-Timing', \`dashboard;dur=\${Date.now() - startedAt}\`);
      return res.json({ ...cached.payload, cache: 'HIT' });
    }

    const states = Object.fromEntries(types.map(type => {
      const payload = buildFastBusinessState(type, snapshotId);
      return [type, payload.state];
    }));
    const reportDate = Object.values(states).find(state => state?.reportDate)?.reportDate || latest?.reportDate || '';
    const completed = Object.values(states).length > 0 && Object.values(states).every(state => state?.snapshotStatus === 'COMPLETED');
    const ttlMs = completed ? 5 * 60 * 1000 : 5000;
    const payload = { ok: true, reportDate, snapshotId, import: latest || null, states, generatedAt: new Date().toISOString(), ttlMs };
    dashboardBootstrapCache.set(cacheKey, { payload, expiresAt: Date.now() + ttlMs });
    if (dashboardBootstrapCache.size > 40) {
      const firstKey = dashboardBootstrapCache.keys().next().value;
      if (firstKey) dashboardBootstrapCache.delete(firstKey);
    }
    res.setHeader('Cache-Control', 'private, max-age=3');
    res.setHeader('X-Dashboard-Cache', 'MISS');
    res.setHeader('Server-Timing', \`dashboard;dur=\${Date.now() - startedAt}\`);
    return res.json({ ...payload, cache: 'MISS' });
  } catch (error) {
    return res.status(500).json({ ok: false, code: 'DASHBOARD_BOOTSTRAP_FAILED', error: error.message || '看板快速读取失败' });
  }
});`;

  server = replaceOrThrow(
    server,
    /const periodDashboardCache = new Map\(\);/,
    bootstrapBlock,
    'periodDashboardCache insertion'
  );
  fs.writeFileSync(SERVER_PATH, server);
}

console.log('V21 fastload patch applied.');
