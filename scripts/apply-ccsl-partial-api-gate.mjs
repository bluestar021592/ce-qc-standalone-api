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
`  state.carryBills = nextCarryBills;
  state.podLocks = [...podSet].sort();
  state.processing = { running: false, paused: false, phase: '完成', batchIndex: 1, totalBatches: 1, runId };
  state.lastRunSummary = summary;
  state.lastRun = summary;
  await checkpoint(state, onCheckpoint);
  await onProgress(\`完成：订单POD \${summary.scanPod}，轨迹POD \${summary.trackPod}，明日继续 \${summary.nextCarry}\`);
  return { state, summary };`,
`  state.carryBills = nextCarryBills;
  state.podLocks = [...podSet].sort();

  const failedScanBills = [...scanStatusByBill]
    .filter(([, row]) => row.status === 'failed')
    .map(([bill]) => bill);
  const failedTrackBills = [...trackStatusByBill]
    .filter(([, row]) => row.status === 'failed')
    .map(([bill]) => bill);
  const retryBills = [...new Set([...failedScanBills, ...failedTrackBills])].sort();
  if (retryBills.length) {
    const retrySummary = {
      ...summary,
      runStatus: 'API_RETRY_REQUIRED',
      scanRetry: failedScanBills.length,
      trackRetry: failedTrackBills.length,
      retryBills
    };
    const errorMessage = \`接口仍有 \${retryBills.length} 票待重试（扫描 \${failedScanBills.length}，轨迹 \${failedTrackBills.length}），当前进度已保存；继续处理时只重试失败票。\`;
    state.processing = {
      running: false,
      paused: false,
      phase: '接口待重试',
      batchIndex: 0,
      totalBatches: retryBills.length,
      runId,
      error: errorMessage
    };
    state.lastRunSummary = retrySummary;
    state.lastRun = retrySummary;
    await checkpoint(state, onCheckpoint);
    await onProgress(errorMessage);
    const retryError = new Error(errorMessage);
    retryError.code = 'CCSL_PARTIAL_API_FAILURE';
    retryError.runStatus = 'API_RETRY_REQUIRED';
    retryError.retryBills = retryBills;
    retryError.scanRetry = failedScanBills.length;
    retryError.trackRetry = failedTrackBills.length;
    throw retryError;
  }

  state.processing = { running: false, paused: false, phase: '完成', batchIndex: 1, totalBatches: 1, runId };
  state.lastRunSummary = { ...summary, runStatus: 'COMPLETED', scanRetry: 0, trackRetry: 0, retryBills: [] };
  state.lastRun = state.lastRunSummary;
  await checkpoint(state, onCheckpoint);
  await onProgress(\`完成：订单POD \${summary.scanPod}，轨迹POD \${summary.trackPod}，明日继续 \${summary.nextCarry}\`);
  return { state, summary: state.lastRunSummary };`,
'block formal completion while CCSL API rows remain failed'
);

fs.writeFileSync(file, source, 'utf8');
