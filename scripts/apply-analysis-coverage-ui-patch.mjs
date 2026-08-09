import fs from 'node:fs';

const file = 'public/app.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
`  renderUnifiedImportResult();
  renderHistoryOptions();
  renderProcessingNotice();`,
`  renderUnifiedImportResult();
  renderHistoryOptions();
  renderProcessingNotice();
  renderAnalysisCoverageNotice();`,
'call analysis coverage notice'
);

replaceOnce(
`function renderProcessingNotice() {`,
`function rangeAnalysisCoverage() {
  if (!dashboardPeriodMode) return null;
  const types = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
  const sourceTotal = types.reduce((sum, type) => sum + Number(businessStates[type]?.sourceTotal ?? businessStates[type]?.dashboard?.sourceTotal ?? 0), 0);
  const analyzedTotal = types.reduce((sum, type) => sum + Number(businessStates[type]?.analyzedTotal ?? businessStates[type]?.dashboard?.analyzedTotal ?? 0), 0);
  const missingDates = [...new Set(types.flatMap(type => businessStates[type]?.missingAnalysisDates || businessStates[type]?.dashboard?.missingAnalysisDates || []))].sort();
  return {
    sourceTotal,
    analyzedTotal,
    analysisPending: Math.max(0, sourceTotal - analyzedTotal),
    missingDates,
    analysisComplete: sourceTotal === analyzedTotal && missingDates.length === 0
  };
}

function renderAnalysisCoverageNotice() {
  let target = document.getElementById('analysisCoverageNotice');
  if (!target) {
    target = document.createElement('div');
    target.id = 'analysisCoverageNotice';
    target.className = 'global-processing-notice warning';
    const main = document.querySelector('.main-content');
    const processing = document.getElementById('globalProcessingNotice');
    if (processing?.parentNode) processing.insertAdjacentElement('afterend', target);
    else main?.prepend(target);
  }
  const coverage = rangeAnalysisCoverage();
  if (!coverage || coverage.sourceTotal <= 0 || coverage.analysisComplete) {
    target.hidden = true;
    return;
  }
  const dateText = coverage.missingDates.length ? ` · 未完成日期 ${coverage.missingDates.join('、')}` : '';
  target.hidden = false;
  target.className = 'global-processing-notice warning';
  target.innerHTML = `<span><strong>数据分析未全部完成</strong> · 源日报 ${coverage.sourceTotal} 票 · 已分析 ${coverage.analyzedTotal} 票 · 待分析 ${coverage.analysisPending} 票${escapeHtml(dateText)}</span>`;
}

function renderProcessingNotice() {`,
'add analysis coverage notice'
);

replaceOnce(
`  const rangeBusinessCount = type => {
    const state = businessStates[type] || {};
    if (/^SHOPEE/.test(type)) {
      return Number(state.dashboard?.recipientGroups?.ALL?.metrics?.total
        || state.dashboard?.metrics?.total
        || state.dailyParseSummary?.totalRecognized
        || 0);
    }
    return Number(state.dashboard?.pnh
      || state.dashboard?.totalMonitored
      || state.dailyParseSummary?.totalRecognized
      || 0);
  };
  const businessCards = [
    ['total', '总览', useSingleDayImportCounts ? Number(unifiedImportState.summary?.validUniqueWaybills || 0) : total, 'blue'],`,
`  const rangeBusinessCount = type => {
    const state = businessStates[type] || {};
    const sourceTotal = state.sourceTotal ?? state.dashboard?.sourceTotal ?? state.dailyParseSummary?.sourceTotal;
    if (sourceTotal !== undefined && sourceTotal !== null) return Number(sourceTotal || 0);
    if (/^SHOPEE/.test(type)) {
      return Number(state.dashboard?.recipientGroups?.ALL?.metrics?.total
        || state.dashboard?.metrics?.total
        || state.dailyParseSummary?.totalRecognized
        || 0);
    }
    return Number(state.dashboard?.pnh
      || state.dashboard?.totalMonitored
      || state.dailyParseSummary?.totalRecognized
      || 0);
  };
  const periodSourceTotal = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].reduce((sum, type) => sum + rangeBusinessCount(type), 0);
  const businessCards = [
    ['total', '总览', useSingleDayImportCounts ? Number(unifiedImportState.summary?.validUniqueWaybills || 0) : (dashboardPeriodMode ? periodSourceTotal : total), 'blue'],`,
'home range source denominator'
);

replaceOnce(
`    ['shopeecn', 'SHOPEE CN', useSingleDayImportCounts ? Number(importedCounts.SHOPEECN || 0) : Number(shopeeState.dashboard?.recipientGroups?.CN?.metrics?.total || rangeBusinessCount('SHOPEECN')), 'purple'],
    ['shopeevn', 'SHOPEE VN', useSingleDayImportCounts ? Number(importedCounts.SHOPEEVN || 0) : Number(shopeeState.dashboard?.recipientGroups?.VN?.metrics?.total || rangeBusinessCount('SHOPEEVN')), 'red'],`,
`    ['shopeecn', 'SHOPEE CN', useSingleDayImportCounts ? Number(importedCounts.SHOPEECN || 0) : (dashboardPeriodMode ? rangeBusinessCount('SHOPEECN') : Number(shopeeState.dashboard?.recipientGroups?.CN?.metrics?.total || rangeBusinessCount('SHOPEECN'))), 'purple'],
    ['shopeevn', 'SHOPEE VN', useSingleDayImportCounts ? Number(importedCounts.SHOPEEVN || 0) : (dashboardPeriodMode ? rangeBusinessCount('SHOPEEVN') : Number(shopeeState.dashboard?.recipientGroups?.VN?.metrics?.total || rangeBusinessCount('SHOPEEVN'))), 'red'],`,
'Shopee period source denominator'
);

fs.writeFileSync(file, source, 'utf8');
