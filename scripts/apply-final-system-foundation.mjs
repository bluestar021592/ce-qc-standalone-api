import fs from 'node:fs';

function patchFile(file, patches) {
  let source = fs.readFileSync(file, 'utf8');
  for (const { label, before, after, count = 1 } of patches) {
    if (source.includes(after)) continue;
    const actual = source.split(before).length - 1;
    if (actual !== count) throw new Error(`${file} ${label}: expected ${count} match(es), got ${actual}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source, 'utf8');
}

patchFile('src/shopWhitelist.js', [
  {
    label: 'builtin whitelist import',
    before: `import { fileURLToPath } from 'url';`,
    after: `import { fileURLToPath } from 'url';
import {
  BUILTIN_SHOP_STORES,
  BUILTIN_SHOP_WHITELIST_SOURCE_FILE,
  BUILTIN_SHOP_WHITELIST_SOURCE_SHA256,
  BUILTIN_SHOP_WHITELIST_VERSION
} from './shopWhitelistBuiltin.js';`
  },
  {
    label: 'builtin whitelist fallback payload',
    before: `let raw = null;
let payload = {
  version: '2026-08-03',
  source_file: '',
  source_sha256: '',
  stores: []
};
let loadedFileSha256 = '';`,
    after: `let raw = null;
let payload = {
  version: BUILTIN_SHOP_WHITELIST_VERSION,
  source_file: BUILTIN_SHOP_WHITELIST_SOURCE_FILE,
  source_sha256: BUILTIN_SHOP_WHITELIST_SOURCE_SHA256,
  stores: BUILTIN_SHOP_STORES
};
let loadedFileSha256 = crypto.createHash('sha256').update(JSON.stringify(BUILTIN_SHOP_STORES)).digest('hex');`
  },
  {
    label: 'source kind export',
    before: `export const SHOP_WHITELIST_VERSION = String(payload.version || '2026-08-03');`,
    after: `export const SHOP_WHITELIST_VERSION = String(payload.version || BUILTIN_SHOP_WHITELIST_VERSION);
export const SHOP_WHITELIST_SOURCE_KIND = SHOP_WHITELIST_AVAILABLE ? 'SIGNED_FILE' : 'BUILTIN_EXECUTION_COPY';`
  },
  {
    label: 'seed builtin whitelist',
    before: `  if (!SHOP_WHITELIST_AVAILABLE || !LATEST_SHOP_STORES.length) {
    return persistedWhitelistSummary(db);
  }`,
    after: `  if (!LATEST_SHOP_STORES.length) {
    return persistedWhitelistSummary(db);
  }`
  },
  {
    label: 'seed source kind',
    before: `    source: 'SIGNED_FILE'`,
    after: `    source: SHOP_WHITELIST_SOURCE_KIND`
  }
]);

patchFile('src/shopCodes.js', [
  {
    label: 'whitelist source kind import',
    before: `  SHOP_WHITELIST_AVAILABLE,
  normalizeShopCode as normalizeLatestShopCode,`,
    after: `  SHOP_WHITELIST_AVAILABLE,
  SHOP_WHITELIST_SOURCE_KIND,
  normalizeShopCode as normalizeLatestShopCode,`
  },
  {
    label: 'summary source kind',
    before: `    source: SHOP_WHITELIST_AVAILABLE && map.size ? 'SIGNED_FILE' : 'SQLITE_PERSISTED'`,
    after: `    source: map.size ? SHOP_WHITELIST_SOURCE_KIND : 'SQLITE_PERSISTED'`
  },
  {
    label: 'unknown structured shop code',
    before: `  const matched = matchTargetShop(evidence.targetNode, codeMap);
  if (!matched) return { isShop: false, ...evidence, matchedRule: 'TARGET_NOT_IN_SHOP_WHITELIST' };`,
    after: `  const supportedTargetCode = extractSupportedShopCodes(evidence.targetNode)[0] || '';
  const matched = matchTargetShop(evidence.targetNode, codeMap);
  if (!matched) {
    if (supportedTargetCode) {
      return { isShop: false, unknownShopCode: supportedTargetCode, ...evidence, matchedRule: 'UNKNOWN_SHOP_CODE' };
    }
    return { isShop: false, ...evidence, matchedRule: 'TARGET_NOT_IN_SHOP_WHITELIST' };
  }`
  },
  {
    label: 'supported structured code helper',
    before: `export function extractShopCodes(text, codeSet) {
  const out = [];`,
    after: `export function extractSupportedShopCodes(text) {
  const out = [];
  const src = String(text || '').normalize('NFKC').toUpperCase();
  for (const match of src.matchAll(SHOP_CODE_RE)) {
    const code = normalizeShopCode(match[1]);
    if (isSupportedShopCode(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export function extractShopCodes(text, codeSet) {
  const out = [];`
  }
]);

patchFile('src/storeFlow.js', [
  {
    label: 'store oc regex',
    before: `const PENDING_RE = /pending|派送失败|无法联系|无人接听|地址错误|改派/i;`,
    after: `const PENDING_RE = /pending|派送失败|无法联系|无人接听|地址错误|改派/i;
const OC_RE = /(?:^|[^A-Z])OC(?:[^A-Z]|$)|overdue|逾期|超时/i;`
  },
  {
    label: 'reset context at inbound',
    before: `      cycle.shopLastEventAt = event.eventTime || '';
      cycle.state = 'SHOP_ARRIVED_CURRENT';
      cycle.reason = 'STRUCTURED_WHITELIST_INBOUND';`,
    after: `      cycle.shopLastEventAt = event.eventTime || '';
      cycle.pending = false;
      cycle.oc = false;
      cycle.state = 'SHOP_ARRIVED_CURRENT';
      cycle.reason = 'STRUCTURED_WHITELIST_INBOUND';`
  },
  {
    label: 'store pending and oc context',
    before: `      cycle.pending = true;
      cycle.reason = 'PENDING_AFTER_SHOP_ARRIVAL';
      continue;
    }
    if (cycle?.state === 'SHOP_ARRIVED_CURRENT' && closesStoreCycle(event, action, current, cycle.currentShopCode)) {`,
    after: `      cycle.pending = true;
      cycle.oc = false;
      cycle.reason = 'PENDING_AFTER_SHOP_ARRIVAL';
      continue;
    }
    if (cycle?.state === 'SHOP_ARRIVED_CURRENT' && OC_RE.test(eventText(event))) {
      cycle.shopOcAt ||= event.eventTime || '';
      cycle.shopLastEventAt = event.eventTime || cycle.shopLastEventAt;
      cycle.oc = true;
      cycle.pending = false;
      cycle.reason = 'OC_AFTER_SHOP_ARRIVAL';
      continue;
    }
    if (cycle?.state === 'SHOP_ARRIVED_CURRENT' && closesStoreCycle(event, action, current, cycle.currentShopCode)) {`
  },
  {
    label: 'transfer clock',
    before: `  const shopAge = cycle.state === 'SHOP_ARRIVED_CURRENT'
    ? elapsedInclusiveDays(cycle.shopArrivedAt, reportDate)
    : 0;
  const retentionAnchor = cycle.shopLastEventAt || cycle.shopArrivedAt;`,
    after: `  const transfer = cycle.state === 'SHOP_TRANSFER_IN_PROGRESS'
    ? elapsedInclusiveDays(cycle.shopTransferStartedAt, reportDate)
    : 0;
  const shopAge = cycle.state === 'SHOP_ARRIVED_CURRENT'
    ? elapsedInclusiveDays(cycle.shopArrivedAt, reportDate)
    : 0;
  const retentionAnchor = cycle.shopLastEventAt || cycle.shopArrivedAt;`
  },
  {
    label: 'store transfer tags',
    before: `  if (cycle.state === 'SHOP_TRANSFER_IN_PROGRESS') tags.push('SHOP_TRANSFER_IN_PROGRESS');
  if (cycle.state === 'SHOP_ARRIVED_CURRENT') tags.push('SHOP_ARRIVED_CURRENT');`,
    after: `  if (cycle.state === 'SHOP_TRANSFER_IN_PROGRESS') tags.push('SHOP_TRANSFER_IN_PROGRESS');
  if (transfer >= 1) tags.push('SHOP_TRANSFER_1_PLUS');
  if (transfer >= 2) tags.push('SHOP_TRANSFER_2_PLUS');
  if (transfer >= 3) tags.push('SHOP_TRANSFER_3_PLUS');
  if (cycle.state === 'SHOP_ARRIVED_CURRENT') tags.push('SHOP_ARRIVED_CURRENT');`
  },
  {
    label: 'store oc tag',
    before: `  if (cycle.pending && cycle.state === 'SHOP_ARRIVED_CURRENT') tags.push('SHOP_PENDING');`,
    after: `  if (cycle.pending && cycle.state === 'SHOP_ARRIVED_CURRENT') tags.push('SHOP_PENDING');
  if (cycle.oc && cycle.state === 'SHOP_ARRIVED_CURRENT') tags.push('SHOP_OC');`
  },
  {
    label: 'store returned fields',
    before: `    shopPendingAt: cycle.shopPendingAt,
    shopAgeNaturalDays: shopAge,
    shopRetentionNaturalDays: retention,`,
    after: `    shopPendingAt: cycle.shopPendingAt,
    shopOcAt: cycle.shopOcAt,
    shopTransferNaturalDays: transfer,
    shopAgeNaturalDays: shopAge,
    shopRetentionNaturalDays: retention,`
  },
  {
    label: 'empty store fields',
    before: `    shopTransferStartedAt: '', shopArrivedAt: '', shopLastEventAt: '', shopPendingAt: '',
    shopAgeNaturalDays: 0, shopRetentionNaturalDays: 0, shopState: '', shopStateReason: 'NO_STORE_CYCLE',`,
    after: `    shopTransferStartedAt: '', shopArrivedAt: '', shopLastEventAt: '', shopPendingAt: '', shopOcAt: '',
    shopTransferNaturalDays: 0, shopAgeNaturalDays: 0, shopRetentionNaturalDays: 0, shopState: '', shopStateReason: 'NO_STORE_CYCLE',`
  },
  {
    label: 'new cycle fields',
    before: `    shopPendingAt: '',
    pending: false,
    state: 'SHOP_TRANSFER_IN_PROGRESS',`,
    after: `    shopPendingAt: '',
    shopOcAt: '',
    pending: false,
    oc: false,
    state: 'SHOP_TRANSFER_IN_PROGRESS',`
  }
]);

patchFile('src/trajectoryFacts.js', [
  {
    label: 'code26 semantic correction',
    before: `  INBOUND_NO_SCAN: '26',`,
    after: `  PICKUP_SUCCESS: '26',`
  },
  {
    label: 'trajectory final facts',
    before: `  const pendingEvents = sortedEvents.filter(event => trackingCodeOf(event) === TRACK_FACT_CODES.PENDING);
  const pendingDates = distinctEventDates(pendingEvents);

  return {`,
    after: `  const pendingEvents = sortedEvents.filter(event => trackingCodeOf(event) === TRACK_FACT_CODES.PENDING);
  const pendingDates = distinctEventDates(pendingEvents);
  const pendingDateContinuity = pendingDates.length <= 1 ? true : areConsecutiveDates(pendingDates);
  const pendingContinuityLabel = pendingDates.length === 0 ? '无' : pendingDates.length === 1 ? '单次' : pendingDateContinuity ? '连续' : '不连续';
  const inboundNoScan = Boolean(lastEvent && isCcslInboundFactEvent(lastEvent));
  const pickupSuccess = lastCode === TRACK_FACT_CODES.PICKUP_SUCCESS;

  return {`
  },
  {
    label: 'trajectory returned facts',
    before: `    latestShop,
    storeFlow,
    pendingRawEventCount: pendingEvents.length,
    pendingDates,
    pendingDistinctDayCount: pendingDates.length,
    pendingDateContinuity: pendingDates.length <= 1 ? true : areConsecutiveDates(pendingDates)`,
    after: `    latestShop,
    unknownShopCode: latestShop?.unknownShopCode || '',
    storeFlow,
    pickupSuccess,
    inboundNoScan,
    pendingRawEventCount: pendingEvents.length,
    pendingDates,
    pendingDistinctDayCount: pendingDates.length,
    pendingDateContinuity,
    pendingContinuityLabel,
    pendingNonContinuous: pendingDates.length >= 2 && !pendingDateContinuity`
  },
  {
    label: 'true CCSL inbound helper',
    before: `function emptyNodeAction() {`,
    after: `function isCcslInboundFactEvent(event = {}) {
  const action = parseEventNodeAction(event);
  if (action.actionType !== 'INBOUND') return false;
  const code = String(action.targetNodeCode || action.targetNode || '').normalize('NFKC').toUpperCase().replace(/^CEL?\\s*:\\s*/, '').replace(/[^A-Z0-9]/g, '');
  return code === 'CCSL';
}

function emptyNodeAction() {`
  }
]);

patchFile('src/analyzerV30.js', [
  {
    label: 'analyzer code26 semantic',
    before: `  INBOUND_NO_SCAN: '26',`,
    after: `  PICKUP_SUCCESS: '26',`
  },
  {
    label: 'unknown shop fact',
    before: `  const storeFlow = facts.storeFlow;`,
    after: `  const storeFlow = facts.storeFlow;
  const unknownShopCode = facts.unknownShopCode || '';`
  },
  {
    label: 'unknown shop priority',
    before: `  } else if (storeFlow.shopState === 'SHOP_ARRIVED_CURRENT') {`,
    after: `  } else if (unknownShopCode) {
    category = '未知门店编码';
    state = 'UNKNOWN_SHOP_CODE';
    judgment = \`最新结构化门店编码\\\${unknownShopCode}未命中95码白名单，禁止按名称猜测，需人工确认\`;
  } else if (storeFlow.shopState === 'SHOP_ARRIVED_CURRENT') {`
  },
  {
    label: 'store transfer days',
    before: `    category = Number(storeFlow.shopRetentionNaturalDays || 0) >= 2 ? '门店途中2天+' : '门店途中';`,
    after: `    category = Number(storeFlow.shopTransferNaturalDays || 0) >= 2 ? '门店途中2天+' : '门店途中';`
  },
  {
    label: 'true inbound no scan and pickup success',
    before: `  } else if (lastCode === TRACK.INBOUND_NO_SCAN) {
    category = '入库无扫描';
    state = 'INBOUND_NO_SCAN';
    judgment = '当前最后有效轨迹状态码26，入库后没有后续有效动作';
  }`,
    after: `  } else if (facts.inboundNoScan) {
    category = '入库无扫描';
    state = 'INBOUND_NO_SCAN';
    judgment = '最新有效轨迹为明确CCSL到达/入库节点，且没有更晚有效业务动作';
  } else if (lastCode === TRACK.PICKUP_SUCCESS) {
    category = '正常流转';
    state = 'PICKUP_SUCCESS';
    judgment = '轨迹状态码26表示揽收成功/由CEL节点收件，不作为入库无扫描异常';
  }`
  },
  {
    label: 'current facts exclusions',
    before: `  const currentPendingDays = !terminal && !returnInProgress && !special && !storeFlow.shopState && lastCode === TRACK.PENDING ? pending.days : 0;
  const currentCycleDays = !terminal && !returnInProgress && !special && !storeFlow.shopState && CYCLE_CODES.has(lastCode) ? cycle.days : 0;
  const currentOcDays = !terminal && !returnInProgress && !special && !storeFlow.shopState && oc.active ? oc.days : 0;
  const inboundNoScan = !terminal && !returnInProgress && !special && !storeFlow.shopState && lastCode === TRACK.INBOUND_NO_SCAN;
  const allPendingDates = facts.pendingDates;`,
    after: `  const ordinaryOpen = !terminal && !returnInProgress && !special && !storeFlow.shopState && !unknownShopCode;
  const currentPendingDays = ordinaryOpen && lastCode === TRACK.PENDING ? pending.days : 0;
  const currentCycleDays = ordinaryOpen && CYCLE_CODES.has(lastCode) ? cycle.days : 0;
  const currentOcDays = ordinaryOpen && oc.active ? oc.days : 0;
  const inboundNoScan = ordinaryOpen && facts.inboundNoScan;
  const pendingNonContinuous = ordinaryOpen && facts.pendingNonContinuous;
  const allPendingDates = facts.pendingDates;`
  },
  {
    label: 'analysis rule version',
    before: `analysisRuleVersion: '2026-08-09-ccsl-scan-track-code-separation-v30',`,
    after: `analysisRuleVersion: '2026-08-10-final-trajectory-state-machine-v1',`
  },
  {
    label: 'pending fact fields',
    before: `    pendingRawEventCount: facts.pendingRawEventCount,
    pendingFactDateContinuity: facts.pendingDateContinuity ? '连续' : '不连续',`,
    after: `    pendingRawEventCount: facts.pendingRawEventCount,
    pendingFactDateContinuity: facts.pendingContinuityLabel,
    Pending事实连续性: facts.pendingContinuityLabel,
    Pending不连续: pendingNonContinuous ? '是' : '否',
    unknownShopCode,
    shopWhitelistStatus: unknownShopCode ? 'UNKNOWN_SHOP_CODE' : '',
    pickupSuccess: facts.pickupSuccess ? '是' : '否',`
  },
  {
    label: 'tag args',
    before: `      pendingContinuous: pending.continuous, ocDays: currentOcDays, cycleDays: currentCycleDays,
      inboundNoScan, storePending, storeOc`,
    after: `      pendingContinuous: pending.continuous, pendingNonContinuous, ocDays: currentOcDays, cycleDays: currentCycleDays,
      inboundNoScan, storePending, storeOc`
  },
  {
    label: 'independent pending tag',
    before: `  if (s.pendingDays >= 2) tags.push(s.pendingContinuous ? 'PENDING_CONTINUOUS' : 'PENDING_NON_CONTINUOUS');`,
    after: `  if (s.pendingDays >= 2 && s.pendingContinuous) tags.push('PENDING_CONTINUOUS');
  if (s.pendingNonContinuous) tags.push('PENDING_NON_CONTINUOUS');`
  }
]);

patchFile('src/currentStatus.js', [
  {
    label: 'pickup and unknown labels',
    before: `  INBOUND_NO_SCAN: '入库无扫描',`,
    after: `  INBOUND_NO_SCAN: '入库无扫描',
  PICKUP_SUCCESS: '揽收成功',
  UNKNOWN_SHOP_CODE: '未知门店编码',`
  },
  {
    label: 'track26 display',
    before: `  '26': '入库无扫描',`,
    after: `  '26': '揽收成功',`
  }
]);

patchFile('src/shopeeAnalyzerV30.js', [
  {
    label: 'trajectory facts import',
    before: `import { classifyScanTerminal } from './scanTerminal.js';`,
    after: `import { classifyScanTerminal } from './scanTerminal.js';
import { buildTrajectoryFacts } from './trajectoryFacts.js';`
  },
  {
    label: 'shopee code26 semantic',
    before: `  INBOUND_NO_SCAN: '26',`,
    after: `  PICKUP_SUCCESS: '26',`
  },
  {
    label: 'shopee facts integration',
    before: `  const exactTerminal = latestExactTerminal(sorted);
  const isPod = scanGate.currentState === 'POD' || exactTerminal?.type === 'POD';
  const isReturned = !isPod && (scanGate.currentState === 'RETURN_COMPLETED' || exactTerminal?.type === 'RETURN_COMPLETED');
  const returnInProgress = !isPod && !isReturned && latestCode === TRACK.RETURN_START;

  const storeFlow = analyzeStoreFlow({
    shipmentCode: waybill,
    events: sorted,
    reportDate: effectiveDate,
    isPod,
    isReturned
  });
  const special = !isPod && !isReturned ? classifyLatestSpecialNode(sorted) : null;
  const region = classifyShopeeRegion({ dailyRow, shipmentTrackRow, scanRow, events: sorted });
  const pending = exactPendingState(sorted);`,
    after: `  const facts = buildTrajectoryFacts({ shipmentCode: waybill, scanRow, events: sorted, reportDate: effectiveDate });
  const exactTerminal = facts.latestTrackTerminal;
  const isPod = scanGate.currentState === 'POD' || exactTerminal?.type === 'POD';
  const isReturned = !isPod && (scanGate.currentState === 'RETURN_COMPLETED' || exactTerminal?.type === 'RETURN_COMPLETED');
  const returnInProgress = !isPod && !isReturned && latestCode === TRACK.RETURN_START;

  const storeFlow = facts.storeFlow;
  const special = !isPod && !isReturned ? facts.special : null;
  const unknownShopCode = facts.unknownShopCode || '';
  const region = classifyShopeeRegion({ dailyRow, shipmentTrackRow, scanRow, events: sorted });
  const pending = pendingFromFacts(facts, latestCode);`
  },
  {
    label: 'shopee store pending reset',
    before: `        shopRetentionNaturalDays: 1,`,
    after: `        shopRetentionNaturalDays: 0,`
  },
  {
    label: 'shopee unknown shop priority',
    before: `  } else if (correctedStoreFlow.shopState === 'SHOP_ARRIVED_CURRENT') {`,
    after: `  } else if (unknownShopCode) {
    category = '未知门店编码';
    currentState = 'UNKNOWN_SHOP_CODE';
    qc = \`最新结构化门店编码\\\${unknownShopCode}未命中95码白名单，禁止按名称猜测，需人工确认\`;
  } else if (correctedStoreFlow.shopState === 'SHOP_ARRIVED_CURRENT') {`
  },
  {
    label: 'shopee transfer days',
    before: `    category = Number(correctedStoreFlow.shopRetentionNaturalDays || 0) >= 2 ? '门店途中2天+' : '门店途中';`,
    after: `    category = Number(correctedStoreFlow.shopTransferNaturalDays || 0) >= 2 ? '门店途中2天+' : '门店途中';`
  },
  {
    label: 'shopee true inbound and pickup',
    before: `  } else if (latestCode === TRACK.INBOUND_NO_SCAN) {
    category = '入库无扫描节点';
    currentState = 'INBOUND_NO_SCAN';
  } else if (latest && BUSINESS_PROGRESS_CODES.has(latestCode)) {`,
    after: `  } else if (facts.inboundNoScan) {
    category = '入库无扫描节点';
    currentState = 'INBOUND_NO_SCAN';
  } else if (latestCode === TRACK.PICKUP_SUCCESS) {
    category = '正常流转';
    currentState = 'PICKUP_SUCCESS';
    qc = '轨迹状态码26表示揽收成功/由CEL节点收件，不作为入库无扫描异常';
  } else if (latest && BUSINESS_PROGRESS_CODES.has(latestCode)) {`
  },
  {
    label: 'shopee current pending facts',
    before: `  const currentPending = !terminal && !returnInProgress && !special && !correctedStoreFlow.shopState && latestCode === TRACK.PENDING
    ? pending.activeDays : 0;
  const allPendingDates = exactPendingAllDates(sorted);
  const pendingContinuity = currentPending >= 2 ? (pending.continuous ? '连续' : '不连续') : (currentPending ? '单次' : '无');
  const cycleDays = !terminal && !returnInProgress && CYCLE_CODES.has(latestCode) ? cycle.days : 0;
  const inboundNoScan = !terminal && !returnInProgress && !special && !correctedStoreFlow.shopState && latestCode === TRACK.INBOUND_NO_SCAN;`,
    after: `  const ordinaryOpen = !terminal && !returnInProgress && !special && !correctedStoreFlow.shopState && !unknownShopCode;
  const currentPending = ordinaryOpen && latestCode === TRACK.PENDING ? pending.activeDays : 0;
  const allPendingDates = facts.pendingDates;
  const pendingContinuity = currentPending >= 2 ? (pending.continuous ? '连续' : '不连续') : (currentPending ? '单次' : '无');
  const pendingNonContinuous = ordinaryOpen && facts.pendingNonContinuous;
  const cycleDays = ordinaryOpen && CYCLE_CODES.has(latestCode) ? cycle.days : 0;
  const inboundNoScan = ordinaryOpen && facts.inboundNoScan;`
  },
  {
    label: 'shopee tag args',
    before: `        pendingDays: currentPending,
        pendingContinuous: pending.continuous,`,
    after: `        pendingDays: currentPending,
        pendingContinuous: pending.continuous,
        pendingNonContinuous,`
  },
  {
    label: 'shopee rule version',
    before: `    analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,`,
    after: `    analysisRuleVersion: '2026-08-10-final-trajectory-state-machine-v1',`
  },
  {
    label: 'shopee pending facts output',
    before: `    Pending连续: currentPending >= 2 && pending.continuous ? '是' : '否',
    Pending不连续: currentPending >= 2 && !pending.continuous ? '是' : '否',`,
    after: `    Pending连续: currentPending >= 2 && pending.continuous ? '是' : '否',
    Pending事实连续性: facts.pendingContinuityLabel,
    pendingFactDateContinuity: facts.pendingContinuityLabel,
    Pending不连续: pendingNonContinuous ? '是' : '否',
    unknownShopCode,
    shopWhitelistStatus: unknownShopCode ? 'UNKNOWN_SHOP_CODE' : '',
    pickupSuccess: facts.pickupSuccess ? '是' : '否',`
  },
  {
    label: 'latest terminal only',
    before: `function latestExactTerminal(events) {
  let found = null;
  for (const event of events) {
    const code = trackCode(event);
    if (code === TRACK.POD) found = { type: 'POD', event };
    if (code === TRACK.RETURN_COMPLETE) found = { type: 'RETURN_COMPLETED', event };
  }
  return found;
}`,
    after: `function latestExactTerminal(events = []) {
  const event = events.at(-1) || null;
  const code = trackCode(event || {});
  if (code === TRACK.POD) return { type: 'POD', event };
  if (code === TRACK.RETURN_COMPLETE) return { type: 'RETURN_COMPLETED', event };
  return null;
}`
  },
  {
    label: 'pending from facts helper',
    before: `function exactPendingState(events) {`,
    after: `function pendingFromFacts(facts = {}, latestCode = '') {
  if (String(latestCode || '') !== TRACK.PENDING) return { activeDays: 0, activeDates: [], continuous: false };
  const dates = [...new Set((facts.pendingDates || []).map(String).filter(Boolean))].sort();
  return { activeDays: Math.max(1, dates.length), activeDates: dates, continuous: dates.length <= 1 ? true : Boolean(facts.pendingDateContinuity) };
}

function exactPendingState(events) {`
  },
  {
    label: 'shopee independent pending tag',
    before: `  if (state.pendingDays >= 2) tags.push(state.pendingContinuous ? 'PENDING_CONTINUOUS' : 'PENDING_NON_CONTINUOUS');`,
    after: `  if (state.pendingDays >= 2 && state.pendingContinuous) tags.push('PENDING_CONTINUOUS');
  if (state.pendingNonContinuous) tags.push('PENDING_NON_CONTINUOUS');`
  }
]);

patchFile('src/shopeeAnalyzerV31.js', [
  {
    label: 'latest terminal only wrapper',
    before: `  const hasTrackPod = sorted.some(event => codeOf(event) === '80');
  const hasTrackReturn = sorted.some(event => codeOf(event) === '86');
  const exactPod = scanGate.currentState === 'POD' || hasTrackPod;
  const exactReturn = !exactPod && (scanGate.currentState === 'RETURN_COMPLETED' || hasTrackReturn);`,
    after: `  const exactPod = scanGate.currentState === 'POD' || latestCode === '80';
  const exactReturn = !exactPod && (scanGate.currentState === 'RETURN_COMPLETED' || latestCode === '86');`
  }
]);

patchFile('src/reporting.js', [
  {
    label: 'pending noncontinuous categories',
    before: `pendingNonContinuous: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 2 && row?.Pending连续性 === '不连续').length,`,
    after: `pendingNonContinuous: ordinaryRows.filter(isPendingNonContinuousRow).length,`,
    count: 1
  },
  {
    label: 'pending noncontinuous details',
    before: `pendingNonContinuous: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 2 && row?.Pending连续性 === '不连续'),`,
    after: `pendingNonContinuous: ordinaryRows.filter(isPendingNonContinuousRow),`,
    count: 1
  },
  {
    label: 'normal pickup exclusion from core abnormal',
    before: `    && !isSpecialRetentionRow(row)
    && !isShopRow(row);`,
    after: `    && !isSpecialRetentionRow(row)
    && !isNormalOperationalFlowRow(row)
    && !isShopRow(row);`
  },
  {
    label: 'normal pickup exclusion from any abnormal',
    before: `    && !isSpecialRetentionRow(row)
    && !isNormalShopFlowRow(row);`,
    after: `    && !isSpecialRetentionRow(row)
    && !isNormalOperationalFlowRow(row)
    && !isNormalShopFlowRow(row);`
  },
  {
    label: 'pending helper and normal operational helper',
    before: `function isRefreshFailedRow(row = {}) {`,
    after: `function isPendingNonContinuousRow(row = {}) {
  if (row?.Pending不连续 === '是') return true;
  if (row?.pendingFactDateContinuity === '不连续' || row?.Pending事实连续性 === '不连续') return true;
  return Number(row?.pendingDistinctDayCount || 0) >= 2 && row?.Pending连续性 === '不连续';
}

function isNormalOperationalFlowRow(row = {}) {
  const state = String(row?.currentState || '').toUpperCase();
  const category = String(row?.primaryCategory || row?.主分类 || row?.异常分类 || '').trim();
  return state === 'PICKUP_SUCCESS' || category === '正常流转';
}

function isRefreshFailedRow(row = {}) {`
  },
  {
    label: 'shop days transfer clock',
    before: `function shopDays(row = {}) {
  if (Number(row?.shopRetentionNaturalDays || 0) > 0) return Number(row.shopRetentionNaturalDays);
  return Number(row?.门店滞留天数 || row?.门店未更新天数 || row?.shopNoUpdateDays || 0) || 0;
}`,
    after: `function shopDays(row = {}) {
  if (String(row?.shopState || '') === 'SHOP_TRANSFER_IN_PROGRESS') {
    return Number(row?.shopTransferNaturalDays || row?.门店途中天数 || 0) || 0;
  }
  if (Number(row?.shopRetentionNaturalDays || 0) > 0) return Number(row.shopRetentionNaturalDays);
  return Number(row?.门店滞留天数 || row?.门店未更新天数 || row?.shopNoUpdateDays || 0) || 0;
}`
  },
  {
    label: 'inbound no scan facts',
    before: `inboundNoScan: ordinaryRows.filter(row => row?.异常分类 === '入库无扫描').length,`,
    after: `inboundNoScan: ordinaryRows.filter(row => row?.异常分类 === '入库无扫描' || row?.入库无扫描节点 === '是').length,`
  },
  {
    label: 'inbound no scan detail facts',
    before: `inboundNoScan: ordinaryRows.filter(row => row?.异常分类 === '入库无扫描'),`,
    after: `inboundNoScan: ordinaryRows.filter(row => row?.异常分类 === '入库无扫描' || row?.入库无扫描节点 === '是'),`
  }
]);

// Range SQL appears twice for Pending continuity (CCSL and SHOPEE). Replace both
// with the fact-layer-aware expression while preserving compatibility with old rows.
let range = fs.readFileSync('src/rangeDashboardStoreV31.js', 'utf8');
const pendingOld = `SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$.\"Pending连续性\"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,`;
const pendingNew = `SUM(CASE WHEN COALESCE(f.isPod,0)=0
                AND COALESCE(f.shopState,'')=''
                AND COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'') NOT IN ('已退回','退回处理中')
                AND UPPER(COALESCE(f.primaryCategory,'')) NOT IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')
                AND (
                  COALESCE(json_extract(f.rawJson,'$.\"Pending不连续\"'),'')='是'
                  OR COALESCE(json_extract(f.rawJson,'$.pendingFactDateContinuity'),'')='不连续'
                  OR COALESCE(json_extract(f.rawJson,'$.\"Pending事实连续性\"'),'')='不连续'
                  OR (COALESCE(CAST(json_extract(f.rawJson,'$.pendingDistinctDayCount') AS INTEGER),0)>=2 AND COALESCE(json_extract(f.rawJson,'$.\"Pending连续性\"'),'')='不连续')
                ) THEN 1 ELSE 0 END) AS pendingNonContinuous,`;
const pendingMatches = range.split(pendingOld).length - 1;
if (pendingMatches === 2) range = range.split(pendingOld).join(pendingNew);
else if (!range.includes(pendingNew)) throw new Error(`range pending continuity: expected 2 matches, got ${pendingMatches}`);

const normalShopOld = `SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_TRANSFER_IN_PROGRESS'
                OR (COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND (`;
const normalShopNew = `SUM(CASE WHEN (COALESCE(f.shopState,'')='SHOP_TRANSFER_IN_PROGRESS'
                  AND COALESCE(CAST(json_extract(f.rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)<2)
                OR (COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND (`;
const shopMatches = range.split(normalShopOld).length - 1;
if (shopMatches === 2) range = range.split(normalShopOld).join(normalShopNew);
else if (!range.includes(normalShopNew)) throw new Error(`range normal shop: expected 2 matches, got ${shopMatches}`);
fs.writeFileSync('src/rangeDashboardStoreV31.js', range, 'utf8');
