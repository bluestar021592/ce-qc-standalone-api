import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{
  const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  assert.equal(result.status,0,`${file}: ${result.stderr||result.stdout}`);
};

test('V137 WHPP adapter is syntax-valid and exposes the common business-state route',()=>{
  syntax('src/v137WhppUnifiedBusinessStatePatch.js');
  syntax('public/v137-whpp-unified-snapshot-view.js');
  const patch=read('src/v137WhppUnifiedBusinessStatePatch.js');
  assert.match(patch,/\/api\/business-state\/:businessType/);
  assert.match(patch,/\/api\/v132\/whpp-fast-summary/);
  assert.match(patch,/sourceTruth:'NORMALIZED_SQLITE'/);
  assert.match(patch,/business_daily_reports/);
  assert.match(patch,/business_final_rows/);
  assert.match(patch,/business_history_summary/);
  assert.match(patch,/business_export_snapshots/);
  assert.match(patch,/Cache-Control','no-store/);
  assert.doesNotMatch(patch,/const cache=new Map/);
});

test('V137 keeps WHPP business rules but removes independent dashboard-source wording',()=>{
  const ui=read('public/v137-whpp-unified-snapshot-view.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(ui,/数据来自当前业务有效快照/);
  assert.match(ui,/当前业务快照处理中/);
  assert.match(injector,/v137WhppUnifiedBusinessStatePatch\.js/);
  assert.match(injector,/v137-whpp-unified-snapshot-view\.js\?v=20260815-2/);
  assert.ok(injector.indexOf('v132-whpp-seven-business-fast.js')<injector.indexOf('v137-whpp-unified-snapshot-view.js'));
});

test('V137 heading reconciliation is idempotent and cannot self-trigger an endless body observer loop',()=>{
  const ui=read('public/v137-whpp-unified-snapshot-view.js');
  assert.match(ui,/v137-whpp-unified-snapshot-view-v2/);
  assert.match(ui,/if\(node\.textContent!==target\)node\.textContent=target/);
  assert.match(ui,/pageObserver\.observe\(page,\{subtree:true,childList:true,characterData:true\}\)/);
  assert.match(ui,/bootstrapObserver\.observe\(document\.body,\{subtree:true,childList:true\}\)/);
  assert.doesNotMatch(ui,/observer\.observe\(document\.body,\{subtree:true,childList:true,characterData:true\}\)/);
  assert.ok(ui.indexOf('const headingDate=')<ui.indexOf("document.getElementById('reportDate')"));
});
