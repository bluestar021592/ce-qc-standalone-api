import XLSX from 'xlsx';

const CANDIDATE_RE = /(?:^|[^0-9A-Z])((?:TBKH[0-9A-Z]{6,}|CC[0-9A-Z]{6,}|SPE[0-9A-Z]{3,}|WHPP[0-9A-Z]{3,}))(?![0-9A-Z])/gi;

const PROVINCE_PATTERNS = [
  ['Banteay Meanchey', /BANTEAY\s*MEANCHEY|班迭棉吉|卜迭棉芷/i],
  ['Battambang', /BATTAMBANG|马德望/i],
  ['Kampong Cham', /KAMPONG\s*CHAM|磅湛/i],
  ['Kampong Chhnang', /KAMPONG\s*CHHNANG|磅清扬/i],
  ['Kampong Speu', /KAMPONG\s*SPEU|实居/i],
  ['Kampong Thom', /KAMPONG\s*THOM|磅同/i],
  ['Kampot', /KAMPOT|贡布/i],
  ['Kandal', /KANDAL|干拉/i],
  ['Kep', /(?:^|[^A-Z])KEP(?:[^A-Z]|$)|白马/i],
  ['Koh Kong', /KOH\s*KONG|国公/i],
  ['Kratie', /KRATIE|桔井/i],
  ['Mondulkiri', /MONDULKIRI|蒙多基里/i],
  ['Oddar Meanchey', /ODDAR\s*MEANCHEY|奥多棉吉/i],
  ['Pailin', /PAILIN|拜林/i],
  ['Preah Sihanouk', /PREAH\s*SIHANOUK|SIHANOUK|SIHANOUKVILLE|SHV|西港|西哈努克/i],
  ['Preah Vihear', /PREAH\s*VIHEAR|柏威夏/i],
  ['Prey Veng', /PREY\s*VENG|波罗勉/i],
  ['Pursat', /PURSAT|菩萨/i],
  ['Ratanakiri', /RATANAKIRI|腊塔纳基里/i],
  ['Siem Reap', /SIEM\s*REAP|暹粒/i],
  ['Stung Treng', /STUNG\s*TRENG|上丁/i],
  ['Svay Rieng', /SVAY\s*RIENG|柴桢/i],
  ['Takeo', /TAKEO|茶胶/i],
  ['Tboung Khmum', /TBOUNG\s*KHMUM|TBONG\s*KHMUM|特本克蒙/i]
];

const PNH_RE = /PNH|PHNOM\s*PENH|PHNOMPENH|金边/i;

export async function parseDailyExcel(filePath, opts = {}) {
  const wb = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const detectedDate = detectReportDate(wb, opts);
  const reportDate = detectedDate.reportDate || '';
  const assumePnhReport = opts.assumePnhReport !== false;
  const finalByBill = new Map();
  const details = [];
  const duplicateBills = new Set();
  const notes = [];
  let occurrenceCount = 0;
  let duplicateCount = 0;
  let defaultPnhCount = 0;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    matrix.forEach((arr, index) => {
      const rowNumber = index + 1;
      const text = arr.map(x => String(x || '').trim()).filter(Boolean).join(' | ');
      const bills = extractCandidates(text);
      if (!bills.length) return;

      for (const shipmentCode of bills) {
        occurrenceCount += 1;
        const classified = classifyRow({ shipmentCode, text, assumePnhReport });
        if (classified.defaultPnh) defaultPnhCount += 1;

        const detail = {
          sheetName,
          rowNumber,
          shipmentCode,
          result: classified.result,
          reason: classified.reason,
          rawText: text.slice(0, 1000)
        };

        const existing = finalByBill.get(shipmentCode);
        if (existing) {
          duplicateCount += 1;
          const shouldReplace = classified.priority > existing.priority;
          details.push({
            ...detail,
            result: '重复',
            reason: shouldReplace
              ? `${classified.reason}；重复单号，因判断更明确覆盖首次结果`
              : `重复单号，首次出现在 ${existing.sheetName} 第 ${existing.rowNumber} 行，已按首次结果 ${existing.result} 保留`
          });
          duplicateBills.add(shipmentCode);
          if (shouldReplace) finalByBill.set(shipmentCode, { ...detail, priority: classified.priority });
          continue;
        }

        finalByBill.set(shipmentCode, { ...detail, priority: classified.priority });
        details.push(detail);
      }
    });
  }

  const finalRows = [...finalByBill.values()];
  const pnhBills = finalRows.filter(x => x.result === 'PNH').map(x => x.shipmentCode);
  const nonPnhBills = finalRows.filter(x => x.result === '非PNH').map(x => x.shipmentCode);
  const excludedBills = finalRows.filter(x => x.result === '排除').map(x => x.shipmentCode);
  const preview = details.slice(0, 50).map(stripPriority);

  if (defaultPnhCount > 0) {
    notes.push(`有 ${defaultPnhCount} 条记录未识别到PNH或外省关键词，已按金边日报默认归入PNH。`);
  }
  if (duplicateCount > 0) {
    notes.push(`发现 ${duplicateCount} 条重复出现的运单号，最终每票只保留一次。`);
  }

  return {
    reportDate,
    reportDateSource: detectedDate.source,
    reportDateAutoDetected: detectedDate.source && detectedDate.source !== 'manual',
    reportDateNeedsManual: !reportDate,
    sourceName: opts.originalName || '',
    pnhBills,
    nonPnhBills,
    excludedBills,
    duplicateBills: [...duplicateBills].sort(),
    rows: finalRows.map(stripPriority),
    details: details.map(stripPriority),
    preview,
    notes,
    summary: {
      sourceName: opts.originalName || '',
      reportDate,
      reportDateSource: detectedDate.source,
      reportDateAutoDetected: detectedDate.source && detectedDate.source !== 'manual',
      reportDateNeedsManual: !reportDate,
      pnh: pnhBills.length,
      nonPnh: nonPnhBills.length,
      excluded: excludedBills.length,
      duplicates: duplicateCount,
      duplicateBills: [...duplicateBills].sort(),
      totalRecognized: finalRows.length,
      totalOccurrences: occurrenceCount,
      previewCount: preview.length,
      defaultPnh: defaultPnhCount,
      notes
    }
  };
}

