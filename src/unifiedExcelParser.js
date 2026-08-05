import crypto from 'crypto';
import fs from 'fs';
import XLSX from 'xlsx';

const BUSINESS_PRIORITY = ['SHOPEEVN', 'SHOPEECN', 'TBKH', 'ALI1688'];
const SHIPMENT_HEADERS = ['运单号', '运单编号', '单号', '面单号', '快递单号', '物流单号', 'waybill', 'waybillno', 'waybillnumber', 'trackingno', 'trackingnumber', 'shipmentcode'];
const RECIPIENT_HEADERS = ['收件人', '收件人姓名', '客户名称', '客户', '收货人', 'recipient', 'receiver', 'receivername', 'consignee', 'customername'];
const REGION_HEADERS = ['省份标识', '区域', '区域代码', '路区', '站点', '目的地', '网点', 'region', 'area', 'route', 'site', 'destination'];
const DATE_HEADERS = ['日报日期', '数据日期', '下单时间', '入库日期', '日期', 'reportdate', 'ordertime', 'orderdate', 'date', 'inbounddate'];

export function parseUnifiedDailyExcel(filePath, options = {}) {
  const signature = fs.readFileSync(filePath).subarray(0, 4).toString('hex').toUpperCase();
  const containerFormat = signature.startsWith('504B') ? 'OOXML_ZIP' : (signature.startsWith('D0CF11E0') ? 'OLE_XLS' : 'UNKNOWN');
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const details = [];
  const warnings = [];
  const sheetDiagnostics = [];
  const seen = new Set();
  let rawRows = 0;
  let duplicateRows = 0;
  let missingWaybillRows = 0;
  let missingRecipientWarnings = 0;
  let classificationConflicts = 0;
  let detectedDate = normalizeDate(options.reportDate);
  const dateCandidates = new Map();
  let dateDetectionSource = detectedDate ? '手动日期' : '';

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const hidden = Number(workbook.Workbook?.Sheets?.find(item => item.name === sheetName)?.Hidden || 0) > 0;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (hidden || !matrix.some(row => row.some(value => String(value ?? '').trim()))) {
      sheetDiagnostics.push({ sheetName, status: 'SKIPPED', reason: hidden ? '隐藏Sheet' : '空Sheet', headerRow: null, detectedColumns: {}, missingFields: [] });
      continue;
    }
    propagateMergedHeaderCells(sheet, matrix);
    const headerIndex = findHeaderRow(matrix);
    if (headerIndex < 0) {
      sheetDiagnostics.push({ sheetName, status: 'SKIPPED', reason: '前15行未找到运单号+收件人表头', headerRow: null, detectedColumns: {}, missingFields: ['waybill', 'recipient'], sampleHeaders: matrix.slice(0, 15).map(row => row.filter(Boolean).slice(0, 8)) });
      continue;
    }
    const headers = matrix[headerIndex].map(normalizeHeader);
    const shipmentIndex = findColumn(headers, SHIPMENT_HEADERS);
    const recipientIndex = findColumn(headers, RECIPIENT_HEADERS);
    const regionIndex = findColumn(headers, REGION_HEADERS);
    const dateIndex = findColumn(headers, DATE_HEADERS);
    const detectedColumns = { waybill: shipmentIndex, recipient: recipientIndex, region: regionIndex, reportDate: dateIndex };
    sheetDiagnostics.push({ sheetName, status: 'VALID', reason: '识别成功', headerRow: headerIndex + 1, detectedColumns, missingFields: [], sampleHeaders: matrix[headerIndex].slice(0, 12) });

    for (let index = headerIndex + 1; index < matrix.length; index += 1) {
      const row = matrix[index] || [];
      if (!row.some(value => String(value ?? '').trim())) continue;
      rawRows += 1;
      const shipmentCode = normalizeShipmentCode(row[shipmentIndex]);
      const recipientRaw = String(row[recipientIndex] ?? '').trim();
      const recipientNormalized = normalizeRecipient(recipientRaw);
      const regionCode = normalizeRegion(row[regionIndex]);
      const rowDate = normalizeDate(row[dateIndex]);
      if (rowDate) dateCandidates.set(rowDate, Number(dateCandidates.get(rowDate) || 0) + 1);
      if (!shipmentCode) {
        missingWaybillRows += 1;
        warnings.push({ type: 'MISSING_WAYBILL', sheetName, rowNumber: index + 1, message: '运单号缺失，未计入分类' });
        continue;
      }
      if (seen.has(shipmentCode)) {
        duplicateRows += 1;
        warnings.push({ type: 'DUPLICATE', shipmentCode, sheetName, rowNumber: index + 1, message: '重复运单号，已保留首次出现' });
        continue;
      }
      seen.add(shipmentCode);
      if (!recipientRaw) {
        missingRecipientWarnings += 1;
        warnings.push({ type: 'MISSING_RECIPIENT', shipmentCode, sheetName, rowNumber: index + 1, message: '收件人缺失，按默认规则归类CE' });
      }
      const matches = classifyMatches(shipmentCode, recipientNormalized);
      if (matches.length > 1) {
        classificationConflicts += 1;
        warnings.push({ type: 'CLASSIFICATION_CONFLICT', shipmentCode, sheetName, rowNumber: index + 1, matches, message: `命中多个板块，按优先级归类${matches[0]}` });
      }
      const classification = classifyBusiness(shipmentCode, recipientNormalized);
      const businessType = classification.businessType;
      details.push({
        shipmentCode, businessType, regionCode, recipientRaw, recipientNormalized,
        sheetName, rowNumber: index + 1, reportDate: detectedDate || rowDate || '',
        classificationSource: classification.source,
        classificationMatchedValue: classification.matchedValue,
        classificationWarning: matches.length > 1 ? `命中多个板块：${matches.join(',')}` : '',
        classificationReason: classification.reason
      });
    }
  }

  if (!details.length) {
    const error = new Error('未识别到同时包含运单号和收件人字段的日报数据，请查看逐Sheet诊断');
    error.sheetDiagnostics = sheetDiagnostics;
    throw error;
  }
  const sortedDateCandidates = [...dateCandidates.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!detectedDate && sortedDateCandidates.length) {
    detectedDate = sortedDateCandidates[0][0];
    dateDetectionSource = '下单时间列';
  }
  const reportDate = normalizeDate(options.reportDate) || detectedDate;
  if (!reportDate) throw new Error('未识别到日报日期，请手动选择日报日期');
  for (const row of details) row.reportDate = reportDate;
  const classificationCounts = Object.fromEntries(['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].map(type => [type, details.filter(row => row.businessType === type).length]));
  const regionCounts = { PP: details.filter(row => row.regionCode === 'PP').length, PV: details.filter(row => row.regionCode === 'PV').length };
  return {
    reportDate,
    dateDetectionSource,
    dateWasManuallyCorrected: Boolean(normalizeDate(options.reportDate)),
    dateCandidates: sortedDateCandidates.map(([date, count]) => ({ date, count })),
    dateConflict: sortedDateCandidates.length > 1,
    containerFormat,
    fileHash: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
    classificationCounts,
    regionCounts,
    summary: { rawRows, validUniqueWaybills: details.length, duplicateRows, missingWaybillRows, missingRecipientWarnings, classificationConflicts },
    rows: details,
    warnings,
    sheetDiagnostics
  };
}

function findHeaderRow(matrix) {
  for (let i = 0; i < Math.min(matrix.length, 15); i += 1) {
    const headers = (matrix[i] || []).map(normalizeHeader);
    if (findColumn(headers, SHIPMENT_HEADERS) >= 0 && findColumn(headers, RECIPIENT_HEADERS) >= 0) return i;
  }
  return -1;
}

function findColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const alias of normalizedAliases) {
    const index = headers.findIndex(header => header === alias);
    if (index >= 0) return index;
  }
  return -1;
}

