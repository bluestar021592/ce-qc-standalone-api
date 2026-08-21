import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync('next/server.js','utf8');
const db=fs.readFileSync('next/db.js','utf8');
const auth=fs.readFileSync('next/auth.js','utf8');
const store=fs.readFileSync('next/store.js','utf8');
const ui=fs.readFileSync('next/public/index.html','utf8');

test('QC Next is a new entrypoint and does not import the legacy bootstrap patch chain',()=>{
  assert.doesNotMatch(server,/bootstrap\.js|v\d+.*Patch/);
  assert.doesNotMatch(db,/bootstrap\.js|v\d+.*Patch/);
  assert.match(server,/version:'QC-NEXT-1\.0'/);
  assert.match(server,/architecture:'CLEAN_REBUILD'/);
});

test('QC Next splits system and business data databases and never writes legacy business DB',()=>{
  assert.match(db,/ce_qc_next_system\.db/);
  assert.match(db,/ce_qc_next_data\.db/);
  assert.match(db,/new DatabaseSync\(legacyFile,\{readOnly:true\}\)/);
  assert.match(db,/PRAGMA query_only=ON/);
});

test('internal login is direct in 5177 and does not use 5179 handoff',()=>{
  assert.match(auth,/app\.post\('\/api\/auth\/login'/);
  assert.doesNotMatch(auth,/5179|handoffToken|fast-auth\/accept/);
  assert.match(auth,/ce_qc_next_session/);
});

test('all seven businesses including WHPP are first-class in store and navigation',()=>{
  for(const business of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']){
    assert.match(store,new RegExp(`['\"]${business}['\"]`));
    assert.match(ui,new RegExp(business.replace('SHOPEECN','SHOPEE CN').replace('SHOPEEVN','SHOPEE VN')));
  }
  assert.match(ui,/data-board="WHPP"/);
});

test('empty business data cannot block health or internal login',()=>{
  assert.match(server,/dataRequiredForLogin:false/);
  assert.doesNotMatch(server,/seven.*nonzero|dataBlocking|PERSISTED_DATA_PRESENT/i);
});
