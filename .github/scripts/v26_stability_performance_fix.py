from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# 1) SHOPEE state store: cheap current-date lookup + runtime-only metadata save
# ---------------------------------------------------------------------------
p = Path('src/businessStore.js')
text = p.read_text(encoding='utf-8')

anchor = """  return normalized;\n}\n\nexport function getBusinessCurrentReportDate(businessType = SHOPEE) {\n  const state = loadBusinessState(businessType);\n  if (state.reportDate && state.dailyReportReady) return state.reportDate;\n  return '';\n}\n"""
replacement = """  return normalized;\n}\n\nexport function saveBusinessRuntimeState(state = {}, businessType = state.businessType || SHOPEE) {\n  const type = normalizeType(businessType);\n  const normalized = restrictShopeeState(normalizeBusinessState(state, type), type);\n  const persisted = compactBusinessStatePayload(normalized);\n  const now = nowIso();\n  getDb().prepare(`INSERT INTO business_states(businessType,valueJson,updatedAt) VALUES(?,?,?)\n    ON CONFLICT(businessType) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`)\n    .run(type, JSON.stringify(persisted), now);\n  return normalized;\n}\n\nexport function getBusinessCurrentReportDate(businessType = SHOPEE) {\n  const type = normalizeType(businessType);\n  const db = getDb();\n  let reportDate = '';\n  try {\n    reportDate = String(db.prepare(`SELECT json_extract(valueJson,'$.reportDate') AS reportDate FROM business_states WHERE businessType=?`).get(type)?.reportDate || '').trim();\n  } catch {}\n  if (reportDate && db.prepare('SELECT 1 FROM business_daily_reports WHERE businessType=? AND reportDate=?').get(type, reportDate)) return reportDate;\n  return String(db.prepare('SELECT reportDate FROM business_daily_reports WHERE businessType=? ORDER BY updatedAt DESC,reportDate DESC LIMIT 1').get(type)?.reportDate || '');\n}\n"""
text = replace_once(text, anchor, replacement, 'business runtime state + current date')
text = replace_once(text,
"""    // Track results are the only large-ish array retained because they are the\n    // resume checkpoint after an event batch. Strip embedded raw scan bodies.\n    trackResults: (state.trackResults || []).map(stripHeavyBusinessRow),\n    finalRows: [],\n    priorCarryRows: (state.priorCarryRows || []).map(stripHeavyBusinessRow)\n""",
"""    // Runtime metadata must stay small. Evidence/results are already mirrored in\n    // normalized SQLite tables during full stage checkpoints. Keeping these arrays\n    // here made every lightweight status save allocate large strings again.\n    trackResults: [],\n    finalRows: [],\n    priorCarryRows: []\n""",
'compact business payload')
p.write_text(text, encoding='utf-8')

# ---------------------------------------------------------------------------
# 2) CCSL pipeline: daily bills already POD-locked must still appear in finalRows
# ---------------------------------------------------------------------------
p = Path('src/pipeline.js')
text = p.read_text(encoding='utf-8')
text = replace_once(text,
"""  const podLocks = new Set(cleanBills(state.podLocks || []));\n  const shopCodeMap = businessType === 'CCSL' ? getShopCodeMap() : new Map();\n  const scanPool = cleanBills([...today, ...carry]).filter(wb => !podLocks.has(wb));\n""",
"""  const podLocks = new Set(cleanBills(state.podLocks || []));\n  const lockedToday = today.filter(wb => podLocks.has(wb));\n  const shopCodeMap = businessType === 'CCSL' ? getShopCodeMap() : new Map();\n  const scanPool = cleanBills([...today, ...carry]).filter(wb => !podLocks.has(wb));\n""",
'CCSL locked today set')

