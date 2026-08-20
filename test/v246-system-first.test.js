import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('src/v246CoreAvailabilityPatch.js','utf8');
const client=fs.readFileSync('public/v246-core-usability.js','utf8');
const cold=fs.readFileSync('src/v46ColdStartIndexPatch.js','utf8');
const localTruth=fs.readFileSync('scripts/v225-local-db-truth-smoke.mjs','utf8');
const seven=fs.readFileSync('scripts/v233-seven-board-local-truth-smoke.mjs','utf8');
const production=fs.readFileSync('scripts/v238-local-production-readonly-gate.mjs','utf8');
const purge=fs.readFileSync('src/dataPurge.js','utf8');
const restartE2E=fs.readFileSync('scripts/v234-restart-persistence-e2e.mjs','utf8');

test('V246 startup is service-first: business data can be empty or partial without blocking 5177',()=>{
  assert.match(cold,/v246CoreAvailabilityPatch\.js/);
  assert.match(core,/const ready=Boolean\(services\?\.ready\)/);
  assert.doesNotMatch(core,/result\?\.ready&&services\?\.ready/);
  assert.match(core,/dataState:'NOT_REQUIRED_FOR_STARTUP'/);
  assert.match(core,/dataBlocking:false/);
  assert.match(core,/V246-DATA-DIAGNOSTIC-ONLY/);
  assert.match(core,/V246-CORE-SERVICES-FIRST/);
  assert.match(localTruth,/dataState=\$\{dataState\}/);
  assert.doesNotMatch(localTruth,/refusing update/);
});

test('V246 internal account login stays same-origin and never requires the browser to call port 5179 directly',()=>{
  assert.match(core,/AUTH_PROXY_PATH='\/api\/v246\/internal-auth\/login'/);
  assert.match(core,/http:\/\/127\.0\.0\.1:\$\{AUTH_PORT\}\/api\/v213\/local-auth\/login/);
  assert.match(core,/signForChannel\(sidecarPayload,channel\)/);
  assert.match(core,/\/api\/v223\/fast-auth\/accept/);
  assert.match(core,/同源认证，不再要求浏览器直接连接5179端口/);
});

test('V246 CE API login has immediate visible feedback and a bounded timeout',()=>{
  assert.match(core,/CE API登录超过10秒未响应/);
  assert.match(core,/Promise\.race\(\[original\.apply\(this,args\),timeout\]\)/);
  assert.match(client,/正在登录CE系统/);
  assert.match(client,/正在连接 CE API，最长等待10秒/);
  assert.match(client,/setTimeout\(\(\)=>controller\.abort\(\),12_000\)/);
  assert.match(client,/CE API 登录成功/);
});

test('V246 WHPP refresh is authoritative, bounded, and does not depend on one stale daily-report date',()=>{
  assert.match(core,/latestWhppDate/);
  assert.match(core,/business_final_rows/);
  assert.match(core,/business_daily_parse_rows/);
  assert.match(core,/business_daily_reports/);
  assert.match(core,/this\.get\('\/api\/v132\/whpp-fast-summary',v246WhppSummary\)/);
  assert.match(client,/\/api\/v132\/whpp-fast-summary/);
  assert.match(client,/setTimeout\(\(\)=>controller\.abort\(\),7000\)/);
});

test('V246 treats existing operational data as diagnostic while preserving strict read-only database access',()=>{
  assert.match(seven,/CE_QC_CANONICAL_MEMBERSHIP=AUDIT_COMPLETE_READ_ONLY/);
  assert.match(seven,/software availability is not blocked/);
  assert.match(production,/DatabaseSync\(dbFile,\{readOnly:true\}\)/);
  assert.match(production,/PRAGMA query_only=ON/);
  assert.match(production,/WARNING_REIMPORT_ALLOWED/);
  assert.match(production,/CE_QC_V238_LOCAL_PRODUCTION_READONLY=PASS/);
});

test('V246 clean reset boundary preserves accounts/configuration instead of deleting the ability to log in',()=>{
  assert.match(purge,/retainedScope/);
  assert.match(purge,/用户、角色与系统设置/);
  assert.match(purge,/最新门店白名单/);
  assert.match(purge,/审计日志/);
  assert.doesNotMatch(core,/DELETE FROM users/i);
});

test('V247 restart E2E cannot regress to the obsolete V232 data-blocking health contract',()=>{
  assert.match(restartE2E,/V246-DATA-DIAGNOSTIC-ONLY/);
  assert.match(restartE2E,/V246-CORE-SERVICES-FIRST/);
  assert.match(restartE2E,/CORE_SERVICES_READY/);
  assert.match(restartE2E,/NOT_REQUIRED_FOR_STARTUP/);
  assert.match(restartE2E,/\/api\/v246\/internal-auth\/login/);
  assert.match(restartE2E,/V246_SAME_ORIGIN_AUTH_PROXY/);
  assert.doesNotMatch(restartE2E,/healthResponse\.headers\.get\('x-ce-qc-data-gate'\)!=='V232-LIVE-PERSISTED-BOARDS'/);
  assert.doesNotMatch(restartE2E,/health\?\.dataState!=='PERSISTED_BOARDS_READY'/);
});
