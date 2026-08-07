import XLSX from 'xlsx';
import path from 'path';
import { classifyShopeeRegion } from './shopeeAnalyzer.js';
import { classifyRecipient } from './recipientGroup.js';

const BILL_HEADERS = new Set(['shipmentcode', 'shipment code', '运单号', '运单编号', '单号', 'waybill', 'waybillno', 'trackingnumber', 'tracking number', 'tracking no']);
const DATE_HEADERS = new Set(['reportdate', 'report date', '报表日期', '日报日期', '日期', 'date']);
const RECIPIENT_HEADERS = new Set(['收件人', '收件人名称', 'consigneename', 'consignee', 'recipientname', 'recipient']);

export async function parseShopeeDailyExcel(filePath, options = {}) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const details = [];
  const actualHeaders = new Set();
  const failures = [];
  const recipientHeaders = new Set();
  for (const sheetName of workbook.SheetNames || []) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    const headerIndex = matrix.slice(0, 30).findIndex(row => row.some(cell => BILL_HEADERS.has(normalizeHeader(cell))));
    if (headerIndex < 0) {
      (matrix.find(row => row.some(cell => String(cell || '').trim())) || []).forEach(cell => actualHeaders.add(String(cell || '').trim()));
      failures.push(`${sheetName}: 未找到运单号列`);
      continue;
    }
    const headers = matrix[headerIndex].map(cell => String(cell || '').trim());
    headers.forEach(header => actualHeaders.add(header));
    const billColumn = headers.findIndex(header => BILL_HEADERS.has(normalizeHeader(header)));
    const dateColumn = headers.findIndex(header => DATE_HEADERS.has(normalizeHeader(header)));
    const recipientColumn = headers.findIndex(header => RECIPIENT_HEADERS.has(normalizeHeader(header)));
    if (recipientColumn < 0) {
      failures.push(`${sheetName}: 未找到收件人列`);
      continue;
    }
    recipientHeaders.add(headers[recipientColumn]);
    for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
      const row = matrix[rowIndex] || [];
      const shipmentCode = normalizeBill(row[billColumn]);
      if (!shipmentCode) {
        if (row.some(cell => String(cell || '').trim())) failures.push(`${sheetName}!${rowIndex + 1}: 运单号为空或格式无效`);
        continue;
      }
      const raw = Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, row[index] ?? '']));
      const region = classifyShopeeRegion({ dailyRow: { raw } });
      const recipient = classifyRecipient(row[recipientColumn]);
      details.push({
        sheetName,
        rowNumber: rowIndex + 1,
        source_row_number: rowIndex + 1,
        shipmentCode,
        reportDate: normalizeDate(row[dateColumn]),
        sourceType: 'SHOPEE日报',
        regionType: region.regionType,
        regionCode: region.regionCode,
        regionSource: region.regionSource,
        ...recipient,
        recipient_header: headers[recipientColumn],
        rawText: row.map(cell => String(cell || '').trim()).filter(Boolean).join(' | ').slice(0, 1000),
        raw
      });
    }
  }
  if (failures.some(message => message.includes('未找到收件人列'))) {
    const headers = [...actualHeaders].filter(Boolean);
    throw new Error(`SHOPEE日报解析失败：缺少收件人列（收件人/收件人名称/consigneeName/consignee/recipientName/recipient）。实际表头：${headers.join('、') || '未读取到表头'}。${failures.filter(message => message.includes('未找到收件人列')).join('；')}`);
  }
  if (!details.length) {
    const headers = [...actualHeaders].filter(Boolean);
    const missingRecipient = failures.some(message => message.includes('未找到收件人列'));
    const reason = missingRecipient
      ? '缺少收件人列（收件人/收件人名称/consigneeName/consignee/recipientName/recipient）'
      : '缺少运单号列（shipmentCode/运单号/waybill/tracking number）';
    throw new Error(`SHOPEE日报解析失败：${reason}。实际表头：${headers.join('、') || '未读取到表头'}。${failures.slice(0, 5).join('；')}`);
  }

  const reportDate = normalizeDate(options.reportDate)
    || details.map(row => row.reportDate).find(Boolean)
    || dateFromFilename(options.originalName || path.basename(filePath));
  if (!reportDate) throw new Error(`SHOPEE日报解析失败：未识别reportDate。实际表头：${[...actualHeaders].filter(Boolean).join('、')}`);
  const rowsByBill = new Map();
  let duplicates = 0;
  for (const row of details) {
    if (!rowsByBill.has(row.shipmentCode)) rowsByBill.set(row.shipmentCode, []);
    else duplicates += 1;
    rowsByBill.get(row.shipmentCode).push({ ...row, reportDate });
  }
  const conflicts = [];
  const rows = [];
  const importRows = [];
  const excludedRows = [];
  for (const [shipmentCode, sourceRows] of rowsByBill) {
    const eligibleRows = sourceRows.filter(row => row.recipient_group === 'CN' || row.recipient_group === 'VN');
    const groups = [...new Set(eligibleRows.map(row => row.recipient_group))];
    if (!eligibleRows.length) {
      excludedRows.push({
        ...sourceRows[0],
        importStatus: 'IGNORED_NON_SHOPEE',
        recipient_group_reason: sourceRows[0].recipient_group_reason || 'UNMATCHED_RECIPIENT'
      });
      continue;
    }
    if (groups.length > 1) {
      const conflict = {
        shipmentCode,
        groups,
        rows: eligibleRows.map(row => ({ sheetName: row.sheetName, rowNumber: row.rowNumber, recipient_raw: row.recipient_raw, recipient_group: row.recipient_group }))
      };
      conflicts.push(conflict);
      importRows.push(...eligibleRows.map(row => ({
        ...row,
        importStatus: 'RECIPIENT_GROUP_CONFLICT',
        recipient_group_reason: 'RECIPIENT_GROUP_CONFLICT'
      })));
      continue;
    }
    const canonical = { ...eligibleRows[0], importStatus: eligibleRows.length > 1 ? 'DUPLICATE_SAME_GROUP' : 'ACCEPTED' };
    rows.push(canonical);
    importRows.push(canonical, ...eligibleRows.slice(1).map(row => ({ ...row, importStatus: 'DUPLICATE_SAME_GROUP' })));
  }
  const groupCounts = countGroups(rows);
  const reconciliation = {
    status: rows.length === groupCounts.CN + groupCounts.VN ? 'PASSED' : 'FAILED_RECONCILIATION',
    total: rows.length,
    ...groupCounts
  };
  return {
    businessType: 'SHOPEE',
    reportDate,
    sourceName: options.originalName || path.basename(filePath),
    bills: rows.map(row => row.shipmentCode),
    details: rows,
    excludedRows,
    importRows,
    conflicts,
    preview: importRows.slice(0, 50),
    summary: {
      rawRows: details.length,
      eligibleUniqueShipments: rows.length,
      totalRecognized: rows.length,
      totalUniqueCount: rowsByBill.size,
      totalAppearCount: details.length,
      duplicates,
      conflictCount: conflicts.length,
      recipientHeader: [...recipientHeaders].join('、'),
      groupCounts,
      reconciliation,
      warnings: [
        ...(conflicts.length ? [`存在${conflicts.length}票收件人分组冲突，已排除出正式处理池`] : [])
      ],
      failedRows: failures.slice(0, 50),
      actualHeaders: [...actualHeaders].filter(Boolean)
    }
  };
}

function countGroups(rows) {
  const counts = { CN: 0, VN: 0 };
  for (const row of rows) {
    if (row.recipient_group === 'CN' || row.recipient_group === 'VN') counts[row.recipient_group] += 1;
  }
  return counts;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizeBill(value) {
  const text = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9-]{8,40}$/.test(text) ? text : '';
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const date = value instanceof Date ? value : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function dateFromFilename(name) {
  const match = String(name || '').match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}
