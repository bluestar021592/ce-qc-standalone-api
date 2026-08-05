import { analyzeShipment, normalizeEvent } from './analyzer.js';
import { createHash } from 'crypto';
import { cleanAnyBills, cleanMainBills, isExcludedBill } from './storage.js';
import { getShopCodeMap } from './shopCodes.js';
import { analyzeShopeeShipment, classifyShopeeScanStatus } from './shopeeAnalyzer.js';
import { queryBatchWithFallback, queryTrackBatchWithFallback, splitTrackBatches, TRACK_QUERY_BATCH_SIZE } from './trackBatching.js';
import { classifyScanTerminal } from './scanTerminal.js';

const ORDER_BATCH_SIZE = Number(process.env.ORDER_BATCH_SIZE || 350);
const TRACK_CONCURRENCY = Number(process.env.TRACK_CONCURRENCY || 1);

export async function runQcPipeline({
  state,
  client,
  onProgress = async () => {},
  onCheckpoint = async () => {},
  isPaused = async () => false
}) {
  const startedAt = new Date();
  const businessType = String(state.businessType || 'CCSL').toUpperCase() === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  if (businessType === 'SHOPEE') {
    return runShopeePipeline({ state, client, onProgress, onCheckpoint, isPaused, startedAt });
  }
  const cleanBills = businessType === 'SHOPEE' ? cleanAnyBills : cleanMainBills;
  const excluded = businessType === 'CCSL' ? isExcludedBill : () => false;
  const runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || state.lastRun?.runId || '').trim();
  const today = cleanBills(state.pnhBills || []);
  const carry = cleanBills(state.carryBills || state.nextCarryBills || []);
  const podLocks = new Set(cleanBills(state.podLocks || []));
  const shopCodeMap = businessType === 'CCSL' ? getShopCodeMap() : new Map();
  const scanPool = cleanBills([...today, ...carry]).filter(wb => !podLocks.has(wb));

  state.scanPool = scanPool;
  state.processing = { running: true, paused: false, phase: '订单扫描', batchIndex: 0, totalBatches: Math.ceil(scanPool.length / ORDER_BATCH_SIZE), runId };
  state.lastRunSummary = {
    ...(state.lastRunSummary || {}),
    runId,
    reportDate: state.reportDate || '',
    startedAt: startedAt.toISOString(),
    today: today.length,
    carry: carry.length,
    scanPool: scanPool.length
  };
  await checkpoint(state, onCheckpoint);
  await onProgress(`开始：今日PNH ${today.length}票，旧跨日 ${carry.length}票，扫描池 ${scanPool.length}票`);

  const scanResults = preserveRows(state.scanResults, scanPool, '运单号', state.reportDate || '');
  const scanned = new Set(scanResults.map(row => row.运单号));
  const refreshFailed = new Set();
  const returnedCompleted = new Set();

  for (let i = 0; i < scanPool.length; i += ORDER_BATCH_SIZE) {
    await waitIfPaused(state, isPaused, onProgress, onCheckpoint);
    const batch = scanPool.slice(i, i + ORDER_BATCH_SIZE).filter(wb => !scanned.has(wb));
    if (!batch.length) continue;
    state.processing = { ...state.processing, phase: '订单扫描', batchIndex: Math.floor(i / ORDER_BATCH_SIZE) + 1, totalBatches: Math.ceil(scanPool.length / ORDER_BATCH_SIZE) };
    await onProgress(`订单扫描 ${i + 1}-${Math.min(i + ORDER_BATCH_SIZE, scanPool.length)} / ${scanPool.length}`);
    let data = [];
    try {
      data = await client.confirmQuery(batch);
    } catch (error) {
      await onProgress(`订单扫描批次失败，保留明日续查：${error?.message || error}`);
      for (const wb of batch) refreshFailed.add(wb);
    }
    const grouped = groupConfirmRows(data);
    for (const wb of batch) {
      const rows = grouped.get(wb) || [];
      const row = selectConfirmRow(rows);
      const orderStatus = String(row?.orderStatus ?? '');
      const terminal = classifyScanTerminal(row || {}, refreshFailed.has(wb) ? 'failed' : (row ? 'success' : 'failed'));
      const isPod = terminal.currentState === 'POD';
      const scanRow = {
        运单号: wb,
        reportDate: state.reportDate || '',
        来源类型: sourceType(wb, today, carry),
        orderStatus,
        businessType: businessType,
        scanRawStatus: row?.shipmentStatus ?? row?.statusCode ?? row?.status ?? orderStatus,
        scanNormalizedState: terminal.currentState,
        scanTerminalType: terminal.scanTerminalType,
        scanTerminalReason: terminal.scanTerminalReason,
        currentState: terminal.currentState,
        trackRequired: terminal.trackRequired,
        trackSkippedReason: terminal.trackSkippedReason,
        是否POD: isPod ? '是' : '否',
        扫描分类: isPod ? '已签收(POD)' : (orderStatus ? `未签收状态(${orderStatus})` : '订单扫描无返回'),
        pickupShop: row?.pickupShop || '',
        deliveryShop: row?.deliveryShop || '',
        productCode: row?.productCode || '',
        customerName: row?.customerName || '',
        rawJson: row || {},
        原始返回摘要: JSON.stringify(row || {}).slice(0, 1000)
      };
      if (refreshFailed.has(wb)) {
        scanRow.查询状态 = 'refresh_failed';
        scanRow.扫描分类 = '订单扫描API失败';
        scanRow.错误信息 = '订单扫描失败，保留明日续查';
      }
      if (terminal.currentState === 'RETURN_COMPLETED') {
        scanRow.退回状态 = '已退回';
        scanRow.扫描分类 = '已退回(终态)';
        returnedCompleted.add(wb);
      } else if (terminal.currentState === 'RETURN_IN_PROGRESS') {
        scanRow.退回状态 = '退回处理中';
        scanRow.扫描分类 = '退回处理中';
      }
      scanResults.push(scanRow);
      scanned.add(wb);
      if (isPod) podLocks.add(wb);
    }
    state.scanResults = scanResults;
    state.podLocks = [...podLocks].sort();
    state.lastRunSummary = { ...state.lastRunSummary, scanDone: scanResults.length, scanPod: countRows(scanResults, 'POD闭环', true) };
    await checkpoint(state, onCheckpoint);
  }

  const scanByBill = new Map(scanResults.map(item => [item.运单号, item]));
  const needTrack = scanPool.filter(wb => scanByBill.get(wb)?.trackRequired === true && !podLocks.has(wb) && !refreshFailed.has(wb) && !excluded(wb));
  state.needTrackBills = needTrack;
  state.processing = { ...state.processing, phase: '轨迹查询', batchIndex: 0, totalBatches: Math.ceil(needTrack.length / TRACK_QUERY_BATCH_SIZE) };
  await onProgress(`订单扫描完成：POD ${scanResults.filter(x => x.是否POD === '是').length}票，进入轨迹 ${needTrack.length}票`);
  await checkpoint(state, onCheckpoint);

  const allEvents = Array.isArray(state.trackEvents)
    ? state.trackEvents.map(normalizeEvent).filter(event => !event.reportDate || event.reportDate === (state.reportDate || ''))
    : [];
  const trackResults = preserveRows(state.trackResults, needTrack, '运单号', state.reportDate || '');
  const tracked = new Set(trackResults.map(row => row.运单号));
  const chunks = splitTrackBatches(needTrack.filter(wb => !tracked.has(wb)));
  let idx = 0;

  async function worker() {
    while (idx < chunks.length) {
      await waitIfPaused(state, isPaused, onProgress, onCheckpoint);
      const my = idx++;
      const batch = chunks[my];
      state.processing = { ...state.processing, phase: '轨迹查询', batchIndex: my + 1, totalBatches: chunks.length };
      await onProgress(`轨迹批量 ${my + 1}/${chunks.length}：${batch.length}票`);
      const batchOutcome = await queryTrackBatchWithFallback({
        batch,
        query: codes => client.trackQuery(codes),
        onLog: onProgress
      });
      const eventsRaw = batchOutcome.successes.flatMap(item => item.events || []);
      const failedByBill = new Map();
      for (const failure of batchOutcome.failures) {
        for (const wb of failure.batch) {
          refreshFailed.add(wb);
          failedByBill.set(wb, failure.error);
        }
      }
      const events = eventsRaw
        .map(event => ({ ...normalizeEvent(event), reportDate: state.reportDate || '' }))
        .filter(e => e.shipmentCode);
      allEvents.push(...events);
      const grouped = groupEvents(events, batch);
      for (const wb of batch) {
        const scanRow = scanResults.find(x => x.运单号 === wb) || { 运单号: wb, 来源类型: sourceType(wb, today, carry) };
        const trackError = failedByBill.get(wb) || null;
        const result = trackError
          ? {
              ...scanRow,
              运单号: wb,
              是否POD: '否',
              查询状态: 'refresh_failed',
              API状态: '失败',
              异常分类: '待重试',
              primaryCategory: '待重试',
              主分类: '待重试',
              tags: ['REFRESH_FAILED'],
              matchedRule: 'TRACK_API_REFRESH_FAILED',
              命中规则: 'TRACK_API_REFRESH_FAILED',
              QC判断: '轨迹API失败，保留明日续查',
              carry状态: 'active',
              跨日状态: scanRow?.来源类型 === '旧跨日' ? '跨日续查' : '当日',
              错误信息: trackError?.message || String(trackError || '')
            }
          : (businessType === 'SHOPEE'
              ? analyzeShopeeShipment({ waybill: wb, scanRow, events: grouped.get(wb) || [], reportDate: state.reportDate || '' })
              : analyzeShipment({ waybill: wb, scanRow, events: grouped.get(wb) || [], shopCodeMap, reportDate: state.reportDate || '' }));
        result.businessType = businessType;
        result.reportDate = state.reportDate || '';
        trackResults.push(result);
        if (result.是否POD === '是') podLocks.add(wb);
      }
      state.trackEvents = allEvents;
      state.trackResults = trackResults;
      state.podLocks = [...podLocks].sort();
      await checkpoint(state, onCheckpoint);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, TRACK_CONCURRENCY) }, () => worker()));

  const podSet = new Set(cleanBills([...podLocks, ...scanResults.filter(x => x.是否POD === '是').map(x => x.运单号)]));
  const podRows = scanResults
    .filter(row => podSet.has(row.运单号))
    .map(row => ({
      ...row,
      异常分类: 'POD闭环',
      QC判断: row.orderStatus === '85' ? '订单扫描已签收' : 'POD锁已闭环'
    }));

  const returnedRows = scanResults.filter(row => returnedCompleted.has(row.运单号)).map(row => ({ ...row, 是否POD: '否', POD状态: '未POD', 退回状态: '已退回', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回', 入库无扫描节点: '否', carry状态: 'closed_return', 跨日状态: '已闭环' }));
  const retryRows = scanResults.filter(row => row.currentState === 'SCAN_PENDING_RETRY').map(row => ({ ...row, primaryCategory: '订单扫描待重试', 主分类: '订单扫描待重试', 异常分类: '订单扫描待重试', 入库无扫描节点: '否', carry状态: 'active' }));
  const finalRows = [...podRows, ...returnedRows, ...retryRows, ...trackResults]
    .filter(row => row?.运单号 && !excluded(row.运单号))
    .filter(row => row.是否POD === '是' || !podSet.has(row.运单号));
  const finalDiversionRows = finalRows.filter(isNormalFinalDiversionRow);
  const nextCarryBills = cleanBills([...trackResults, ...retryRows]
    .filter(row => row.是否POD !== '是' && row.退回状态 !== '已退回')
    .filter(row => !isNormalFinalDiversionRow(row))
    .filter(row => row.specialState !== 'SELF_PICKUP' && row.primaryCategory !== '仓库自提')
    .map(row => row.运单号))
    .filter(wb => !podSet.has(wb));

  const completedAt = new Date();
  const summary = {
    ...buildSummary({
    state,
    today,
    carry,
    scanPool,
    scanResults,
    trackResults,
    allEvents,
    nextCarryBills,
    refreshFailed,
    startedAt,
      completedAt
    }),
    runId
  };

  state.trackEvents = allEvents;
  state.trackResults = trackResults;
  state.finalRows = finalRows;
  state.finalDiversionRows = finalDiversionRows;
  state.nextCarryBills = nextCarryBills;
  state.carryBills = nextCarryBills;
  state.podLocks = [...podSet].sort();
  state.processing = { running: false, paused: false, phase: '完成', batchIndex: 1, totalBatches: 1, runId };
  state.lastRunSummary = summary;
  state.lastRun = summary;
  await checkpoint(state, onCheckpoint);
  await onProgress(`完成：订单POD ${summary.scanPod}，轨迹POD ${summary.trackPod}，明日继续 ${summary.nextCarry}`);
  return { state, summary };
}

async function runShopeePipeline({ state, client, onProgress, onCheckpoint, isPaused, startedAt }) {
  const runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || '').trim();
  const reportDate = state.reportDate || '';
  const today = cleanAnyBills(state.pnhBills || []);
  const carry = cleanAnyBills(state.carryBills || state.nextCarryBills || []);
  const podLocks = new Set(cleanAnyBills(state.podLocks || []));
  const scanPool = cleanAnyBills([...today, ...carry]).filter(bill => !podLocks.has(bill));
  const dailyByBill = new Map((state.dailyParseRows || []).map(row => [billOf(row), row]));
  const lockedToday = today.filter(bill => podLocks.has(bill));
  const priorByBill = new Map([...(state.priorCarryRows || []), ...(state.finalRows || [])].map(row => [billOf(row), row]));
  state.apiBatchStatus = state.apiBatchStatus || [];
  state.scanPool = scanPool;
  state.processing = { running: true, paused: false, phase: 'SHOPEE状态查询', batchIndex: 0, totalBatches: Math.ceil(scanPool.length / TRACK_QUERY_BATCH_SIZE), runId };
  state.processing = { ...state.processing, phase: '\u8ba2\u5355\u626b\u63cf', totalBatches: Math.ceil(scanPool.length / ORDER_BATCH_SIZE) };
  state.lastRunSummary = { ...(state.lastRunSummary || {}), businessType: 'SHOPEE', runId, reportDate, startedAt: startedAt.toISOString(), today: today.length, carry: carry.length, scanPool: scanPool.length };
  await checkpoint(state, onCheckpoint);
  await onProgress(`SHOPEE开始：今日日报 ${today.length}票，旧跨日 ${carry.length}票，查询池 ${scanPool.length}票`);

  const scan = await queryShopeeConfirmApi({ state, bills: scanPool, client, onProgress, onCheckpoint, isPaused });
  const scanByBill = groupRows(scan.rows);
  const scanStatusByBill = statusMap(scan.statuses);
  const scanResults = scanPool.map(bill => {
    const sourceRows = scanByBill.get(bill) || [];
    const source = sourceRows.find(row => String(row?.orderStatus ?? '') === '85') || sourceRows[0] || {};
    const status = scanStatusByBill.get(bill) || 'failed';
    const recipient = dailyByBill.get(bill) || priorByBill.get(bill) || {};
    return {
      ...source,
      businessType: 'SHOPEE', reportDate, 运单号: bill, shipmentCode: bill,
      来源类型: sourceType(bill, today, carry),
      orderStatus: source.orderStatus ?? '',
      shipmentStatus: source.shipmentStatus ?? source.statusCode ?? '',
      是否POD: '否',
      API状态: status === 'success' ? '成功' : '失败',
      查询状态: status === 'success' ? 'success' : 'refresh_failed',
      recipient_raw: recipient.recipient_raw || '',
      recipient_normalized: recipient.recipient_normalized || '',
      recipient_group: recipient.recipient_group || 'OTHER',
      recipient_group_reason: recipient.recipient_group_reason || 'LEGACY_OR_UNRESOLVED',
      source_row_number: Number(recipient.source_row_number || recipient.rowNumber || 0),
      rawJson: source
    };
  });
  const lockedPodRows = lockedToday.map(bill => ({
    ...(dailyByBill.get(bill) || {}), businessType: 'SHOPEE', reportDate, 运单号: bill, shipmentCode: bill,
    来源类型: '今日PNH', orderStatus: 85, scanNormalizedState: 'POD', currentState: 'POD', trackRequired: false,
    trackSkippedReason: 'POD_LOCK', 是否POD: '是', POD状态: 'POD', 扫描状态: 'POD_LOCK', API状态: '已跳过', 查询状态: 'skipped_pod'
  }));
  state.scanResults = uniqueRows([...lockedPodRows, ...scanResults]);

  const scanTerminalByBill = new Map(scanPool.map(bill => [bill, classifyScanTerminal(selectConfirmRow(scanByBill.get(bill) || []) || {}, scanStatusByBill.get(bill))]));
  const scanRouteByBill = new Map(scanPool.map(bill => [bill, routeShopeeScan((scanByBill.get(bill) || [])[0] || {}, scanStatusByBill.get(bill))]));
  for (const row of scanResults) {
    const terminal = scanTerminalByBill.get(billOf(row));
    Object.assign(row, terminal, { scanNormalizedState: terminal.currentState, scanRawStatus: row.shipmentStatus || row.orderStatus || '' });
    if (terminal.currentState === 'POD') { row.是否POD = '是'; row.POD状态 = 'POD'; }
    if (terminal.currentState === 'RETURN_COMPLETED') row.退回状态 = '已退回';
    if (terminal.currentState === 'RETURN_IN_PROGRESS') row.退回状态 = '退回处理中';
  }
  const preliminaryPodBills = new Set(scanPool.filter(bill => scanRouteByBill.get(bill) === 'CLOSE_POD_NO_TRACK'));
  const preliminaryReturnBills = new Set(scanPool.filter(bill => scanRouteByBill.get(bill) === 'CLOSE_RETURN_NO_TRACK'));
  for (const bill of preliminaryPodBills) podLocks.add(bill);
  const scanRetryBills = scanPool.filter(bill => scanRouteByBill.get(bill) === 'SCAN_RETRY');
  state.scanRetryBills = scanRetryBills;
  const needTrack = scanPool.filter(bill => scanRouteByBill.get(bill) === 'TRACK');
  state.needTrackBills = needTrack;
  state.podLocks = [...podLocks].sort();
  await checkpoint(state, onCheckpoint);

  const eventsResult = await queryShopeeApi({
    state, apiName: 'tms-shipment-event-query', bills: needTrack,
    rowsKey: 'trackEvents', statusKey: 'eventQueryStatus',
    query: codes => client.trackQuery(codes), onProgress, onCheckpoint, isPaused,
    normalizeRow: row => ({ ...normalizeEvent(row), reportDate })
  });
  const exceptionResult = await queryShopeeApi({
    state, apiName: 'exception-item-query', bills: needTrack,
    rowsKey: 'exceptionItems', statusKey: 'exceptionQueryStatus',
    query: codes => client.exceptionQuery(codes), onProgress, onCheckpoint, isPaused,
    normalizeRow: row => ({ ...row, shipmentCode: billOf(row), reportDate })
  });

  const eventsByBill = groupRows(eventsResult.rows);
  const exceptionsByBill = groupRows(exceptionResult.rows);
  const eventStatusByBill = statusMap(eventsResult.statuses);
  const exceptionStatusByBill = statusMap(exceptionResult.statuses);
  const trackResults = [];
  for (const bill of scanPool) {
    const scanRow = scanResults.find(row => billOf(row) === bill) || { 运单号: bill, shipmentCode: bill, 来源类型: sourceType(bill, today, carry) };
    const alreadyPod = preliminaryPodBills.has(bill);
    const scanRetry = scanRouteByBill.get(bill) === 'SCAN_RETRY';
    const result = analyzeShopeeShipment({
      waybill: bill,
      scanRow,
      shipmentTrackRow: {},
      events: (alreadyPod || preliminaryReturnBills.has(bill)) ? [] : (eventsByBill.get(bill) || []),
      exceptions: (alreadyPod || preliminaryReturnBills.has(bill)) ? [] : (exceptionsByBill.get(bill) || []),
      reportDate,
      dailyRow: dailyByBill.get(bill) || {},
      priorRow: priorByBill.get(bill) || {},
      apiStatus: {
        shipment: scanRetry ? 'scan_retry' : (scanStatusByBill.get(bill) || 'failed'),
        event: alreadyPod ? 'skipped_pod' : (preliminaryReturnBills.has(bill) ? 'skipped_return' : (scanRetry ? 'skipped_scan_retry' : (eventStatusByBill.get(bill) || 'failed'))),
        exception: alreadyPod ? 'skipped_pod' : (preliminaryReturnBills.has(bill) ? 'skipped_return' : (scanRetry ? 'skipped_scan_retry' : (exceptionStatusByBill.get(bill) || 'failed')))
      }
    });
    if (scanRetry) {
      result.API状态 = '待重试';
      result.查询状态 = 'scan_retry';
      result.primaryCategory = '订单扫描待重试';
      result.主分类 = '订单扫描待重试';
      result.异常分类 = '订单扫描待重试';
      result.QC判断 = '订单扫描未返回有效状态，未进入轨迹查询，保留次日续查。';
    }
    trackResults.push(result);
    if (result.是否POD === '是') podLocks.add(bill);
  }

  const podSet = new Set(cleanAnyBills([...podLocks]));
  const finalRows = uniqueRows([...lockedPodRows.map(row => ({ ...row, primaryCategory: 'POD', 主分类: 'POD', 异常分类: 'POD', carry状态: 'closed_pod', 跨日状态: '已闭环', 入库无扫描节点: '否' })), ...trackResults]);
  const nextCarryBills = cleanAnyBills(finalRows
    .filter(row => row.是否POD !== '是' && row.退回状态 !== '已退回')
    .filter(row => row.specialState !== 'SELF_PICKUP' && row.primaryCategory !== '仓库自提')
    .map(billOf))
    .filter(bill => !podSet.has(bill));
  const completedAt = new Date();
  const failedBills = new Set(finalRows.filter(row => row.查询状态 === 'refresh_failed').map(billOf));
  const summary = {
    businessType: 'SHOPEE', reportDate, runId,
    today: today.length, carry: carry.length, scanPool: scanPool.length,
    scanPod: finalRows.filter(row => row.是否POD === '是').length,
    needTrack: needTrack.length, trackPod: finalRows.filter(row => row.是否POD === '是').length,
    scanRetry: scanRetryBills.length,
    events: eventsResult.rows.length, exceptions: exceptionResult.rows.length,
    nextCarry: nextCarryBills.length, refreshFailed: failedBills.size,
    startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
    durationSeconds: Math.round((completedAt - startedAt) / 1000)
  };

  state.trackResults = trackResults;
  state.finalRows = finalRows;
  state.nextCarryBills = nextCarryBills;
  state.carryBills = nextCarryBills;
  state.podLocks = [...podSet].sort();
  state.processing = { running: false, paused: false, phase: '完成', batchIndex: 1, totalBatches: 1, runId };
  state.lastRunSummary = summary;
  state.lastRun = summary;
  await checkpoint(state, onCheckpoint);
  if (scanRetryBills.length) {
    state.processing = {
      ...(state.processing || {}),
      running: false,
      paused: false,
      phase: '订单扫描待重试',
      error: `SHOPEE订单扫描仍有${scanRetryBills.length}票未返回有效状态，已停止生成正式快照。`
    };
    state.lastRunSummary = { ...state.lastRunSummary, runStatus: 'SCAN_RETRY_REQUIRED' };
    state.lastRun = state.lastRunSummary;
    await checkpoint(state, onCheckpoint);
    const error = new Error(`SHOPEE订单扫描仍有${scanRetryBills.length}票待重试，未生成正式快照。`);
    error.code = 'SCAN_RETRY_REQUIRED';
    error.runStatus = 'SCAN_RETRY_REQUIRED';
    throw error;
  }
  if (failedBills.size) {
    await onProgress(`SHOPEE部分接口失败：${failedBills.size}票已保留跨日与失败批次，继续处理时只重试失败票`);
    const error = new Error(`SHOPEE有${failedBills.size}票API查询失败，数据已保留，请点击继续处理重试失败批次。`);
    error.code = 'SHOPEE_PARTIAL_API_FAILURE';
    error.runStatus = 'TRACK_RETRY_REQUIRED';
    throw error;
  }
  await onProgress(`SHOPEE完成：POD ${summary.scanPod}票，退回 ${finalRows.filter(row => row.退回状态 === '已退回').length}票，明日继续 ${summary.nextCarry}票`);
  return { state, summary };
}

async function queryShopeeConfirmApi({ state, bills, client, onProgress, onCheckpoint, isPaused }) {
  const reportDate = state.reportDate || '';
  const statusByBill = new Map((state.scanQueryStatus || [])
    .filter(row => !row.reportDate || row.reportDate === reportDate)
    .map(row => [billOf(row), row]));
  const completed = new Set([...statusByBill]
    .filter(([, row]) => row.status === 'success')
    .map(([bill]) => bill));
  const rows = (state.scanResults || []).filter(row => completed.has(billOf(row)));
  const pending = cleanAnyBills(bills).filter(bill => !completed.has(bill));
  const batches = [];
  for (let index = 0; index < pending.length; index += ORDER_BATCH_SIZE) batches.push(pending.slice(index, index + ORDER_BATCH_SIZE));

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    await waitIfPaused(state, isPaused, onProgress, onCheckpoint);
    state.processing = { ...state.processing, phase: 'SHOPEE订单扫描', batchIndex: index + 1, totalBatches: batches.length };
    await onProgress(`SHOPEE订单扫描 ${index + 1}/${batches.length}：${batch.length}票（单批上限350）`);
    try {
      const responseRows = await client.confirmQuery(batch);
      rows.push(...(responseRows || []));
      const grouped = groupConfirmRows(responseRows || []);
      for (const bill of batch) {
        const matched = grouped.get(bill) || [];
        statusByBill.set(bill, {
          businessType: 'SHOPEE', reportDate, shipmentCode: bill, status: matched.length ? 'success' : 'failed',
          resultCount: matched.length, errorMessage: matched.length ? '' : 'SCAN_EMPTY_RESPONSE', checkedAt: new Date().toISOString()
        });
      }
      recordApiAttempt(state, { apiName: 'otwms-order-confirm-query', stage: 'scan-status', batchIndex: index + 1, batch, status: 'success', resultCount: (responseRows || []).length });
    } catch (error) {
      const diagnostic = classifyCeFailure(error);
      if (diagnostic.runStatus) {
        state.apiDiagnostic = { ...diagnostic, apiName: 'otwms-order-confirm-query', endpoint: '/api/otwms/order/confirm-query', bodyShape: '{shipmentCodes:[...]}', batchKey: `scan-status:${String(index + 1).padStart(6, '0')}`, runId: state.currentRun?.runId || '', shipmentCount: batch.length };
        state.processing = { ...state.processing, running: false, paused: true, error: diagnostic.userMessage };
        await checkpoint(state, onCheckpoint);
        const systemError = new Error(diagnostic.userMessage);
        systemError.code = diagnostic.code;
        systemError.runStatus = diagnostic.runStatus;
        systemError.apiDiagnostic = state.apiDiagnostic;
        throw systemError;
      }
      for (const bill of batch) {
        statusByBill.set(bill, {
          businessType: 'SHOPEE', reportDate, shipmentCode: bill, status: 'failed',
          errorMessage: error?.message || String(error || ''), checkedAt: new Date().toISOString()
        });
      }
      recordApiAttempt(state, { apiName: 'otwms-order-confirm-query', stage: 'scan-status', batchIndex: index + 1, batch, status: 'failed', error });
      await onProgress(`SHOPEE订单扫描批次失败：${batch.length}票已保留，续跑时仅重试该失败批次`);
    }
    state.scanResults = dedupeApiRows(rows, 'confirm-query');
    state.scanQueryStatus = [...statusByBill.values()];
    await checkpoint(state, onCheckpoint);
  }
  state.scanResults = dedupeApiRows(rows, 'confirm-query');
  state.scanQueryStatus = [...statusByBill.values()];
  return { rows: state.scanResults, statuses: state.scanQueryStatus };
}

