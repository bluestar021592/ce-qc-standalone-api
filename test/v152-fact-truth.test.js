import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(result.status,0,`${file}: ${result.stderr||result.stdout}`);};

const facts=read('src/v152FactTruthPatch.js');
const injector=read('src/v44WhppUiPatch.js');

test('V152 fact reader is syntax valid and installed before server routes register',()=>{
  syntax('src/v152FactTruthPatch.js');
  syntax('src/v44WhppUiPatch.js');
  assert.match(injector,/import '\.\/v152FactTruthPatch\.js'/);
  assert.match(injector,/v152-multi-generation-fact-truth-v1/);
});

test('V152 reads every persisted generation instead of treating legacy history as zero',()=>{
  assert.match(facts,/UNIFIED_IMPORT_ROWS/);
  assert.match(facts,/SHIPMENT_DAILY_SNAPSHOTS/);
  assert.match(facts,/LEGACY_DAILY_ROWS/);
  assert.match(facts,/FROM daily_reports/);
  assert.match(facts,/FROM daily_parse_rows/);
  assert.match(facts,/FROM business_daily_reports/);
  assert.match(facts,/FROM business_daily_parse_rows/);
  assert.match(facts,/business_history_summary/);
  assert.match(facts,/businessType='WHPP'/);
});

test('V152 repairs bootstrap and exact business reads rather than allowing empty fast-cache boards',()=>{
  assert.match(facts,/path==='\/api\/bootstrap'/);
  assert.match(facts,/path==='\/api\/business-state\/:businessType'/);
  assert.match(facts,/repairBootstrap/);
  assert.match(facts,/repairBusinessResponse/);
  assert.match(facts,/authoritativeRawState/);
  assert.match(facts,/loadLightweightUnifiedBusinessState/);
  assert.match(facts,/factTruth=/);
});

test('V152 trend endpoint supports all seven businesses plus aggregates',()=>{
  assert.match(facts,/path==='\/api\/v27\/trends'/);
  assert.match(facts,/WHPP/);
  assert.match(facts,/CCSL/);
  assert.match(facts,/SHOPEE/);
  assert.match(facts,/V152_MULTI_GENERATION_FACTS/);
});

test('V150 exact-current script is loaded after instant navigation so no later fast loader can overwrite it',()=>{
  const nav=injector.indexOf('v109-instant-business-navigation.js');
  const truth=injector.indexOf('v140-current-business-truth.js?v=20260816-4');
  const whpp=injector.indexOf('v132-whpp-seven-business-fast.js');
  assert.ok(nav>=0&&truth>nav,'V150 truth must load after V109 navigation');
  assert.ok(whpp>truth,'WHPP-only scripts may load later but six-business truth must follow V109');
});

test('V152 is read-only for historical business facts',()=>{
  assert.doesNotMatch(facts,/DELETE\s+FROM/i);
  assert.doesNotMatch(facts,/DROP\s+TABLE/i);
  assert.doesNotMatch(facts,/UPDATE\s+(?:unified_import|daily_reports|daily_parse_rows|business_daily_reports|business_daily_parse_rows|final_rows|business_final_rows)/i);
  assert.doesNotMatch(facts,/INSERT\s+INTO/i);
});
