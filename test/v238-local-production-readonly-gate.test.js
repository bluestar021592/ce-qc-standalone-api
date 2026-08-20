import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');

test('V238 local production acceptance is read-only, latest-date driven, and checks seven-business + WHPP truth',()=>{
  const source=read('scripts/v238-local-production-readonly-gate.mjs');
  assert.match(source,/new DatabaseSync\(dbFile,\{readOnly:true\}\)/);
  assert.match(source,/PRAGMA query_only=ON/);
  assert.match(source,/CE_QC_First_Day_GoLive_Verify_ReadOnly\.mjs/);
  assert.match(source,/CE_QC_Business_Snapshot_Audit_ReadOnly\.mjs/);
  assert.match(source,/CE_QC_WHPP_Terminal_Authority_Audit_ReadOnly\.mjs/);
  assert.match(source,/CE_QC_V238_LATEST_DATE=/);
  assert.match(source,/CE_QC_V238_DATABASE_UNCHANGED=PASS/);
  assert.match(source,/CE_QC_V238_LOCAL_PRODUCTION_READONLY=PASS/);
  assert.match(source,/CE_QC_V238_LOCAL_PRODUCTION_READONLY=SKIPPED_NO_LOCAL_DB/);
  assert.doesNotMatch(source,/INSERT INTO/);
  assert.doesNotMatch(source,/UPDATE /);
  assert.doesNotMatch(source,/DELETE FROM/);
});

test('V238 final golive gate uses current V223/V226 handoff contracts instead of stale pre-handoff versions',()=>{
  const source=read('scripts/golive-runtime-gate.cjs');
  assert.match(source,/2026-08-19-v223-main-session-handoff-v1/);
  assert.match(source,/2026-08-19-v226-auth-sidecar-handoff-v2/);
  assert.match(source,/\/api\/v223\/fast-auth\/accept/);
  assert.match(source,/V223_AUTH_HANDOFF_OK/);
  assert.match(source,/handoffToken:issued\.token/);
  assert.doesNotMatch(source,/2026-08-19-v213-auth-sidecar-login-v1/);
  assert.doesNotMatch(source,/2026-08-19-v213-auth-sidecar-v1/);
});

test('V238 final golive gate executes the local production audit and keeps V237 startup triplet locked',()=>{
  const source=read('scripts/golive-runtime-gate.cjs');
  assert.match(source,/scripts\/v238-local-production-readonly-gate\.mjs/);
  assert.match(source,/execFileSync\(process\.execPath, \['scripts\/v238-local-production-readonly-gate\.mjs'\]/);
  assert.match(source,/V237-5177-5178-5179/);
  assert.match(source,/\/api\/v213\/auth-ping/);
  assert.match(source,/\/api\/v194\/export-ping/);
});

test('V238 candidate wrapper allows the full V235 matrix time budget instead of killing it at five minutes',()=>{
  const source=read('scripts/v224-persisted-bootstrap-recovery-smoke.cjs');
  assert.match(source,/run\(\['scripts\/v235-final-functional-acceptance\.cjs'\], 480000\)/);
  assert.match(source,/test\/v237-startup-triplet-health\.test\.js/);
});