async function queryShopeeApi({ state, apiName, bills, rowsKey, statusKey, query, onProgress, onCheckpoint, isPaused, normalizeRow = row => row }) {
  const reportDate = state.reportDate || '';
  const existingRows = (state[rowsKey] || []).filter(row => !row.reportDate || row.reportDate === reportDate);
  const statusByBill = new Map((state[statusKey] || []).filter(row => !row.reportDate || row.reportDate === reportDate).map(row => [billOf(row), row]));
  const completed = new Set([...statusByBill].filter(([, row]) => row.status === 'success' || row.status === 'skipped_pod').map(([bill]) => bill));
  const batches = splitTrackBatches(cleanAnyBills(bills));
  let rows = existingRows.filter(row => completed.has(billOf(row)));
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const stableBatch = batches[batchIndex];
    if (stableBatch.every(bill => completed.has(bill))) continue;
    const batch = stableBatch.filter(bill => !completed.has(bill));
    await waitIfPaused(state, isPaused, onProgress, onCheckpoint);
    const batchNumber = batchIndex + 1;
    state.processing = { ...state.processing, phase: apiName, batchIndex: batchNumber, totalBatches: batches.length };
    await onProgress(`${apiName} ${batchNumber}/${batches.length}：${batch.length}票（单批上限50）`);
    const outcome = await queryBatchWithFallback({
      batch,
      query,
      apiName,
      onLog: onProgress,
      fallbackSizes: [],
      onAttempt: attempt => recordApiAttempt(state, { ...attempt, stage: apiName === 'tms-shipment-event-query' ? 'track-event' : 'exception-item', batchIndex: batchNumber })
    });
    for (const success of outcome.successes) {
      const normalized = (success.events || []).map(normalizeRow).filter(row => billOf(row));
      rows.push(...normalized);
      for (const bill of success.batch) statusByBill.set(bill, { businessType: 'SHOPEE', reportDate, shipmentCode: bill, status: 'success', resultCount: normalized.filter(row => billOf(row) === bill).length, checkedAt: new Date().toISOString() });
    }
    for (const failure of outcome.failures) {
      for (const bill of failure.batch) statusByBill.set(bill, { businessType: 'SHOPEE', reportDate, shipmentCode: bill, status: 'failed', errorMessage: failure.error?.message || String(failure.error || ''), checkedAt: new Date().toISOString() });
    }
    rows = dedupeApiRows(rows, apiName);
    state[rowsKey] = rows;
    state[statusKey] = [...statusByBill.values()];
    await checkpoint(state, onCheckpoint);
  }
  state[rowsKey] = dedupeApiRows(rows, apiName);
  state[statusKey] = [...statusByBill.values()];
  return { rows: state[rowsKey], statuses: state[statusKey] };
}

