import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const BUSINESS_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']);
const BUSINESS_PRIORITY = Object.freeze(['CEAF', 'SHOPEEVN', 'SHOPEECN', 'ALI1688', 'TBKH', 'WHPP', 'CE']);
const SHIPMENT_HEADERS = [
  '运单号', '运单编号', '单号', '面单号', '快递单号', '物流单号',
  'waybill', 'waybillno', 'waybillnumber', 'trackingno', 'trackingnumber', 'shipmentcode'
];
const RECIPIENT_HEADERS = [
  '收件人', '收件人姓名', '收件人名称', '收货人', '收货人姓名', '收货人名称',
  '客户名称', '客户', '收件客户', '收货客户',
  'recipient', 'recipientname', 'receiver', 'receivername', 'consignee', 'consigneename', 'customername'
];
const CUSTOMER_NAME_HEADERS = [
  '客户名称', '客户名', '客户', 'customername', 'customer', 'clientname'
];
const REGION_HEADERS = [
  '省份标识', '区域', '区域代码', '路区', '站点', '目的地', '网点',
  '省份', '收件省份', '目的省份', '目的地省份', '收货省份',
  'region', 'area', 'route', 'site', 'destination', 'province', 'destprovince', 'destinationprovince', 'receiverprovince'
];
const EXPLICIT_REPORT_DATE_HEADERS = [
  '日报日期', '数据日期', '报表日期', '报告日期', 'reportdate', 'reportingdate', 'datadate'
];
const TRANSACTION_DATE_HEADERS = [
  '入库日期', '下单日期', '下单时间', '订单日期', '日期', 'ordertime', 'orderdate', 'date', 'inbounddate'
];

