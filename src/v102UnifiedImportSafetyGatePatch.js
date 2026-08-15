import fs from 'fs';
import fsPromises from 'fs/promises';
import express from 'express';
import XLSX from 'xlsx';
import { classifyUnifiedBusiness, parseUnifiedDailyExcel } from './unifiedExcelParser.js';

export const V102_UNIFIED_IMPORT_SAFETY_GATE_ID = '2026-08-15-v151-direct-persist-safety-v5';
const ROUTE = '/api/import/unified-daily-report';
const WRAPPED = Symbol.for('ce-qc.v102-unified-import-safety');
let persistUnifiedUploadFast = null;

function safetyError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function normalizeManualDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  return match ? text : '';
}

function findDuplicateOwnershipConflict(filePath, parsed) {
  const duplicateWarnings = (parsed?.warnings || []).filter(item => item?.type === 'DUPLICATE');
  if (!duplicateWarnings.length) return null;
  if (!filePath || !fs.existsSync(filePath)) {
    throw safetyError('IMPORT_SAFETY_SOURCE_MISSING', '导入安全复核无法读取临时日报文件，已停止写入数据库。');
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const firstByBill = new Map((parsed.rows || []).map(row => [String(row.shipmentCode || '').trim().toUpperCase(), row]));
  const diagnostics = new Map((parsed.sheetDiagnostics || []).filter(item => item?.status === 'VALID').map(item => [item.sheetName, item]));
  const matrices = new Map();

  for (const warning of duplicateWarnings) {
    const bill = String(warning.shipmentCode || '').trim().toUpperCase();
    const first = firstByBill.get(bill);
    const diagnostic = diagnostics.get(warning.sheetName);
    const sheet = workbook.Sheets?.[warning.sheetName];
    if (!bill || !first || !diagnostic || !sheet) {
      throw safetyError('DUPLICATE_WAYBILL_REVIEW_REQUIRED', `重复运单 ${bill || '未知'} 无法完成业务归属复核，已停止导入。`, { shipmentCode: bill });
    }
    let matrix = matrices.get(warning.sheetName);
    if (!matrix) {
      matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      matrices.set(warning.sheetName, matrix);
    }
    const row = matrix[Math.max(0, Number(warning.rowNumber || 1) - 1)] || [];
    const columns = diagnostic.detectedColumns || {};
    const recipient = Number.isInteger(columns.recipient) && columns.recipient >= 0 ? row[columns.recipient] : '';
    const sender = Number.isInteger(columns.sender) && columns.sender >= 0 ? row[columns.sender] : '';
    const customerName = Number.isInteger(columns.customerName) && columns.customerName >= 0 ? row[columns.customerName] : '';
    const duplicateClassification = classifyUnifiedBusiness(bill, recipient, customerName, sender);
    if (!duplicateClassification) {
      throw safetyError(
        'DUPLICATE_WAYBILL_REVIEW_REQUIRED',
        `重复运单 ${bill} 的后续行无法根据收件人、发件人、客户名称和运单号确认业务归属，已停止导入。`,
        { shipmentCode: bill, firstBusinessType: first.businessType, sheetName: warning.sheetName, rowNumber: warning.rowNumber }
      );
    }
    if (String(duplicateClassification.businessType || '').toUpperCase() !== String(first.businessType || '').toUpperCase()) {
      return {
        shipmentCode: bill,
        firstBusinessType: String(first.businessType || '').toUpperCase(),
        duplicateBusinessType: String(duplicateClassification.businessType || '').toUpperCase(),
        sheetName: warning.sheetName,
        rowNumber: warning.rowNumber
      };
    }
  }
  return null;
}

export function assertUnifiedImportSafety({ filePath = '', parsed, manualReportDate = '' } = {}) {
  if (!parsed || typeof parsed !== 'object') throw safetyError('IMPORT_SAFETY_PARSE_MISSING', '日报解析结果为空，已停止写入数据库。');
  if (parsed.sourceReconciliation?.balanced !== true) {
    throw safetyError('SOURCE_CLASSIFICATION_RECONCILIATION_FAILED', '日报七业务分类总数与有效唯一运单数不一致，已停止导入。', { sourceReconciliation: parsed.sourceReconciliation });
  }

  const conflicts = (parsed.warnings || []).filter(item => item?.type === 'CLASSIFICATION_CONFLICT');
  if (conflicts.length || Number(parsed.summary?.classificationConflicts || 0) > 0) {
    const first = conflicts[0] || {};
    throw safetyError(
      'CLASSIFICATION_CONFLICT_BLOCKED',
      `运单 ${first.shipmentCode || '未知'} 同时命中多个强业务规则（${(first.matches || []).join(' / ') || '冲突'}），已停止导入；系统不再自动按优先级猜分流。`,
      { shipmentCode: first.shipmentCode || '', matches: first.matches || [], conflictCount: Math.max(conflicts.length, Number(parsed.summary?.classificationConflicts || 0)) }
    );
  }

  const manual = normalizeManualDate(manualReportDate);
  if (!manual && Array.isArray(parsed.explicitDateCandidates) && parsed.explicitDateCandidates.length > 1) {
    throw safetyError(
      'REPORT_DATE_CONFLICT_BLOCKED',
      `日报日期列存在多个日期（${parsed.explicitDateCandidates.map(item => item.date).join(' / ')}），已停止导入；请使用明确日报日期。`,
      { dateCandidates: parsed.explicitDateCandidates }
    );
  }
  if (!manual && parsed.dateDetectionSource === '业务日期列' && Array.isArray(parsed.transactionDateCandidates) && parsed.transactionDateCandidates.length > 1) {
    throw safetyError(
      'REPORT_DATE_AMBIGUOUS_BLOCKED',
      `文件没有明确日报日期，且业务日期存在多个值（${parsed.transactionDateCandidates.map(item => item.date).join(' / ')}），已停止按多数值猜日期。`,
      { dateCandidates: parsed.transactionDateCandidates }
    );
  }

  const duplicateConflict = findDuplicateOwnershipConflict(filePath, parsed);
  if (duplicateConflict) {
    throw safetyError(
      'DUPLICATE_WAYBILL_BUSINESS_CONFLICT',
      `重复运单 ${duplicateConflict.shipmentCode} 在同一日报中分别属于 ${duplicateConflict.firstBusinessType} / ${duplicateConflict.duplicateBusinessType}，已停止导入。`,
      duplicateConflict
    );
  }

  const validUnique = Number(parsed.summary?.validUniqueWaybills || 0);
  const classified = Number(parsed.sourceReconciliation?.classifiedWaybills || 0);
  if (validUnique <= 0 || classified !== validUnique) {
    throw safetyError('IMPORT_MEMBERSHIP_NOT_BALANCED', `日报成员守恒失败：有效唯一运单 ${validUnique}，分类合计 ${classified}，已停止导入。`);
  }

  return {
    ok: true,
    gateId: V102_UNIFIED_IMPORT_SAFETY_GATE_ID,
    reportDate: parsed.reportDate,
    validUniqueWaybills: validUnique,
    classifiedWaybills: classified,
    duplicateRows: Number(parsed.summary?.duplicateRows || 0),
    classificationConflicts: 0,
    readyForPersistence: true
  };
}

const previousPost = express.application.post;
if (typeof previousPost === 'function' && !previousPost[WRAPPED]) {
  const wrappedPost = function v151UnifiedImportSafetyPost(pathValue, ...handlers) {
    if (pathValue !== ROUTE || handlers.length === 0) return previousPost.call(this, pathValue, ...handlers);
    const finalHandler = handlers.pop();
    if (typeof finalHandler !== 'function') return previousPost.call(this, pathValue, ...handlers, finalHandler);

    const guardedFinalHandler = async function v151UnifiedImportSafety(req, res, next) {
      const startedAt = Date.now();
      try {
        if (!req?.file?.path) return await finalHandler.call(this, req, res, next);
        const parsed = parseUnifiedDailyExcel(req.file.path, {
          reportDate: req.body?.reportDate || '',
          originalName: req.file.originalname
        });
        req.ceQcParsedUnified = parsed;
        req.ceQcImportSafety = assertUnifiedImportSafety({
          filePath: req.file.path,
          parsed,
          manualReportDate: req.body?.reportDate || ''
        });
        if (typeof persistUnifiedUploadFast !== 'function') throw safetyError('IMPORT_FAST_PERSIST_NOT_READY', '快速保存模块尚未就绪，请重新启动CE QC后再导入。');
        // HARD BYPASS: after safety validation, persist and respond right here.
        // The legacy unified import final handler is intentionally NOT called.
        const saved = persistUnifiedUploadFast(parsed, req.file.originalname);
        await fsPromises.unlink(req.file.path).catch(() => {});
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-CE-QC-Import-Path', 'V151-DIRECT-SAFE-PERSIST');
        return res.json({
          ok: true,
          ...saved,
          processingDeferred: true,
          statePreparation: 'ON_PROCESS_START',
          importElapsedMs: Date.now() - startedAt,
          patchId: '2026-08-15-v151-direct-safe-persist-v2',
          safetyGateId: V102_UNIFIED_IMPORT_SAFETY_GATE_ID
        });
      } catch (error) {
        if (req?.file?.path) await fsPromises.unlink(req.file.path).catch(() => {});
        console.error('[CE-QC][V151_IMPORT_SAFETY]', error?.code || '', error?.message || error);
        if (res.headersSent) return;
        return res.status(400).json({
          ok: false,
          code: error?.code || 'UNIFIED_IMPORT_SAFETY_BLOCKED',
          error: error?.message || String(error),
          shipmentCode: error?.shipmentCode || '',
          gateId: V102_UNIFIED_IMPORT_SAFETY_GATE_ID,
          sheetDiagnostics: error?.sheetDiagnostics || []
        });
      }
    };
    return previousPost.call(this, pathValue, ...handlers, guardedFinalHandler);
  };
  Object.defineProperty(wrappedPost, WRAPPED, { value: true });
  express.application.post = wrappedPost;
}

// Install run-start hydration only after this safety wrapper exists. Import requests
// are persisted directly by V102 above; the old heavy final handler can no longer run.
const fastModule = await import('./v150UnifiedImportFastRoutePatch.js');
persistUnifiedUploadFast = fastModule.persistUnifiedUploadFast;

export const __test = { findDuplicateOwnershipConflict };
