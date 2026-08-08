from pathlib import Path
import re


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'Missing patch anchor: {label}')
    return text.replace(old, new, 1)

# Server: use SQL aggregate range reader, never shipment rows for dashboard ranges.
server_path = Path('server.js')
server = server_path.read_text(encoding='utf-8')
store_import = "import { loadLightweightAggregateState, loadLightweightPeriodBusinessState, loadLightweightUnifiedBusinessState } from './src/lightweightDashboardStore.js';"
range_import = "import { loadRangeDashboard } from './src/rangeDashboardStore.js';"
if range_import not in server:
    if store_import not in server:
        raise SystemExit('Missing lightweight store import')
    server = server.replace(store_import, store_import + '\n' + range_import, 1)

old_route_pattern = r"app\.get\('/api/period-dashboard', \(req, res\) => \{.*?\n\}\);(?=\n\napp\.get\('/api/shopee/state')"
new_route = r'''app.get('/api/period-dashboard', (req, res) => {
  try {
    const rawFrom = String(req.query.from || '').trim();
    const rawTo = String(req.query.to || '').trim();
    const mode = String(req.query.mode || '').toLowerCase();
    const anchor = String(req.query.date || '').trim();
    let fromDate = rawFrom;
    let toDate = rawTo;
    let resolvedMode = 'custom';
    if (!fromDate || !toDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !['weekly', 'monthly'].includes(mode)) {
        return res.status(400).json({ ok: false, error: '请选择有效的开始日期和结束日期。' });
      }
      const date = new Date(`${anchor}T12:00:00+07:00`);
      if (mode === 'weekly') {
        const mondayOffset = (date.getDay() + 6) % 7;
        const start = new Date(date); start.setDate(start.getDate() - mondayOffset);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        fromDate = localIsoDate(start); toDate = localIsoDate(end);
      } else {
        fromDate = `${anchor.slice(0, 7)}-01`;
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
        toDate = localIsoDate(end);
      }
      resolvedMode = mode;
    }
    const result = loadRangeDashboard(fromDate, toDate);
    res.json({ ok: true, mode: resolvedMode, anchor: anchor || toDate, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});'''
server, count = re.subn(old_route_pattern, lambda _: new_route, server, count=1, flags=re.S)
if count != 1 and 'const result = loadRangeDashboard(fromDate, toDate);' not in server:
    raise SystemExit('Cannot replace period dashboard route')
server_path.write_text(server, encoding='utf-8')

# Frontend: use server-provided aggregate states directly. No browser row aggregation.
app_path = Path('public/app.js')
app = app_path.read_text(encoding='utf-8')
old_apply = r'''function applyPeriodDashboardResult(result, mode, anchor, shouldRender = true) {
  const types = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];
  types.forEach(type => { businessStates[type] = result.states?.[type] || {}; });
  const snapshotId = `PERIOD:${mode}:${result.fromDate}:${result.toDate}`;
  appState = aggregateBusinessStates(types.slice(0, 3).map(type => businessStates[type]), 'CCSL', result.toDate, snapshotId);
  shopeeState = aggregateBusinessStates(types.slice(3).map(type => businessStates[type]), 'SHOPEE', result.toDate, snapshotId);
  for (const state of [appState, shopeeState]) {
    state.periodMode = mode;
    state.periodStart = result.fromDate;
    state.periodEnd = result.toDate;
    state.periodDates = [...new Set(types.flatMap(type => result.states?.[type]?.periodDates || []))].sort();
  }
  historyModeDate = anchor || result.toDate;
  dashboardPeriodMode = mode;
  dashboardPeriodRange = { mode, fromDate: result.fromDate, toDate: result.toDate };
  if (shouldRender) renderAll();
}'''
new_apply = r'''function applyPeriodDashboardResult(result, mode, anchor, shouldRender = true) {
  const types = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];
  types.forEach(type => { businessStates[type] = result.states?.[type] || {}; });
  appState = result.aggregates?.CCSL || {};
  shopeeState = result.aggregates?.SHOPEE || {};
  for (const state of [appState, shopeeState]) {
    state.periodMode = mode;
    state.periodStart = result.fromDate;
    state.periodEnd = result.toDate;
    state.periodDates = result.dates || [];
  }
  historyModeDate = anchor || result.toDate;
  dashboardPeriodMode = mode;
  dashboardPeriodRange = { mode, fromDate: result.fromDate, toDate: result.toDate };
  if (shouldRender) renderAll();
}'''
app = replace_once(app, old_apply, new_apply, 'apply period dashboard result')

# Range mode intentionally has no bulk shipment rows. Make detail navigation explicit.
old_open_home = "function openHomeMetricDetail(tab) {\n  if (['self-pickup', 'cecn', 'cezt', '580'].includes(tab)) {"
new_open_home = "function openHomeMetricDetail(tab) {\n  if (dashboardPeriodMode && (appState._rangeSummaryOnly || shopeeState._rangeSummaryOnly)) {\n    navigatePage('reports');\n    const status = document.getElementById('exportProgress');\n    if (status) status.textContent = `当前为 ${dashboardPeriodRange?.fromDate || ''} 至 ${dashboardPeriodRange?.toDate || ''} 范围汇总。范围完整明细请使用自定义日期导出；单票明细按日期进入对应看板查看。`;\n    return;\n  }\n  if (['self-pickup', 'cecn', 'cezt', '580'].includes(tab)) {"
app = replace_once(app, old_open_home, new_open_home, 'range detail navigation')

app_path.write_text(app, encoding='utf-8')
print('V22 SQL range summary patch applied')