export function parseUnifiedDailyExcel(filePath, options = {}) {
  const fileBuffer = fs.readFileSync(filePath);
  const signature = fileBuffer.subarray(0, 4).toString('hex').toUpperCase();
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

  const manualDate = normalizeDate(options.reportDate);
  const explicitDateCandidates = new Map();
  const transactionDateCandidates = new Map();

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
      sheetDiagnostics.push({
        sheetName, status: 'SKIPPED', reason: '前30行未找到可识别的运单号+收件人表头', headerRow: null,
        detectedColumns: {}, missingFields: ['waybill', 'recipient'],
        sampleHeaders: matrix.slice(0, 30).map(row => row.filter(Boolean).slice(0, 12)).filter(row => row.length).slice(0, 8)
      });
      continue;
    }

    const originalHeaders = matrix[headerIndex].map(value => String(value ?? '').trim());
    const headers = originalHeaders.map(normalizeHeader);
    const shipmentIndex = findColumn(headers, SHIPMENT_HEADERS);
    let recipientIndex = findColumn(headers, RECIPIENT_HEADERS);
    let recipientDetection = 'HEADER_ALIAS';
    if (recipientIndex < 0) {
      recipientIndex = detectRecipientColumnByValues(matrix, headerIndex, shipmentIndex);
      recipientDetection = recipientIndex >= 0 ? 'VALUE_HEURISTIC' : 'NOT_FOUND';
    }
    if (shipmentIndex < 0 || recipientIndex < 0) {
      sheetDiagnostics.push({
        sheetName, status: 'SKIPPED', reason: shipmentIndex < 0 ? '未识别运单号列' : '未识别收件人列', headerRow: headerIndex + 1,
        detectedColumns: { waybill: shipmentIndex, recipient: recipientIndex },
        missingFields: [shipmentIndex < 0 ? 'waybill' : 'recipient'], sampleHeaders: originalHeaders.slice(0, 16)
      });
      continue;
    }

    const customerNameIndex = findColumn(headers, CUSTOMER_NAME_HEADERS);
    const regionIndex = findColumn(headers, REGION_HEADERS);
    const explicitDateIndex = findColumn(headers, EXPLICIT_REPORT_DATE_HEADERS);
    const transactionDateIndex = explicitDateIndex >= 0 ? -1 : findColumn(headers, TRANSACTION_DATE_HEADERS);
    const detectedColumns = {
      waybill: shipmentIndex,
      recipient: recipientIndex,
      recipientHeader: originalHeaders[recipientIndex] || '',
      recipientDetection,
      customerName: customerNameIndex,
      customerNameHeader: customerNameIndex >= 0 ? originalHeaders[customerNameIndex] : '',
      region: regionIndex,
      regionHeader: regionIndex >= 0 ? originalHeaders[regionIndex] : '',
      explicitReportDate: explicitDateIndex,
      explicitReportDateHeader: explicitDateIndex >= 0 ? originalHeaders[explicitDateIndex] : '',
      transactionDate: transactionDateIndex,
      transactionDateHeader: transactionDateIndex >= 0 ? originalHeaders[transactionDateIndex] : ''
    };
    sheetDiagnostics.push({ sheetName, status: 'VALID', reason: '识别成功', headerRow: headerIndex + 1, detectedColumns, missingFields: [], sampleHeaders: originalHeaders.slice(0, 16) });

    for (let index = headerIndex + 1; index < matrix.length; index += 1) {
      const row = matrix[index] || [];
      if (!row.some(value => String(value ?? '').trim())) continue;
      rawRows += 1;

      const shipmentCode = normalizeShipmentCode(row[shipmentIndex]);
      const recipientRaw = String(row[recipientIndex] ?? '').trim();
      const recipientNormalized = normalizeRecipient(recipientRaw);
      const customerNameRaw = customerNameIndex >= 0 ? String(row[customerNameIndex] ?? '').trim() : '';
      const customerNameNormalized = normalizeCustomerName(customerNameRaw);
      const regionRaw = regionIndex >= 0 ? String(row[regionIndex] ?? '').trim() : '';
      const regionCode = normalizeRegion(regionRaw);
      const explicitRowDate = explicitDateIndex >= 0 ? normalizeDate(row[explicitDateIndex]) : '';
      const transactionRowDate = transactionDateIndex >= 0 ? normalizeDate(row[transactionDateIndex]) : '';
      if (explicitRowDate) incrementCandidate(explicitDateCandidates, explicitRowDate);
      if (transactionRowDate) incrementCandidate(transactionDateCandidates, transactionRowDate);

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
        warnings.push({ type: 'MISSING_RECIPIENT', shipmentCode, sheetName, rowNumber: index + 1, message: '收件人为空，但仍按客户名称与运单号前缀继续精确分类；不影响有效票数。' });
      }

      const matches = classifyMatches(shipmentCode, recipientNormalized, customerNameNormalized);
      if (matches.length > 1) {
        classificationConflicts += 1;
        warnings.push({ type: 'CLASSIFICATION_CONFLICT', shipmentCode, sheetName, rowNumber: index + 1, matches, message: `命中多个强业务规则，按优先级归类${matches[0]}` });
      }
      const classification = classifyBusiness(shipmentCode, recipientNormalized, customerNameNormalized);
      if (!classification) {
        const error = new Error(`运单 ${shipmentCode} 未命中任何业务板块。CE必须CC开头，WHPP本土必须CE开头；已阻止静默归CE。`);
        error.code = 'UNCLASSIFIED_WAYBILL_PREFIX';
        error.shipmentCode = shipmentCode;
        error.sheetName = sheetName;
        error.rowNumber = index + 1;
        throw error;
      }
      const raw = Object.fromEntries(originalHeaders.map((header, column) => [header || `column_${column + 1}`, row[column] ?? '']));
      details.push({
        shipmentCode,
        businessType: classification.businessType,
        regionCode,
        regionRaw,
        recipientRaw,
        recipientNormalized,
        customerNameRaw,
        customerNameNormalized,
        sheetName,
        rowNumber: index + 1,
        reportDate: manualDate || explicitRowDate || transactionRowDate || '',
        classificationSource: classification.source,
        classificationMatchedValue: classification.matchedValue,
        classificationWarning: matches.length > 1 ? `命中多个强业务规则：${matches.join(',')}` : '',
        classificationReason: classification.reason,
        raw
      });
    }
  }

  if (!details.length) {
    const error = new Error('未识别到同时包含运单号和收件人字段的日报数据，请查看逐Sheet诊断');
    error.sheetDiagnostics = sheetDiagnostics;
    throw error;
  }

  const explicitSorted = sortCandidates(explicitDateCandidates);
  const transactionSorted = sortCandidates(transactionDateCandidates);
  const filenameDate = dateFromFilename(options.originalName || path.basename(filePath), options);

  let reportDate = manualDate;
  let dateDetectionSource = manualDate ? '手动日期' : '';
  if (!reportDate && explicitSorted.length) {
    reportDate = explicitSorted[0][0];
    dateDetectionSource = '日报日期列';
  }
  if (!reportDate && filenameDate) {
    reportDate = filenameDate;
    dateDetectionSource = '文件名';
  }
  if (!reportDate && transactionSorted.length) {
    reportDate = transactionSorted[0][0];
    dateDetectionSource = '业务日期列';
    warnings.push({ type: 'DATE_FALLBACK', message: `未找到明确日报日期，使用业务日期列多数值 ${reportDate}` });
  }
  if (!reportDate) throw new Error('未识别到日报日期，请手动选择日报日期');

  for (const row of details) row.reportDate = reportDate;

  const classificationCounts = Object.fromEntries(BUSINESS_TYPES.map(type => [type, details.filter(row => row.businessType === type).length]));
  const classifiedWaybills = Object.values(classificationCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const sourceReconciliation = {
    businessTypes: [...BUSINESS_TYPES],
    validUniqueWaybills: details.length,
    classifiedWaybills,
    difference: classifiedWaybills - details.length,
    balanced: classifiedWaybills === details.length
  };
  if (!sourceReconciliation.balanced) {
    const error = new Error(`日报源数据分类守恒失败：有效唯一运单${details.length}票，七板块合计${classifiedWaybills}票`);
    error.code = 'SOURCE_CLASSIFICATION_RECONCILIATION_FAILED';
    error.sourceReconciliation = sourceReconciliation;
    throw error;
  }

  const regionCounts = {
    PP: details.filter(row => row.regionCode === 'PP').length,
    PV: details.filter(row => row.regionCode === 'PV').length,
    UNKNOWN: details.filter(row => !['PP', 'PV'].includes(row.regionCode)).length
  };
  const allDateCandidates = mergeDateCandidates(explicitSorted, transactionSorted);

  return {
    reportDate,
    dateDetectionSource,
    dateWasManuallyCorrected: Boolean(manualDate),
    filenameDate,
    dateCandidates: allDateCandidates.map(([date, count]) => ({ date, count })),
    explicitDateCandidates: explicitSorted.map(([date, count]) => ({ date, count })),
    transactionDateCandidates: transactionSorted.map(([date, count]) => ({ date, count })),
    dateConflict: explicitSorted.length > 1 || (!explicitSorted.length && transactionSorted.length > 1),
    containerFormat,
    fileHash: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
    classificationCounts,
    sourceReconciliation,
    regionCounts,
    summary: { rawRows, validUniqueWaybills: details.length, duplicateRows, missingWaybillRows, missingRecipientWarnings, classificationConflicts },
    rows: details,
    warnings,
    sheetDiagnostics
  };
}