text = replace_once(text,
"""  const returnedRows = scanResults.filter(row => returnedCompleted.has(row.运单号)).map(row => ({ ...row, 是否POD: '否', POD状态: '未POD', 退回状态: '已退回', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回', 入库无扫描节点: '否', carry状态: 'closed_return', 跨日状态: '已闭环' }));\n  const retryRows = scanResults.filter(row => row.currentState === 'SCAN_PENDING_RETRY').map(row => ({ ...row, primaryCategory: '订单扫描待重试', 主分类: '订单扫描待重试', 异常分类: '订单扫描待重试', 入库无扫描节点: '否', carry状态: 'active' }));\n  // API failures are operational retry items, not business anomalies. Keep them\n  // in carry/scan retry state, but never publish them as QC exception rows.\n  const finalRows = [...podRows, ...returnedRows, ...trackResults]\n    .filter(row => row?.运单号 && !excluded(row.运单号))\n    .filter(row => row.是否POD === '是' || !podSet.has(row.运单号));\n""",
"""  const lockedDailyByBill = new Map((state.dailyParseRows || []).map(row => [String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(), row]));\n  const lockedPodRows = lockedToday.map(wb => ({\n    ...(lockedDailyByBill.get(wb) || {}),\n    shipmentCode: wb, 运单号: wb, reportDate: state.reportDate || '', 来源类型: '今日PNH',\n    orderStatus: '85', scanNormalizedState: 'POD', currentState: 'POD', trackRequired: false,\n    trackSkippedReason: 'POD_LOCK', 是否POD: '是', POD状态: 'POD', 扫描分类: 'POD锁已闭环',\n    primaryCategory: 'POD闭环', 主分类: 'POD闭环', 异常分类: 'POD闭环',\n    QC判断: '历史POD锁命中，当日日报仍计入POD闭环', carry状态: 'closed_pod', 跨日状态: '已闭环'\n  }));\n  const returnedRows = scanResults.filter(row => returnedCompleted.has(row.运单号)).map(row => ({ ...row, 是否POD: '否', POD状态: '未POD', 退回状态: '已退回', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回', 入库无扫描节点: '否', carry状态: 'closed_return', 跨日状态: '已闭环' }));\n  const retryRows = scanResults.filter(row => row.currentState === 'SCAN_PENDING_RETRY').map(row => ({ ...row, primaryCategory: '订单扫描待重试', 主分类: '订单扫描待重试', 异常分类: '订单扫描待重试', 入库无扫描节点: '否', carry状态: 'active' }));\n  // API failures are operational retry items, not business anomalies. Keep them\n  // in carry/scan retry state, but never publish them as QC exception rows.\n  const finalRows = [...new Map([...lockedPodRows, ...podRows, ...returnedRows, ...trackResults]\n    .filter(row => row?.运单号 && !excluded(row.运单号))\n    .filter(row => row.是否POD === '是' || !podSet.has(row.运单号))\n    .map(row => [String(row.运单号 || row.shipmentCode || '').trim().toUpperCase(), row])).values()];\n""",
'CCSL locked POD final rows')
p.write_text(text, encoding='utf-8')

# ---------------------------------------------------------------------------
# 3) Server: lightweight checkpoints instead of full-table rewrites every batch
# ---------------------------------------------------------------------------
p = Path('server.js')
text = p.read_text(encoding='utf-8')
text = replace_once(text,
"""  resetBusinessRunForReport, saveBusinessSnapshot, saveBusinessState, updateBusinessRunLock\n""",
"""  resetBusinessRunForReport, saveBusinessSnapshot, saveBusinessState, saveBusinessRuntimeState, updateBusinessRunLock\n""",
'import saveBusinessRuntimeState')
text = text.replace("patchId: '2026-08-08-v23-range-fast-nav'", "patchId: '2026-08-08-v26-stability-performance'")

