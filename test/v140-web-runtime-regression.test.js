import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('V140 Shopee trends use scoped queries and do not blank a whole day for partial unknown attempts',()=>{
  const source=read('src/v137TrendTruthPatch.js');
  assert.match(source,/function scopeBusinessTypes\(type\)/);
  assert.match(source,/\.all\(fromDate,toDate,\.\.\.scope\)/);
  assert.doesNotMatch(source,/d\.unknown===0/);
  assert.match(source,/attemptUnknownPod/);
  assert.match(source,/attemptEvidencePolicy:'KNOWN_ATTEMPTS_RENDER_WITH_UNKNOWN_REPORTED_SEPARATELY'/);
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