function recordApiAttempt(state, attempt) {
  const codes = cleanAnyBills(attempt.batch || []);
  const stage = String(attempt.stage || attempt.apiName || 'batch').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const batchIndex = Math.max(1, Number(attempt.batchIndex || 1));
  const batchKey = `${stage}:${String(batchIndex).padStart(6, '0')}`;
  const runId = state.currentRun?.runId || state.lastRunSummary?.runId || '';
  const existing = (state.apiBatchStatus || []).find(row => row.apiName === attempt.apiName && row.batchKey === batchKey && row.runId === runId);
  const payloadHash = createHash('sha256').update(JSON.stringify(codes)).digest('hex');
  if (existing?.payloadHash && existing.payloadHash !== payloadHash) {
    const error = new Error(`批次${batchKey}的运单内容与已保存记录不一致，已停止避免重复请求。`);
    error.code = 'BATCH_KEY_PAYLOAD_MISMATCH';
    throw error;
  }
  const row = {
    ...(existing || {}), businessType: 'SHOPEE', reportDate: state.reportDate || '', runId,
    apiName: attempt.apiName, batchKey, shipmentCodes: codes, payloadHash, shipmentCount: codes.length,
    firstShipmentCode: codes[0] || '', lastShipmentCode: codes.at(-1) || '',
    status: attempt.status,
    attemptCount: attempt.status === 'running'
      ? Number(existing?.attemptCount || 0) + 1
      : Math.max(1, Number(existing?.attemptCount || 0)),
    resultCount: Number(attempt.resultCount || existing?.resultCount || 0), errorMessage: attempt.error?.message || '',
    createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  state.apiBatchStatus = [...(state.apiBatchStatus || []).filter(item => !(item.apiName === row.apiName && item.batchKey === row.batchKey && item.runId === row.runId)), row];
}

function classifyCeFailure(error) {
  const status = Number(error?.ceStatus || error?.response?.status || 0);
  const code = String(error?.ceCode || '');
  const msg = String(error?.ceMsg || error?.message || '').slice(0, 500);
  if ([401, 403].includes(status) || ['401', '403'].includes(code)) return { code: 'AUTH_REQUIRED', runStatus: 'AUTH_REQUIRED', httpStatus: status, ceCode: code, ceMsg: msg, userMessage: 'CE系统登录已失效，请在系统设置重新登录后点击继续处理。' };
  if ([400, 422].includes(status)) return { code: 'REQUEST_SCHEMA_INVALID', runStatus: 'REQUEST_SCHEMA_INVALID', httpStatus: status, ceCode: code, ceMsg: msg, userMessage: `CE请求结构错误：${msg || `HTTP ${status}`}` };
  if (status === 404) return { code: 'ENDPOINT_INVALID', runStatus: 'ENDPOINT_INVALID', httpStatus: status, ceCode: code, ceMsg: msg, userMessage: 'CE接口路径无效，已停止本次处理。' };
  return { code: 'BATCH_REQUEST_FAILED', runStatus: '', httpStatus: status, ceCode: code, ceMsg: msg, userMessage: msg || 'CE请求失败' };
}

function routeShopeeScan(row = {}, requestStatus = '') {
  const terminal = classifyScanTerminal(row, requestStatus);
  if (terminal.currentState === 'SCAN_PENDING_RETRY') return 'SCAN_RETRY';
  if (terminal.currentState === 'POD') return 'CLOSE_POD_NO_TRACK';
  if (terminal.currentState === 'RETURN_COMPLETED') return 'CLOSE_RETURN_NO_TRACK';
  // A successful scan response is not an API failure. Only terminal POD/return
  // statuses skip track query; all other successful statuses must enter track.
  return 'TRACK';
}

function groupRows(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const bill = billOf(row);
    if (!bill) continue;
    if (!grouped.has(bill)) grouped.set(bill, []);
    grouped.get(bill).push(row);
  }
  return grouped;
}

