export const TRACK_QUERY_BATCH_SIZE = 50;
const DEFAULT_TRANSIENT_RETRIES = Math.max(1, Math.min(5, Number(process.env.CE_TRANSIENT_RETRIES || 3)));
const DEFAULT_TRANSIENT_DELAY_MS = Math.max(200, Math.min(5000, Number(process.env.CE_TRANSIENT_RETRY_DELAY_MS || 800)));
const MIN_BATCH_TIME_BUDGET_MS = Math.max(250, Math.min(30000, Number(process.env.CE_MIN_BATCH_BUDGET_MS || 5000)));
const DEFAULT_BATCH_TIME_BUDGET_MS = Math.max(MIN_BATCH_TIME_BUDGET_MS, Math.min(180000, Number(process.env.CE_TRACK_BATCH_BUDGET_MS || 90000)));
const MAX_REQUEST_WINDOW_MS = 15000;
const TRACK_FALLBACK_SIZES = Object.freeze([25, 10, 5, 1]);

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

function effectiveFallbackSizes(apiName = '', fallbackSizes = null) {
  // An explicitly supplied [] means "fixed-size batch, never shrink". The SHOPEE
  // event/exception pipeline uses this mode so a 50-ticket batch is retried as the
  // same batch and then checkpointed for later retry instead of degrading to
  // 25/10/5/1 and slowing thousands of daily shipments.
  if (Array.isArray(fallbackSizes)) return fallbackSizes;
  return /track|shipment-event|exception-item/i.test(String(apiName || '')) ? [...TRACK_FALLBACK_SIZES] : [];
}

function budgetError(apiName, batch, budgetMs) {
  const error = new Error(`${apiName}批次超过${Math.ceil(Number(budgetMs || DEFAULT_BATCH_TIME_BUDGET_MS) / 1000)}秒时间预算，${batch.length}票转入接口失败重试中心，主流程继续下一批。`);
  error.code = 'BATCH_TIME_BUDGET_EXCEEDED';
  error.transportCode = 'ETIMEDOUT';
  return error;
}

function requestWindowMs(budgetMs) {
  return Math.min(MAX_REQUEST_WINDOW_MS, Math.max(100, Math.floor(Number(budgetMs || DEFAULT_BATCH_TIME_BUDGET_MS) / 4)));
}

