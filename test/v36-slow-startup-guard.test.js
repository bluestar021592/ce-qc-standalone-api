import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('protected launcher tolerates slow local initialization', () => {
  const runtime = fs.readFileSync('Start_CE_QC.ps1', 'utf8');
  assert.match(runtime, /Wait-BackendReady\s+\$Backend\s+240/);
  assert.match(runtime, /Backend is still initializing/);
  assert.match(runtime, /Write-BackendInitProgress/);
  assert.match(runtime, /initialization exceeded the safe startup window/);
  assert.match(runtime, /Wait-BackendReady\s+\$Backend\s+120/);
});

test('bootstrap emits phase diagnostics before server becomes reachable', () => {
  const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
  assert.match(bootstrap, /\[CE-QC\]\[BOOT\] START/);
  assert.match(bootstrap, /\[CE-QC\]\[BOOT\] DONE/);
  assert.match(bootstrap, /importPhase\('server', '\.\/server\.js'\)/);
  assert.match(bootstrap, /bootstrap pid=/);
});