checkpoint_anchor = """let dashboardCacheWorker = null;\nlet dashboardCachePendingDate = '';\nlet dashboardCacheTimer = null;\n"""
checkpoint_helpers = """let dashboardCacheWorker = null;\nlet dashboardCachePendingDate = '';\nlet dashboardCacheTimer = null;\n\nconst RUN_FULL_CHECKPOINT_INTERVAL = Math.max(10, Number(process.env.RUN_FULL_CHECKPOINT_INTERVAL || 40));\nconst runCheckpointMarkers = new Map();\n\nfunction shouldPersistFullCheckpoint(scope, state, reportDate, runId) {\n  const processing = state?.processing || {};\n  const phase = String(processing.phase || '');\n  const batchIndex = Number(processing.batchIndex || 0);\n  const totalBatches = Number(processing.totalBatches || 0);\n  const bucket = batchIndex > 0 ? Math.floor(batchIndex / RUN_FULL_CHECKPOINT_INTERVAL) : 0;\n  const key = `${scope}:${reportDate}:${runId}`;\n  const previous = runCheckpointMarkers.get(key);\n  const terminal = !processing.running || processing.paused || Boolean(processing.error) || phase === '完成';\n  const stageChanged = !previous || previous.phase !== phase;\n  const intervalReached = !previous || bucket > previous.bucket;\n  const stageCompleted = totalBatches > 0 && batchIndex >= totalBatches;\n  const full = stageChanged || intervalReached || stageCompleted || terminal;\n  if (full) runCheckpointMarkers.set(key, { phase, bucket, batchIndex });\n  return full;\n}\n\nfunction persistRunCheckpointOnly(scope, state, reportDate, runId) {\n  const db = getDb();\n  const now = new Date().toISOString();\n  const processing = state?.processing || {};\n  const status = processing.error ? 'failed' : (processing.paused ? 'paused' : (processing.running ? 'running' : (processing.phase === '完成' ? 'finished' : 'saved')));\n  const batchIndex = Number(processing.batchIndex || 0);\n  const totalBatches = Number(processing.totalBatches || 0);\n  const payload = JSON.stringify({\n    scanDone: Number(state?.scanResults?.length || 0),\n    trackDone: Number(state?.trackResults?.length || 0),\n    eventCount: Number(state?.trackEvents?.length || 0),\n    finalRows: Number(state?.finalRows?.length || 0),\n    nextCarry: Number(state?.nextCarryBills?.length || 0)\n  });\n  db.exec('BEGIN IMMEDIATE');\n  try {\n    if (scope === 'SHOPEE') {\n      db.prepare(`UPDATE business_run_locks SET status=?,currentStage=?,batchIndex=?,totalBatches=?,errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=? AND runId=?`)\n        .run(status, processing.phase || '', batchIndex, totalBatches, processing.error || '', now, SHOPEE, reportDate, runId);\n      db.prepare(`INSERT INTO business_run_checkpoints(businessType,runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)\n        .run(SHOPEE, runId, reportDate, processing.phase || '', batchIndex, totalBatches, status, payload, processing.error || '', now, now);\n    } else {\n      db.prepare(`UPDATE run_locks SET status=?,currentStage=?,batchIndex=?,totalBatches=?,errorMessage=?,updatedAt=? WHERE reportDate=? AND runId=?`)\n        .run(status, processing.phase || '', batchIndex, totalBatches, processing.error || '', now, reportDate, runId);\n      db.prepare(`INSERT INTO run_checkpoints(runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`)\n        .run(runId, reportDate, processing.phase || '', batchIndex, totalBatches, status, payload, processing.error || '', now, now);\n    }\n    db.exec('COMMIT');\n  } catch (error) {\n    try { db.exec('ROLLBACK'); } catch {}\n    throw error;\n  }\n}\n"""
text = replace_once(text, checkpoint_anchor, checkpoint_helpers, 'checkpoint helpers')

text = replace_once(text,
"""    const onProgress = async (msg) => {\n      state.logs = [...(state.logs || []), `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-300);\n      await appendRuntimeLog(msg);\n      await saveState(state);\n    };\n""",
"""    const onProgress = async (msg) => {\n      state.logs = [...(state.logs || []), `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-300);\n      await appendRuntimeLog(msg);\n    };\n""",
'CCSL progress no full save')

text = replace_once(text,
"""      onCheckpoint: async checkpointState => {\n        checkpointState.currentRun = { ...(checkpointState.currentRun || run), runId: run.runId, reportDate };\n        checkpointState.lastRunSummary = { ...(checkpointState.lastRunSummary || {}), runId: run.runId, reportDate };\n        await saveState(checkpointState);\n      },\n      isPaused: async () => {\n        const latest = await loadState();\n        return Boolean(latest.processing?.paused);\n      }\n""",
"""      onCheckpoint: async checkpointState => {\n        checkpointState.currentRun = { ...(checkpointState.currentRun || run), runId: run.runId, reportDate };\n        checkpointState.lastRunSummary = { ...(checkpointState.lastRunSummary || {}), runId: run.runId, reportDate };\n        if (shouldPersistFullCheckpoint('CCSL', checkpointState, reportDate, run.runId)) await saveState(checkpointState);\n        else persistRunCheckpointOnly('CCSL', checkpointState, reportDate, run.runId);\n      },\n      isPaused: async () => getRunStatus(reportDate).lock?.status === 'paused'\n""",
'CCSL checkpoint policy')

text = text.replace("  saveBusinessState(state, SHOPEE);\n  res.json({ ok: true, state: summarizeShopeeState(state) });\n});\n\nasync function executeShopeeRunRequest", "  saveBusinessRuntimeState(state, SHOPEE);\n  res.json({ ok: true, state: summarizeShopeeState(state) });\n});\n\nasync function executeShopeeRunRequest", 1)

