from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

# 1) businessStore: stop loading/saving one giant SHOPEE JSON payload.
p = Path('src/businessStore.js')
text = p.read_text(encoding='utf-8')

old = """export function loadBusinessState(businessType = SHOPEE) {
  const type = normalizeType(businessType);
  const row = getDb().prepare('SELECT valueJson FROM business_states WHERE businessType=?').get(type);
  if (!row?.valueJson) return emptyState(type);
  try { return restrictShopeeState(normalizeBusinessState(JSON.parse(row.valueJson), type), type); } catch { return emptyState(type); }
}
"""
new = """export function loadBusinessState(businessType = SHOPEE) {
  const type = normalizeType(businessType);
  const db = getDb();
  // Legacy versions stored the whole processing state (including every raw event)
  // in one JSON string. Large SHOPEE days can exceed V8's maximum string length.
  // Read a compact payload only when it is reasonably small; otherwise rebuild
  // the current state from the normalized SQLite tables without materializing the
  // legacy giant JSON in Node.js memory.
  const meta = db.prepare('SELECT length(valueJson) AS jsonLength FROM business_states WHERE businessType=?').get(type);
  let base = emptyState(type);
  const jsonLength = Number(meta?.jsonLength || 0);
  if (jsonLength > 0 && jsonLength <= 96 * 1024 * 1024) {
    const row = db.prepare('SELECT valueJson FROM business_states WHERE businessType=?').get(type);
    try { base = normalizeBusinessState(JSON.parse(row?.valueJson || '{}'), type); } catch { base = emptyState(type); }
  } else if (jsonLength > 0) {
    try {
      const row = db.prepare(`SELECT
        json_extract(valueJson,'$.reportDate') AS reportDate,
        json_extract(valueJson,'$.sourceName') AS sourceName,
        json_extract(valueJson,'$.snapshotId') AS snapshotId
        FROM business_states WHERE businessType=?`).get(type);
      base = normalizeBusinessState({ ...base, ...row }, type);
    } catch {}
  }
  const hydrated = hydrateBusinessStateFromTables(db, base, type);
  return restrictShopeeState(hydrated, type);
}
"""
text = replace_once(text, old, new, 'loadBusinessState')

old = """  const normalized = restrictShopeeState(normalizeBusinessState(state, type), type);
  const db = getDb();
  const now = nowIso();
"""
new = """  const normalized = restrictShopeeState(normalizeBusinessState(state, type), type);
  const persisted = compactBusinessStatePayload(normalized);
  const db = getDb();
  const now = nowIso();
"""
text = replace_once(text, old, new, 'saveBusinessState persisted')
text = replace_once(text, ".run(type, JSON.stringify(normalized), now);", ".run(type, JSON.stringify(persisted), now);", 'saveBusinessState stringify')

old = """  const snapshotState = { ...state, businessType: type, snapshotId };
"""
new = """  const snapshotState = {
    ...compactBusinessStatePayload(normalizeBusinessState(state, type)),
    businessType: type,
    snapshotId,
    // Keep final rows in the immutable snapshot for count/reconciliation checks,
    // but never embed raw API payloads or cumulative track events again.
    finalRows: (state.finalRows || []).map(stripHeavyBusinessRow),
    trackResults: [],
    trackEvents: [],
    scanResults: [],
    shipmentTrackResults: [],
    exceptionItems: [],
    dailyParseRows: []
  };
"""
text = replace_once(text, old, new, 'snapshotState compaction')

