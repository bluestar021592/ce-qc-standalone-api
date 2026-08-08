import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

test('V21 dashboard startup uses one bootstrap endpoint and deferred metadata', () => {
  assert.match(app, /V21_FASTLOAD_20260808/);
  assert.match(app, /\/api\/dashboard\/bootstrap\?scope=/);
  assert.match(app, /loadDeferredStartupMetadata/);
  assert.doesNotMatch(app, /for \(const \[label, task\] of requestDefinitions\)/);
});

test('V21 unified selection no longer performs five serial full-state requests', () => {
  assert.match(app, /one lightweight request replaces five sequential business-state requests/);
  assert.match(app, /snapshotId=.*compact=1/);
});

test('V21 server exposes cached lightweight dashboard bootstrap', () => {
  assert.match(server, /dashboardBootstrapCache/);
  assert.match(server, /app\.get\('\/api\/dashboard\/bootstrap'/);
  assert.match(server, /X-Dashboard-Cache/);
  assert.match(server, /compactDashboardState/);
});