function statusMap(rows = []) { return new Map(rows.map(row => [billOf(row), row.status])); }

function dedupeApiRows(rows = [], apiName = '') {
  const map = new Map();
  const normalizedApiName = String(apiName || '').toLowerCase();
  const isTrackEvent = normalizedApiName.includes('shipment-event');
  const isExceptionItem = normalizedApiName.includes('exception-item');
  for (const row of rows) {
    const bill = billOf(row);
    if (!bill) continue;
    const key = isTrackEvent
      ? `${bill}|${row.eventTime || ''}|${row.eventCode || ''}|${row.trackingEventCode || ''}|${row.trackingEventDescZh || row.trackingEventDesc || ''}`
      : isExceptionItem
        ? `${bill}|${row.reportTime || ''}|${row.exceptionType || ''}|${row.exceptionDesc || ''}|${row.fileId || ''}`
        : bill;
    map.set(key, row);
  }
  return [...map.values()];
}

function uniqueRows(rows = []) { const map = new Map(); for (const row of rows) if (billOf(row)) map.set(billOf(row), row); return [...map.values()]; }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase(); }

function groupConfirmRows(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const wb = String(row?.shipmentCode || row?.运单号 || '').trim().toUpperCase();
    if (!wb) continue;
    if (!grouped.has(wb)) grouped.set(wb, []);
    grouped.get(wb).push(row);
  }
  return grouped;
}

