import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('V141 Shopee trends use scoped queries, direct attempt columns and partial evidence',()=>{
  const source=read('src/v137TrendTruthPatch.js');
  assert.match(source,/function scopeBusinessTypes\(type\)/);
  assert.match(source,/\.all\(fromDate,toDate,\.\.\.scope\)/);
  assert.match(source,/bf\.podAttemptNo/);
  assert.match(source,/bf\.currentAttemptNo/);
  assert.match(source,/persistedPodAttempt/);
  assert.doesNotMatch(source,/d\.unknown===0/);
  assert.match(source,/attemptUnknownPod/);
  assert.match(source,/attemptEvidencePolicy:'PERSISTED_ATTEMPT_COLUMNS_THEN_JSON_THEN_POD_DATE'/);
});

test('V141 legacy V27 trend calls bridge to V137 instead of returning retired JSON errors',()=>{
  const source=read('public/v139-normal-web-runtime.js');
  assert.match(source,/url\.pathname==='\/api\/v27\/trends'/);
  assert.match(source,/url\.pathname='\/api\/v137\/trends'/);
  assert.doesNotMatch(source,/JSON\.stringify\(\{ok:false,retired:true/);
  assert.match(source,/v141-canonical-trends-only/);
});

test('V141 legacy V56 trend observer is fully retired',()=>{
  const source=read('public/v56-trend-truth.js');
  assert.match(source,/retired:true/);
  assert.match(source,/replacement:'V137_RANGE_TRENDS'/);
  assert.doesNotMatch(source,/fetch\(`\/api\/v27\/trends/);
  assert.doesNotMatch(source,/new MutationObserver/);
});

test('V141 selected day without completed snapshot is not presented as truthful zero data',()=>{
  const source=read('public/v137-range-trends.js');
  assert.match(source,/requestedDateAvailable===false/);
  assert.match(source,/没有 VALID \+ COMPLETED 的有效日报快照/);
  assert.match(source,/data-v141-hidden-for-no-data/);
});

test('V140 WHPP import display never derives WHPP as the remainder of six businesses',()=>{
  const source=read('public/v68-whpp-classification-stability.js');
  assert.match(source,/CANONICAL_COUNTS/);
  assert.match(source,/classificationCounts/);
  assert.doesNotMatch(source,/rawUnique\s*-\s*core/);
  assert.doesNotMatch(source,/rawUnique\s*-\s*coreCount/);
});

test('V140 canonical classification sync queues a fresh read instead of dropping an import-time refresh',()=>{
  const source=read('public/v94-business-source-truth-ui-v2.js');
  assert.match(source,/let pendingSync = false/);
  assert.match(source,/pendingSync = true/);
  assert.match(source,/ce-qc-canonical-classification-ready/);
  assert.match(source,/_=\$\{Date\.now\(\)\}/);
});

test('V140 range terminal overlay uses one JSON-set query on normal SQLite builds',()=>{
  const source=read('src/rangeDashboardStoreV136TerminalOverlay.js');
  assert.match(source,/json_each\(\?\)/);
  assert.match(source,/LATEST_TERMINAL_V140_SINGLE_QUERY/);
  assert.match(source,/loadTerminalAuthorityFast/);
  assert.match(source,/loadTerminalAuthorityFallback/);
});
