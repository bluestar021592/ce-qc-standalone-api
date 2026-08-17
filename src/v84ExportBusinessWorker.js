import fs from 'node:fs';
import path from 'node:path';
import { listCompletedWhppSnapshots } from './v87WhppExportStore.js';
import { createShopeeTemplateWorkbook } from './shopeeTemplateExporter.js';
import { createCompactPeriodBusinessWorkbook } from './v177CompactPeriodExporter.js';
import { createShopeeRefreshedPeriodWorkbook } from './v183ShopeeRefreshedPeriodExporter.js';
import { closeDb, getRuntimeConfig } from './db.js';

const VERSION = '2026-08-17-v183-all-business-shopee-current-status-v1';
const resultFile = path.resolve(String(process.argv[2] || ''));
const type = String(process.argv[3] || '').trim().toUpperCase();
const from = String(process.argv[4] || '').slice(0, 10);
const to = String(process.argv[5] || '').slice(0, 10);
const periodType = String(process.argv[6] || 'custom');
const partIndex = Number(process.argv[7] || 1);
const partCount = Number(process.argv[8] || 1);
const allowed = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']);
const shopee = new Set(['SHOPEECN', 'SHOPEEVN']);

function writeResult(value) { fs.writeFileSync(resultFile, JSON.stringify(value, null, 2), 'utf8'); }

try {
  if (!resultFile || !allowed.has(type)) throw new Error(`不支持的业务板块：${type}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('导出日期范围无效。');
  const range = { from, to, key: `${from}_${to}` };
  if (partCount > 1) throw new Error('V183完整报表禁止对用户输出日期分片；请由主任务按整业务重试。');

  if (type === 'WHPP') {
    const snapshots = listCompletedWhppSnapshots(from, to);
    if (!snapshots.length) writeResult({ ok: true, type, range, rows: 0, files: [], version: VERSION });
    else {
      const result = await createShopeeTemplateWorkbook({ type, periodType, range, snapshots, outputDir: getRuntimeConfig().exportsDir });
      writeResult({ ok: true, type, range, rows: Number(result.audit?.rows || 0), files: [result.file], completeWorkbook: true, version: VERSION });
    }
  } else if (shopee.has(type)) {
    const result = await createShopeeRefreshedPeriodWorkbook({ type, periodType, range, outputDir: getRuntimeConfig().exportsDir });
    writeResult({ ok: true, type, range, rows: Number(result.summary?.total || 0), files: [result.file], summary: result.summary || {}, completeWorkbook: true, version: VERSION });
  } else {
    const result = await createCompactPeriodBusinessWorkbook({ type, periodType, range, outputDir: getRuntimeConfig().exportsDir });
    writeResult({ ok: true, type, range, rows: Number(result.rowCount || 0), files: [result.file], summary: result.summary || {}, completeWorkbook: true, version: VERSION });
  }
} catch (error) {
  writeResult({ ok: false, type, from, to, error: error?.message || String(error), stack: error?.stack || '', version: VERSION });
  process.exitCode = 1;
} finally {
  try { closeDb(); } catch {}
}