function selectConfirmRow(rows = []) {
  const priorities = { POD: 4, RETURN_COMPLETED: 3, RETURN_IN_PROGRESS: 2, OPEN_TRACK_REQUIRED: 1, SCAN_PENDING_RETRY: 0 };
  return [...rows].sort((left, right) => {
    const a = classifyScanTerminal(left, 'success').currentState;
    const b = classifyScanTerminal(right, 'success').currentState;
    return (priorities[b] || 0) - (priorities[a] || 0);
  })[0] || null;
}

function groupEvents(events, bills) {
  const m = new Map(bills.map(x => [x, []]));
  for (const e of events) {
    const wb = String(e.shipmentCode || '').toUpperCase();
    if (!m.has(wb)) m.set(wb, []);
    m.get(wb).push(e);
  }
  for (const arr of m.values()) arr.sort((a, b) => String(a.eventTime || '').localeCompare(String(b.eventTime || '')));
  return m;
}

function buildSummary({ state, today, carry, scanPool, scanResults, trackResults, allEvents, nextCarryBills, refreshFailed, startedAt, completedAt }) {
  const byCat = categoryCounts(trackResults);
  return {
    reportDate: state.reportDate || '',
    sourceName: state.sourceName || '',
    today: today.length,
    nonPnh: (state.nonPnhBills || []).length,
    excluded: (state.excludedBills || []).length,
    duplicates: (state.duplicateBills || []).length,
    carry: carry.length,
    scanPool: scanPool.length,
    scanPod: scanResults.filter(x => x.是否POD === '是').length,
    needTrack: (state.needTrackBills || []).length,
    trackPod: trackResults.filter(x => x.是否POD === '是').length,
    events: allEvents.length,
    pending3: byCat['Pending3次以上'] || byCat['Pending连续3天+'] || 0,
    oc2: byCat['OC2天'] || byCat['OC2天+'] || 0,
    cycle2: byCat['盘点2天'] || byCat['盘点2天+'] || 0,
    delivery2: byCat['派送停留2天'] || byCat['派送停留2天+'] || 0,
    assign2: byCat['派件分配2天+'] || 0,
    inboundNoScan: byCat['入库无扫描'] || 0,
    finalDiversion: (byCat['正常分流节点'] || 0) + (byCat['最终分流排除'] || 0),
    noTrack: byCat['包裹无动作'] || byCat['轨迹无返回'] || 0,
    nextCarry: nextCarryBills.length,
    refreshFailed: refreshFailed?.size || 0,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds: Math.round((completedAt - startedAt) / 1000)
  };
}