helper = r'''
function parseJsonSafe(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function stripHeavyBusinessRow(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  // Raw API bodies remain available in the normalized scan/event tables. Do not
  // duplicate them inside state/snapshot JSON where they multiply memory usage.
  delete copy.rawJson;
  delete copy.raw;
  delete copy.events;
  delete copy.trackEvents;
  delete copy.exceptionItems;
  delete copy.scanRaw;
  return copy;
}

function compactBusinessStatePayload(state = {}) {
  const summary = state.dailyParseSummary || state.daily?.summary || null;
  const compactDaily = state.daily ? {
    reportDate: state.reportDate || state.daily.reportDate || '',
    sourceName: state.sourceName || state.daily.sourceName || '',
    importedAt: state.daily.importedAt || summary?.importedAt || '',
    summary
  } : null;
  return {
    ...state,
    daily: compactDaily,
    dailyParseRows: [],
    recipientConflicts: [],
    scanResults: [],
    scanQueryStatus: [],
    shipmentTrackResults: [],
    shipmentQueryStatus: [],
    trackEvents: [],
    eventQueryStatus: [],
    exceptionItems: [],
    exceptionQueryStatus: [],
    apiBatchStatus: [],
    // Track results are the only large-ish array retained because they are the
    // resume checkpoint after an event batch. Strip embedded raw scan bodies.
    trackResults: (state.trackResults || []).map(stripHeavyBusinessRow),
    finalRows: [],
    priorCarryRows: (state.priorCarryRows || []).map(stripHeavyBusinessRow)
  };
}

function rowsFromJson(db, sql, params = [], field = 'rawJson') {
  try {
    return db.prepare(sql).all(...params)
      .map(row => parseJsonSafe(row?.[field], null))
      .filter(Boolean)
      .map(stripHeavyBusinessRow);
  } catch {
    return [];
  }
}

function hydrateBusinessStateFromTables(db, state = {}, type = SHOPEE) {
  let date = String(state.reportDate || '').trim();
  if (!date) {
    const latest = db.prepare('SELECT reportDate,sourceFile,summaryJson FROM business_daily_reports WHERE businessType=? ORDER BY updatedAt DESC,reportDate DESC LIMIT 1').get(type);
    if (!latest?.reportDate) return state;
    date = latest.reportDate;
    state = { ...state, reportDate: date, sourceName: latest.sourceFile || state.sourceName || '' };
  }

  const report = db.prepare('SELECT sourceFile,totalCount,summaryJson FROM business_daily_reports WHERE businessType=? AND reportDate=?').get(type, date);
  const dailySummary = parseJsonSafe(report?.summaryJson, state.dailyParseSummary || null);
  const dailyRows = rowsFromJson(db,
    'SELECT rowJson FROM business_daily_parse_rows WHERE businessType=? AND reportDate=? ORDER BY id',
    [type, date], 'rowJson');
  const scanResults = rowsFromJson(db,
    'SELECT rawJson FROM business_scan_results WHERE businessType=? AND reportDate=? ORDER BY shipmentCode',
    [type, date]);
  const shipmentTrackResults = rowsFromJson(db,
    'SELECT rawJson FROM business_shipment_tracks WHERE businessType=? AND reportDate=? ORDER BY shipmentCode',
    [type, date]);
  const trackEvents = rowsFromJson(db,
    'SELECT rawJson FROM business_track_events WHERE businessType=? AND reportDate=? ORDER BY eventTime,id',
    [type, date]);
  const exceptionItems = rowsFromJson(db,
    'SELECT rawJson FROM business_exception_items WHERE businessType=? AND reportDate=? ORDER BY reportTime,id',
    [type, date]);
  const finalRows = rowsFromJson(db,
    'SELECT rawJson FROM business_final_rows WHERE businessType=? AND reportDate=? ORDER BY shipmentCode',
    [type, date]);

  const conflictRows = db.prepare('SELECT shipmentCode,groupsJson,rowsJson,status FROM business_recipient_conflicts WHERE businessType=? AND reportDate=? ORDER BY id').all(type, date)
    .map(row => ({ shipmentCode: row.shipmentCode, groups: parseJsonSafe(row.groupsJson, []), rows: parseJsonSafe(row.rowsJson, []), status: row.status || '' }));
  const apiBatchStatus = db.prepare('SELECT runId,apiName,batchKey,shipmentCodesJson,status,attemptCount,resultCount,errorMessage,createdAt,updatedAt FROM business_api_batches WHERE businessType=? AND reportDate=? ORDER BY updatedAt').all(type, date)
    .map(row => ({ ...row, shipmentCodes: parseJsonSafe(row.shipmentCodesJson, []) }));
  const podLocks = db.prepare('SELECT shipmentCode FROM business_pod_locks WHERE businessType=? ORDER BY shipmentCode').all(type).map(row => row.shipmentCode);
  const carryRowsRaw = rowsFromJson(db,
    'SELECT rawJson FROM business_carry_bills WHERE businessType=? ORDER BY updatedAt DESC',
    [type]);
  const carryByBill = new Map();
  for (const row of carryRowsRaw) {
    const bill = billOf(row);
    if (bill && !carryByBill.has(bill)) carryByBill.set(bill, row);
  }
  const carryRows = [...carryByBill.values()].filter(row => !String(row.carry状态 || row.status || '').startsWith('closed'));
  const carryBills = carryRows.map(billOf).filter(Boolean);
  const run = db.prepare('SELECT * FROM business_run_locks WHERE businessType=? AND reportDate=?').get(type, date) || null;
  const historyRows = db.prepare('SELECT summaryJson FROM business_history_summary WHERE businessType=? ORDER BY reportDate DESC LIMIT 30').all(type)
    .map(row => parseJsonSafe(row.summaryJson, null)).filter(Boolean).reverse();
  const latestSnapshot = db.prepare("SELECT snapshotId FROM business_export_snapshots WHERE businessType=? AND reportDate=? AND COALESCE(status,'VALID')='VALID' ORDER BY id DESC LIMIT 1").get(type, date);
  const pnhBills = dailyRows.map(billOf).filter(Boolean);
  const podSet = new Set(podLocks);
  const scanPool = [...new Set([...pnhBills, ...carryBills])].filter(bill => !podSet.has(bill));
  const needTrackBills = scanResults.filter(row => row.trackRequired === true && row.是否POD !== '是').map(billOf).filter(Boolean);
  const currentSummary = historyRows.find(item => String(item?.reportDate || '') === date) || state.lastRunSummary || null;

  return normalizeBusinessState({
    ...state,
    businessType: type,
    reportDate: date,
    sourceName: report?.sourceFile || state.sourceName || '',
    dailyReportReady: Boolean(report || dailyRows.length),
    dailyParseSummary: dailySummary,
    daily: state.daily || (report ? { reportDate: date, sourceName: report.sourceFile || '', summary: dailySummary } : null),
    dailyParseRows: dailyRows,
    recipientConflicts: conflictRows,
    recipientReconciliation: state.recipientReconciliation || dailySummary?.reconciliation || null,
    pnhBills: pnhBills.length ? pnhBills : state.pnhBills,
    podLocks,
    carryBills,
    priorCarryRows: carryRows,
    scanPool,
    scanResults,
    shipmentTrackResults,
    trackEvents,
    exceptionItems,
    apiBatchStatus,
    finalRows,
    needTrackBills,
    historySummary: historyRows.length ? historyRows : state.historySummary,
    processing: run ? {
      running: run.status === 'running',
      paused: run.status === 'paused',
      phase: run.currentStage || '',
      batchIndex: Number(run.batchIndex || 0),
      totalBatches: Number(run.totalBatches || 0),
      error: run.errorMessage || '',
      runId: run.runId || ''
    } : state.processing,
    currentRun: run || state.currentRun,
    lastRunSummary: currentSummary,
    lastRun: currentSummary,
    snapshotId: latestSnapshot?.snapshotId || state.snapshotId || ''
  }, type);
}

'''
text = replace_once(text, "export function normalizeBusinessState(state = {}, businessType = SHOPEE) {", helper + "export function normalizeBusinessState(state = {}, businessType = SHOPEE) {", 'businessStore helpers')
p.write_text(text, encoding='utf-8')

