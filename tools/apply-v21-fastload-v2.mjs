import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePath = 'tools/apply-v21-fastload.mjs';
let source = fs.readFileSync(sourcePath, 'utf8');

source = source.replace(
  "    const cacheKey = \\\`${'${snapshotId}'}:\\${'${types.join(\",\")}'}\\\`;",
  "    const cacheKey = snapshotId + ':' + types.join(',');"
);
source = source.replace(
  "  if (!shopee) state.detailTabs.dashboard = { label: \\\`${'${source.businessType}'}总看板\\\`, rows: buildDashboardRows(source), total: buildDashboardRows(source).length };",
  "  if (!shopee) state.detailTabs.dashboard = { label: source.businessType + '总看板', rows: buildDashboardRows(source), total: buildDashboardRows(source).length };"
);

const tempPath = path.resolve('tools/.apply-v21-fastload.generated.mjs');
fs.writeFileSync(tempPath, source, 'utf8');
await import(pathToFileURL(tempPath).href + `?t=${Date.now()}`);
fs.rmSync(tempPath, { force: true });

// Preserve V20's exact-current-snapshot contract while keeping V21 first-paint fast.
// This helper is intentionally evaluated only against lightweight metadata.
let app = fs.readFileSync('public/app.js', 'utf8');
if (!app.includes('function preferredUnifiedForSelectedDate()')) {
  const helper = `function preferredUnifiedForSelectedDate() {
  if (!historyModeDate) return unifiedImportState || (historyCatalog.UNIFIED || [])[0] || null;
  return unifiedImportState?.reportDate === historyModeDate
    ? unifiedImportState
    : (historyCatalog.UNIFIED || []).find(row => row.reportDate === historyModeDate) || null;
}

`;
  app = app.replace('function loadDeferredStartupMetadata() {', helper + 'function loadDeferredStartupMetadata() {');
  app = app.replace(
    '    renderHistoryOptions();\n    renderTopbar();',
    '    const preferredUnified = preferredUnifiedForSelectedDate();\n    if (preferredUnified?.reportDate && !historyModeDate) historyModeDate = preferredUnified.reportDate;\n    renderHistoryOptions();\n    renderTopbar();'
  );
  fs.writeFileSync('public/app.js', app, 'utf8');
}