function categoryCounts(rows) {
  const out = {};
  for (const row of rows || []) {
    const key = row?.异常分类 || '';
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function isNormalFinalDiversionRow(row = {}) {
  return row?.异常分类 === '正常分流节点'
    || row?.异常分类 === '最终分流排除'
    || row?.primaryCategory === '正常分流节点'
    || row?.matchedRule === 'NORMAL_FINAL_HUB';
}

function sourceType(wb, today, carry) {
  return today.includes(wb) && carry.includes(wb) ? '今日日报+跨日遗留' : (carry.includes(wb) ? '跨日遗留' : '今日日报');
}

function preserveRows(rows, bills, key, reportDate = '') {
  const billSet = new Set(bills);
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    if (row?.reportDate && reportDate && row.reportDate !== reportDate) continue;
    const wb = String(row?.[key] || '').toUpperCase();
    if (!wb || !billSet.has(wb) || seen.has(wb)) continue;
    seen.add(wb);
    out.push(row);
  }
  return out;
}

async function retry(fn, times, label) {
  let lastError;
  for (let i = 1; i <= times; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < times) await sleep(1000 * i);
    }
  }
  throw new Error(`${label}失败，已重试${times}次：${lastError?.message || lastError}`);
}

async function waitIfPaused(state, isPaused, onProgress, onCheckpoint) {
  let notified = false;
  while (await isPaused()) {
    state.processing = { ...state.processing, paused: true };
    await checkpoint(state, onCheckpoint);
    if (!notified) {
      await onProgress('处理已暂停，等待继续...');
      notified = true;
    }
    await sleep(2000);
  }
  if (notified) await onProgress('处理已继续');
  state.processing = { ...state.processing, paused: false };
}

async function checkpoint(state, onCheckpoint) {
  await onCheckpoint(state);
}

function countRows(rows, category, podOnly = false) {
  if (podOnly) return rows.filter(row => row.是否POD === '是').length;
  return rows.filter(row => row.异常分类 === category).length;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
