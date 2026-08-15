import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('V142 Shopee trends use scoped queries, persisted attempt columns and real track-event fallback',()=>{
  const source=read('src/v137TrendTruthPatch.js');
  assert.match(source,/function scopeBusinessTypes\(type\)/);
  assert.match(source,/bf\.podAttemptNo/);
  assert.match(source,/bf\.currentAttemptNo/);
  assert.match(source,/persistedPodAttempt/);
  assert.match(source,/business_track_events/);
  assert.match(source,/eventCode,''\) AS TEXT\)='30'/);
  assert.match(source,/delivery assign/);
  assert.match(source,/out for delivery/);
  assert.match(source,/trackAttemptCount/);
  assert.doesNotMatch(source,/d\.unknown===0/);
  assert.match(source,/attemptUnknownPod/);
  assert.match(source,/attemptEvidencePolicy:'PERSISTED_ATTEMPT_THEN_RAW_THEN_TRACK_EVENTS_THEN_POD_DATE'/);
});

test('V142 selected imported day is auto-finalized only from two valid completed child snapshots',()=>{
  const source=read('src/v142UnifiedSnapshotRepairPatch.js');
  assert.match(source,/latestCcslSnapshot/);
  assert.match(source,/latestShopeeSnapshot/);
  assert.match(source,/COALESCE\(status,'VALID'\)='VALID'/);
  assert.match(source,/COALESCE\(reconciliationStatus,'COMPLETED'\)='COMPLETED'/);
  assert.match(source,/completeUnifiedSnapshot/);
  assert.match(source,/WAITING_FOR_CHILD_SNAPSHOTS/);
  assert.doesNotMatch(source,/SET status='COMPLETED'/);
});

test('V142 lifecycle UI distinguishes not imported, processing and reconciliation failure',()=>{
  const source=read('public/v137-range-trends.js');
  assert.match(source,/requestedDateAvailable===false/);
  assert.match(source,/尚未导入日报/);
  assert.match(source,/日报已导入，正在等待处理完成/);
  assert.match(source,/一致性检查未通过/);
  assert.match(source,/data-v141-hidden-for-no-data/);
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
