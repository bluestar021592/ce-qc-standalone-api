import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../tools/Apply_V94_SHOPEE_WHPP_SourceTruth_Fix.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('V94 runs focused and full regression before stopping the live 5177 backend', () => {
  const focused = source.indexOf('Running V94 focused deployment gate while current backend stays online');
  const full = source.indexOf('Running complete go-live regression while current backend stays online');
  const stop = source.indexOf('All code-level gates passed. Stopping existing CE QC backend');
  assert.ok(focused >= 0, 'focused deployment gate must exist');
  assert.ok(full > focused, 'complete go-live regression must run after focused tests');
  assert.ok(stop > full, 'live backend must not be stopped until every code-level gate passes');
  assert.match(source, /npm run test:golive/);
});

test('test commands force TAP summaries and V124 purge lifecycle is part of go-live', () => {
  assert.match(pkg.scripts.test, /--test-reporter=tap/);
  assert.match(pkg.scripts['test:golive'], /--test-reporter=tap/);
  assert.match(pkg.scripts['test:golive'], /v107-focused-golive\.test\.js/);
  assert.match(pkg.scripts['test:golive'], /v104-fast-purge-backup\.test\.js/);
  assert.match(pkg.scripts['test:golive'], /data-purge-large-backup\.test\.js/);
});

test('V94 deployment automatically restores the backend if a post-stop audit/start stage aborts', () => {
  assert.match(source, /function Start-CeQcBackendIfNeeded/);
  assert.match(source, /Recovering backend automatically so the live system is not left offline/);
  assert.match(source, /BACKEND_RECOVERED_AFTER_ABORT/);
  assert.match(source, /BACKEND_RECOVERY_FAILED/);
});

test('V94 still takes a database safety copy before post-test deployment/audit work', () => {
  const stop = source.indexOf('All code-level gates passed. Stopping existing CE QC backend');
  const backup = source.indexOf('Creating pre-V94 database safety copy');
  const audit = source.indexOf('Running read-only source-truth audit before restart');
  assert.ok(backup > stop, 'database copy must happen only after code gates pass and writers are stopped');
  assert.ok(audit > backup, 'read-only source-truth audit must run after the safety copy');
});