# 2) analyzer: preserve all useful top-level event fields but remove the duplicate
# rawJson string copy from every event.
p = Path('src/analyzer.js')
text = p.read_text(encoding='utf-8')
old = """export function normalizeEvent(e) {
  return {
    ...e,
    shipmentCode: String(e?.shipmentCode || e?.运单号 || '').toUpperCase(),
    eventCode: String(e?.eventCode || ''),
    trackingEventCode: String(e?.trackingEventCode || ''),
    trackingEventDesc: e?.trackingEventDesc || '',
    trackingEventDescZh: e?.trackingEventDescZh || '',
    trackingEventDescKm: e?.trackingEventDescKm || '',
    eventTime: e?.eventTime || e?.creationDate || e?.lastUpdateDate || '',
    operator: e?.operator || '',
    eventCourier: e?.eventCourier || '',
    eventShop: e?.eventShop || e?.eventShopName || e?.shopName || '',
    locationCode: e?.locationCode || '',
    place: e?.place || '',
    rawJson: e?.rawJson || JSON.stringify(e || {})
  };
}
"""
new = """export function normalizeEvent(e) {
  const source = e && typeof e === 'object' ? { ...e } : {};
  // Do not embed a JSON-string copy of the whole event inside the event itself.
  // The normalized SQLite event row is already the raw evidence record. Keeping
  // rawJson here doubles every track payload and caused large SHOPEE days to hit
  // V8's maximum string/heap limits.
  delete source.rawJson;
  return {
    ...source,
    shipmentCode: String(e?.shipmentCode || e?.运单号 || '').toUpperCase(),
    eventCode: String(e?.eventCode || ''),
    trackingEventCode: String(e?.trackingEventCode || ''),
    trackingEventDesc: e?.trackingEventDesc || '',
    trackingEventDescZh: e?.trackingEventDescZh || '',
    trackingEventDescKm: e?.trackingEventDescKm || '',
    eventTime: e?.eventTime || e?.creationDate || e?.lastUpdateDate || '',
    operator: e?.operator || '',
    eventCourier: e?.eventCourier || '',
    eventShop: e?.eventShop || e?.eventShopName || e?.shopName || '',
    locationCode: e?.locationCode || '',
    place: e?.place || ''
  };
}
"""
text = replace_once(text, old, new, 'normalizeEvent raw duplication')
p.write_text(text, encoding='utf-8')