text = text.replace("      saveBusinessState(state, SHOPEE);\n    } catch (error) {", "      saveBusinessRuntimeState(state, SHOPEE);\n    } catch (error) {", 1)
text = text.replace("      saveBusinessState(state, SHOPEE);\n      return res.status(409).json({ ok: false, code, error: message, diagnostic: state.apiDiagnostic });", "      saveBusinessRuntimeState(state, SHOPEE);\n      return res.status(409).json({ ok: false, code, error: message, diagnostic: state.apiDiagnostic });", 1)
text = text.replace("      saveBusinessState(state, SHOPEE);\n    }\n    const repair = !options.resume", "      saveBusinessRuntimeState(state, SHOPEE);\n    }\n    const repair = !options.resume", 1)
text = text.replace("    saveBusinessState(state, SHOPEE);\n    const result = await runQcPipeline({", "    saveBusinessRuntimeState(state, SHOPEE);\n    const result = await runQcPipeline({", 1)

text = replace_once(text,
"""      onCheckpoint: async checkpointState => saveBusinessState(checkpointState, SHOPEE),\n      isPaused: async () => Boolean(loadBusinessState(SHOPEE).processing?.paused)\n""",
"""      onCheckpoint: async checkpointState => {\n        if (shouldPersistFullCheckpoint('SHOPEE', checkpointState, reportDate, runId)) saveBusinessState(checkpointState, SHOPEE);\n        else persistRunCheckpointOnly('SHOPEE', checkpointState, reportDate, runId);\n      },\n      isPaused: async () => getBusinessRunStatus(SHOPEE, reportDate).lock?.status === 'paused'\n""",
'SHOPEE checkpoint policy')

text = text.replace("    completeUnifiedSnapshot({ reportDate, ccslSnapshot, shopeeSnapshot: snapshot });\n    saveBusinessState(result.state, SHOPEE);", "    completeUnifiedSnapshot({ reportDate, ccslSnapshot, shopeeSnapshot: snapshot });\n    saveBusinessRuntimeState(result.state, SHOPEE);", 1)
text = text.replace("    saveBusinessState(state, SHOPEE);\n    res.status(error.code === 'AUTH_REQUIRED' ? 409 : 500).json", "    saveBusinessRuntimeState(state, SHOPEE);\n    res.status(error.code === 'AUTH_REQUIRED' ? 409 : 500).json", 1)
p.write_text(text, encoding='utf-8')

# ---------------------------------------------------------------------------
# 4) Frontend: bounded parallel startup + reconciliation restart path
# ---------------------------------------------------------------------------
p = Path('public/app.js')
text = p.read_text(encoding='utf-8')

refresh_anchor = """async function refreshInternal() {\n"""
refresh_helper = """async function runStartupRequestPool(definitions, concurrency = 3) {\n  const loaded = Array(definitions.length).fill(null);\n  const startupFailures = [];\n  let nextIndex = 0;\n  async function worker() {\n    while (true) {\n      const index = nextIndex++;\n      if (index >= definitions.length) return;\n      const [label, task] = definitions[index];\n      try { loaded[index] = await task(); }\n      catch (error) {\n        startupFailures.push({ label, error });\n        loaded[index] = null;\n        console.warn(`[startup] ${label}读取失败`, error);\n      }\n    }\n  }\n  const count = Math.max(1, Math.min(Number(concurrency || 1), definitions.length));\n  await Promise.all(Array.from({ length: count }, () => worker()));\n  return { loaded, startupFailures };\n}\n\nasync function refreshInternal() {\n"""
text = replace_once(text, refresh_anchor, refresh_helper, 'startup request pool helper')

old_loop = """  // Limit the startup burst. The same endpoints are healthy when requested one-by-one,\n  // but firing all heavy snapshot/history endpoints at once can create a transient\n  // connection failure during page startup.\n  const loaded = [];\n  const startupFailures = [];\n  for (const [label, task] of requestDefinitions) {\n    try {\n      loaded.push(await task());\n    } catch (error) {\n      startupFailures.push({ label, error });\n      loaded.push(null);\n      console.warn(`[startup] ${label}读取失败`, error);\n      if (error?.code === 'NETWORK_CONNECTION_INTERRUPTED') break;\n    }\n  }\n"""
new_loop = """  // Dashboard endpoints are compact SQL/cache reads. Run a bounded pool instead\n  // of nine serial round-trips so the first page behaves like a normal website\n  // without recreating the old all-at-once request burst.\n  const { loaded, startupFailures } = await runStartupRequestPool(\n    requestDefinitions,\n    needsFullAggregate ? 2 : 4\n  );\n"""
text = replace_once(text, old_loop, new_loop, 'startup serial loop')

