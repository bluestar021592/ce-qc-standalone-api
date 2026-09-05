import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const accessPath = process.env.V431_ACCESS_FILE || 'src/accessControl.js';
const sidecarPath = process.env.V431_SIDECAR_FILE || 'src/localAuthSidecar.js';
const access = fs.readFileSync(accessPath, 'utf8');
const sidecar = fs.readFileSync(sidecarPath, 'utf8');

execFileSync(process.execPath, ['--check', accessPath], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', sidecarPath], { stdio: 'inherit' });

assert.match(access, /V431_LOCAL_AUTH_SIDECAR_ID = '2026-09-05-v431-readonly-local-auth-sidecar-v1'/);
assert.match(sidecar, /V431_LOCAL_AUTH_SIDECAR_ID = '2026-09-05-v431-readonly-local-auth-sidecar-v1'/);
assert.match(sidecar, /new DatabaseSync\(file, \{ readOnly: true \}\)/);
assert.match(sidecar, /PRAGMA query_only=ON/);
assert.match(sidecar, /PRAGMA busy_timeout=800/);
assert.doesNotMatch(sidecar, /INSERT\s+INTO\s+(?:users|user_sessions|audit_logs)/i);
assert.doesNotMatch(sidecar, /UPDATE\s+(?:users|user_sessions|audit_logs)/i);
assert.doesNotMatch(sidecar, /DELETE\s+FROM\s+(?:users|user_sessions|audit_logs)/i);
assert.match(sidecar, /\/api\/local-auth\/health/);
assert.match(sidecar, /\/api\/local-auth\/login/);
assert.match(sidecar, /res\.writeHead\(303/);
assert.match(sidecar, /LOGIN_LIMIT = 5/);
assert.match(sidecar, /LOCK_MS = 15 \* 60_000/);

const fastRead = access.indexOf('let user = readLocalAuthSession(req, channel);');
const legacyRead = access.indexOf('user = readSession(req, channel, cloudflareEmail);');
assert.ok(fastRead >= 0 && legacyRead > fastRead, 'local signed session must be checked before the primary SQLite session path');
assert.match(access, /new URL\('\.\/localAuthSidecar\.js', import\.meta\.url\)/);
assert.match(access, /NODE_ENV \|\| ''\)\.toLowerCase\(\) === 'test'/);
assert.match(access, /AUTH_SIDECAR_PORT[^\n]*5179/);
assert.match(access, /http:\/\/[\s\S]*\/api\/local-auth\/login/);
assert.match(access, /new AbortController\(\)/);
assert.match(access, /,8000\)|, 8000\)/);
assert.match(access, /'\/api\/internal-auth\/login'/, 'public/main auth fallback must remain available');
assert.match(access, /V430_INTERNAL_LOGIN_FALLBACK_ID/, 'V430 native-form compatibility marker must remain');
assert.match(access, /独立登录通道 5179/);
assert.doesNotMatch(sidecar, /unified_import|business_final|shipment_current|confirm-query|tracking-events/i, 'auth sidecar must not touch business facts');

console.log('[V431 AUTH CONTRACT] PASS readonly 5179 credential verification + signed local session + 8s fail-visible login; business data paths untouched');
