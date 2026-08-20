import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { __test as healthTest } from '../src/v232LiveDataHealthGatePatch.js';

const read=file=>fs.readFileSync(file,'utf8');

test('V247 effective loopback health is service-first: 5179 auth plus 5178 export readiness before HTTP 200, business data diagnostic-only',()=>{
  const core=read('src/v246CoreAvailabilityPatch.js');
  assert.match(core,/V246-CORE-SERVICES-FIRST/);
  assert.match(core,/V246-DATA-DIAGNOSTIC-ONLY/);
  assert.match(core,/const ready=Boolean\(services\?\.ready\)/);
  assert.match(core,/startupState:ready\?'CORE_SERVICES_READY':'CORE_SERVICES_INCOMPLETE'/);
  assert.match(core,/dataState:'NOT_REQUIRED_FOR_STARTUP'/);
  assert.match(core,/dataBlocking:false/);
  assert.match(core,/return res\.status\(ready\?200:503\)\.json\(payload\)/);
});

test('V247 still validates exact auth/export sidecar identity rather than accepting arbitrary listeners',()=>{
  const source=read('src/v232LiveDataHealthGatePatch.js');
  assert.match(source,/Number\(authPayload\.port\|\|0\)===AUTH_PORT/);
  assert.match(source,/Number\(authPayload\.appPort\|\|0\)===APP_PORT/);
  assert.match(source,/String\(authPayload\.version\|\|'\'\)===EXPECTED_AUTH_VERSION/);
  assert.match(source,/Boolean\(authProbe\.headers\?\.\['x-ce-qc-auth-sidecar'\]\)/);
  assert.match(source,/Number\(exportPayload\.port\|\|0\)===EXPORT_PORT/);
  assert.match(source,/String\(exportPayload\.revision\|\|'\'\)===EXPECTED_EXPORT_REVISION/);
  assert.match(source,/String\(exportPayload\.statusTransport\|\|'\'\)===EXPECTED_EXPORT_TRANSPORT/);
});

test('V247 keeps V232/V245 persisted seven-board logic as a diagnostic source without letting it own browser availability',()=>{
  const source=read('src/v232LiveDataHealthGatePatch.js');
  const core=read('src/v246CoreAvailabilityPatch.js');
  for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) assert.match(source,new RegExp(`'${type}'`));
  assert.match(source,/V232-LIVE-PERSISTED-BOARDS/);
  assert.match(source,/V245_STARTUP_GATE_PASS/);
  assert.match(source,/V245_STARTUP_GATE_BLOCK/);
  assert.match(core,/startupServiceProbe\.inspectStartupServices\(\)/);
  assert.doesNotMatch(core,/result\?\.ready&&services\?\.ready/);
});

test('V247 restart E2E exercises effective V246 health plus same-origin login end-to-end',()=>{
  const runtime=read('scripts/v234-restart-persistence-e2e.mjs');
  assert.match(runtime,/await waitFor\(`\$\{APP_ORIGIN\}\/api\/health`/);
  assert.match(runtime,/accept:r=>r\.status===200/);
  assert.match(runtime,/V246-DATA-DIAGNOSTIC-ONLY/);
  assert.match(runtime,/V246-CORE-SERVICES-FIRST/);
  assert.match(runtime,/\/api\/v246\/internal-auth\/login/);
  assert.match(runtime,/V246_SAME_ORIGIN_AUTH_PROXY/);
  assert.match(runtime,/\/api\/v223\/fast-auth\/accept/);
});

test('V245 diagnostic membership recovery still resolves generic persisted Shopee CN/VN rows by recipient_group',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`
      CREATE TABLE business_final_rows(
        businessType TEXT,
        shipmentCode TEXT,
        reportDate TEXT,
        recipient_group TEXT
      );
      INSERT INTO business_final_rows VALUES
        ('SHOPEE','CN-1','2026-08-17','CN'),
        ('SHOPEE','CN-2','2026-08-17','CN'),
        ('SHOPEE','VN-1','2026-08-17','VN'),
        ('SHOPEE','VN-2','2026-08-17','VN'),
        ('SHOPEE','VN-3','2026-08-17','VN'),
        ('WHPP','W-1','2026-08-17','OTHER');
    `);
    const counts=healthTest.emptyCounts();
    counts.SHOPEEVN=1;
    healthTest.lightweightFallbackCounts(db,'2026-08-17',counts);
    assert.equal(counts.SHOPEECN,2);
    assert.equal(counts.SHOPEEVN,3);
    assert.equal(counts.WHPP,1);
  }finally{db.close();}
});
