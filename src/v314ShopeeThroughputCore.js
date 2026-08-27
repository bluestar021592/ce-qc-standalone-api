export const V314_SHOPEE_THROUGHPUT_CORE_ID = '2026-08-26-v314-bounded-prefetch-fast-checkpoint-v2';
export const V339_CCSL_THROUGHPUT_CORE_ID = '2026-08-27-v339-ccsl-bounded-confirm-prefetch-v1';

export function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export const V314_EVENT_CONCURRENCY = clampInt(process.env.SHOPEE_EVENT_CONCURRENCY, 1, 4, 4);
export const V314_EXCEPTION_CONCURRENCY = clampInt(process.env.SHOPEE_EXCEPTION_CONCURRENCY, 1, 4, 4);
export const V314_CONFIRM_CONCURRENCY = clampInt(process.env.SHOPEE_CONFIRM_CONCURRENCY, 1, 2, 2);
export const V339_CCSL_CONFIRM_CONCURRENCY = clampInt(process.env.CCSL_CONFIRM_CONCURRENCY, 1, 2, 2);

export function cleanShipmentCodes(values = []) {
  return [...new Set((values || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
}

export function splitFixedBatches(values = [], size = 50) {
  const codes = cleanShipmentCodes(values);
  const width = Math.max(1, Number(size || 1));
  const out = [];
  for (let index = 0; index < codes.length; index += width) out.push(codes.slice(index, index + width));
  return out;
}

function batchKey(values = []) {
  return cleanShipmentCodes(values).join('\u001f');
}

function successfulBills(statusRows = []) {
  return new Set((statusRows || [])
    .filter(row => ['success', 'skipped_pod', 'skipped_return'].includes(String(row?.status || '')))
    .map(row => String(row?.shipmentCode || row?.waybill || row?.运单号 || '').trim().toUpperCase())
    .filter(Boolean));
}

function planBatches(sourceBills = [], completed = new Set(), width = 50, mode = 'stable-filter') {
  const source = cleanShipmentCodes(sourceBills);
  if (mode === 'compact-pending') return splitFixedBatches(source.filter(code => !completed.has(code)), width);
  return splitFixedBatches(source, width)
    .map(batch => batch.filter(code => !completed.has(code)))
    .filter(batch => batch.length);
}

export function createBoundedPrefetchPool({
  getSourceBills,
  getStatusRows = () => [],
  batchSize,
  concurrency,
  query,
  label = 'SHOPEE',
  planMode = 'stable-filter'
}) {
  const width = Math.max(1, Number(batchSize || 1));
  const limit = Math.max(1, Number(concurrency || 1));
  const cache = new Map();
  const queue = [];
  let active = 0;
  let launched = false;
  let plannedKeys = new Set();

  function pump() {
    while (active < limit && queue.length) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(() => query(job.batch))
        .then(
          value => job.finish({ ok: true, value }),
          error => job.finish({ ok: false, error })
        )
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  function enqueue(batch) {
    const clean = cleanShipmentCodes(batch);
    if (!clean.length) return null;
    const key = batchKey(clean);
    if (cache.has(key)) return cache.get(key);
    let finish;
    const settled = new Promise(resolve => { finish = resolve; });
    const entry = { key, batch: clean, settled };
    cache.set(key, entry);
    queue.push({ key, batch: clean, finish });
    pump();
    return entry;
  }

  function launch(focusBatch = []) {
    if (launched) return;
    launched = true;
    const completed = successfulBills(getStatusRows() || []);
    let batches = planBatches(getSourceBills() || [], completed, width, planMode);
    plannedKeys = new Set(batches.map(batchKey));
    const focusKey = batchKey(focusBatch);
    if (focusKey && plannedKeys.has(focusKey)) {
      batches = [
        ...batches.filter(batch => batchKey(batch) === focusKey),
        ...batches.filter(batch => batchKey(batch) !== focusKey)
      ];
    }
    console.info('[CE-QC][V314_PREFETCH]', JSON.stringify({ label, batchSize: width, concurrency: limit, batches: batches.length, completedBills: completed.size, planMode }));
    for (const batch of batches) enqueue(batch);
  }

  async function request(codes = []) {
    const batch = cleanShipmentCodes(codes);
    if (!batch.length) return [];
    launch(batch);
    const key = batchKey(batch);
    // Adaptive fallback children (for confirm-query) are intentionally not
    // prefetched. They use the original query directly so fallback semantics stay exact.
    if (!plannedKeys.has(key)) return query(batch);
    const entry = cache.get(key) || enqueue(batch);
    const settled = await entry.settled;
    if (!settled.ok) {
      cache.delete(key);
      throw settled.error;
    }
    return settled.value;
  }

  return {
    label,
    batchSize: width,
    concurrency: limit,
    planMode,
    request,
    stats: () => ({ active, queued: queue.length, cached: cache.size, planned: plannedKeys.size, launched })
  };
}

export function createCcslThroughputClient(state = {}, client, options = {}) {
  if (!client || typeof client !== 'object') return client;
  const confirmQuery = typeof client.confirmQuery === 'function' ? client.confirmQuery.bind(client) : null;
  if (!confirmQuery) return client;
  const pool = createBoundedPrefetchPool({
    getSourceBills: () => state.scanPool || state.pnhBills || [],
    getStatusRows: () => state.scanQueryStatus || [],
    batchSize: 350,
    concurrency: options.confirmConcurrency || V339_CCSL_CONFIRM_CONCURRENCY,
    query: confirmQuery,
    label: 'CCSL-confirm-query',
    // CCSL pipeline keeps stable 350-ticket source chunks, then removes bills
    // already proven successful inside each chunk. Match that shape exactly so
    // checkpoint resume and adaptive fallback semantics are unchanged.
    planMode: 'stable-filter'
  });
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'confirmQuery') return codes => pool.request(codes);
      if (prop === '__v339CcslConfirmPool') return pool;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export function createShopeeThroughputClient(state = {}, client, options = {}) {
  if (!client || typeof client !== 'object') return client;
  const confirmQuery = typeof client.confirmQuery === 'function' ? client.confirmQuery.bind(client) : null;
  const trackQuery = typeof client.trackQuery === 'function' ? client.trackQuery.bind(client) : null;
  const exceptionQuery = typeof client.exceptionQuery === 'function' ? client.exceptionQuery.bind(client) : null;
  const pools = {};

  if (confirmQuery) {
    pools.confirm = createBoundedPrefetchPool({
      getSourceBills: () => state.scanPool || state.pnhBills || [],
      getStatusRows: () => state.scanQueryStatus || [],
      batchSize: 350,
      concurrency: options.confirmConcurrency || V314_CONFIRM_CONCURRENCY,
      query: confirmQuery,
      label: 'confirm-query',
      // Native queryShopeeConfirmApi compacts all unfinished bills before slicing 350.
      planMode: 'compact-pending'
    });
  }
  if (trackQuery) {
    pools.event = createBoundedPrefetchPool({
      getSourceBills: () => state.needTrackBills || [],
      getStatusRows: () => state.eventQueryStatus || [],
      batchSize: 50,
      concurrency: options.eventConcurrency || V314_EVENT_CONCURRENCY,
      query: trackQuery,
      label: 'tms-shipment-event-query',
      // Native queryShopeeApi keeps stable 50-ticket chunks then removes completed bills.
      planMode: 'stable-filter'
    });
  }
  if (exceptionQuery) {
    pools.exception = createBoundedPrefetchPool({
      getSourceBills: () => state.needTrackBills || [],
      getStatusRows: () => state.exceptionQueryStatus || [],
      batchSize: 50,
      concurrency: options.exceptionConcurrency || V314_EXCEPTION_CONCURRENCY,
      query: exceptionQuery,
      label: 'exception-item-query',
      planMode: 'stable-filter'
    });
  }

  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'confirmQuery' && pools.confirm) return codes => pools.confirm.request(codes);
      if (prop === 'trackQuery' && pools.event) return codes => pools.event.request(codes);
      if (prop === 'exceptionQuery' && pools.exception) return codes => pools.exception.request(codes);
      if (prop === '__v314Pools') return pools;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export function checkpointStrideForPhase(phase = '') {
  const value = String(phase || '');
  if (/tms-shipment-event-query|exception-item-query/i.test(value)) return 4;
  if (/SHOPEE.*订单扫描|订单扫描/i.test(value)) return 2;
  return 1;
}

export function shouldUseFastCheckpoint(state = {}, businessType = '') {
  if (String(businessType || state.businessType || '').toUpperCase() !== 'SHOPEE') return false;
  const processing = state.processing || {};
  if (!processing.running || processing.paused) return false;
  const index = Math.max(0, Number(processing.batchIndex || 0));
  const total = Math.max(0, Number(processing.totalBatches || 0));
  if (!index || !total || index >= total) return false;
  const stride = checkpointStrideForPhase(processing.phase || '');
  if (stride <= 1) return false;
  return index % stride !== 0;
}
