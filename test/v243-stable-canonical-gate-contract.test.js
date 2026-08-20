import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const localTruth=fs.readFileSync(new URL('../scripts/v233-seven-board-local-truth-smoke.mjs',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v224-persisted-bootstrap-recovery-smoke.cjs',import.meta.url),'utf8');

test('V243 local seven-board truth emits a stable unversioned canonical acceptance marker',()=>{
  assert.match(localTruth,/CE_QC_CANONICAL_MEMBERSHIP=PASS_READ_ONLY/);
  assert.match(localTruth,/CE_QC_V242_CANONICAL_MEMBERSHIP=PASS_READ_ONLY/);
});

test('V243 candidate gate consumes the stable canonical marker instead of a brittle version-only marker',()=>{
  assert.match(gate,/must\(localSevenBoard, 'CE_QC_CANONICAL_MEMBERSHIP=PASS_READ_ONLY'\)/);
  assert.doesNotMatch(gate,/must\(localSevenBoard, 'CE_QC_V241_CANONICAL_MEMBERSHIP=PASS_READ_ONLY'\)/);
  assert.match(gate,/persistedFinalSupplementCount/);
  assert.match(gate,/sourceMode/);
});
