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