# 3) pipeline: strip embedded raw scan payloads from SHOPEE analysis results before
# they become checkpoint/final arrays. Raw scans are separately persisted already.
p = Path('src/pipeline.js')
text = p.read_text(encoding='utf-8')
marker = "async function runShopeePipeline({ state, client, onProgress, onCheckpoint, isPaused, startedAt }) {"
if marker not in text:
    raise SystemExit('anchor not found: runShopeePipeline')
head, tail = text.split(marker, 1)
helper = """function stripHeavyPipelineRow(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  delete copy.rawJson;
  delete copy.raw;
  delete copy.events;
  delete copy.trackEvents;
  delete copy.exceptionItems;
  delete copy.scanRaw;
  return copy;
}

"""
if 'function stripHeavyPipelineRow(' not in head:
    head += helper
# The SHOPEE-specific result push is the first one after the marker.
tail = replace_once(tail, "    trackResults.push(result);", "    trackResults.push(stripHeavyPipelineRow(result));", 'shopee trackResults push')
tail = replace_once(tail,
    "  state.trackResults = trackResults;\n  state.finalRows = finalRows;",
    "  state.trackResults = trackResults.map(stripHeavyPipelineRow);\n  state.finalRows = finalRows.map(stripHeavyPipelineRow);",
    'shopee final state strip')
text = head + marker + tail
p.write_text(text, encoding='utf-8')

