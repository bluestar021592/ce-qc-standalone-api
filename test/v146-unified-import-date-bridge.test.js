import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{const r=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,`${file}: ${r.stderr||r.stdout}`);};

test('V146 normalizes recognized daily-report dates before V102 persistence safety',()=>{
  syntax('src/v146UnifiedImportDateBridgePatch.js');
  const source=read('src/v146UnifiedImportDateBridgePatch.js');
  assert.match(source,/v146-unified-import-date-bridge-v1/);
  assert.match(source,/normalizeUnifiedReportDate/);
  assert.match(source,/dateFromUnifiedFilename/);
  assert.match(source,/replace\(\/\[年\/\.\]\//);
  assert.match(source,/req\.body\.reportDate = reportDate/);
  assert.match(source,/X-CE-QC-Import-Date/);
  assert.doesNotMatch(source,/DELETE FROM|UPDATE unified_import_batches|INSERT INTO unified_import_batches/i);

  const bootstrap=read('bootstrap.js');
  assert.ok(bootstrap.indexOf("v102UnifiedImportSafetyGatePatch")<bootstrap.indexOf("v146UnifiedImportDateBridgePatch"));
  assert.ok(bootstrap.indexOf("v146UnifiedImportDateBridgePatch")<bootstrap.indexOf("v42WhppPatch"));
});

test('V146 browser bridge always sends an ISO report date and keeps import failures visible',()=>{
  syntax('public/v146-unified-import-date-status.js');
  const ui=read('public/v146-unified-import-date-status.js');
  assert.match(ui,/v146-unified-import-date-status-v1/);
  assert.match(ui,/body\.set\('reportDate',target\)/);
  assert.match(ui,/已选择 .*尚未写入数据库/);
  assert.match(ui,/日报导入未完成/);
  assert.match(ui,/数据库仍保留上一份成功日报/);
  assert.match(ui,/response\.clone\(\)\.json/);

  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/v146-unified-import-date-status\.js\?v=20260816-1/);
  assert.match(injector,/v146-unified-import-date-status-v1/);
});
