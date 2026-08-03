import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const isolatedRoot = path.resolve('data/codex_ui_track_crossday/long_json_fixture');
fs.mkdirSync(isolatedRoot, { recursive: true });
process.env.DATA_DIR = isolatedRoot;
process.env.DB_FILE = path.join(isolatedRoot, 'ce_qc_monitor.db');
const { parseLongBackupModules } = await import('../src/backupParser.js');
const { mergeBackupModule } = await import('../src/backupRecovery.js');

const backup = {
  type: 'CE_QC_STANDALONE_BACKUP',
  schemaVersion: 2,
  modules: {
    CCSL: { podLocks: ['CCPOD000001'], carryBills: ['CCCARRY0001'], historySummary: [{ reportDate: '2026-07-18', summary: { metrics: { 今日PNH: 10 } } }] },
    SHOPEE: { podLocks: ['SPEPOD000001'], carryBills: ['SPECARRY001'], historySummary: [{ reportDate: '2026-07-18', summary: { metrics: { 日报总件数: 8 } } }] }
  }
};
const modules = parseLongBackupModules(backup);

const jsonOnlyCcsl = {};
const jsonOnlyShopee = { businessType: 'SHOPEE' };
mergeBackupModule(jsonOnlyCcsl, modules.CCSL, { businessType: 'CCSL', importedAt: Date.now() });
mergeBackupModule(jsonOnlyShopee, modules.SHOPEE, { businessType: 'SHOPEE', importedAt: Date.now() });
assert.equal(jsonOnlyCcsl.reportDate || '', '');
assert.equal(jsonOnlyShopee.reportDate || '', '');
assert.deepEqual(jsonOnlyCcsl.carryBills, ['CCCARRY0001']);
assert.deepEqual(jsonOnlyShopee.carryBills, ['SPECARRY001']);

const dailyThenJson = {
  businessType: 'SHOPEE', reportDate: '2026-07-20', sourceName: 'SHOPEE_2026-07-20.xls', dailyReportReady: true,
  pnhBills: ['SPE260720000001'], currentRun: { runId: 'RUN-CURRENT' }, snapshotId: 'SNAP-CURRENT', carryBills: [], podLocks: []
};
mergeBackupModule(dailyThenJson, modules.SHOPEE, { businessType: 'SHOPEE', importedAt: Date.now() });
assert.equal(dailyThenJson.reportDate, '2026-07-20');
assert.equal(dailyThenJson.currentRun.runId, 'RUN-CURRENT');
assert.equal(dailyThenJson.snapshotId, 'SNAP-CURRENT');
assert.deepEqual(dailyThenJson.pnhBills, ['SPE260720000001']);

const jsonThenDaily = { businessType: 'SHOPEE' };
mergeBackupModule(jsonThenDaily, modules.SHOPEE, { businessType: 'SHOPEE', importedAt: Date.now() });
Object.assign(jsonThenDaily, { reportDate: '2026-07-20', sourceName: 'SHOPEE_2026-07-20.xls', dailyReportReady: true, pnhBills: ['SPE260720000001'] });
assert.equal(jsonThenDaily.reportDate, '2026-07-20');
assert(jsonThenDaily.carryBills.includes('SPECARRY001'));

mergeBackupModule(jsonThenDaily, modules.SHOPEE, { businessType: 'SHOPEE', importedAt: Date.now() });
assert.equal(new Set(jsonThenDaily.carryBills).size, jsonThenDaily.carryBills.length);
assert(!jsonOnlyCcsl.carryBills.includes('SPECARRY001'));
assert(!jsonOnlyShopee.carryBills.includes('CCCARRY0001'));

const result = {
  ok: true,
  tests: {
    jsonOnly: { ccsl: jsonOnlyCcsl.backupSummary, shopee: jsonOnlyShopee.backupSummary, reportDatesUntouched: true },
    dailyThenJson: { reportDate: dailyThenJson.reportDate, runId: dailyThenJson.currentRun.runId, snapshotId: dailyThenJson.snapshotId, dailyBills: dailyThenJson.pnhBills.length },
    jsonThenDaily: { reportDate: jsonThenDaily.reportDate, dailyBills: jsonThenDaily.pnhBills.length, restoredCarry: jsonThenDaily.carryBills },
    duplicateImportIdempotent: true,
    businessIsolation: true
  }
};
const out = path.resolve('data/codex_ui_track_crossday/long_json_order_results.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, reportFile: out }, null, 2));
