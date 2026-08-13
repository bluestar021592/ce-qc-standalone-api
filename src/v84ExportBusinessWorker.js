import fs from 'node:fs';
import path from 'node:path';
import { listLightweightCompletedUnifiedSnapshots } from './lightweightDashboardStore.js';
import { listCompletedWhppSnapshots } from './v87WhppExportStore.js';
import { createShopeeTemplateWorkbook } from './shopeeTemplateExporter.js';
import { closeDb, getRuntimeConfig } from './db.js';

const resultFile = path.resolve(String(process.argv[2] || ''));
const type = String(process.argv[3] || '').trim().toUpperCase();
const from = String(process.argv[4] || '').slice(0, 10);
const to = String(process.argv[5] || '').slice(0, 10);
const periodType = String(process.argv[6] || 'custom');
const partIndex = Number(process.argv[7] || 1);
const partCount = Number(process.argv[8] || 1);
const allowed = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']);

function writeResult(value) {
  fs.writeFileSync(resultFile, JSON.stringify(value, null, 2), 'utf8');
}

try {
  if (!resultFile || !allowed.has(type)) throw new Error(`不支持的业务板块：${type}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('导出日期范围无效。');
  const range = { from, to, key: partCount > 1 ? `${from}_${to}_PART${partIndex}` : `${from}_${to}` };
  const snapshots = type === 'WHPP'
    ? listCompletedWhppSnapshots(from, to)
    : listLightweightCompletedUnifiedSnapshots(from, to, [type]);
  if (!snapshots.length) {
    writeResult({ ok: true, type, range, rows: 0, files: [] });
  } else {
    const result = await createShopeeTemplateWorkbook({ type, periodType, range, snapshots, outputDir: getRuntimeConfig().exportsDir });
    writeResult({ ok: true, type, range, rows: Number(result.audit?.rows || 0), files: [result.file] });
  }
} catch (error) {
  writeResult({ ok: false, type, from, to, error: error?.message || String(error), stack: error?.stack || '' });
  process.exitCode = 1;
} finally {
  try { closeDb(); } catch {}
}
