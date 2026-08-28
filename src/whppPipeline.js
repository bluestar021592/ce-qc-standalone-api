import { normalizeEvent } from './analyzer.js';
import { queryBatchWithFallback, queryTrackBatchWithFallback, splitTrackBatches } from './trackBatching.js';
import { createUnifiedThroughputClient } from './v314ShopeeThroughputCore.js';
import { analyzeWhppShipment, isWhppCancelledRow } from './whppAnalyzer.js';
import { isSpecialCategory } from './specialNode.js';

const CONFIRM_BATCH_SIZE = 350;
export const WHPP_THROUGHPUT_POLICY_ID = '2026-08-28-v346-whpp-independent-350-scan-50x4-evidence-v1';

export async function runWhppPipeline({
  state,
  client,
  onProgress = async () => {},
  onCheckpoint = async () => {},
  isPaused = async () => false
}) {
  const startedAt = new Date();
  const reportDate = state.reportDate || '';
  const runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || `WHPP-${reportDate}-${Date.now()}`);
  const today = cleanCodes(state.pnhBills || []);
  const carry = cleanCodes(state.carryBills || state.nextCarryBills || []);
  const allBills = cleanCodes([...today, ...carry]);
  const dailyByBill = new Map((state.dailyParseRows || []).map(row => [billOf(row), row]));
  const podLocks = new Set(cleanCodes(state.podLocks || []));

  state.businessType = 'WHPP';
  // The WHPP stage is intentionally independent from CCSL, but it must obey the
  // same bounded CE endpoint policy. scanPool must be the exact today+carry pool so
  // speculative 350-ticket batches have identical boundaries to the real loop.
  state.scanPool = allBills;
  const throughputClient = createUnifiedThroughputClient(state, client, {
    businessType: 'WHPP',
    confirmConcurrency: 1,
    trackConcurrency: 4,
    exceptionConcurrency: 4
  });
  console.info('[CE-QC][WHPP_THROUGHPUT]', WHPP_THROUGHPUT_POLICY_ID, JSON.stringify({ scanBatchSize: 350, scanConcurrency: 1, trackBatchSize: 50, trackConcurrency: 4, exceptionBatchSize: 50, exceptionConcurrency: 4, independentStage: true }));
  state.processing = { running: true, paused: false, phase: 'WHPP订单扫描', batchIndex: 0, totalBatches: Math.ceil(allBills.length / CONFIRM_BATCH_SIZE), runId };
  state.lastRunSummary = { businessType: 'WHPP', reportDate, runId, today: today.length, carry: carry.length, totalQuery: allBills.length, startedAt: startedAt.toISOString() };
  await checkpoint(state, onCheckpoint);
  await onProgress(`WHPP本土开始：今日日报 ${today.length}票，跨日 ${carry.length}票，查询池 ${allBills.length}票`);

  const scanRows = new Map(uniqueRows(state.scanResults || []).map(row => [billOf(row), row]));
  const scanStatuses = statusMap(state.scanQueryStatus || []);
  const scanPending = allBills.filter(bill => scanStatuses.get(bill)?.status !== 'success');

  for (let offset = 0; offset < scanPending.length; offset += CONFIRM_BATCH_SIZE) {
    await waitIfPaused(state, isPaused, onProgress, onCheckpoint);
    const batch = scanPending.slice(offset, offset + CONFIRM_BATCH_SIZE);
    state.processing = { ...state.processing, phase: 'WHPP订单扫描', batchIndex: Math.floor(offset / CONFIRM_BATCH_SIZE) + 1, totalBatches: Math.ceil(scanPending.length / CONFIRM_BATCH_SIZE) };
    await onProgress(`WHPP订单扫描 ${offset + 1}-${Math.min(offset + batch.length, scanPending.length)} / ${scanPending.length}`);
    const outcome = await queryBatchWithFallback({
      batch,
      query: codes => throughputClient.confirmQuery(codes),
      apiName: 'whpp-confirm-query',
      fallbackSizes: [100, 50, 10, 1],
      onLog: onProgress
    });
    const grouped = groupRows(outcome.successes.flatMap(item => item.events || []));
    const failed = failureMap(outcome.failures);
    for (const bill of batch) {
      const sourceRows = grouped.get(bill) || [];
      const source = selectConfirmRow(sourceRows);
      if (source && !failed.has(bill)) {
        scanRows.set(bill, {
          ...source,
          shipmentCode: bill,
          运单号: bill,
          businessType: 'WHPP',
          reportDate,
          来源类型: today.includes(bill) ? '今日日报' : '跨日续查',
          regionCode: dailyByBill.get(bill)?.regionCode || '',
          rawJson: source
        });
        scanStatuses.set(bill, successStatus(bill, reportDate, sourceRows.length));
      } else {
        scanStatuses.set(bill, failedStatus(bill, reportDate, failed.get(bill)?.message || 'SCAN_EMPTY_RESPONSE'));
      }
    }
    state.scanResults = [...scanRows.values()];
    state.scanQueryStatus = [...scanStatuses.values()];
    await checkpoint(state, onCheckpoint);
  }

  const scanFailed = allBills.filter(bill => scanStatuses.get(bill)?.status !== 'success');
  const podOrReturnTerminal = new Set(allBills.filter(bill => ['85','100'].includes(String(scanRows.get(bill)?.orderStatus ?? '').trim())));
  const cancelledByScan = new Set(allBills.filter(bill => String(scanRows.get(bill)?.orderStatus ?? '').trim() === '10'));
  const scanTerminal = new Set([...podOrReturnTerminal, ...cancelledByScan]);
  const needTrack = allBills.filter(bill => !scanTerminal.has(bill) && scanStatuses.get(bill)?.status === 'success' && !podLocks.has(bill));
  // A scan-side orderStatus=10 is already sufficient to close cancellation, but
  // exception-item/query is still queried to enrich reason/sub-reason/report-shop
  // details. Failure of this enrichment must not reopen a confirmed cancellation.
  const needException = cleanCodes([...needTrack, ...cancelledByScan]);
  state.needTrackBills = needTrack;
  state.needExceptionBills = needException;
  await onProgress(`WHPP订单扫描完成：扫描终态 ${scanTerminal.size}票，进入轨迹 ${needTrack.length}票，取消/异常查询 ${needException.length}票，扫描待重试 ${scanFailed.length}票`);
  await checkpoint(state, onCheckpoint);

  const eventRows = new Map(groupRows((state.trackEvents || []).map(row => ({ ...normalizeEvent(row), reportDate }))));
  const eventStatuses = statusMap(state.eventQueryStatus || []);
  await queryEvidenceBatches({
    state, bills: needTrack, rowsByBill: eventRows, statuses: eventStatuses,
    rowsKey: 'trackEvents', statusKey: 'eventQueryStatus',
    phase: 'WHPP轨迹查询', apiName: 'whpp-track-query',
    query: codes => throughputClient.trackQuery(codes), normalize: row => ({ ...normalizeEvent(row), reportDate }),
    onProgress, onCheckpoint, isPaused
  });
  state.trackEvents = flattenRows(eventRows);
  state.eventQueryStatus = [...eventStatuses.values()];

  const exceptionRows = new Map(groupRows(state.exceptionItems || []));
  const exceptionStatuses = statusMap(state.exceptionQueryStatus || []);
  await queryEvidenceBatches({
    state, bills: needException, rowsByBill: exceptionRows, statuses: exceptionStatuses,
    rowsKey: 'exceptionItems', statusKey: 'exceptionQueryStatus',
    phase: 'WHPP订单取消/异常查询', apiName: 'whpp-exception-item-query',
    query: codes => throughputClient.exceptionQuery(codes), normalize: row => ({ ...row, shipmentCode: billOf(row), reportDate }),
    onProgress, onCheckpoint, isPaused
  });
  state.exceptionItems = flattenRows(exceptionRows);
  state.exceptionQueryStatus = [...exceptionStatuses.values()];

  const finalRows = [];
  const failedBills = new Set(scanFailed);
  for (const bill of needTrack) {
    if (eventStatuses.get(bill)?.status !== 'success' || exceptionStatuses.get(bill)?.status !== 'success') failedBills.add(bill);
  }

  for (const bill of allBills) {
    const scanRow = scanRows.get(bill) || { shipmentCode: bill, 运单号: bill, orderStatus: '' };
    const dailyRow = dailyByBill.get(bill) || {};
    let result;
    if (failedBills.has(bill)) {
      result = {
        ...dailyRow,
        ...scanRow,
        shipmentCode: bill,
        运单号: bill,
        businessType: 'WHPP',
        reportDate,
        currentState: 'API_PENDING_RETRY',
        primaryCategory: '待重试',
        主分类: '待重试',
        异常分类: '待重试',
        是否POD: '否',
        POD状态: '未POD',
        退回状态: '未退回',
        订单取消: '否',
        查询状态: 'refresh_failed',
        API状态: '失败',
        carry状态: 'active',
        跨日状态: '未闭环',
        QC判断: 'WHPP接口查询失败，已保留断点，仅重试失败运单'
      };
    } else {
      result = analyzeWhppShipment({
        waybill: bill,
        scanRow,
        events: scanTerminal.has(bill) ? [] : (eventRows.get(bill) || []),
        exceptions: podOrReturnTerminal.has(bill) ? [] : (exceptionRows.get(bill) || []),
        reportDate,
        dailyRow,
        priorRow: {},
        apiStatus: {
          shipment: 'success',
          event: scanTerminal.has(bill) ? 'skipped_terminal' : 'success',
          exception: exceptionStatuses.get(bill)?.status || (podOrReturnTerminal.has(bill) ? 'skipped_terminal' : 'success')
        }
      });
      result = { ...dailyRow, ...result, businessType: 'WHPP', reportDate, shipmentCode: bill, 运单号: bill, regionCode: dailyRow.regionCode || result.regionCode || '' };
    }
    finalRows.push(result);
    if (isPod(result)) podLocks.add(bill);
  }

  const nextCarryBills = cleanCodes(finalRows.filter(row => !isClosed(row) && row.查询状态 !== 'refresh_failed').map(billOf));
  for (const bill of failedBills) if (!nextCarryBills.includes(bill)) nextCarryBills.push(bill);

  const completedAt = new Date();
  const summary = {
    businessType: 'WHPP', reportDate, runId,
    today: today.length, carry: carry.length, totalQuery: allBills.length,
    pod: finalRows.filter(isPod).length,
    returned: finalRows.filter(isReturned).length,
    cancelled: finalRows.filter(isWhppCancelledRow).length,
    needTrack: needTrack.length,
    cancellationEvidenceQueries: needException.length,
    retry: failedBills.size,
    nextCarry: nextCarryBills.length,
    startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
    durationSeconds: Math.round((completedAt - startedAt) / 1000)
  };

  state.finalRows = uniqueRows(finalRows);
  state.trackResults = state.finalRows;
  state.nextCarryBills = nextCarryBills.sort();
  state.carryBills = state.nextCarryBills;
  state.podLocks = [...podLocks].sort();
  state.processing = { running: false, paused: false, phase: failedBills.size ? 'WHPP待重试' : '完成', batchIndex: 1, totalBatches: 1, runId, error: failedBills.size ? `${failedBills.size}票接口失败待重试` : '' };
  state.lastRunSummary = summary;
  state.lastRun = summary;
  await checkpoint(state, onCheckpoint);

  if (failedBills.size) {
    const error = new Error(`WHPP有${failedBills.size}票接口查询失败，断点已保存；继续处理时仅重试失败票。`);
    error.code = 'WHPP_PARTIAL_API_FAILURE';
    error.runStatus = 'TRACK_RETRY_REQUIRED';
    error.state = state;
    throw error;
  }

  await onProgress(`WHPP完成：POD ${summary.pod}票，退回 ${summary.returned}票，订单取消 ${summary.cancelled}票，跨日续查 ${summary.nextCarry}票`);
  return { state, summary };
}

