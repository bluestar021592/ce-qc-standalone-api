import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const uiUrl = new URL('../public/v84-async-export-ui.js', import.meta.url);
const injectorUrl = new URL('../src/v44WhppUiPatch.js', import.meta.url);
const ui = fs.readFileSync(uiUrl, 'utf8');
const injector = fs.readFileSync(injectorUrl, 'utf8');

test('V88 resumable export UI is syntax valid', () => {
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(uiUrl)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test('active background export job is persisted and automatically resumed after page reload', () => {
  assert.match(ui, /ACTIVE_JOB_KEY = 'ce_qc_active_export_job_v88'/);
  assert.match(ui, /localStorage\.setItem\(ACTIVE_JOB_KEY/);
  assert.match(ui, /localStorage\.getItem\(ACTIVE_JOB_KEY/);
  assert.match(ui, /localStorage\.removeItem\(ACTIVE_JOB_KEY/);
  assert.match(ui, /saveActiveJob\(start\.jobId, payload\)/);
  assert.match(ui, /async function resumeActiveJob\(\)/);
  assert.match(ui, /setTimeout\(\(\) => void resumeActiveJob\(\), 80\)/);
  assert.match(ui, /关闭或刷新页面也不会中断任务/);
  assert.match(ui, /重新进入报表页将自动恢复查询/);
  assert.match(injector, /v84-async-export-ui\.js\?v=20260813-3/);
});

test('completed or failed jobs clear the active job pointer without deleting generated files', () => {
  assert.match(ui, /job\.status === 'COMPLETED'/);
  assert.match(ui, /clearActiveJob\(jobId\)/);
  assert.match(ui, /job\.status === 'FAILED'/);
  assert.doesNotMatch(ui, /DELETE FROM|unlink|rmSync|removeFile/i);
});
