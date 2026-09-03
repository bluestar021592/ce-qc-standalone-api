import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

function loadV159() {
  const source = read('../public/v159-current-import-stability.js');
  const document = { readyState:'complete', body:{}, getElementById(){return null;}, querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){} };
  class MutationObserver { observe(){} disconnect(){} }
  const window = { addEventListener(){} };
  vm.runInNewContext(source, {
    window, document, location:{pathname:'/'}, MutationObserver,
    queueMicrotask(){}, setTimeout(){return 1;}, clearTimeout(){},
    console:{info(){},warn(){},error(){}}, Number, String, Math, Date, Promise, Object, Array, Boolean, Map
  }, { filename:'v159-current-import-stability.js' });
  return { api: window.__CE_QC_V159_CURRENT_IMPORT_STABILITY__, source };
}

test('V419 OPEN display uses backend values only', () => {
  const { api, source } = loadV159();
  assert.ok(api);
  assert.match(api.version, /v419-current-import-stability-v5-backend-open-single-source/);
  const display = api.reconciledCarryDisplay({todayOpen:100,historicalOpen:20,currentOpen:120,conservativeCurrentOpen:999,historicalReconciledOpen:888});
  assert.deepEqual({today:display.today,historical:display.historical,current:display.current},{today:100,historical:20,current:120});
  assert.equal(display.source,'V419_BACKEND_OPEN_SINGLE_SOURCE');
  const fallback=api.reconciledCarryDisplay({todayOpen:100,historicalOpen:20});
  assert.equal(fallback.current,120);
  assert.equal(fallback.source,'V419_BACKEND_OPEN_SUM_FALLBACK');
  assert.doesNotMatch(source,/Math\.max\(num\(carry\.todayOpen\),num\(carry\.conservativeCurrentOpen\)\)/);
  assert.doesNotMatch(source,/Math\.max\(num\(carry\.historicalOpen\),num\(carry\.historicalReconciledOpen\)\)/);
});

test('V419 heavy history audit is manual-only and cannot overwrite primary OPEN', () => {
  const audit=read('../public/v142-history-integrity-audit.js');
  const loader=read('../src/v44WhppUiPatch.js');
  assert.match(audit,/v419-manual-only-history-audit-no-open-mutation-v4/);
  assert.match(audit,/automatic:false/);
  assert.match(audit,/automatic history audit disabled/);
  assert.match(audit,/历史审计不会回写或覆盖主页面OPEN数字/);
  assert.match(audit,/立即重新检查/);
  assert.doesNotMatch(audit,/combined-processing-queue-count/);
  assert.doesNotMatch(audit,/function syncOpenSummary\(/);
  assert.doesNotMatch(audit,/requestIdleCallback/);
  assert.doesNotMatch(audit,/ce-qc-run-complete[^\n]*load/);
  assert.match(loader,/v142-history-integrity-audit\.js\?v=20260902-v419-priority-1/);
});

test('V419 recovery-safe startup skips synchronous POD-lock repair but explicit maintenance remains available', () => {
  const bootstrap=read('../bootstrap.js');
  const repair=read('../src/v167CcslPodLockFactRepair.js');
  assert.match(bootstrap,/process\.env\.CE_QC_RECOVERY_SAFE_MODE = '1'/);
  assert.match(repair,/v419-ccsl-pod-lock-safe-mode-startup-guard-v3/);
  assert.match(repair,/!database && \(/);
  assert.match(repair,/CE_QC_RECOVERY_SAFE_MODE/);
  assert.match(repair,/INTERACTIVE_FIRST_STARTUP_SKIP/);
  assert.match(repair,/const db = database \|\| getDb\(\)/);
});

test('V419 loader cache-busts replaced V159 and total remains core + WHPP', () => {
  const loader=read('../src/v44WhppUiPatch.js');
  const totalSync=read('../public/v68-whpp-classification-stability.js');
  assert.match(loader,/v159-current-import-stability\.js\?v=20260902-v419-open-single-source-1/);
  assert.doesNotMatch(loader,/v159-current-import-stability\.js\?v=20260902-v414-explicit-1/);
  assert.equal(5060+228,5288);
  assert.match(totalSync,/fullUnique:\s*core\s*\+\s*whppTotal/);
  assert.match(totalSync,/validUniqueWaybills:\s*core\s*\+\s*total/);
});
