import fs from 'node:fs';

function replaceOnce(file, before, after, label) {
  const source = fs.readFileSync(file, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match in ${file}, found ${count}`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
  console.log(`patched ${label}`);
}

replaceOnce(
  'src/unifiedImportStore.js',
  `  const rows = getDb().prepare(\`SELECT b.*, s.status snapshotStatus, s.createdAt snapshotCreatedAt\n    FROM unified_import_batches b\n    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId\n    ORDER BY b.reportDate DESC,\n      CASE s.status WHEN 'COMPLETED' THEN 0 WHEN 'IMPORTED' THEN 1 ELSE 2 END,\n      b.createdAt DESC\n    LIMIT ?\`).all(Math.max(1, Math.min(500, Number(limit) || 120)));`,
  `  // One report date must resolve to the newest currently VALID import batch.\n  // A superseded COMPLETED snapshot belongs to an older upload of the same date\n  // and must never replace the latest imported classification on business pages.\n  const rows = getDb().prepare(\`SELECT b.*, s.status snapshotStatus, s.createdAt snapshotCreatedAt\n    FROM unified_import_batches b\n    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId\n    WHERE b.status='VALID'\n    ORDER BY b.reportDate DESC, b.createdAt DESC\n    LIMIT ?\`).all(Math.max(1, Math.min(500, Number(limit) || 120)));`,
  'prefer latest VALID unified batch per date'
);

replaceOnce(
  'public/app.js',
  `  const selectedUnified = historyModeDate\n    ? (historyCatalog.UNIFIED || []).find(row => row.reportDate === historyModeDate)\n    : null;`,
  `  // When the selected date is the current imported date, always bind the five\n  // business pages to that exact newest import snapshot. History may still contain\n  // an older completed snapshot for the same date and must not override it.\n  const selectedUnified = historyModeDate\n    ? (unifiedImportState?.reportDate === historyModeDate\n        ? unifiedImportState\n        : (historyCatalog.UNIFIED || []).find(row => row.reportDate === historyModeDate))\n    : null;`,
  'bind selected current date to newest unified import snapshot'
);

replaceOnce(
  'public/app.js',
  `function ccslMetrics(sourceState = appState) {\n  const dashboard = sourceState.dashboard || {};\n  return { total: Number(dashboard.pnh || dashboard.totalMonitored || 0), pod: Number(dashboard.todayPod || 0), podRate: Number(dashboard.podRate || 0), abnormal: Number(dashboard.abnormalCount || 0), pending: Number(dashboard.categories?.pendingTotal || 0), oc: Number(dashboard.categories?.ocTotal || 0) };\n}`,
  `function ccslMetrics(sourceState = appState) {\n  const dashboard = sourceState.dashboard || {};\n  // Directly after unified import there may be no scan/final rows yet. The business\n  // ticket count is still authoritative from the exact imported business slice.\n  const importedTotal = Number(sourceState.pnhBills?.length || sourceState.dailyParseSummary?.totalRecognized || sourceState.dailyParseRows?.length || 0);\n  return { total: Number(dashboard.pnh || dashboard.totalMonitored || importedTotal), pod: Number(dashboard.todayPod || 0), podRate: Number(dashboard.podRate || 0), abnormal: Number(dashboard.abnormalCount || 0), pending: Number(dashboard.categories?.pendingTotal || 0), oc: Number(dashboard.categories?.ocTotal || 0) };\n}`,
  'CCSL-family business ticket count import fallback'
);

replaceOnce(
  'public/app.js',
  `  const metrics = shopeeState.dashboard?.recipientGroups?.[shopeeRecipientGroup]?.metrics || {};\n  const unresolved = Number.isFinite(Number(metrics.unresolved)) ? Number(metrics.unresolved) : Math.max(0, Number(metrics.total || 0) - Number(metrics.pod || 0) - Number(metrics.returned || 0));`,
  `  const metrics = { ...(shopeeState.dashboard?.recipientGroups?.[shopeeRecipientGroup]?.metrics || {}) };\n  // A newly imported CN/VN slice has a valid total before CE scan/track processing.\n  // Keep POD/return/anomaly values at zero until processed, but never hide the imported count.\n  const importedTotal = Number(state.pnhBills?.length || state.dailyParseSummary?.totalRecognized || state.dailyParseRows?.length || 0);\n  if (!Number(metrics.total || 0) && importedTotal) metrics.total = importedTotal;\n  const unresolved = Number.isFinite(Number(metrics.unresolved)) ? Number(metrics.unresolved) : Math.max(0, Number(metrics.total || 0) - Number(metrics.pod || 0) - Number(metrics.returned || 0));`,
  'SHOPEE CN/VN ticket count import fallback'
);

console.log('V20 patch complete');
