import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runQcPipeline } from '../src/pipeline.js';


test('CCSL daily POD lock is preserved in finalRows without API call', async () => {
  let apiCalls = 0;
  const client = {
    async confirmQuery() { apiCalls += 1; throw new Error('confirmQuery must not run for POD lock'); },
    async trackQuery() { apiCalls += 1; throw new Error('trackQuery must not run for POD lock'); }
  };
  const state = {
    businessType: 'CCSL',
    reportDate: '2026-07-29',
    dailyReportReady: true,
    pnhBills: ['TESTLOCK001'],
    dailyParseRows: [{ shipmentCode: 'TESTLOCK001', 运单号: 'TESTLOCK001', result: 'PNH' }],
    carryBills: [],
    podLocks: ['TESTLOCK001'],
    scanResults: [],
    trackResults: [],
    trackEvents: [],
    finalRows: [],
    processing: { running: false, paused: false, phase: '' },
    currentRun: { runId: 'v26-test-run' },
    lastRunSummary: { runId: 'v26-test-run' }
  };
  const result = await runQcPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false });
  assert.equal(apiCalls, 0);
  assert.equal(result.state.finalRows.length, 1);
  assert.equal(result.state.finalRows[0].运单号, 'TESTLOCK001');
  assert.equal(result.state.finalRows[0].是否POD, '是');
  assert.equal(result.state.finalRows[0].primaryCategory, 'POD闭环');
});


test('V26 source contains lightweight checkpoint and bounded startup protections', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const store = fs.readFileSync(new URL('../src/businessStore.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /shouldPersistFullCheckpoint/);
  assert.match(server, /persistRunCheckpointOnly/);
  assert.doesNotMatch(server, /isPaused:\s*async \(\) => Boolean\(loadBusinessState\(SHOPEE\)/);
  assert.match(store, /saveBusinessRuntimeState/);
  assert.match(store, /json_extract\(valueJson,'\$\.reportDate'\)/);
  assert.match(app, /runStartupRequestPool/);
  assert.match(app, /retryMode:\s*reconciliationFailed \? 'restart'/);
});
