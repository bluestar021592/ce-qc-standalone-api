export const TRACK_QUERY_BATCH_SIZE = 50;
const DEFAULT_TRANSIENT_RETRIES = Math.max(1, Math.min(5, Number(process.env.CE_TRANSIENT_RETRIES || 3)));
const DEFAULT_TRANSIENT_DELAY_MS = Math.max(200, Math.min(5000, Number(process.env.CE_TRANSIENT_RETRY_DELAY_MS || 800)));

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

export function isTransientTransportError(error) {
  const code = String(error?.code || error?.cause?.code || error?.transportCode || '').toUpperCase();
  const message = [error?.message, error?.cause?.message, error?.ceMsg]
    .filter(Boolean)
    .join(' ');
  return ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETRESET', 'ENETUNREACH', 'ECONNREFUSED'].includes(code)
    || /socket hang up|connection reset|network error|timed?\s*out|timeout|premature close|read ECONNRESET|socket disconnected before secure TLS connection|before secure TLS connection was established|client network socket disconnected/i.test(message);
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

async function withTransientRetry(query, batch, onLog, retries = DEFAULT_TRANSIENT_RETRIES, delayMs = DEFAULT_TRANSIENT_DELAY_MS, apiName = 'CE接口') {
  let attempt = 0;
  while (true) {
    try {
      return await query(batch);
    } catch (error) {
      if (isAuthenticationFailure(error) || error?.runStatus) throw error;
      if (!isTransientTransportError(error) || attempt >= retries) throw error;
      attempt += 1;
      const backoff = Math.min(8000, delayMs * attempt);
      await onLog(`${apiName}网络/TLS瞬断：${batch.length}票将在${backoff}ms后自动重试 ${attempt}/${retries}，原因：${error?.message || error}`);
      await wait(backoff);
    }
  }
}

export async function queryBatchWithFallback({
  batch,
  query,
  onLog = async () => {},
  onAttempt = async () => {},
  apiName = 'track',
  fallbackSizes = [25, 10],
  transientRetries = DEFAULT_TRANSIENT_RETRIES,
  transientDelayMs = DEFAULT_TRANSIENT_DELAY_MS
}) {
  const original = [...batch];
  try {
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'running' }, onLog);
    // CE's read-only query endpoints can occasionally reset the TLS socket before
    // the secure connection is established. Retry the exact same idempotent request
    // several times before treating the waybills as failed. This prevents one brief
    // upstream network reset from stopping a multi-thousand-row daily run.
    const events = await withTransientRetry(query, original, onLog, transientRetries, transientDelayMs, apiName);
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'success', resultCount: (events || []).length }, onLog);
    return { successes: [{ batch: original, events: events || [] }], failures: [] };
  } catch (error) {
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'failed', error }, onLog);
    // CE sometimes reports an expired/unauthorized session with HTTP 200 and a
    // business message such as “请求未授权”. Treat that exactly like HTTP 401/403:
    // stop immediately, preserve checkpoints, and let the run pause for login.
    if (error?.runStatus || isAuthenticationFailure(error)) throw error;
    await onLog(`${apiName}批次失败：原批次${original.length}票，原因：${error?.message || error}`);
    const fallbackSize = (fallbackSizes || []).find(size => size < original.length);
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
        fallbackSizes: (fallbackSizes || []).filter(size => size < fallbackSize),
        transientRetries,
        transientDelayMs
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

  // Track/event queries are read-only. Retry transient network/TLS failures up to
  // three times at each size, then adaptively shrink only the failed batch.
  return queryBatchWithFallback({
    ...options,
    query: rawQuery,
    onLog,
    apiName: options.apiName || 'track-query',
    transientRetries: Number.isFinite(Number(options.transientRetries)) ? Number(options.transientRetries) : DEFAULT_TRANSIENT_RETRIES,
    transientDelayMs: Number.isFinite(Number(options.transientDelayMs)) ? Number(options.transientDelayMs) : DEFAULT_TRANSIENT_DELAY_MS,
    fallbackSizes: Array.isArray(options.fallbackSizes) && options.fallbackSizes.length
      ? options.fallbackSizes
      : [25, 10, 5, 1]
  });
}