# 4) Add regression test.
test = Path('test/v25-shopee-large-state.test.js')
test.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v25-'));
process.env.DATA_DIR = root;
process.env.DB_FILE = path.join(root, 'v25.db');

const { getDb, closeDb } = await import('../src/db.js');
const { SHOPEE, saveBusinessState, loadBusinessState, saveBusinessSnapshot } = await import('../src/businessStore.js');

function dailyRow(code) {
  return { shipmentCode: code, 运单号: code, recipient_group: 'CN', recipient_raw: 'SHOPEECN', recipient_normalized: 'SHOPEECN', source_row_number: 1 };
}

test('V25 stores large track evidence outside the single business_states JSON', () => {
  const hugeText = 'x'.repeat(20_000);
  const bills = ['A001', 'A002', 'A003'];
  const state = {
    businessType: SHOPEE,
    reportDate: '2026-08-08',
    sourceName: '8-8.xls',
    dailyReportReady: true,
    dailyParseSummary: { totalRecognized: 3, reconciliation: { status: 'PASSED' } },
    dailyParseRows: bills.map(dailyRow),
    pnhBills: bills,
    carryBills: [],
    podLocks: [],
    scanResults: bills.map(code => ({ ...dailyRow(code), reportDate: '2026-08-08', trackRequired: true, 是否POD: '否', rawJson: { payload: hugeText } })),
    trackEvents: Array.from({ length: 120 }, (_, i) => ({ shipmentCode: bills[i % bills.length], reportDate: '2026-08-08', eventTime: `2026-08-08T00:${String(i % 60).padStart(2,'0')}:00`, eventCode: '10', note: hugeText })),
    trackResults: bills.map(code => ({ ...dailyRow(code), reportDate: '2026-08-08', 是否POD: '否', primaryCategory: 'Pending1次', rawJson: { payload: hugeText } })),
    finalRows: bills.map(code => ({ ...dailyRow(code), reportDate: '2026-08-08', 是否POD: '否', primaryCategory: 'Pending1次', rawJson: { payload: hugeText } })),
    processing: { running: true, paused: false, phase: '轨迹查询', batchIndex: 1, totalBatches: 2, runId: 'run-v25' },
    currentRun: { runId: 'run-v25', reportDate: '2026-08-08' },
    lastRunSummary: { runId: 'run-v25', reportDate: '2026-08-08', runStatus: 'running' }
  };

  saveBusinessState(state, SHOPEE);
  const db = getDb();
  const stored = db.prepare('SELECT length(valueJson) AS n FROM business_states WHERE businessType=?').get(SHOPEE);
  assert.ok(Number(stored.n) < 500_000, `compact state unexpectedly large: ${stored.n}`);
  assert.equal(db.prepare('SELECT count(*) AS n FROM business_track_events WHERE businessType=? AND reportDate=?').get(SHOPEE, '2026-08-08').n, 120);

  const loaded = loadBusinessState(SHOPEE);
  assert.equal(loaded.dailyParseRows.length, 3);
  assert.equal(loaded.scanResults.length, 3);
  assert.equal(loaded.trackEvents.length, 120);
  assert.equal(loaded.trackResults.length, 3);
  assert.equal(loaded.finalRows.length, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.trackResults[0], 'rawJson'), false);

  const snapshot = saveBusinessSnapshot(SHOPEE, { ...loaded, analysisRuleVersion: 'v25' }, {
    recipientReconciliation: { status: 'PASSED', checks: [] },
    dashboardRows: [], detailTabs: {}, metrics: {}
  });
  assert.ok(snapshot.snapshotId);
  const payloadSize = db.prepare('SELECT length(payloadJson) AS n FROM business_export_snapshots WHERE snapshotId=?').get(snapshot.snapshotId);
  assert.ok(Number(payloadSize.n) < 1_000_000, `snapshot unexpectedly large: ${payloadSize.n}`);
});

test.after(() => {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
''', encoding='utf-8')

print('V25 patch applied')
