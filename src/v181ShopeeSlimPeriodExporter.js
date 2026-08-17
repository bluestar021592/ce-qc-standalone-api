import path from 'node:path';
import ExcelJS from 'exceljs';
import { getDb } from './db.js';

const VERSION = '2026-08-17-v181-shopee-slim-period-export-v1';
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const FONT_NAME = 'Microsoft YaHei';

function dateKey(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}
function dayNumber(value = '') {
  const key = dateKey(value);
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function naturalDays(from, to) {
  const a = dayNumber(from), b = dayNumber(to);
  if (a === null || b === null || b < a) return '';
  return Math.floor((b - a) / 86400000) + 1;
}
function rate(a, b) { return b ? Number((Number(a || 0) * 100 / Number(b)).toFixed(2)) : 0; }
function avg(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(2)) : 0;
}
function safeFileName(value = '') { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }
function displayType(type) { return type === 'SHOPEECN' ? 'SHOPEE CN' : type === 'SHOPEEVN' ? 'SHOPEE VN' : type; }
function periodLabel(periodType = 'custom') { return ({ daily: '日报', weekly: '周报', monthly: '月报', custom: '自定义日期' })[periodType] || '区间报表'; }
function iter(statement, ...params) {
  if (typeof statement.iterate === 'function') return statement.iterate(...params);
  return statement.all(...params);
}
function tableColumns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name || ''))); }
  catch { return new Set(); }
}
function quoted(name) { return `"${String(name).replaceAll('"', '""')}"`; }
function optionalSelect(columns, alias, name) {
  return columns.has(name) ? `${alias}.${quoted(name)} AS ${quoted(name)}` : `NULL AS ${quoted(name)}`;
}
function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}
function regionOf(row = {}) {
  const raw = String(firstValue(row, ['region_code', 'regionCode']) || '').trim().toUpperCase();
  if (raw === 'PP' || /PHNOM\s*PENH|金边/.test(raw)) return 'PP';
  if (raw === 'PV' || /外省/.test(raw)) return 'PV';
  return raw;
}
function returned(row = {}) {
  const text = String(firstValue(row, ['currentMainCategory', 'primaryCategory', 'category', 'currentStatus']) || '').toUpperCase();
  return /RETURN|退回|退件/.test(text);
}
function latestCompletedBatches(db, from, to) {
  const rows = db.prepare(`
    SELECT b.snapshotId,b.reportDate,b.createdAt
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ?
    ORDER BY b.reportDate ASC,b.createdAt DESC
  `).all(from, to);
  const byDate = new Map();
  for (const row of rows) if (row.reportDate && !byDate.has(row.reportDate)) byDate.set(row.reportDate, row);
  return [...byDate.values()];
}
function blankEntry(code, reportDate) {
  return {
    shipmentCode: code,
    firstReportDate: reportDate,
    lastReportDate: reportDate,
    region: '',
    recipient: '',
    sourceRowNumber: 0,
    pod: false,
    podSnapshotDate: '',
    podTime: '',
    podDate: '',
    podTimeSource: '',
    deliveryNaturalDays: '',
    podAttemptNo: 0,
    currentAttemptNo: 0,
    currentStatus: '未闭环',
    latestEventTime: '',
    latestNode: '',
    shopCode: '',
    shopName: ''
  };
}
function ensureEntry(entries, code, reportDate) {
  const bill = String(code || '').trim().toUpperCase();
  if (!bill) return null;
  if (!entries.has(bill)) entries.set(bill, blankEntry(bill, reportDate));
  const entry = entries.get(bill);
  if (!entry.firstReportDate || reportDate < entry.firstReportDate) entry.firstReportDate = reportDate;
  if (!entry.lastReportDate || reportDate > entry.lastReportDate) entry.lastReportDate = reportDate;
  return entry;
}
function markPod(entry, reportDate) {
  if (!entry) return;
  entry.pod = true;
  if (!entry.podSnapshotDate || reportDate < entry.podSnapshotDate) entry.podSnapshotDate = reportDate;
}
function updateLatest(entry, row, reportDate) {
  if (!entry || reportDate < entry.lastReportDate) return;
  entry.region = regionOf(row) || entry.region;
  entry.recipient = String(firstValue(row, ['recipient_normalized', 'recipientNormalized', 'recipient_raw', 'recipientRaw']) || entry.recipient || '');
  entry.sourceRowNumber = Number(firstValue(row, ['source_row_number', 'rowNumber']) || entry.sourceRowNumber || 0);
  entry.currentStatus = String(firstValue(row, ['currentMainCategory', 'primaryCategory', 'category']) || (Number(row.isPod || 0) === 1 ? 'POD' : entry.currentStatus || '未闭环'));
  entry.latestEventTime = String(firstValue(row, ['lastEventTime', 'latestEventTime']) || entry.latestEventTime || '');
  entry.latestNode = String(firstValue(row, ['lastEventDesc', 'lastEvent', 'latestEventDesc']) || entry.latestNode || '');
  entry.shopCode = String(firstValue(row, ['currentShopCode', 'targetShopCode']) || entry.shopCode || '');
  entry.shopName = String(firstValue(row, ['shopName']) || entry.shopName || '');
  entry.podAttemptNo = Math.max(Number(entry.podAttemptNo || 0), Number(row.podAttemptNo || 0));
  entry.currentAttemptNo = Math.max(Number(entry.currentAttemptNo || 0), Number(row.currentAttemptNo || 0));
  if (Number(row.isPod || 0) === 1) markPod(entry, reportDate);
}
function loadNormalizedRange(db, businessType, batches, onProgress = () => {}) {
  const entries = new Map();
  const finalCols = tableColumns(db, 'business_final_rows');
  const wantedFinal = [
    'isPod','currentMainCategory','primaryCategory','category','lastEventTime','lastEventDesc','lastEvent',
    'podAttemptNo','currentAttemptNo','firstAttemptAt','currentShopCode','targetShopCode','shopName',
    'region_code','recipient_raw','recipient_normalized','source_row_number'
  ];
  const finalSelect = wantedFinal.map(name => optionalSelect(finalCols, 'f', name)).join(',\n        ');
  const dailyStmt = db.prepare(`
    SELECT shipmentCode,regionCode,recipientRaw,recipientNormalized,rowNumber
    FROM unified_import_rows
    WHERE snapshotId=? AND businessType=?
    ORDER BY shipmentCode
  `);
  const scanStmt = db.prepare(`
    SELECT s.shipmentCode,s.isPod,s.orderStatus
    FROM business_scan_results s
    INNER JOIN unified_import_rows u
      ON u.shipmentCode=s.shipmentCode AND u.snapshotId=? AND u.businessType=?
    WHERE s.businessType='SHOPEE' AND s.reportDate=?
    ORDER BY s.shipmentCode
  `);
  const finalStmt = db.prepare(`
    SELECT f.shipmentCode,
        ${finalSelect}
    FROM business_final_rows f
    INNER JOIN unified_import_rows u
      ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
    WHERE f.businessType='SHOPEE' AND f.reportDate=?
    ORDER BY f.shipmentCode
  `);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const reportDate = String(batch.reportDate || '');
    for (const row of iter(dailyStmt, batch.snapshotId, businessType)) {
      const entry = ensureEntry(entries, row.shipmentCode, reportDate);
      if (!entry) continue;
      if (reportDate >= entry.lastReportDate) updateLatest(entry, {
        regionCode: row.regionCode,
        recipientRaw: row.recipientRaw,
        recipientNormalized: row.recipientNormalized,
        rowNumber: row.rowNumber
      }, reportDate);
    }
    for (const row of iter(scanStmt, batch.snapshotId, businessType, reportDate)) {
      const entry = ensureEntry(entries, row.shipmentCode, reportDate);
      if (Number(row.isPod || 0) === 1 || String(row.orderStatus || '') === '85') markPod(entry, reportDate);
    }
    for (const row of iter(finalStmt, batch.snapshotId, businessType, reportDate)) {
      const entry = ensureEntry(entries, row.shipmentCode, reportDate);
      updateLatest(entry, row, reportDate);
    }
    onProgress({ phase: 'snapshots', completed: index + 1, total: batches.length, entries: entries.size });
  }
  return entries;
}
function fillPodLocks(db, entries, range, onProgress = () => {}) {
  const list = [...entries.values()];
  const chunkSize = 400;
  let completed = 0;
  for (let offset = 0; offset < list.length; offset += chunkSize) {
    const chunk = list.slice(offset, offset + chunkSize);
    const marks = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode,podTime,source FROM business_pod_locks WHERE businessType='SHOPEE' AND shipmentCode IN (${marks})`).all(...chunk.map(row => row.shipmentCode));
    const locks = new Map(rows.map(row => [String(row.shipmentCode || '').trim().toUpperCase(), row]));
    for (const entry of chunk) {
      const lock = locks.get(entry.shipmentCode);
      const lockDate = dateKey(lock?.podTime || '');
      if (lock && lockDate && lockDate <= range.to) {
        entry.pod = true;
        entry.podTime = String(lock.podTime || '');
        entry.podDate = lockDate;
        entry.podTimeSource = 'POD锁';
      } else if (entry.pod) {
        entry.podDate = entry.podSnapshotDate || dateKey(entry.latestEventTime);
        entry.podTime = entry.podDate || '';
        entry.podTimeSource = entry.podSnapshotDate ? 'POD日报快照' : 'POD最后节点';
      }
      entry.deliveryNaturalDays = entry.pod && entry.podDate ? naturalDays(entry.firstReportDate, entry.podDate) : '';
      if (entry.pod) entry.currentStatus = 'POD';
    }
    completed += chunk.length;
    onProgress({ phase: 'podLocks', completed: Math.min(completed, list.length), total: list.length, entries: list.length });
  }
}
function buildDailyStats(values) {
  const map = new Map();
  for (const entry of values) {
    const date = entry.firstReportDate;
    if (!date) continue;
    if (!map.has(date)) map.set(date, { date, total: 0, pod: 0, pp: 0, pv: 0, returned: 0, days: [], a1: 0, a2: 0, a3: 0 });
    const stat = map.get(date);
    stat.total += 1;
    if (entry.region === 'PP') stat.pp += 1;
    if (entry.region === 'PV') stat.pv += 1;
    if (entry.pod) {
      stat.pod += 1;
      const days = Number(entry.deliveryNaturalDays || 0);
      if (days > 0) stat.days.push(days);
      if (entry.podAttemptNo === 1) stat.a1 += 1;
      else if (entry.podAttemptNo === 2) stat.a2 += 1;
      else if (entry.podAttemptNo >= 3) stat.a3 += 1;
    }
    if (returned(entry)) stat.returned += 1;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function styleHeader(row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { name: FONT_NAME, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF195A8D' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}
function summaryRow(sheet, label, value, note = '') {
  const row = sheet.addRow([label, value, note]);
  row.getCell(1).font = { name: FONT_NAME, bold: true, color: { argb: 'FF18324F' } };
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FA' } };
  row.eachCell(cell => { cell.font = { ...(cell.font || {}), name: FONT_NAME }; });
  row.commit?.();
}

export async function createShopeeSlimPeriodWorkbook({ type, periodType = 'custom', range, outputDir, onProgress = () => {} }) {
  const businessType = String(type || '').trim().toUpperCase();
  if (!SHOPEE_TYPES.has(businessType)) throw new Error(`V181仅支持SHOPEECN/SHOPEEVN：${businessType}`);
  const db = getDb();
  const batches = latestCompletedBatches(db, range.from, range.to);
  if (!batches.length) throw new Error(`${range.from} 至 ${range.to} 没有 VALID + COMPLETED 日快照。`);

  onProgress({ phase: 'start', completed: 0, total: batches.length, entries: 0 });
  const entries = loadNormalizedRange(db, businessType, batches, onProgress);
  if (!entries.size) throw new Error(`${displayType(businessType)} 在 ${range.from} 至 ${range.to} 没有可导出的业务数据。`);
  fillPodLocks(db, entries, range, onProgress);

  const values = [...entries.values()].sort((a, b) => a.firstReportDate.localeCompare(b.firstReportDate) || a.shipmentCode.localeCompare(b.shipmentCode));
  const daily = buildDailyStats(values);
  const podRows = values.filter(row => row.pod);
  const validDays = podRows.map(row => Number(row.deliveryNaturalDays)).filter(value => Number.isFinite(value) && value > 0);
  const total = values.length;
  const pod = podRows.length;
  const notPod = Math.max(0, total - pod);
  const pp = values.filter(row => row.region === 'PP').length;
  const pv = values.filter(row => row.region === 'PV').length;
  const returnCount = values.filter(returned).length;
  const t1 = validDays.filter(value => value === 1).length;
  const t2 = validDays.filter(value => value === 2).length;
  const t3 = validDays.filter(value => value >= 3).length;
  const a1 = podRows.filter(row => row.podAttemptNo === 1).length;
  const a2 = podRows.filter(row => row.podAttemptNo === 2).length;
  const a3 = podRows.filter(row => row.podAttemptNo >= 3).length;

  const fileName = safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_完整统计表_${range.from}_至_${range.to}.xlsx`);
  const filePath = path.join(outputDir, fileName);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  workbook.creator = 'CE Express QC';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('看板汇总');
  summary.columns = [{ width: 24 }, { width: 22 }, { width: 72 }];
  const title = summary.addRow([`${displayType(businessType)} ${range.from} 至 ${range.to} 完整统计看板`]);
  title.getCell(1).font = { name: FONT_NAME, size: 16, bold: true, color: { argb: 'FF0B3558' } };
  title.commit?.();
  summaryRow(summary, '业务板块', displayType(businessType));
  summaryRow(summary, '日期范围', `${range.from} 至 ${range.to}`, '只读取 VALID + COMPLETED 日快照；同一运单跨日期只统计一次。');
  summaryRow(summary, '唯一票数', total);
  summaryRow(summary, '已POD票数', pod);
  summaryRow(summary, '未POD票数', notPod);
  summaryRow(summary, 'POD派件完成率', `${rate(pod, total)}%`, '已POD唯一票数 ÷ 区间唯一票数。');
  summaryRow(summary, '平均派件天数', validDays.length ? `${avg(validDays)} 天` : '—', '首次日报日期 → POD日期，自然日口径，同日POD=1天。');
  summaryRow(summary, '派件天数有效样本', validDays.length, 'POD时间优先读取 business_pod_locks；缺失时回退POD日报快照。');
  summaryRow(summary, 'T1签收', t1, `${rate(t1, pod)}% / 已POD`);
  summaryRow(summary, 'T2签收', t2, `${rate(t2, pod)}% / 已POD`);
  summaryRow(summary, 'T3+签收', t3, `${rate(t3, pod)}% / 已POD`);
  summaryRow(summary, '1派POD', a1, `${rate(a1, pod)}% / 已POD`);
  summaryRow(summary, '2派POD', a2, `${rate(a2, pod)}% / 已POD`);
  summaryRow(summary, '3派+POD', a3, `${rate(a3, pod)}% / 已POD`);
  summaryRow(summary, '金边 PP', pp, `${rate(pp, total)}%`);
  summaryRow(summary, '外省 PV', pv, `${rate(pv, total)}%`);
  summaryRow(summary, '退回/退件', returnCount, `${rate(returnCount, total)}%`);
  summaryRow(summary, '导出引擎', VERSION, 'V181不读取 business_final_rows.rawJson / API原始报文。');
  summary.commit();

  const dailySheet = workbook.addWorksheet('每日汇总');
  dailySheet.columns = [
    { header: '首次日报日期', key: 'date', width: 16 },
    { header: '唯一票数', key: 'total', width: 14 },
    { header: '已POD', key: 'pod', width: 12 },
    { header: 'POD率', key: 'podRate', width: 14 },
    { header: '平均派件天数', key: 'avgDays', width: 16 },
    { header: 'T1', key: 't1', width: 10 },
    { header: 'T2', key: 't2', width: 10 },
    { header: 'T3+', key: 't3', width: 10 },
    { header: '金边PP', key: 'pp', width: 12 },
    { header: '外省PV', key: 'pv', width: 12 },
    { header: '退回/退件', key: 'returned', width: 14 }
  ];
  styleHeader(dailySheet.getRow(1));
  for (const stat of daily) {
    const days = stat.days || [];
    dailySheet.addRow({
      date: stat.date, total: stat.total, pod: stat.pod, podRate: `${rate(stat.pod, stat.total)}%`,
      avgDays: days.length ? avg(days) : '', t1: days.filter(v => v === 1).length, t2: days.filter(v => v === 2).length,
      t3: days.filter(v => v >= 3).length, pp: stat.pp, pv: stat.pv, returned: stat.returned
    }).commit();
  }
  dailySheet.commit();

  const detail = workbook.addWorksheet('运单统计明细');
  detail.columns = [
    { header: '运单号', key: 'shipmentCode', width: 24 },
    { header: '业务', key: 'businessType', width: 14 },
    { header: '首次日报日期', key: 'firstReportDate', width: 16 },
    { header: '最后日报日期', key: 'lastReportDate', width: 16 },
    { header: '区域', key: 'region', width: 12 },
    { header: '收件人', key: 'recipient', width: 26 },
    { header: '是否POD', key: 'pod', width: 12 },
    { header: 'POD时间', key: 'podTime', width: 22 },
    { header: 'POD日期', key: 'podDate', width: 16 },
    { header: '派件耗时自然日', key: 'deliveryNaturalDays', width: 18 },
    { header: 'POD派次', key: 'podAttemptNo', width: 12 },
    { header: '当前派次', key: 'currentAttemptNo', width: 12 },
    { header: '当前状态', key: 'currentStatus', width: 20 },
    { header: '最后节点', key: 'latestNode', width: 42 },
    { header: '最后节点时间', key: 'latestEventTime', width: 22 },
    { header: '门店编码', key: 'shopCode', width: 16 },
    { header: '门店名称', key: 'shopName', width: 22 },
    { header: 'POD时间来源', key: 'podTimeSource', width: 18 },
    { header: '源行号', key: 'sourceRowNumber', width: 12 }
  ];
  styleHeader(detail.getRow(1));
  for (const row of values) {
    detail.addRow({ ...row, businessType: displayType(businessType), region: row.region === 'PP' ? '金边 PP' : row.region === 'PV' ? '外省 PV' : row.region, pod: row.pod ? '是' : '否' }).commit();
  }
  detail.commit();

  onProgress({ phase: 'writing', completed: values.length, total: values.length, entries: values.length });
  await workbook.commit();
  return {
    file: filePath,
    summary: {
      type: businessType, from: range.from, to: range.to, total, pod, notPod,
      podRate: rate(pod, total), averageDeliveryDays: avg(validDays), validDeliveryDaySamples: validDays.length,
      t1, t2, t3, attempt1Pod: a1, attempt2Pod: a2, attempt3PlusPod: a3, pp, pv, returned: returnCount,
      engine: VERSION, rawJsonRead: false
    }
  };
}

export const V181_SHOPEE_SLIM_EXPORT_VERSION = VERSION;
