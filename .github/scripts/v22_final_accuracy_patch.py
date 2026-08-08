from pathlib import Path

path = Path('public/app.js')
text = path.read_text(encoding='utf-8')
old = """  const importedCounts = unifiedImportState?.classificationCounts || {};
  const hasUnifiedCounts = Boolean(unifiedImportState?.snapshotId);
  const businessCards = [
    ['total', '总览', hasUnifiedCounts ? Number(unifiedImportState.summary?.validUniqueWaybills || 0) : total, 'blue'],
    ['ce', 'CE', hasUnifiedCounts ? Number(importedCounts.CE || 0) : cc.total, 'green'],
    ['tbkh', 'TBKH', Number(importedCounts.TBKH || 0), 'orange'],
    ['shopeecn', 'SHOPEE CN', hasUnifiedCounts ? Number(importedCounts.SHOPEECN || 0) : Number(shopeeState.dashboard?.recipientGroups?.CN?.metrics?.total || 0), 'purple'],
    ['shopeevn', 'SHOPEE VN', hasUnifiedCounts ? Number(importedCounts.SHOPEEVN || 0) : Number(shopeeState.dashboard?.recipientGroups?.VN?.metrics?.total || 0), 'red'],
    ['ali1688', 'ALI1688', Number(importedCounts.ALI1688 || 0), 'cyan']
  ];"""
new = """  const importedCounts = unifiedImportState?.classificationCounts || {};
  // Single-day mode may use the exact import classification counters. In a date
  // range those counters belong only to the newest imported day, so every business
  // card must instead use the SQL range state for the selected start/end dates.
  const useSingleDayImportCounts = Boolean(unifiedImportState?.snapshotId) && !dashboardPeriodMode;
  const rangeBusinessCount = type => {
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
    ['total', '总览', useSingleDayImportCounts ? Number(unifiedImportState.summary?.validUniqueWaybills || 0) : total, 'blue'],
    ['ce', 'CE', useSingleDayImportCounts ? Number(importedCounts.CE || 0) : (dashboardPeriodMode ? rangeBusinessCount('CE') : cc.total), 'green'],
    ['tbkh', 'TBKH', useSingleDayImportCounts ? Number(importedCounts.TBKH || 0) : rangeBusinessCount('TBKH'), 'orange'],
    ['shopeecn', 'SHOPEE CN', useSingleDayImportCounts ? Number(importedCounts.SHOPEECN || 0) : Number(shopeeState.dashboard?.recipientGroups?.CN?.metrics?.total || rangeBusinessCount('SHOPEECN')), 'purple'],
    ['shopeevn', 'SHOPEE VN', useSingleDayImportCounts ? Number(importedCounts.SHOPEEVN || 0) : Number(shopeeState.dashboard?.recipientGroups?.VN?.metrics?.total || rangeBusinessCount('SHOPEEVN')), 'red'],
    ['ali1688', 'ALI1688', useSingleDayImportCounts ? Number(importedCounts.ALI1688 || 0) : rangeBusinessCount('ALI1688'), 'cyan']
  ];"""
if new not in text:
    if old not in text:
        raise SystemExit('Cannot find business card count block')
    text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
print('V22 final range business-card accuracy patch applied')