async function queryEvidenceBatches({ state, bills, rowsByBill, statuses, rowsKey, statusKey, phase, apiName, query, normalize, onProgress, onCheckpoint, isPaused }) {
  const pending = cleanCodes(bills).filter(bill => statuses.get(bill)?.status !== 'success');
  const batches = splitTrackBatches(pending);
  for (let index = 0; index < batches.length; index += 1) {
    await waitIfPaused(state, isPaused, onProgress, onCheckpoint);
    const batch = batches[index];
    state.processing = { ...state.processing, phase, batchIndex: index + 1, totalBatches: batches.length };
    await onProgress(`${phase} ${index + 1}/${batches.length}：${batch.length}票`);
    const outcome = await queryTrackBatchWithFallback({ batch, query, apiName, onLog: onProgress });
    const failed = failureMap(outcome.failures);
    for (const success of outcome.successes) {
      const grouped = groupRows((success.events || []).map(normalize));
      for (const bill of success.batch) {
        rowsByBill.set(bill, grouped.get(bill) || []);
        statuses.set(bill, successStatus(bill, state.reportDate || '', (grouped.get(bill) || []).length));
      }
    }
    for (const bill of batch) {
      if (!failed.has(bill) || statuses.get(bill)?.status === 'success') continue;
      statuses.set(bill, failedStatus(bill, state.reportDate || '', failed.get(bill)?.message || `${apiName}_FAILED`));
    }
    // Persist each successful/failed child batch immediately. A restart therefore
    // only retries the exact bills whose per-waybill status is not success.
    state[rowsKey] = flattenRows(rowsByBill);
    state[statusKey] = [...statuses.values()];
    await checkpoint(state, onCheckpoint);
  }
}

