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

async function safeAttempt(onAttempt, payload, onLog) {
  try {
    await onAttempt(payload);
  } catch (error) {
    // Per-waybill scan/event/exception status is the authoritative resume checkpoint.
    // apiBatchStatus is only audit metadata. After a partial success or adaptive
    // fallback, the remaining waybills can legitimately be regrouped under the same
    // numeric batch key. That must never block a safe resume.
    if (error?.code === 'BATCH_KEY_PAYLOAD_MISMATCH') {
      await onLog(`批次审计键已变化，按逐票成功/失败状态继续处理：${error.message || ''}`);
      return;
    }
    throw error;
  }
}

function isTransientTransportError(error) {
  const code = String(error?.code || error?.cause?.code || error?.transportCode || '').toUpperCase();
  const message = String(error?.message || error?.cause?.message || '');
  return ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETRESET', 'ENETUNREACH'].includes(code)
    || /socket hang up|connection reset|network error|timed?\s*out|timeout|premature close|read ECONNRESET/i.test(message);
}

function isAuthenticationFailure(error) {
  const status = Number(error?.ceStatus || error?.status || error?.response?.status || 0);
  const code = String(error?.ceCode || error?.code || '').trim().toUpperCase();
  const message = [error?.ceMsg, error?.message, error?.response?.data?.msg, error?.response?.data?.message]
    .filter(Boolean)
    .join(' ');
  return [401, 403].includes(status)
    || ['401', '403', 'AUTH_REQUIRED'].includes(code)
    || /请求未授权|未授权|unauthorized|登录已失效|登录过期|token\s*(?:expired|invalid)|expired\s*token|invalid\s*token/i.test(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function withTransientRetry(query, batch, onLog, retries = 1, delayMs = 800) {
  let attempt = 0;
  while (true) {
    try {
      return await query(batch);
    } catch (error) {
      if (!isTransientTransportError(error) || attempt >= retries) throw error;
      attempt += 1;
      await onLog(`轨迹网络瞬断：${batch.length}票将在${delayMs}ms后自动重试 ${attempt}/${retries}，原因：${error?.message || error}`);
      await wait(delayMs * attempt);
    }
  }
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
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'running' }, onLog);
    const events = await query(original);
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'success', resultCount: (events || []).length }, onLog);
    return { successes: [{ batch: original, events: events || [] }], failures: [] };
  } catch (error) {
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'failed', error }, onLog);
    // CE sometimes reports an expired/unauthorized session with HTTP 200 and a
    // business message such as “请求未授权”. Treat that exactly like HTTP 401/403:
    // stop immediately, preserve checkpoints, and let the run pause for login.
    // Splitting the same unauthorized request into 100/50/10/1 batches only floods
    // CE and can incorrectly turn every waybill into a retry item.
    if (error?.runStatus || isAuthenticationFailure(error)) throw error;
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

export async function queryTrackBatchWithFallback(options = {}) {
  const onLog = options.onLog || (async () => {});
  const rawQuery = options.query;
  if (typeof rawQuery !== 'function') throw new Error('track query function is required');

  // Track/event queries are read-only. A remote CE socket reset should not turn a
  // whole 10-waybill child batch into a manual resume item. Retry a transient
  // transport failure once at the same size, then progressively isolate the failed
  // child down to 5 and finally 1 waybill. Successful siblings are never repeated.
  return queryBatchWithFallback({
    ...options,
    onLog,
    fallbackSizes: Array.isArray(options.fallbackSizes) && options.fallbackSizes.length
      ? options.fallbackSizes
      : [25, 10, 5, 1],
    query: batch => withTransientRetry(rawQuery, batch, onLog, 1, 800)
  });
}
