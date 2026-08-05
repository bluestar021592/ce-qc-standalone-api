import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { persistPendingDailyMembers } from './pendingDays.js';

const STATE_KEY = 'current';
const ACTIVE_REPORT = '__active__';

export function initializeStore() {
  const db = getDb();
  const row = db.prepare('SELECT valueJson FROM app_state WHERE key=?').get(STATE_KEY);
  if (row?.valueJson) return;

  const legacy = path.join(getRuntimeConfig().dataDir, 'state.json');
  if (fs.existsSync(legacy)) {
    try {
      const state = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      saveAppState(state, { mirror: true });
    } catch {
      saveAppState({}, { mirror: true });
    }
  } else {
    saveAppState({}, { mirror: true });
  }
}

export function loadAppState() {
  initializeStore();
  const db = getDb();
  const row = db.prepare('SELECT valueJson FROM app_state WHERE key=?').get(STATE_KEY);
  if (row?.valueJson) {
    try {
      const state = JSON.parse(row.valueJson);
      if (state?.reportDate || !latestReportDate()) return attachRunState(state);
      return attachRunState(buildStateFromTables());
    } catch {}
  }
  return attachRunState(buildStateFromTables());
}

export function saveAppState(state = {}, options = {}) {
  const db = getDb();
  const now = nowIso();
  const tx = () => {
    db.prepare(`
      INSERT INTO app_state(key, valueJson, updatedAt)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET valueJson=excluded.valueJson, updatedAt=excluded.updatedAt
    `).run(STATE_KEY, JSON.stringify(state), now);

    setMeta('last_processed_report_date', state.reportDate || '');
    if (options.mirror !== false) mirrorStateTables(state, now);
  };
  runTransaction(tx);
}

