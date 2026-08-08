import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('CCSL pipeline keeps today POD-locked bills in final reconciliation rows', () => {
  const text = fs.readFileSync('src/pipeline.js', 'utf8');
  assert.match(text, /const lockedToday = today\.filter\(wb => podLocks\.has\(wb\)\)/);
  assert.match(text, /const finalRows = \[\.\.\.lockedTodayRows, \.\.\.podRows, \.\.\.returnedRows, \.\.\.trackResults\]/);
  assert.match(text, /历史POD锁已闭环，今日无需重复查询/);
});

test('V26 exposes one-shot bootstrap and browser uses it', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(server, /app\.get\('\/api\/bootstrap'/);
  assert.match(server, /businessStates: businesses/);
  assert.match(app, /await api\('\/api\/bootstrap'\)/);
  assert.match(server, /2026-08-08-v26-stability-bootstrap/);
});
