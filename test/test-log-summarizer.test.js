import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/Summarize_Test_Log.mjs', import.meta.url);

function runWithLog(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-test-summary-'));
  const log = path.join(dir, 'test.log');
  fs.writeFileSync(log, content, 'utf8');
  const result = spawnSync(process.execPath, [script.pathname, log], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test('summarizer prints tests pass fail for a successful TAP run', () => {
  const result = runWithLog('# tests 12\n# pass 12\n# fail 0\n# duration_ms 100\n');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# tests 12/);
  assert.match(result.stdout, /# pass 12/);
  assert.match(result.stdout, /# fail 0/);
  assert.match(result.stdout, /FAILING TESTS: none/);
});

test('summarizer lists failing test names and exits non-zero', () => {
  const result = runWithLog('not ok 3 - dashboard source truth\n# tests 12\n# pass 11\n# fail 1\n');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAILING TESTS \(1\)/);
  assert.match(result.stdout, /dashboard source truth/);
});
