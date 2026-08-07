export const TRACK_QUERY_BATCH_SIZE = 50;

export function splitTrackBatches(shipmentCodes = [], batchSize = TRACK_QUERY_BATCH_SIZE) {
  const size = Math.max(1, Math.min(TRACK_QUERY_BATCH_SIZE, Number(batchSize || TRACK_QUERY_BATCH_SIZE)));
  const codes = [...new Set((shipmentCodes || []).map(code => String(code || '').trim().toUpperCase()).filter(Boolean))];
  const batches = [];
  for (let index = 0; index < codes.length; index += size) batches.push(codes.slice(index, index + size));
  return batches;
}

function splitBatchesAtSize(shipmentCodes = [], batchSize = 1) {
  const size = Math.max(1, Number(batchSize || 1));
  const batches = [];
  for (let index = 0; index < shipmentCodes.length; index += size) {
    batches.push(shipmentCodes.slice(index, index + size));
  }
  return batches;
}

export async function queryBatchWithFallback({
  batch,
  query,
  onLog = async () => {},
  onAttempt = async () => {},
  apiName = 'track',
  fallbackSizes = [25, 10]
}) {
  const original = [...batch];
  try {
    await onAttempt({ apiName, batch: original, status: 'running' });
    const events = await query(original);
    await onAttempt({ apiName, batch: original, status: 'success', resultCount: (events || []).length });
    return { successes: [{ batch: original, events: events || [] }], failures: [] };
  } catch (error) {
    await onAttempt({ apiName, batch: original, status: 'failed', error });
    // Authentication failures pause the whole run. Splitting the same request
    // cannot repair an expired session and would only create needless traffic.
    const authFailure = Number(error?.ceStatus || error?.status || 0) === 401
      || String(error?.ceCode || error?.code || '') === '401';
    if (error?.runStatus || authFailure) throw error;
    await onLog(`轨迹批次失败：原批次${original.length}票，原因：${error?.message || error}`);
    const fallbackSize = fallbackSizes.find(size => size < original.length);
    if (!fallbackSize) return { successes: [], failures: [{ batch: original, error }] };

    await onLog(`仅对失败批次自适应降级：${original.length}→${fallbackSize}`);
    const successes = [];
    const failures = [];
    for (const child of splitBatchesAtSize(original, fallbackSize)) {
      const result = await queryBatchWithFallback({
        batch: child,
        query,
        onLog,
        onAttempt,
        apiName,
        fallbackSizes: fallbackSizes.filter(size => size < fallbackSize)
      });
      successes.push(...result.successes);
      failures.push(...result.failures);
    }
    return { successes, failures };
  }
}

export const queryTrackBatchWithFallback = queryBatchWithFallback;