export function resetAppState(nextState = {}) {
  const db = getDb();
  const now = nowIso();
  const clearTargets = [
    'daily_reports',
    'daily_parse_rows',
    'scan_results',
    'track_events',
    'final_rows',
    'pod_locks',
    'carry_bills',
    'history_summary',
    'run_checkpoints',
    'run_locks',
    'export_snapshots',
    'export_records',
    'business_daily_reports',
    'business_daily_parse_rows',
    'business_scan_results',
    'business_track_events',
    'business_final_rows',
    'business_pod_locks',
    'business_carry_bills',
    'business_history_summary',
    'business_run_checkpoints',
    'business_run_locks',
    'business_export_snapshots',
    'business_export_records',
    'business_states'
  ];
  const cleared = Object.fromEntries(clearTargets.map(table => [
    table,
    Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0)
  ]));
  runTransaction(() => {
    for (const table of clearTargets) {
      while (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
        db.exec(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} LIMIT 50000)`);
      }
    }
    db.prepare(`
      INSERT INTO app_state(key, valueJson, updatedAt)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET valueJson=excluded.valueJson, updatedAt=excluded.updatedAt
    `).run(STATE_KEY, JSON.stringify(nextState), now);
    db.prepare(`
      INSERT INTO app_meta(key, value, updatedAt)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt
    `).run('last_processed_report_date', '', now);
    db.prepare(`
      INSERT INTO app_meta(key, value, updatedAt)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt
    `).run('last_full_clear_at', now, now);
    db.prepare(`
      INSERT INTO app_meta(key, value, updatedAt)
      VALUES('current_snapshot_id', '', ?)
      ON CONFLICT(key) DO UPDATE SET value='', updatedAt=excluded.updatedAt
    `).run(now);
  });

  return cleared;
}

export function setMeta(key, value) {
  const db = getDb();
  db.prepare(`
    INSERT INTO app_meta(key, value, updatedAt)
    VALUES(?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt
  `).run(String(key || ''), String(value ?? ''), nowIso());
}

export function getMeta(key) {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key=?').get(String(key || ''));
  return row?.value || '';
}

export function getDbStatus() {
  const cfg = getRuntimeConfig();
  const db = getDb();
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM app_meta').all().map(row => [row.key, row.value]));
  return {
    ok: true,
    dbFile: cfg.dbFile,
    dataDir: cfg.dataDir,
    dbSchemaVersion: meta.db_schema_version || '',
    lastMigrationStatus: meta.last_migration_status || '',
    lastMigrationBackup: meta.last_migration_backup || '',
    appVersion: meta.app_version || '',
    lastStartupAt: meta.last_startup_at || '',
    lastBackupAt: meta.last_backup_at || '',
    lastProcessedReportDate: meta.last_processed_report_date || '',
    sqlite: 'normal',
    dataPathWarning: cfg.dataPathWarning || '',
    usingFallbackDataDir: Boolean(cfg.usingFallbackDataDir),
    backupsDir: cfg.backupsDir,
    exportsDir: cfg.exportsDir,
    longJsonExportsDir: cfg.longJsonExportsDir,
    importsDir: cfg.importsDir,
    logsDir: cfg.logsDir,
    tokenFile: cfg.tokenFile
  };
}

export function acquireRunLock(reportDate, runId, lockedBy = '') {
  const db = getDb();
  const date = String(reportDate || '').trim();
  if (!date) return { ok: false, error: '请先导入当日日报Excel。' };
  const existing = db.prepare('SELECT * FROM run_locks WHERE reportDate=?').get(date);
  if (existing && ['running', 'paused'].includes(existing.status)) {
    return { ok: false, error: '当前日期已有处理任务正在运行，请勿重复启动。', lock: existing };
  }
  const now = nowIso();
  db.prepare(`
    INSERT INTO run_locks(reportDate, runId, status, lockedBy, lockedAt, updatedAt)
    VALUES(?, ?, 'running', ?, ?, ?)
    ON CONFLICT(reportDate) DO UPDATE SET
      runId=excluded.runId,
      status='running',
      lockedBy=excluded.lockedBy,
      lockedAt=excluded.lockedAt,
      updatedAt=excluded.updatedAt
  `).run(date, runId, lockedBy, now, now);
  return { ok: true, runId };
}

export function getCurrentReportDate() {
  const db = getDb();
  const metaDate = getMeta('last_processed_report_date');
  if (metaDate && db.prepare('SELECT 1 FROM daily_reports WHERE reportDate=?').get(metaDate)) return metaDate;
  return latestReportDate();
}

export function createOrRecoverRun(reportDate, options = {}) {
  const db = getDb();
  const date = String(reportDate || '').trim();
  if (!date) return { ok: false, code: 'REPORT_DATE_MISSING', error: '请先导入当日日报Excel。' };
  if (!db.prepare('SELECT 1 FROM daily_reports WHERE reportDate=?').get(date)) {
    return { ok: false, code: 'REPORT_DATE_MISSING', error: '请先导入当日日报Excel。' };
  }

  let result = null;
  runTransaction(() => {
    const existing = db.prepare('SELECT * FROM run_locks WHERE reportDate=?').get(date);
    const recoverable = existing && (
      ['running', 'paused', 'failed'].includes(existing.status)
      || (existing.status === 'finished' && options.recoverFinished === true)
    );
    if (recoverable && existing.status === 'running' && options.rejectRunning) {
      result = { ok: false, code: 'RUN_ALREADY_ACTIVE', error: '当前日期已有处理任务正在运行，请勿重复启动。', run: existing };
      return;
    }

    const now = nowIso();
    if (recoverable) {
      db.prepare(`
        UPDATE run_locks SET status='running', errorMessage='', lockedBy=?, updatedAt=? WHERE reportDate=?
      `).run(options.lockedBy || existing.lockedBy || '', now, date);
      const run = db.prepare('SELECT * FROM run_locks WHERE reportDate=?').get(date);
      insertRunCheckpoint(db, run, 'running', '恢复未完成任务', now);
      result = { ok: true, created: false, recovered: true, run };
      return;
    }

    const runId = options.runId || randomUUID();
    db.prepare(`
      INSERT INTO run_locks(reportDate, runId, status, currentStage, batchIndex, totalBatches, errorMessage, lockedBy, lockedAt, completedAt, updatedAt)
      VALUES(?, ?, 'running', '准备处理', 0, 0, '', ?, ?, '', ?)
      ON CONFLICT(reportDate) DO UPDATE SET
        runId=excluded.runId,
        status='running',
        currentStage='准备处理',
        batchIndex=0,
        totalBatches=0,
        errorMessage='',
        lockedBy=excluded.lockedBy,
        lockedAt=excluded.lockedAt,
        completedAt='',
        updatedAt=excluded.updatedAt
    `).run(date, runId, options.lockedBy || '', now, now);
    const run = db.prepare('SELECT * FROM run_locks WHERE reportDate=?').get(date);
    insertRunCheckpoint(db, run, 'running', '创建处理任务', now);
    result = { ok: true, created: true, recovered: false, run };
  });
  return result || { ok: false, code: 'RUN_CREATE_FAILED', error: '创建处理任务失败。' };
}

export function resetRunForReport(reportDate) {
  const date = String(reportDate || '').trim();
  if (!date) return;
  runTransaction(() => {
    const db = getDb();
    db.prepare('DELETE FROM run_checkpoints WHERE reportDate=?').run(date);
    db.prepare('DELETE FROM export_snapshots WHERE reportDate=?').run(date);
    db.prepare('DELETE FROM run_locks WHERE reportDate=?').run(date);
    db.prepare("UPDATE app_meta SET value='', updatedAt=? WHERE key='current_snapshot_id'").run(nowIso());
  });
}

export function updateRunLock(reportDate, status, errorMessage = '') {
  const db = getDb();
  const nextStatus = String(status || '');
  const now = nowIso();
  db.prepare(`
    UPDATE run_locks SET status=?, errorMessage=?, completedAt=CASE WHEN ?='finished' THEN ? ELSE completedAt END, updatedAt=? WHERE reportDate=?
  `).run(nextStatus, String(errorMessage || ''), nextStatus, now, now, String(reportDate || ''));
}

export function getRunStatus(reportDate) {
  const date = String(reportDate || '').trim();
  const db = getDb();
  const lock = date ? db.prepare('SELECT * FROM run_locks WHERE reportDate=?').get(date) : null;
  const checkpoints = date
    ? db.prepare('SELECT * FROM run_checkpoints WHERE reportDate=? ORDER BY updatedAt DESC, rowid DESC LIMIT 20').all(date)
    : [];
  return { reportDate: date, lock: lock || null, checkpoints };
}

export function listExportRecords(limit = 50) {
  return getDb().prepare('SELECT * FROM export_records ORDER BY id DESC LIMIT ?').all(Number(limit || 50));
}

export function loadDetail({ reportDate, shipmentCode }) {
  const normalizedDate = String(reportDate || '').trim();
  const bill = String(shipmentCode || '').trim().toUpperCase();
  if (!bill) return null;
  const db = getDb();
  const scan = normalizedDate
    ? db.prepare('SELECT * FROM scan_results WHERE shipmentCode=? AND reportDate=? ORDER BY updatedAt DESC,rowid DESC LIMIT 1').get(bill, normalizedDate)
    : db.prepare('SELECT * FROM scan_results WHERE shipmentCode=? ORDER BY reportDate DESC,updatedAt DESC,rowid DESC LIMIT 1').get(bill);
  const finalRow = normalizedDate
    ? db.prepare('SELECT * FROM final_rows WHERE shipmentCode=? AND reportDate=? ORDER BY updatedAt DESC,rowid DESC LIMIT 1').get(bill, normalizedDate)
    : db.prepare('SELECT * FROM final_rows WHERE shipmentCode=? ORDER BY reportDate DESC,updatedAt DESC,rowid DESC LIMIT 1').get(bill);
  const events = normalizedDate
    ? db.prepare('SELECT * FROM track_events WHERE shipmentCode=? AND reportDate=? ORDER BY eventTime,id').all(bill, normalizedDate)
    : db.prepare('SELECT * FROM track_events WHERE shipmentCode=? ORDER BY reportDate DESC,eventTime,id').all(bill);
  const dailyRows = normalizedDate
    ? db.prepare('SELECT * FROM daily_parse_rows WHERE shipmentCode=? AND reportDate=? ORDER BY rowNumber,id LIMIT 20').all(bill, normalizedDate)
    : db.prepare('SELECT * FROM daily_parse_rows WHERE shipmentCode=? ORDER BY reportDate DESC,rowNumber,id LIMIT 20').all(bill);
  const podLock = db.prepare('SELECT * FROM pod_locks WHERE shipmentCode=?').get(bill);
  const carry = db.prepare('SELECT * FROM carry_bills WHERE shipmentCode=? ORDER BY updatedAt DESC LIMIT 5').all(bill);
  return { reportDate: normalizedDate, shipmentCode: bill, scan: inflateRow(scan), finalRow: inflateRow(finalRow), events: events.map(inflateRow), dailyRows, podLock: podLock || null, carry };
}

function mirrorStateTables(state, now) {
  const reportDate = state.reportDate || ACTIVE_REPORT;
  mirrorPodLocks(state, now);
  mirrorCarryBills(state, reportDate, now);
  mirrorDaily(state, reportDate, now);
  mirrorScanResults(state, reportDate, now);
  mirrorTrackEvents(state, reportDate, now);
  persistPendingDailyMembers(getDb(), { businessType: 'CCSL', reportDate, snapshotId: state.snapshotId || '', events: state.trackEvents || [], createdAt: now });
  mirrorFinalRows(state, reportDate, now);
  mirrorHistory(state, now);
  mirrorCheckpoint(state, reportDate, now);
}

function mirrorPodLocks(state, now) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO pod_locks(shipmentCode, source, podTime, evidenceType, evidenceText, lastSeenReportDate, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shipmentCode) DO UPDATE SET
      lastSeenReportDate=excluded.lastSeenReportDate,
      updatedAt=excluded.updatedAt
  `);
  for (const wb of cleanBills(state.podLocks || [])) {
    stmt.run(wb, 'state', '', 'state', '', state.reportDate || '', now, now);
  }
}

function mirrorCarryBills(state, reportDate, now) {
  const db = getDb();
  const nextCarry = cleanBills(state.nextCarryBills || state.carryBills || []);
  const previousActive = new Map(db.prepare(`
    SELECT * FROM carry_bills WHERE status='active' ORDER BY updatedAt DESC
  `).all().map(row => [row.shipmentCode, row]));
  const finalByBill = new Map((state.finalRows || []).map(row => [billOf(row), row]));
  const runId = state.currentRun?.runId || state.lastRunSummary?.runId || state.lastRun?.runId || '';
  for (const wb of cleanBills(state.podLocks || [])) {
    db.prepare('UPDATE carry_bills SET status=?, updatedAt=? WHERE shipmentCode=? AND status=?')
      .run('pod_closed', now, wb, 'active');
  }
  db.prepare('DELETE FROM carry_bills WHERE reportDate=?').run(reportDate);
  const stmt = db.prepare(`
    INSERT INTO carry_bills(
      shipmentCode, reportDate, sourceDate, sourceType, status, reason,
      lastCategory, lastEventTime, lastCheckedDate, primaryCategory, tagsJson,
      lastEventDesc, matchedShopCode, lastRunId, createdAt, updatedAt
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const wb of nextCarry) {
    const previous = previousActive.get(wb) || {};
    const row = finalByBill.get(wb) || {};
    db.prepare('UPDATE carry_bills SET status=?, updatedAt=? WHERE shipmentCode=? AND status=?')
      .run('rolled_forward', now, wb, 'active');
    stmt.run(
      wb,
      reportDate,
      previous.sourceDate || state.reportDate || reportDate,
      row?.来源类型 || previous.sourceType || 'next_carry',
      'active',
      row?.QC判断 || row?.qcConclusion || '明日继续跨日',
      row?.异常分类 || row?.category || previous.lastCategory || '',
      row?.最后节点时间 || row?.lastEventTime || previous.lastEventTime || '',
      reportDate,
      row?.primaryCategory || row?.主分类 || row?.异常分类 || previous.primaryCategory || '',
      JSON.stringify(Array.isArray(row?.tags) ? row.tags : parseJson(previous.tagsJson || '[]', [])),
      row?.lastEventDesc || row?.最后节点 || previous.lastEventDesc || '',
      row?.matchedShopCode || row?.门店编码 || previous.matchedShopCode || '',
      runId || previous.lastRunId || '',
      previous.createdAt || now,
      now
    );
  }
}

function mirrorDaily(state, reportDate, now) {
  const db = getDb();
  if (!state.dailyParseSummary && !(state.dailyParseRows || []).length) return;
  const s = state.dailyParseSummary || {};
  db.prepare(`
    INSERT INTO daily_reports(reportDate, sourceFile, fileHash, pnhCount, nonPnhCount, excludedCount, duplicateCount, totalUniqueCount, totalAppearCount, summaryJson, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reportDate) DO UPDATE SET
      sourceFile=excluded.sourceFile,
      pnhCount=excluded.pnhCount,
      nonPnhCount=excluded.nonPnhCount,
      excludedCount=excluded.excludedCount,
      duplicateCount=excluded.duplicateCount,
      totalUniqueCount=excluded.totalUniqueCount,
      totalAppearCount=excluded.totalAppearCount,
      summaryJson=excluded.summaryJson,
      updatedAt=excluded.updatedAt
  `).run(
    reportDate,
    state.sourceName || '',
    '',
    Number(s.pnh || s.pnhCount || 0),
    Number(s.nonPnh || s.nonPnhCount || 0),
    Number(s.excluded || s.excludedCount || 0),
    Number(s.duplicates || s.duplicateCount || 0),
    Number(s.totalRecognized || s.totalUniqueCount || 0),
    Number(s.totalAppearances || s.totalAppearCount || 0),
    JSON.stringify(s),
    now,
    now
  );

  db.prepare('DELETE FROM daily_parse_rows WHERE reportDate=?').run(reportDate);
  const stmt = db.prepare(`
    INSERT INTO daily_parse_rows(reportDate, sheetName, rowNumber, shipmentCode, result, reason, rawText, rowJson, createdAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of state.dailyParseRows || state.daily?.details || []) {
    stmt.run(
      reportDate,
      row?.sheetName || '',
      Number(row?.rowNumber || 0),
      billOf(row),
      row?.result || '',
      row?.reason || '',
      row?.rawText || row?.原始行摘要 || '',
      JSON.stringify(row || {}),
      now
    );
  }
}

function mirrorScanResults(state, reportDate, now) {
  const db = getDb();
  db.prepare('DELETE FROM scan_results WHERE reportDate=?').run(reportDate);
  const stmt = db.prepare(`
    INSERT INTO scan_results(shipmentCode, reportDate, sourceType, orderStatus, isPod, scanCategory, pickupShop, deliveryShop, productCode, customerName, rawSummary, rawJson, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shipmentCode, reportDate) DO UPDATE SET
      orderStatus=excluded.orderStatus,
      isPod=excluded.isPod,
      scanCategory=excluded.scanCategory,
      rawSummary=excluded.rawSummary,
      rawJson=excluded.rawJson,
      updatedAt=excluded.updatedAt
  `);
  for (const row of state.scanResults || []) {
    const wb = billOf(row);
    if (!wb) continue;
    const rawJson = stringifyRaw(row?.rawJson || row);
    stmt.run(wb, reportDate, row?.来源类型 || row?.sourceType || '', String(row?.orderStatus || ''), isPod(row), row?.扫描分类 || row?.scanCategory || '', row?.pickupShop || '', row?.deliveryShop || '', row?.productCode || '', row?.customerName || '', row?.原始返回摘要 || row?.rawSummary || '', rawJson, now, now);
  }
}

function mirrorTrackEvents(state, reportDate, now) {
  const db = getDb();
  db.prepare('DELETE FROM track_events WHERE reportDate=?').run(reportDate);
  const stmt = db.prepare(`
    INSERT INTO track_events(shipmentCode, reportDate, eventCode, trackingEventCode, trackingEventDesc, trackingEventDescZh, trackingEventDescKm, eventTime, operator, eventCourier, place, rawJson, createdAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of state.trackEvents || []) {
    const wb = billOf(row);
    if (!wb) continue;
    stmt.run(wb, reportDate, row?.eventCode || '', row?.trackingEventCode || '', row?.trackingEventDesc || '', row?.trackingEventDescZh || '', row?.trackingEventDescKm || '', row?.eventTime || '', row?.operator || '', row?.eventCourier || '', row?.place || '', stringifyRaw(row?.rawJson || row), now);
  }
}

function mirrorFinalRows(state, reportDate, now) {
  const db = getDb();
  db.prepare('DELETE FROM final_rows WHERE reportDate=?').run(reportDate);
  const stmt = db.prepare(`
    INSERT INTO final_rows(shipmentCode, reportDate, sourceType, isPod, category, qcConclusion, lastEvent, lastEventTime, lastEventCode, lastEventDesc, lastEventTargetNode, lastEventActionType, matchedRule, matchedShopCode, matchedShopName, primaryCategory, tagsJson, pendingDays, ocDays, cycleCountDays, assignDays, deliveringDays, trackNodeCount, eventCourier, pickupShop, deliveryShop, productCode, customerName, rawSummary, rawJson, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shipmentCode, reportDate) DO UPDATE SET
      isPod=excluded.isPod,
      category=excluded.category,
      qcConclusion=excluded.qcConclusion,
      lastEvent=excluded.lastEvent,
      lastEventTime=excluded.lastEventTime,
      lastEventCode=excluded.lastEventCode,
      lastEventDesc=excluded.lastEventDesc,
      lastEventTargetNode=excluded.lastEventTargetNode,
      lastEventActionType=excluded.lastEventActionType,
      matchedRule=excluded.matchedRule,
      matchedShopCode=excluded.matchedShopCode,
      matchedShopName=excluded.matchedShopName,
      primaryCategory=excluded.primaryCategory,
      tagsJson=excluded.tagsJson,
      rawJson=excluded.rawJson,
      updatedAt=excluded.updatedAt
  `);
  for (const row of state.finalRows || []) {
    const wb = billOf(row);
    if (!wb) continue;
    stmt.run(
      wb,
      reportDate,
      row?.来源类型 || row?.sourceType || '',
      isPod(row),
      row?.异常分类 || row?.category || '',
      row?.QC判断 || row?.qcConclusion || '',
      row?.最后节点 || row?.lastEvent || '',
      row?.最后节点时间 || row?.最后时间 || row?.lastEventTime || '',
      row?.lastEventCode || '',
      row?.lastEventDesc || row?.最后节点 || '',
      row?.lastEventTargetNode || row?.最后节点目标网点 || '',
      row?.lastEventActionType || row?.最后节点动作类型 || '',
      row?.matchedRule || row?.命中规则 || '',
      row?.matchedShopCode || row?.门店编码 || '',
      row?.matchedShopName || row?.门店名称 || '',
      row?.primaryCategory || row?.主分类 || row?.异常分类 || '',
      JSON.stringify(Array.isArray(row?.tags) ? row.tags : []),
      Number(row?.Pending天数 || row?.pendingDays || 0),
      Number(row?.OC天数 || row?.ocDays || 0),
      Number(row?.盘点天数 || row?.cycleCountDays || 0),
      Number(row?.派件分配天数 || row?.assignDays || 0),
      Number(row?.派送停留天数 || row?.deliveringDays || 0),
      Number(row?.轨迹节点数 || row?.trackNodeCount || 0),
      row?.eventCourier || '',
      row?.pickupShop || '',
      row?.deliveryShop || '',
      row?.productCode || '',
      row?.customerName || '',
      row?.轨迹摘要 || row?.rawSummary || '',
      JSON.stringify(row || {}),
      now,
      now
    );
  }
}

function mirrorHistory(state, now) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO history_summary(reportDate, summaryJson, createdAt, updatedAt)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(reportDate) DO UPDATE SET summaryJson=excluded.summaryJson, updatedAt=excluded.updatedAt
  `);
  for (const item of (state.historySummary || []).slice(-30)) {
    const reportDate = item?.reportDate || item?.summary?.reportDate || '';
    if (!reportDate) continue;
    stmt.run(reportDate, JSON.stringify(item?.summary || item || {}), now, now);
  }
}

function mirrorCheckpoint(state, reportDate, now) {
  const db = getDb();
  const processing = state.processing || {};
  const runId = state.currentRun?.runId || state.lastRunSummary?.runId || state.lastRun?.runId || '';
  if (!runId || !reportDate || reportDate === ACTIVE_REPORT) return;
  const status = processing.error ? 'failed' : (processing.paused ? 'paused' : (processing.running ? 'running' : (processing.phase === '完成' ? 'finished' : 'running')));
  const batchIndex = Number(processing.batchIndex || 0);
  const totalBatches = Number(processing.totalBatches || 0);
  db.prepare(`
    UPDATE run_locks SET status=?, currentStage=?, batchIndex=?, totalBatches=?, errorMessage=?, updatedAt=?
    WHERE reportDate=? AND runId=?
  `).run(status, processing.phase || 'state', batchIndex, totalBatches, processing.error || '', now, reportDate, runId);
  db.prepare(`
    INSERT INTO run_checkpoints(runId, reportDate, stage, batchIndex, totalBatches, status, payloadJson, errorMessage, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    reportDate,
    processing.phase || 'state',
    batchIndex,
    totalBatches,
    status,
    JSON.stringify({
      scanResults: (state.scanResults || []).length,
      trackResults: (state.trackResults || []).length,
      trackEvents: (state.trackEvents || []).length,
      finalRows: (state.finalRows || []).length,
      nextCarryBills: (state.nextCarryBills || []).length,
      lastRunSummary: state.lastRunSummary || null
    }),
    processing.error || '',
    now,
    now
  );
}

function buildStateFromTables() {
  const db = getDb();
  const latest = getMeta('last_processed_report_date') || latestReportDate();
  const reportDate = latest || '';
  const dailyReport = db.prepare('SELECT * FROM daily_reports WHERE reportDate=?').get(reportDate);
  const dailyParseRows = db.prepare('SELECT rowJson FROM daily_parse_rows WHERE reportDate=? ORDER BY id').all(reportDate).map(row => parseJson(row.rowJson, {}));
  const podLocks = db.prepare('SELECT shipmentCode FROM pod_locks ORDER BY shipmentCode').all().map(row => row.shipmentCode);
  const podSet = new Set(cleanBills(podLocks));
  const run = reportDate ? db.prepare('SELECT * FROM run_locks WHERE reportDate=?').get(reportDate) : null;
  return {
    reportDate,
    sourceName: dailyReport?.sourceFile || '',
    dailyParseSummary: dailyReport ? parseJson(dailyReport.summaryJson || '', {
      pnh: dailyReport.pnhCount || 0,
      nonPnh: dailyReport.nonPnhCount || 0,
      excluded: dailyReport.excludedCount || 0,
      duplicates: dailyReport.duplicateCount || 0,
      totalRecognized: dailyReport.totalUniqueCount || 0,
      totalAppearances: dailyReport.totalAppearCount || 0
    }) : null,
    dailyParseRows,
    pnhBills: dailyParseRows.filter(row => row?.result === 'PNH').map(billOf).filter(Boolean),
    nonPnhBills: dailyParseRows.filter(row => row?.result === '非PNH').map(billOf).filter(Boolean),
    excludedBills: dailyParseRows.filter(row => row?.result === '排除').map(billOf).filter(Boolean),
    duplicateBills: dailyParseRows.filter(row => row?.result === '重复' || row?.duplicate).map(billOf).filter(Boolean),
    podLocks,
    carryBills: db.prepare('SELECT shipmentCode FROM carry_bills WHERE status=? ORDER BY shipmentCode').all('active').map(row => row.shipmentCode).filter(wb => !podSet.has(wb)),
    scanResults: db.prepare('SELECT rawJson FROM scan_results WHERE reportDate=? ORDER BY shipmentCode').all(reportDate).map(row => parseJson(row.rawJson, {})),
    trackEvents: db.prepare('SELECT rawJson FROM track_events WHERE reportDate=? ORDER BY eventTime').all(reportDate).map(row => parseJson(row.rawJson, {})),
    finalRows: db.prepare('SELECT rawJson FROM final_rows WHERE reportDate=? ORDER BY shipmentCode').all(reportDate).map(row => parseJson(row.rawJson, {})),
    historySummary: db.prepare(`
      SELECT reportDate, summaryJson
      FROM (
        SELECT reportDate, summaryJson
        FROM history_summary
        ORDER BY reportDate DESC
        LIMIT 30
      )
      ORDER BY reportDate ASC
    `).all().map(row => ({ reportDate: row.reportDate, summary: parseJson(row.summaryJson, {}) })),
    currentRun: run || null,
    lastRunSummary: run ? { runId: run.runId, reportDate } : null,
    processing: run ? {
      running: run.status === 'running',
      paused: run.status === 'paused',
      phase: run.currentStage || '',
      batchIndex: Number(run.batchIndex || 0),
      totalBatches: Number(run.totalBatches || 0)
    } : { running: false, paused: false, phase: '' },
    logs: []
  };
}

function attachRunState(state = {}) {
  const reportDate = String(state.reportDate || getCurrentReportDate() || '').trim();
  const run = reportDate ? getDb().prepare('SELECT * FROM run_locks WHERE reportDate=?').get(reportDate) : null;
  if (!reportDate) return { ...state, reportDate: '', currentRun: null };
  const processing = run && ['running', 'paused', 'failed'].includes(run.status)
    ? {
        ...(state.processing || {}),
        running: run.status === 'running',
        paused: run.status === 'paused',
        phase: run.currentStage || state.processing?.phase || '',
        batchIndex: Number(run.batchIndex || 0),
        totalBatches: Number(run.totalBatches || 0),
        error: run.errorMessage || ''
      }
    : (state.processing || { running: false, paused: false, phase: '' });
  return {
    ...state,
    reportDate,
    currentRun: run || null,
    lastRunSummary: run
      ? { ...(state.lastRunSummary || {}), runId: run.runId, reportDate, runStatus: run.status }
      : state.lastRunSummary || null,
    processing
  };
}

function insertRunCheckpoint(db, run, status, message, now) {
  db.prepare(`
    INSERT INTO run_checkpoints(runId, reportDate, stage, batchIndex, totalBatches, status, payloadJson, errorMessage, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, '', ?, ?)
  `).run(
    run.runId,
    run.reportDate,
    run.currentStage || '准备处理',
    Number(run.batchIndex || 0),
    Number(run.totalBatches || 0),
    status,
    JSON.stringify({ message }),
    now,
    now
  );
}

function latestReportDate() {
  return getDb().prepare('SELECT reportDate FROM daily_reports ORDER BY updatedAt DESC LIMIT 1').get()?.reportDate || '';
}

function runTransaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function inflateRow(row) {
  if (!row) return null;
  const raw = parseJson(row.rawJson || '', null);
  return raw && typeof raw === 'object' ? { ...row, ...raw } : row;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function stringifyRaw(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
}

function cleanBills(list) {
  return [...new Set((list || []).map(x => String(x || '').trim().toUpperCase()).filter(Boolean))];
}

function billOf(row) {
  return String(row?.运单号 || row?.shipmentCode || row?.waybill || row?.billNo || '').trim().toUpperCase();
}

function isPod(row) {
  return row?.是否POD === '是' || row?.异常分类 === 'POD闭环' || String(row?.orderStatus || '') === '85' ? 1 : 0;
}