function findHeaderRow(matrix) {
  for (let i = 0; i < Math.min(matrix.length, 30); i += 1) {
    const headers = (matrix[i] || []).map(normalizeHeader);
    const shipmentIndex = findColumn(headers, SHIPMENT_HEADERS);
    if (shipmentIndex < 0) continue;
    if (findColumn(headers, RECIPIENT_HEADERS) >= 0 || detectRecipientColumnByValues(matrix, i, shipmentIndex) >= 0) return i;
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

function detectRecipientColumnByValues(matrix, headerIndex, shipmentIndex) {
  const maxColumns = Math.max(...matrix.slice(headerIndex, Math.min(matrix.length, headerIndex + 80)).map(row => row.length), 0);
  let best = { index: -1, score: 0 };
  for (let column = 0; column < maxColumns; column += 1) {
    if (column === shipmentIndex) continue;
    let score = 0;
    for (let rowIndex = headerIndex + 1; rowIndex < Math.min(matrix.length, headerIndex + 80); rowIndex += 1) {
      const value = normalizeRecipient(matrix[rowIndex]?.[column]);
      if (!value) continue;
      if (/SHOPEEVN|SHOPEECN|ALI1688/.test(value)) score += 3;
    }
    if (score > best.score) best = { index: column, score };
  }
  return best.score >= 3 ? best.index : -1;
}

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}
function normalizeShipmentCode(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
}
function normalizeRecipient(value) {
  return normalizeBusinessToken(value);
}
function normalizeCustomerName(value) {
  return normalizeBusinessToken(value);
}
function normalizeBusinessToken(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[\s_\-]+/g, '');
}
function normalizeRegion(value) {
  const raw = String(value ?? '').normalize('NFKC').trim();
  const text = raw.toUpperCase().replace(/\s+/g, ' ');
  if (!text) return '';
  if (/^(?:PP\d*|PNH)$/.test(text) || /PHNOM\s*PENH|金边/i.test(raw)) return 'PP';
  if (/^PV\d*$/.test(text)) return 'PV';
  return 'PV';
}