function normalizeHeader(value) { return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, ''); }
function normalizeShipmentCode(value) { return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ''); }
function normalizeRecipient(value) { return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[\s_\-]+/g, ''); }
function normalizeRegion(value) { const text = String(value ?? '').trim().toUpperCase(); return text === 'PV' ? 'PV' : text === 'PP' ? 'PP' : ''; }
function classifyMatches(shipmentCode, recipient) {
  const matches = [];
  if (recipient.includes('SHOPEEVN')) matches.push('SHOPEEVN');
  if (recipient.includes('SHOPEECN')) matches.push('SHOPEECN');
  if (shipmentCode.startsWith('TBKH') || recipient.includes('TBKH')) matches.push('TBKH');
  if (recipient.includes('ALI1688')) matches.push('ALI1688');
  return BUSINESS_PRIORITY.filter(type => matches.includes(type));
}
function classifyBusiness(shipmentCode, recipient) {
  if (recipient.includes('SHOPEEVN')) return { businessType: 'SHOPEEVN', source: 'RECIPIENT', matchedValue: 'SHOPEEVN', reason: '收件人命中SHOPEEVN' };
  if (recipient.includes('SHOPEECN')) return { businessType: 'SHOPEECN', source: 'RECIPIENT', matchedValue: 'SHOPEECN', reason: '收件人命中SHOPEECN' };
  if (shipmentCode.startsWith('TBKH')) return { businessType: 'TBKH', source: 'SHIPMENT_PREFIX', matchedValue: 'TBKH', reason: '运单号前缀命中TBKH' };
  if (recipient.includes('TBKH')) return { businessType: 'TBKH', source: 'RECIPIENT', matchedValue: 'TBKH', reason: '收件人命中TBKH' };
  if (recipient.includes('ALI1688')) return { businessType: 'ALI1688', source: 'RECIPIENT', matchedValue: 'ALI1688', reason: '收件人命中ALI1688' };
  return { businessType: 'CE', source: 'DEFAULT', matchedValue: '', reason: '未命中特定板块，默认归类CE' };
}
function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value).trim().replace(/[./]/g, '-');
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

function propagateMergedHeaderCells(sheet, matrix) {
  for (const range of sheet['!merges'] || []) {
    if (range.s.r >= 15) continue;
    const value = matrix[range.s.r]?.[range.s.c];
    if (!String(value ?? '').trim()) continue;
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      matrix[row] ||= [];
      for (let column = range.s.c; column <= range.e.c; column += 1) matrix[row][column] ||= value;
    }
  }
}
