import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('permanent user deletion is restricted to previously deleted users', () => {
  assert.match(serverSource, /app\.delete\('\/api\/admin\/users\/:id\/permanent'/);
  assert.match(serverSource, /SELECT \* FROM users WHERE id=\? AND status='DELETED'/);
  assert.match(serverSource, /DELETE FROM user_sessions WHERE userId=\?/);
  assert.match(serverSource, /DELETE FROM users WHERE id=\? AND status='DELETED'/);
  assert.match(serverSource, /USER_PERMANENTLY_DELETED/);
});

test('account switching revokes the current internal session without fixed origins', () => {
  assert.match(appSource, /async function switchInternalAccount\(\)/);
  assert.match(appSource, /api\('\/api\/internal-auth\/logout'/);
  assert.doesNotMatch(appSource.match(/async function switchInternalAccount[\s\S]*?\n}/)?.[0] || '', /localhost|127\.0\.0\.1/);
});

test('user management uses a full-width non-scrolling compact table', () => {
  assert.match(cssSource, /#userManagementPanel\s*\{\s*grid-column:\s*1 \/ -1;/);
  assert.match(cssSource, /\.user-table\s*\{[^}]*table-layout:\s*fixed;/);
  assert.match(cssSource, /#userManagementPanel \.preview-table-wrap\s*\{[^}]*overflow-x:\s*hidden;/);
});
