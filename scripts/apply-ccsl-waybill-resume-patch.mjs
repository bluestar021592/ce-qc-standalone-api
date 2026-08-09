import fs from 'node:fs';

const file = 'src/pipeline.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
`  const scanResults = preserveRows(state.scanResults, scanPool, '运单号', state.reportDate || '');
  const scanned = new Set(scanResults.map(row => row.运单号));
  const refreshFailed = new Set();
  const returnedCompleted = new Set();`,
`  const reportDate = state.reportDate || '';
  const legacyScanResults = preserveRows(state.scanResults, scanPool, '运单号', reportDate);
  const scanStatusByBill = new Map((state.scanQueryStatus || [])
    .filter(row => !row.reportDate || row.reportDate === reportDate)
    .map(row => [billOf(row), row]));
  for (const row of legacyScanResults) {
    const bill = billOf(row);
    if (!bill || scanStatusByBill.has(bill)) continue;
    scanStatusByBill.set(bill, {
      businessType: 'CCSL', reportDate, shipmentCode: bill,
      status: isScanRetryRow(row) ? 'failed' : 'success',
      resultCount: isScanRetryRow(row) ? 0 : 1,
      errorMessage: isScanRetryRow(row) ? String(row.错误信息 || 'SCAN_RETRY_REQUIRED') : '',
      checkedAt: new Date().toISOString(), inferredFromLegacyState: true
    });
  }
  const completedScan = new Set([...scanStatusByBill]
    .filter(([, row]) => row.status === 'success')
    .map(([bill]) => bill));
  const scanResults = legacyScanResults.filter(row => completedScan.has(billOf(row)));
  const scanned = new Set(completedScan);
  const refreshFailed = new Set([...scanStatusByBill]
    .filter(([, row]) => row.status === 'failed')
    .map(([bill]) => bill));
  const returnedCompleted = new Set(scanResults.filter(row => row.currentState === 'RETURN_COMPLETED' || row.退回状态 === '已退回').map(billOf));`,
'initialize CCSL scan resume status'
);

replaceOnce(
`    const data = scanOutcome.successes.flatMap(item => item.events || []);
    for (const failure of scanOutcome.failures) {
      for (const wb of failure.batch) refreshFailed.add(wb);
    }
    const grouped = groupConfirmRows(data);
    for (const wb of batch) {
      const rows = grouped.get(wb) || [];
      const row = selectConfirmRow(rows);
      const orderStatus = String(row?.orderStatus ?? '');
      const terminal = classifyScanTerminal(row || {}, refreshFailed.has(wb) ? 'failed' : (row ? 'success' : 'failed'));`,
`    const data = scanOutcome.successes.flatMap(item => item.events || []);
    const grouped = groupConfirmRows(data);
    const failedInOutcome = new Map();
    for (const failure of scanOutcome.failures) {
      for (const wb of failure.batch) failedInOutcome.set(wb, failure.error);
    }
    for (const wb of batch) {
      const rows = grouped.get(wb) || [];
      const row = selectConfirmRow(rows);
      const requestSucceeded = Boolean(row) && !failedInOutcome.has(wb);
      const orderStatus = String(row?.orderStatus ?? '');
      if (requestSucceeded) {
        refreshFailed.delete(wb);
        scanStatusByBill.set(wb, {
          businessType: 'CCSL', reportDate, shipmentCode: wb, status: 'success', resultCount: rows.length,
          errorMessage: '', checkedAt: new Date().toISOString()
        });
      } else {
        refreshFailed.add(wb);
        scanStatusByBill.set(wb, {
          businessType: 'CCSL', reportDate, shipmentCode: wb, status: 'failed', resultCount: rows.length,
          errorMessage: failedInOutcome.get(wb)?.message || (row ? 'SCAN_RETRY_REQUIRED' : 'SCAN_EMPTY_RESPONSE'),
          checkedAt: new Date().toISOString()
        });
      }
      const terminal = classifyScanTerminal(row || {}, requestSucceeded ? 'success' : 'failed');`,
'write per-waybill CCSL scan status'
);

replaceOnce(
`    state.scanResults = scanResults;
    state.podLocks = [...podLocks].sort();
    state.lastRunSummary = { ...state.lastRunSummary, scanDone: scanResults.length, scanPod: countRows(scanResults, 'POD闭环', true) };
    await checkpoint(state, onCheckpoint);`,
`    state.scanResults = uniqueRows(scanResults);
    state.scanQueryStatus = [...scanStatusByBill.values()];
    state.podLocks = [...podLocks].sort();
    state.lastRunSummary = { ...state.lastRunSummary, scanDone: state.scanResults.length, scanPod: countRows(state.scanResults, 'POD闭环', true) };
    await checkpoint(state, onCheckpoint);`,
'checkpoint CCSL scan status'
);