old_notice = """      const hasSavedRun = Boolean(returnedState?.processing?.runId || returnedState?.processing?.running || returnedState?.processing?.error);\n      processingNotice = {\n        type: 'UNIFIED',\n        level: 'error',\n        message: hasSavedRun\n          ? `全自动处理未完成：${error.message}。未完成批次已保存，可点击“继续处理”重试。`\n          : `全自动处理未启动：${error.message}。日报已保存，可直接再次开始处理。`\n      };\n"""
new_notice = """      const hasSavedRun = Boolean(returnedState?.processing?.runId || returnedState?.processing?.running || returnedState?.processing?.error);\n      const reconciliationFailed = error.code === 'UNIFIED_RECONCILIATION_FAILED';\n      processingNotice = {\n        type: 'UNIFIED',\n        level: 'error',\n        retryMode: reconciliationFailed ? 'restart' : 'resume',\n        message: reconciliationFailed\n          ? `统一快照对账未通过：${error.message}。日报与处理结果均已保留，请重新核对处理，系统会同时重建CCSL与SHOPEE当天快照。`\n          : (hasSavedRun\n            ? `全自动处理未完成：${error.message}。未完成批次已保存，可点击“继续处理”重试。`\n            : `全自动处理未启动：${error.message}。日报已保存，可直接再次开始处理。`)\n      };\n"""
text = replace_once(text, old_notice, new_notice, 'unified reconciliation notice')

old_retry = """  const retryAction = processingNotice.level === 'error'\n    ? `<button class=\"btn primary compact\" onclick=\"${processingNotice.type === 'SHOPEE' ? 'resumeShopee()' : processingNotice.type === 'CCSL' ? 'resumeProcess()' : 'resumeUnified()'}\">继续处理</button>`\n    : '';\n"""
new_retry = """  const retryHandler = processingNotice.retryMode === 'restart'\n    ? 'runUnified()'\n    : (processingNotice.type === 'SHOPEE' ? 'resumeShopee()' : processingNotice.type === 'CCSL' ? 'resumeProcess()' : 'resumeUnified()');\n  const retryLabel = processingNotice.retryMode === 'restart' ? '重新核对处理' : '继续处理';\n  const retryAction = processingNotice.level === 'error'\n    ? `<button class=\"btn primary compact\" onclick=\"${retryHandler}\">${retryLabel}</button>`\n    : '';\n"""
text = replace_once(text, old_retry, new_retry, 'processing notice retry mode')
p.write_text(text, encoding='utf-8')

# ---------------------------------------------------------------------------
# 5) Targeted regression test
# ---------------------------------------------------------------------------
p = Path('test/v26-stability-performance.test.js')
p.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runQcPipeline } from '../src/pipeline.js';


test('CCSL daily POD lock is preserved in finalRows without API call', async () => {
  let apiCalls = 0;
  const client = {
    async confirmQuery() { apiCalls += 1; throw new Error('confirmQuery must not run for POD lock'); },
    async trackQuery() { apiCalls += 1; throw new Error('trackQuery must not run for POD lock'); }
  };
  const state = {
    businessType: 'CCSL',
    reportDate: '2026-07-29',
    dailyReportReady: true,
    pnhBills: ['TESTLOCK001'],
    dailyParseRows: [{ shipmentCode: 'TESTLOCK001', 运单号: 'TESTLOCK001', result: 'PNH' }],
    carryBills: [],
    podLocks: ['TESTLOCK001'],
    scanResults: [],
    trackResults: [],
    trackEvents: [],
    finalRows: [],
    processing: { running: false, paused: false, phase: '' },
    currentRun: { runId: 'v26-test-run' },
    lastRunSummary: { runId: 'v26-test-run' }
  };
  const result = await runQcPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false });
  assert.equal(apiCalls, 0);
  assert.equal(result.state.finalRows.length, 1);
  assert.equal(result.state.finalRows[0].运单号, 'TESTLOCK001');
  assert.equal(result.state.finalRows[0].是否POD, '是');
  assert.equal(result.state.finalRows[0].primaryCategory, 'POD闭环');
});


test('V26 source contains lightweight checkpoint and bounded startup protections', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const store = fs.readFileSync(new URL('../src/businessStore.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /shouldPersistFullCheckpoint/);
  assert.match(server, /persistRunCheckpointOnly/);
  assert.doesNotMatch(server, /isPaused:\s*async \(\) => Boolean\(loadBusinessState\(SHOPEE\)/);
  assert.match(store, /saveBusinessRuntimeState/);
  assert.match(store, /json_extract\(valueJson,'\$\.reportDate'\)/);
  assert.match(app, /runStartupRequestPool/);
  assert.match(app, /retryMode:\s*reconciliationFailed \? 'restart'/);
});
''', encoding='utf-8')

print('V26 stability/performance patch applied')
