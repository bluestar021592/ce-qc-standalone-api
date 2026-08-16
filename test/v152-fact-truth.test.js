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
const whppStatus=read('src/v152WhppTrendStatusPatch.js');
const injector=read('src/v44WhppUiPatch.js');
const bridge=read('public/v152-history-key-bridge.js');
const whppTrend=read('public/v152-whpp-trend.js');

test('V152 fact reader and UI bridges are syntax valid and installed',()=>{
  for(const file of ['src/v152FactTruthPatch.js','src/v152WhppTrendStatusPatch.js','src/v44WhppUiPatch.js','public/v152-history-key-bridge.js','public/v152-whpp-trend.js'])syntax(file);
  assert.match(injector,/import '\.\/v152FactTruthPatch\.js'/);
  assert.match(injector,/import '\.\/v152WhppTrendStatusPatch\.js'/);
  assert.match(injector,/v152-multi-generation-fact-truth-v3/);
  assert.match(injector,/v152-history-key-bridge\.js\?v=20260816-1/);
  assert.match(injector,/v152-whpp-trend\.js\?v=20260816-1/);
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
  assert.match(facts,/body\.factTruth=/);
});

test('V152 trend endpoint supports all seven businesses plus aggregates',()=>{
  assert.match(facts,/path==='\/api\/v27\/trends'/);
  assert.match(facts,/WHPP/);
  assert.match(facts,/CCSL/);
  assert.match(facts,/SHOPEE/);
  assert.match(facts,/V152_MULTI_GENERATION_FACTS/);
  assert.match(whppStatus,/businessType\|\|''\)\.toUpperCase\(\)==='WHPP'/);
  assert.match(whppStatus,/res\.statusCode=200/);
  assert.match(whppTrend,/businessType:'WHPP'/);
  assert.match(whppTrend,/日报票数趋势/);
  assert.match(whppTrend,/POD率趋势/);
  assert.match(whppTrend,/OC率趋势/);
});

test('V152 bridges normalized history keys to the existing chart contracts',()=>{
  assert.match(bridge,/\['今日PNH'\]=total/);
  assert.match(bridge,/\['今日POD'\]=pod/);
  assert.match(bridge,/\['首投POD率'\]=firstRate/);
  assert.match(bridge,/\['OC1\+'\]=ocCount/);
  assert.match(bridge,/`\$\{group\}_今日总单`/);
  assert.match(bridge,/`\$\{group\}_POD率`/);
  assert.match(bridge,/`\$\{group\}_首派成功率`/);
  assert.match(bridge,/global\.renderAll=function v152HistoryAwareRender/);
});

test('V150 exact-current script is loaded after instant navigation so no later six-business fast loader can overwrite it',()=>{
  const nav=injector.indexOf('v109-instant-business-navigation.js');
  const truth=injector.indexOf('v140-current-business-truth.js?v=20260816-4');
  const bridgeIndex=injector.indexOf('v152-history-key-bridge.js');
  assert.ok(nav>=0&&truth>nav,'V150 truth must load after V109 navigation');
  assert.ok(bridgeIndex>truth,'V152 history alias bridge must run after current truth');
});

test('V152 is read-only for historical business facts',()=>{
  assert.doesNotMatch(facts,/DELETE\s+FROM/i);
  assert.doesNotMatch(facts,/DROP\s+TABLE/i);
  assert.doesNotMatch(facts,/UPDATE\s+(?:unified_import|daily_reports|daily_parse_rows|business_daily_reports|business_daily_parse_rows|final_rows|business_final_rows)/i);
  assert.doesNotMatch(facts,/INSERT\s+INTO/i);
});