replaceOnce(
`  const trackResults = preserveRows(state.trackResults, needTrack, '运单号', state.reportDate || '');
  const tracked = new Set(trackResults.map(row => row.运单号));
  const chunks = splitTrackBatches(needTrack.filter(wb => !tracked.has(wb)));
  let idx = 0;`,
`  const legacyTrackResults = preserveRows(state.trackResults, needTrack, '运单号', reportDate);
  const trackStatusByBill = new Map((state.trackQueryStatus || [])
    .filter(row => !row.reportDate || row.reportDate === reportDate)
    .map(row => [billOf(row), row]));
  for (const row of legacyTrackResults) {
    const bill = billOf(row);
    if (!bill || trackStatusByBill.has(bill)) continue;
    trackStatusByBill.set(bill, {
      businessType: 'CCSL', reportDate, shipmentCode: bill,
      status: isTrackRetryRow(row) ? 'failed' : 'success',
      resultCount: isTrackRetryRow(row) ? 0 : 1,
      errorMessage: isTrackRetryRow(row) ? String(row.错误信息 || 'TRACK_RETRY_REQUIRED') : '',
      checkedAt: new Date().toISOString(), inferredFromLegacyState: true
    });
  }
  const completedTrack = new Set([...trackStatusByBill]
    .filter(([, row]) => row.status === 'success')
    .map(([bill]) => bill));
  const trackResults = legacyTrackResults.filter(row => completedTrack.has(billOf(row)));
  const tracked = new Set(completedTrack);
  const chunks = splitTrackBatches(needTrack.filter(wb => !tracked.has(wb)));
  let idx = 0;`,
'initialize CCSL track resume status'
);

replaceOnce(
`      const failedByBill = new Map();
      for (const failure of batchOutcome.failures) {
        for (const wb of failure.batch) {
          refreshFailed.add(wb);
          failedByBill.set(wb, failure.error);
        }
      }
      const events = eventsRaw`,
`      const failedByBill = new Map();
      for (const success of batchOutcome.successes) {
        for (const wb of success.batch) {
          refreshFailed.delete(wb);
          trackStatusByBill.set(wb, {
            businessType: 'CCSL', reportDate, shipmentCode: wb, status: 'success',
            resultCount: (success.events || []).filter(event => billOf(event) === wb).length,
            errorMessage: '', checkedAt: new Date().toISOString()
          });
        }
      }
      for (const failure of batchOutcome.failures) {
        for (const wb of failure.batch) {
          refreshFailed.add(wb);
          failedByBill.set(wb, failure.error);
          trackStatusByBill.set(wb, {
            businessType: 'CCSL', reportDate, shipmentCode: wb, status: 'failed', resultCount: 0,
            errorMessage: failure.error?.message || String(failure.error || ''), checkedAt: new Date().toISOString()
          });
        }
      }
      const events = eventsRaw`,
'write per-waybill CCSL track status'
);

replaceOnce(
`      state.trackEvents = allEvents;
      state.trackResults = trackResults;
      state.podLocks = [...podLocks].sort();
      await checkpoint(state, onCheckpoint);`,
`      state.trackEvents = allEvents;
      state.trackResults = uniqueRows(trackResults);
      state.trackQueryStatus = [...trackStatusByBill.values()];
      state.podLocks = [...podLocks].sort();
      await checkpoint(state, onCheckpoint);`,
'checkpoint CCSL track status'
);

replaceOnce(
`function preserveRows(rows, bills, key, reportDate = '') {`,
`function isScanRetryRow(row = {}) {
  const state = String(row.currentState || row.scanNormalizedState || '').toUpperCase();
  const queryStatus = String(row.查询状态 || row.apiStatus || row.API状态 || '').toLowerCase();
  return state === 'SCAN_PENDING_RETRY'
    || /refresh_failed|scan_retry|pending_retry|待重试|失败/.test(queryStatus)
    || String(row.primaryCategory || row.主分类 || '').includes('订单扫描待重试');
}

function isTrackRetryRow(row = {}) {
  const queryStatus = String(row.查询状态 || row.apiStatus || row.API状态 || '').toLowerCase();
  return /refresh_failed|track_retry|pending_retry|待重试|失败/.test(queryStatus)
    || String(row.primaryCategory || row.主分类 || '').includes('待重试')
    || (row.tags || []).includes?.('REFRESH_FAILED');
}

function preserveRows(rows, bills, key, reportDate = '') {`,
'add CCSL retry predicates'
);

fs.writeFileSync(file, source, 'utf8');