async function waitIfPaused(state, isPaused, onProgress, onCheckpoint) {
  while (await isPaused()) {
    state.processing = { ...state.processing, paused: true };
    await checkpoint(state, onCheckpoint);
    await onProgress('WHPP处理已暂停，等待继续。');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (state.processing?.paused) state.processing = { ...state.processing, paused: false };
}

async function checkpoint(state, onCheckpoint) { await onCheckpoint(state); }
function cleanCodes(values = []) { return [...new Set(values.map(value => String(value || '').trim().toUpperCase()).filter(Boolean))]; }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase(); }
function uniqueRows(rows = []) { const map = new Map(); for (const row of rows || []) { const bill = billOf(row); if (bill) map.set(bill, row); } return [...map.values()]; }
function groupRows(rows = []) { const map = new Map(); for (const row of rows || []) { const bill = billOf(row); if (!bill) continue; if (!map.has(bill)) map.set(bill, []); map.get(bill).push(row); } return map; }
function flattenRows(map) { return [...map.values()].flat(); }
function statusMap(rows = []) { return new Map((rows || []).map(row => [billOf(row), row]).filter(([bill]) => bill)); }
function successStatus(bill, reportDate, resultCount) { return { businessType: 'WHPP', shipmentCode: bill, reportDate, status: 'success', resultCount: Number(resultCount || 0), errorMessage: '', checkedAt: new Date().toISOString() }; }
function failedStatus(bill, reportDate, errorMessage) { return { businessType: 'WHPP', shipmentCode: bill, reportDate, status: 'failed', resultCount: 0, errorMessage: String(errorMessage || ''), checkedAt: new Date().toISOString() }; }
function failureMap(failures = []) { const map = new Map(); for (const failure of failures || []) for (const bill of failure.batch || []) map.set(String(bill).toUpperCase(), failure.error || new Error('API_FAILED')); return map; }
function selectConfirmRow(rows = []) { return rows.find(row => String(row?.orderStatus ?? '') === '85') || rows.find(row => String(row?.orderStatus ?? '') === '100') || rows.find(row => String(row?.orderStatus ?? '') === '10') || rows.at(-1) || null; }
function isPod(row = {}) { return row.是否POD === '是' || row.POD状态 === 'POD' || String(row.currentState || '').toUpperCase() === 'POD'; }
function isReturned(row = {}) { return row.退回状态 === '已退回' || ['RETURNED','RETURN_COMPLETED'].includes(String(row.currentState || '').toUpperCase()) || String(row.primaryCategory || row.主分类 || '') === '退回'; }
function isClosed(row = {}) { return isPod(row) || isReturned(row) || isWhppCancelledRow(row) || isSpecialCategory(row) || row.primaryCategory === '正常分流节点' || row.matchedRule === 'NORMAL_FINAL_HUB'; }