function detectReportDate(wb, opts = {}) {
  const manual = normalizeDateValue(opts.reportDate);
  if (manual) return { reportDate: manual, source: 'manual' };

  const fileName = String(opts.originalName || '');
  const fromFile = findDateInText(fileName, opts);
  if (fromFile) return { reportDate: fromFile, source: 'filename' };

  const textParts = [];
  for (const sheetName of wb.SheetNames || []) {
    textParts.push(sheetName);
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    for (const row of matrix.slice(0, 30)) {
      textParts.push(row.map(x => String(x || '').trim()).filter(Boolean).join(' '));
    }
  }
  const fromContent = findDateInText(textParts.join(' '), opts);
  if (fromContent) return { reportDate: fromContent, source: 'content' };
  return { reportDate: '', source: '' };
}

function findDateInText(text, opts = {}) {
  const value = String(text || '');
  const compact = value.match(/(?:^|[^0-9])((?:20)\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/);
  if (compact) {
    const normalized = buildDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
    if (normalized) return normalized;
  }

  const full = value.match(/(?:^|[^0-9])((?:20)\d{2})[-_./年\s]+(\d{1,2})[-_./月\s]+(\d{1,2})日?(?:[^0-9]|$)/);
  if (full) {
    const normalized = buildDate(Number(full[1]), Number(full[2]), Number(full[3]));
    if (normalized) return normalized;
  }

  const shortMatches = [...value.matchAll(/(?:^|[^0-9A-Z])(\d{1,2})[-_.月](\d{1,2})日?(?:[^0-9A-Z]|$)/gi)];
  for (const match of shortMatches) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const year = inferYear(month, day, opts);
    const normalized = buildDate(year, month, day);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeDateValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = findDateInText(text, { defaultYear: new Date().getFullYear() });
  if (normalized) return normalized;
  const d = new Date(`${text}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function inferYear(month, day, opts = {}) {
  const last = normalizeDateValue(opts.lastReportDate || '');
  if (last) return Number(last.slice(0, 4));
  const currentYear = Number(opts.defaultYear || new Date().getFullYear());
  const candidate = new Date(Date.UTC(currentYear, month - 1, day));
  const now = new Date();
  if (candidate.getTime() - now.getTime() > 1000 * 60 * 60 * 24 * 31) return currentYear - 1;
  return currentYear;
}

function buildDate(year, month, day) {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractCandidates(text) {
  const out = [];
  for (const match of String(text || '').matchAll(CANDIDATE_RE)) {
    const bill = String(match[1] || '').trim().toUpperCase();
    if (!bill) continue;
    if (/^CC/i.test(bill) && !/\d/.test(bill)) continue;
    out.push(bill);
  }
  return [...new Set(out)];
}

function classifyRow({ shipmentCode, text, assumePnhReport }) {
  if (/^SPE/i.test(shipmentCode)) {
    return { result: '排除', reason: '运单号以SPE开头', priority: 100, defaultPnh: false };
  }
  if (/^WHPP/i.test(shipmentCode) || /WHPP/i.test(text)) {
    return { result: '排除', reason: 'WHPP相关记录', priority: 100, defaultPnh: false };
  }

  const province = detectProvince(text);
  if (province) {
    return { result: '非PNH', reason: `行内包含外省名称：${province}`, priority: 80, defaultPnh: false };
  }
  if (PNH_RE.test(text)) {
    return { result: 'PNH', reason: '行内包含PNH/Phnom Penh/金边', priority: 70, defaultPnh: false };
  }
  if (assumePnhReport) {
    return { result: 'PNH', reason: '无法识别地区，按金边日报默认PNH', priority: 10, defaultPnh: true };
  }
  return { result: '非PNH', reason: '未识别到PNH关键词，且未启用金边日报默认PNH', priority: 5, defaultPnh: false };
}

function detectProvince(text) {
  const value = String(text || '');
  const hit = PROVINCE_PATTERNS.find(([, pattern]) => pattern.test(value));
  return hit ? hit[0] : '';
}

function stripPriority(row) {
  const { priority, ...rest } = row;
  return rest;
}