async function queryWithinHardDeadline(query, batch, apiName, deadlineAt, budgetMs) {
  if (!deadlineAt) return query(batch);
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw budgetError(apiName, batch, budgetMs);
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => query(batch)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(budgetError(apiName, batch, budgetMs)), remaining);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withTransientRetry(query, batch, onLog, retries = DEFAULT_TRANSIENT_RETRIES, delayMs = DEFAULT_TRANSIENT_DELAY_MS, apiName = 'CE接口', deadlineAt = 0, budgetMs = DEFAULT_BATCH_TIME_BUDGET_MS) {
  let attempt = 0;
  const minWindow = requestWindowMs(budgetMs);
  while (true) {
    const remaining = deadlineAt ? deadlineAt - Date.now() : Number.POSITIVE_INFINITY;
    if (deadlineAt && remaining < minWindow) throw budgetError(apiName, batch, budgetMs);
    try {
      // Do not rely on the HTTP client's socket timeout alone. A DNS/TLS/socket
      // promise can occasionally remain pending without resolving or rejecting.
      // The batch wall-clock deadline is authoritative so one bad CE request can
      // never freeze thousands of later shipments or leave the UI on one batch.
      return await queryWithinHardDeadline(query, batch, apiName, deadlineAt, budgetMs);
    } catch (error) {
      if (isAuthenticationFailure(error) || error?.runStatus) throw error;
      if (error?.code === 'BATCH_TIME_BUDGET_EXCEEDED') throw error;
      if (!isTransientTransportError(error) || attempt >= retries) throw error;
      attempt += 1;
      const backoff = Math.min(8000, delayMs * attempt);
      if (deadlineAt && Date.now() + backoff + minWindow > deadlineAt) {
        await onLog(`${apiName}已完成网络补偿尝试 ${attempt}/${retries}，当前${batch.length}票批次达到时间预算，将保存失败票并继续后续批次。`);
        throw budgetError(apiName, batch, budgetMs);
      }
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
  fallbackSizes = null,
  transientRetries = DEFAULT_TRANSIENT_RETRIES,
  transientDelayMs = DEFAULT_TRANSIENT_DELAY_MS,
  batchTimeBudgetMs = DEFAULT_BATCH_TIME_BUDGET_MS,
  deadlineAt = 0
}) {
  const original = [...batch];
  const fallback = effectiveFallbackSizes(apiName, fallbackSizes);
  const effectiveBudgetMs = Math.max(MIN_BATCH_TIME_BUDGET_MS, Math.min(180000, Number(batchTimeBudgetMs || DEFAULT_BATCH_TIME_BUDGET_MS)));
  const effectiveDeadlineAt = deadlineAt || (Date.now() + effectiveBudgetMs);
  const minWindow = requestWindowMs(effectiveBudgetMs);
  try {
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'running' }, onLog);
    // CE's read-only query endpoints can occasionally reset the TLS socket before
    // the secure connection is established. Retry the exact same idempotent request
    // several times before treating the waybills as failed. A wall-clock budget is
    // shared by the original request and every fallback child so one bad batch can
    // never freeze thousands of later waybills.
    const events = await withTransientRetry(query, original, onLog, transientRetries, transientDelayMs, apiName, effectiveDeadlineAt, effectiveBudgetMs);
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'success', resultCount: (events || []).length }, onLog);
    return { successes: [{ batch: original, events: events || [] }], failures: [] };
  } catch (error) {
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'failed', error }, onLog);
    // CE sometimes reports an expired/unauthorized session with HTTP 200 and a
    // business message such as “请求未授权”. Treat that exactly like HTTP 401/403:
    // stop immediately, preserve checkpoints, and let the run pause for login.
    if (error?.runStatus || isAuthenticationFailure(error)) throw error;
    await onLog(`${apiName}批次失败：原批次${original.length}票，原因：${error?.message || error}`);
    if (error?.code === 'BATCH_TIME_BUDGET_EXCEEDED' || Date.now() + minWindow >= effectiveDeadlineAt) {
      await onLog(`${apiName}本批时间预算已用完：${original.length}票已保存为待重试，主流程立即继续下一批。`);
      return { successes: [], failures: [{ batch: original, error }] };
    }
    const fallbackSize = fallback.find(size => size < original.length);
    if (!fallbackSize) {
      await onLog(`${apiName}固定批次模式：${original.length}票不再拆分，已保存为待重试，主流程继续下一批。`);
      return { successes: [], failures: [{ batch: original, error }] };
    }

    await onLog(`仅对失败批次自适应降级：${original.length}→${fallbackSize}`);
    const successes = [];
    const failures = [];
    for (const child of splitBatchesAtSize(original, fallbackSize)) {
      if (Date.now() + minWindow >= effectiveDeadlineAt) {
        const timeout = budgetError(apiName, child, effectiveBudgetMs);
        failures.push({ batch: child, error: timeout });
        continue;
      }
      const result = await queryBatchWithFallback({
        batch: child,
        query,
        onLog,
        onAttempt,
        apiName,
        fallbackSizes: fallback.filter(size => size < fallbackSize),
        transientRetries,
        transientDelayMs,
        batchTimeBudgetMs: effectiveBudgetMs,
        deadlineAt: effectiveDeadlineAt
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

  // Generic CCSL track queries may still opt into adaptive fallback. SHOPEE calls
  // queryBatchWithFallback directly with fallbackSizes: [] and therefore remain at
  // the stable 50-ticket batch size.
  return queryBatchWithFallback({
    ...options,
    query: rawQuery,
    onLog,
    apiName: options.apiName || 'track-query',
    transientRetries: Number.isFinite(Number(options.transientRetries)) ? Number(options.transientRetries) : DEFAULT_TRANSIENT_RETRIES,
    transientDelayMs: Number.isFinite(Number(options.transientDelayMs)) ? Number(options.transientDelayMs) : DEFAULT_TRANSIENT_DELAY_MS,
    batchTimeBudgetMs: Number.isFinite(Number(options.batchTimeBudgetMs)) ? Number(options.batchTimeBudgetMs) : DEFAULT_BATCH_TIME_BUDGET_MS,
    fallbackSizes: Array.isArray(options.fallbackSizes)
      ? options.fallbackSizes
      : [...TRACK_FALLBACK_SIZES]
  });
}
