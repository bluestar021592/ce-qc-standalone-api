import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storeFile = path.join(root, 'src', 'unifiedImportStore.js');
const serverFile = path.join(root, 'server.js');
const storeSource = fs.readFileSync(storeFile, 'utf8');
const serverSource = fs.readFileSync(serverFile, 'utf8');

test('V552 unified import store remains valid JavaScript', () => {
  const checked = spawnSync(process.execPath, ['--check', storeFile], { cwd: root, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

test('V552 history hydration explicitly disables carryover scans', () => {
  const historyBlock = storeSource.match(/export function listUnifiedImportHistory\([\s\S]*?\n}\n\nfunction hydrateBatch/);
  assert.ok(historyBlock, 'listUnifiedImportHistory block must remain present');
  assert.match(historyBlock[0], /hydrateBatch\(row, false, \{ includeCarryover: false \}\)/);
});

test('V552 hydrateBatch keeps carryover enabled by default for non-history callers', () => {
  assert.match(storeSource, /function hydrateBatch\(row, duplicateFile, \{ includeCarryover = true \} = \{\}\)/);
  assert.match(storeSource, /carryover: includeCarryover \? carryoverSummary\(row\.reportDate\) : null/);
  assert.match(storeSource, /return row \? hydrateBatch\(row, false\) : null/);
  assert.match(storeSource, /const hydrated = hydrateBatch\(previousValid, true\)/);
});

test('V552 preserves write-time and processing-time carryover calculation', () => {
  assert.match(storeSource, /const carryover = carryoverSummary\(parsed\.reportDate\)/);
  assert.match(storeSource, /const summary = carryoverSummary\(batch\.reportDate\)/);
  assert.match(storeSource, /export function carryoverSummary\(reportDate\)/);
});

test('V552 central history fix covers both unified-history and bootstrap callers', () => {
  assert.match(serverSource, /app\.get\('\/api\/unified-history'[\s\S]*?listUnifiedImportHistory\(req\.query\.limit\)/);
  assert.match(serverSource, /app\.get\('\/api\/bootstrap'[\s\S]*?const unifiedHistory = listUnifiedImportHistory\(120\)/);
});
