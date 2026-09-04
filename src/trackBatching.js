export const TRACK_QUERY_BATCH_SIZE = 50;
export const TRACK_QUERY_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.TRACK_CONCURRENCY || 4)));
// pipeline.js still reads TRACK_CONCURRENCY from the environment. Keep the one
// canonical batching policy here so every business defaults to the same 50 x 4
// trajectory contract without relying on an old launcher environment value.
if (!process.env.TRACK_CONCURRENCY) process.env.TRACK_CONCURRENCY = String(TRACK_QUERY_CONCURRENCY);
const DEFAULT_TRANSIENT_RETRIES = Math.max(0, Math.min(2, Number(process.env.CE_TRANSIENT_RETRIES || 1)));
const DEFAULT_TRANSIENT_DELAY_MS = Math.max(200, Math.min(5000, Number(process.env.CE_TRANSIENT_RETRY_DELAY_MS || 400)));
const MIN_BATCH_TIME_BUDGET_MS = Math.max(250, Math.min(30000, Number(process.env.CE_MIN_BATCH_BUDGET_MS || 5000)));
const DEFAULT_BATCH_TIME_BUDGET_MS = Math.max(MIN_BATCH_TIME_BUDGET_MS, Math.min(180000, Number(process.env.CE_TRACK_BATCH_BUDGET_MS || 25000)));
const MAX_REQUEST_WINDOW_MS = 15000;
const CONFIRM_HARD_BUDGET_MS = Math.max(100, Math.min(30000, Number(process.env.CE_CONFIRM_HARD_BUDGET_MS || 18000)));
const CONFIRM_MAX_TRANSIENT_RETRIES = 1;

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
  for (let index = 0; index < shipmentCodes.length; index += size) batches.push(shipmentCodes.slice(index, index + size));
  return batches;
}

async function safeAttempt(onAttempt, payload, onLog) {
  try {
    await onAttempt(payload);
  } catch (error) {
    if (error?.code === 'BATCH_KEY_PAYLOAD_MISMATCH') {
      await onLog(`批次审计键已变化，按逐票成功/失败状态继续处理：${error.message || ''}`);
      return;
    }
    throw error;
  }
}

export function isTransientTransportError(error) {
  const code = String(error?.code || error?.cause?.code || error?.transportCode || '').toUpperCase();
  const message = [error?.message, error?.cause?.message, error?.ceMsg].filter(Boolean).join(' ');
  return ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETRESET', 'ENETUNREACH', 'ECONNREFUSED'].includes(code)
    || /socket hang up|connection reset|network error|timed?\s*out|timeout|premature close|read ECONNRESET|socket disconnected before secure TLS connection|before secure TLS connection was established|client network socket disconnected/i.test(message);
}

function isAuthenticationFailure(error) {
  const status = Number(error?.ceStatus || error?.status || error?.response?.status || 0);
  const code = String(error?.ceCode || error?.code || '').trim().toUpperCase();
  const message = [error?.ceMsg, error?.message, error?.response?.data?.msg, error?.response?.data?.message].filter(Boolean).join(' ');
  return [401, 403].includes(status)
    || ['401', '403', 'AUTH_REQUIRED'].includes(code)
    || /请求未授权|未授权|unauthorized|登录已失效|登录过期|token\s*(?:expired|invalid)|expired\s*token|invalid\s*token/i.test(message);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }

function effectiveFallbackSizes(apiName = '', fallbackSizes = null) {
  if (Array.isArray(fallbackSizes)) return fallbackSizes;
  // System consolidation: 350 confirm and 50 trajectory are logical units.
  // Successful-but-partial confirm responses are completed by the dedicated
  // completeness owner; true transport failures go to the retry center. A failed
  // 50-ticket trajectory request likewise remains one retry unit instead of being
  // recursively degraded to 25/10/5/1, which was one of the major latency multipliers.
  return [];
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
      new Promise((_, reject) => { timer = setTimeout(() => reject(budgetError(apiName, batch, budgetMs)), remaining); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function withTransientRetry(query, batch, onLog, retries = DEFAULT_TRANSIENT_RETRIES, delayMs = DEFAULT_TRANSIENT_DELAY_MS, apiName = 'CE接口', deadlineAt = 0, budgetMs = DEFAULT_BATCH_TIME_BUDGET_MS) {
  let attempt = 0;
  const minWindow = requestWindowMs(budgetMs);
  while (true) {
    const remaining = deadlineAt ? deadlineAt - Date.now() : Number.POSITIVE_INFINITY;
    if (deadlineAt && remaining < minWindow) throw budgetError(apiName, batch, budgetMs);
    try {
      return await queryWithinHardDeadline(query, batch, apiName, deadlineAt, budgetMs);
    } catch (error) {
      if (isAuthenticationFailure(error) || error?.runStatus) throw error;
      if (error?.code === 'BATCH_TIME_BUDGET_EXCEEDED') throw error;
      if (!isTransientTransportError(error) || attempt >= retries) throw error;
      attempt += 1;
      const backoff = Math.min(3000, delayMs * attempt);
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
  const isConfirmQuery = /confirm-query/i.test(String(apiName || ''));
  const requestedBudgetMs = Math.max(MIN_BATCH_TIME_BUDGET_MS, Math.min(180000, Number(batchTimeBudgetMs || DEFAULT_BATCH_TIME_BUDGET_MS)));
  const effectiveBudgetMs = isConfirmQuery ? Math.min(requestedBudgetMs, CONFIRM_HARD_BUDGET_MS) : requestedBudgetMs;
  const effectiveTransientRetries = isConfirmQuery
    ? Math.min(CONFIRM_MAX_TRANSIENT_RETRIES, Math.max(0, Number(transientRetries || 0)))
    : transientRetries;
  const effectiveDeadlineAt = deadlineAt || (Date.now() + effectiveBudgetMs);
  const minWindow = requestWindowMs(effectiveBudgetMs);
  try {
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'running' }, onLog);
    const events = await withTransientRetry(query, original, onLog, effectiveTransientRetries, transientDelayMs, apiName, effectiveDeadlineAt, effectiveBudgetMs);
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'success', resultCount: (events || []).length }, onLog);
    return { successes: [{ batch: original, events: events || [] }], failures: [] };
  } catch (error) {
    await safeAttempt(onAttempt, { apiName, batch: original, status: 'failed', error }, onLog);
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

    const successes = [];
    const failures = [];
    for (const child of splitBatchesAtSize(original, fallbackSize)) {
      if (Date.now() + minWindow >= effectiveDeadlineAt) {
        failures.push({ batch: child, error: budgetError(apiName, child, effectiveBudgetMs) });
        continue;
      }
      const result = await queryBatchWithFallback({
        batch: child, query, onLog, onAttempt, apiName,
        fallbackSizes: fallback.filter(size => size < fallbackSize),
        transientRetries: effectiveTransientRetries,
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
  return queryBatchWithFallback({
    ...options,
    query: rawQuery,
    onLog,
    apiName: options.apiName || 'track-query',
    transientRetries: Number.isFinite(Number(options.transientRetries)) ? Number(options.transientRetries) : DEFAULT_TRANSIENT_RETRIES,
    transientDelayMs: Number.isFinite(Number(options.transientDelayMs)) ? Number(options.transientDelayMs) : DEFAULT_TRANSIENT_DELAY_MS,
    batchTimeBudgetMs: Number.isFinite(Number(options.batchTimeBudgetMs)) ? Number(options.batchTimeBudgetMs) : DEFAULT_BATCH_TIME_BUDGET_MS,
    fallbackSizes: Array.isArray(options.fallbackSizes) ? options.fallbackSizes : []
  });
}
