import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');

test('V237 loopback health requires data plus auth 5179 and export 5178 readiness before HTTP 200',()=>{
  const source=read('src/v232LiveDataHealthGatePatch.js');
  assert.match(source,/V237-5177-5178-5179/);
  assert.match(source,/\/api\/v213\/auth-ping/);
  assert.match(source,/\/api\/v194\/export-ping/);
  assert.match(source,/EXPECTED_AUTH_VERSION='2026-08-19-v226-auth-sidecar-handoff-v2'/);
  assert.match(source,/EXPECTED_EXPORT_REVISION='2026-08-18-v195-ipc-memory-status-v1'/);
  assert.match(source,/EXPECTED_EXPORT_TRANSPORT='IPC_MEMORY_V195'/);
  assert.match(source,/const ready=Boolean\(result\?\.ready&&services\?\.ready\)/);
  assert.match(source,/return res\.status\(ready\?200:503\)\.json\(payload\)/);
  assert.match(source,/startupState:ready\?'APP_AUTH_EXPORT_READY':'STARTUP_TRIPLET_INCOMPLETE'/);
});

test('V237 validates sidecar identity and current app/export ports instead of accepting any listener',()=>{
  const source=read('src/v232LiveDataHealthGatePatch.js');
  assert.match(source,/Number\(authPayload\.port\|\|0\)===AUTH_PORT/);
  assert.match(source,/Number\(authPayload\.appPort\|\|0\)===APP_PORT/);
  assert.match(source,/String\(authPayload\.version\|\|'\'\)===EXPECTED_AUTH_VERSION/);
  assert.match(source,/Boolean\(authProbe\.headers\?\.\['x-ce-qc-auth-sidecar'\]\)/);
  assert.match(source,/Number\(exportPayload\.port\|\|0\)===EXPORT_PORT/);
  assert.match(source,/String\(exportPayload\.revision\|\|'\'\)===EXPECTED_EXPORT_REVISION/);
  assert.match(source,/String\(exportPayload\.statusTransport\|\|'\'\)===EXPECTED_EXPORT_TRANSPORT/);
});

test('V237 preserves the seven-board V232 data gate and adds precise startup diagnostics',()=>{
  const source=read('src/v232LiveDataHealthGatePatch.js');
  for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) assert.match(source,new RegExp(`'${type}'`));
  assert.match(source,/X-CE-QC-Data-Gate','V232-LIVE-PERSISTED-BOARDS/);
  assert.match(source,/V237_STARTUP_GATE_PASS/);
  assert.match(source,/V237_STARTUP_GATE_BLOCK/);
  assert.match(source,/auth=5179:READY/);
  assert.match(source,/export=5178:READY/);
});

test('V237 existing isolated runtime E2E still has to reach HTTP 200 health, so triplet readiness is exercised end-to-end',()=>{
  const runtime=read('scripts/v225-runtime-e2e.mjs');
  assert.match(runtime,/await waitFor\(`\$\{APP_ORIGIN\}\/api\/health`/);
  assert.match(runtime,/accept:r=>r\.status===200/);
  assert.match(runtime,/CE_QC_AUTH_SIDECAR_PORT:String\(AUTH_PORT\)/);
  assert.match(runtime,/CE_QC_EXPORT_SIDECAR_PORT:String\(EXPORT_PORT\)/);
  assert.match(runtime,/V232-LIVE-PERSISTED-BOARDS/);
});