export function classifyUnifiedMatches(shipmentCode, recipient = '', customerName = '') {
  return classifyMatches(normalizeShipmentCode(shipmentCode), normalizeRecipient(recipient), normalizeCustomerName(customerName));
}

export function classifyUnifiedBusiness(shipmentCode, recipient = '', customerName = '') {
  return classifyBusiness(normalizeShipmentCode(shipmentCode), normalizeRecipient(recipient), normalizeCustomerName(customerName));
}

function classifyMatches(shipmentCode, recipient, customerName) {
  const matches = [];
  if (customerName.includes('CCAF')) matches.push('CEAF');
  if (recipient.includes('SHOPEEVN')) matches.push('SHOPEEVN');
  if (recipient.includes('SHOPEECN')) matches.push('SHOPEECN');
  if (recipient.includes('ALI1688')) matches.push('ALI1688');
  if (shipmentCode.startsWith('TBKH')) matches.push('TBKH');

  // CE/CC prefixes are fallback ownership rules. They must not be counted as a
  // classification conflict when a stronger recipient/customer rule already
  // identified the parcel. This is what prevents normal Shopee/ALI rows from
  // generating hundreds of false "classification conflict" warnings.
  if (!matches.length) {
    if (shipmentCode.startsWith('CE')) matches.push('WHPP');
    else if (shipmentCode.startsWith('CC')) matches.push('CE');
  }
  return BUSINESS_PRIORITY.filter(type => matches.includes(type));
}

function classifyBusiness(shipmentCode, recipient, customerName) {
  if (customerName.includes('CCAF')) return { businessType: 'CEAF', source: 'CUSTOMER_NAME', matchedValue: 'CCAF', reason: '客户名称命中CCAF，归类CEAF空运' };
  if (recipient.includes('SHOPEEVN')) return { businessType: 'SHOPEEVN', source: 'RECIPIENT', matchedValue: 'SHOPEEVN', reason: '收件人命中SHOPEEVN' };
  if (recipient.includes('SHOPEECN')) return { businessType: 'SHOPEECN', source: 'RECIPIENT', matchedValue: 'SHOPEECN', reason: '收件人命中SHOPEECN' };
  if (recipient.includes('ALI1688')) return { businessType: 'ALI1688', source: 'RECIPIENT', matchedValue: 'ALI1688', reason: '收件人命中ALI1688' };
  if (shipmentCode.startsWith('TBKH')) return { businessType: 'TBKH', source: 'SHIPMENT_PREFIX', matchedValue: 'TBKH', reason: '运单号前缀命中TBKH' };
  if (shipmentCode.startsWith('CE')) return { businessType: 'WHPP', source: 'SHIPMENT_PREFIX', matchedValue: 'CE', reason: '运单号CE开头，归类WHPP本土' };
  if (shipmentCode.startsWith('CC')) return { businessType: 'CE', source: 'SHIPMENT_PREFIX', matchedValue: 'CC', reason: '运单号CC开头，归类CE' };
  return null;
}
function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDateKey(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = String(value).normalize('NFKC').trim().replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '');
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

function dateFromFilename(name, options = {}) {
  const base = path.basename(String(name || '')).replace(/\.[^.]+$/, '');
  const full = base.match(/(?:^|[^0-9])(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?:[^0-9]|$)/);
  if (full) return validDate(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = base.match(/(?:^|[^0-9])(\d{1,2})[-_.](\d{1,2})(?:[^0-9]|$)/);
  if (!short) return '';
  const reference = normalizeDate(options.referenceDate) || normalizeDate(options.lastReportDate) || currentCambodiaDate();
  const year = Number(reference.slice(0, 4)) || new Date().getFullYear();
  return validDate(year, Number(short[1]), Number(short[2]));
}

function validDate(year, month, day) {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function currentCambodiaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function incrementCandidate(map, date) {
  map.set(date, Number(map.get(date) || 0) + 1);
}
function sortCandidates(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function mergeDateCandidates(...groups) {
  const map = new Map();
  for (const group of groups) for (const [date, count] of group) map.set(date, Number(map.get(date) || 0) + Number(count || 0));
  return sortCandidates(map);
}

function propagateMergedHeaderCells(sheet, matrix) {
  for (const range of sheet['!merges'] || []) {
    if (range.s.r >= 30) continue;
    const value = matrix[range.s.r]?.[range.s.c];
    if (!String(value ?? '').trim()) continue;
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      matrix[row] ||= [];
      for (let column = range.s.c; column <= range.e.c; column += 1) matrix[row][column] ||= value;
    }
  }
}
