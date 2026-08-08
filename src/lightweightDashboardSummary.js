import { buildCoreKpis, buildCriticalDashboard, buildDashboardData, buildDetailTabs } from './reporting.js';
import { buildShopeeDashboard } from './shopeeReporting.js';

/**
 * Build browser dashboard payloads without touching export snapshot JSON.
 * All input is already normalized and memory-bounded by lightweightDashboardStore.
 */
export function summarizeLightweightCcslState(state = {}, context = {}) {
  const viewState = state || {};
  const runStatus = viewState.currentRun || null;
  const dashboard = buildDashboardData(viewState);
  const coreKpis = buildCoreKpis(viewState);
  const critical = buildCriticalDashboard(viewState);
  return {
    businessType: 'CCSL',
    snapshotId: viewState.snapshotId || '',
    reportDate: viewState.reportDate || '',
    sourceName: viewState.sourceName || '',
    dailyReportReady: Boolean(viewState.reportDate && (viewState.pnhBills || []).length),
    pnh: (viewState.pnhBills || []).length,
    nonPnh: (viewState.nonPnhBills || []).length,
    carry: (viewState.carryBills || []).length,
    podLocks: (viewState.podLocks || []).length,
    scanResults: (viewState.scanResults || []).length,
    scanPool: (viewState.scanPool || []).length,
    needTrackBills: (viewState.needTrackBills || []).length,
    trackResults: (viewState.trackResults || []).length,
    trackEvents: 0,
    finalRows: (viewState.finalRows || []).length,
    nextCarry: (viewState.nextCarryBills || viewState.carryBills || []).length,
    finalDiversion: 0,
    lastRun: viewState.lastRun || null,
    lastRunSummary: viewState.lastRunSummary || viewState.lastRun || null,
    runId: runStatus?.runId || viewState.lastRunSummary?.runId || '',
    runStatus: runStatus?.status || viewState.lastRunSummary?.runStatus || '',
    currentRun: runStatus,
    dailySummary: viewState.dailyParseSummary || null,
    dailyPreview: (viewState.dailyParseRows || []).slice(0, 50),
    backupSummary: null,
    shopCodes: context.shopCodes || null,
    historySummary: viewState.historySummary || [],
    processing: viewState.processing || { running: false, paused: false, phase: '' },
    dbStatus: context.dbStatus || null,
    network: context.network || null,
    consistency: { status: 'NORMALIZED_SQLITE', errors: [], warnings: [] },
    dashboardMetricHash: '',
    detailRowHash: '',
    dashboard,
    coreKpis,
    criticalDashboard: { summary: critical.summary, rows: critical.rows },
    detailTabs: buildDetailTabs(viewState),
    logs: []
  };
}

export function summarizeLightweightShopeeState(state = {}, context = {}) {
  const viewState = state || {};
  const runStatus = viewState.currentRun || null;
  const dashboard = buildShopeeDashboard({ ...viewState, businessType: 'SHOPEE' });
  return {
    businessType: 'SHOPEE',
    snapshotId: viewState.snapshotId || '',
    reportDate: viewState.reportDate || '',
    sourceName: viewState.sourceName || '',
    dailyReportReady: Boolean(viewState.dailyReportReady),
    total: (viewState.pnhBills || []).length,
    carry: (viewState.carryBills || []).length,
    podLocks: (viewState.podLocks || []).length,
    scanResults: (viewState.scanResults || []).length,
    trackResults: (viewState.trackResults || []).length,
    trackEvents: 0,
    finalRows: (viewState.finalRows || []).length,
    nextCarry: (viewState.nextCarryBills || viewState.carryBills || []).length,
    dailySummary: viewState.dailyParseSummary || null,
    dailyPreview: (viewState.dailyParseRows || []).slice(0, 50),
    backupSummary: null,
    apiDiagnostic: null,
    historySummary: viewState.historySummary || [],
    runId: runStatus?.runId || viewState.lastRunSummary?.runId || '',
    runStatus: runStatus?.status || viewState.lastRunSummary?.runStatus || '',
    currentRun: runStatus,
    processing: viewState.processing || { running: false, paused: false, phase: '' },
    dashboard,
    dashboardMetricHash: '',
    detailRowHash: '',
    detailTabs: dashboard.detailTabs,
    logs: [],
    dbStatus: context.dbStatus || null
  };
}
