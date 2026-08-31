import { getDb } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import {
  V295_FIRST_ATTEMPT_METRIC_ID,
  summarizeV295FirstAttemptMembers,
  mergeV295FirstAttemptFacts
} from './v295FirstAttemptMetric.js';

export const V295_FIRST_ATTEMPT_TRUTH_ID = '2026-08-25-v295-first-attempt-range-truth-v1';
export const V295_FIRST_ATTEMPT_QUERY_POLICY_ID = '2026-08-31-v374-index-friendly-membership-v2';
export const V295_FIRST_ATTEMPT_TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const CCSL_TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = Object.freeze(['SHOPEECN','SHOPEEVN']);
const TYPE_SET = new Set(V295_FIRST_ATTEMPT_TYPES);
const CACHE_MS = 20_000;
const cache = new Map();

const text = value => String(value ?? '').trim();
const billOf = value => text(value).toUpperCase();
const dateKey = value => {
  const m = text(value).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
const chunks = (values, size = 220) => {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
};
const strictSource = value => /^V246_STRICT_TRACK:/i.test(text(value)) || /严格.*START|START.*失败.*START|POD锁定明确派次|明确POD派次/i.test(text(value));
function validRange(fromDate, toDate) {
  const from = dateKey(fromDate), to = dateKey(toDate);
  if (!from || !to || from > to) throw new Error('V295日期范围无效');
  return { from, to };
}

// businessType/shipmentCode are normalized before persistence. Keep indexed columns bare:
// wrapping them in UPPER/TRIM makes SQLite ignore the existing composite membership indexes.
function latestUnifiedMembership(from, to, db) {
  return db.prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
             ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    )
    SELECT DISTINCT r.reportDate,u.businessType businessType,u.shipmentCode shipmentCode
    FROM ranked r
    JOIN unified_import_rows u ON u.snapshotId=r.snapshotId AND u.reportDate=r.reportDate
    WHERE r.rn=1
      AND u.businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
      AND u.shipmentCode<>''
    ORDER BY r.reportDate,businessType,shipmentCode
  `).all(from, to);
}

function whppMembership(from, to, db) {
  try {
    return db.prepare(`
      WITH ranked AS (
        SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
               ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
        FROM unified_import_batches b
        WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
      ), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1)
      SELECT DISTINCT p.reportDate,'WHPP' businessType,p.shipmentCode shipmentCode
      FROM business_daily_parse_rows p
      LEFT JOIN latest l ON l.reportDate=p.reportDate
      WHERE p.businessType='WHPP'
        AND p.reportDate BETWEEN ? AND ?
        AND p.shipmentCode<>''
        AND NOT EXISTS (
          SELECT 1 FROM unified_import_rows u
          WHERE u.snapshotId=l.snapshotId AND u.reportDate=p.reportDate
            AND u.businessType='CEAF'
            AND u.shipmentCode=p.shipmentCode
        )
      ORDER BY p.reportDate,shipmentCode
    `).all(from, to, from, to);
  } catch { return []; }
}

function membershipRows(from, to, db) {
  return [...latestUnifiedMembership(from, to, db), ...whppMembership(from, to, db)]
    .map(row => ({ reportDate: dateKey(row.reportDate), businessType: text(row.businessType).toUpperCase(), shipmentCode: billOf(row.shipmentCode) }))
    .filter(row => row.reportDate && TYPE_SET.has(row.businessType) && row.shipmentCode);
}

function ledgerByKey(rows, db) {
  ensureV246TrackingSchema(db);
  const types = [...new Set(rows.map(row => row.businessType))];
  const bills = [...new Set(rows.map(row => row.shipmentCode))];
  const result = new Map();
  if (!types.length || !bills.length) return result;
  for (const part of chunks(bills, 260)) {
    const billMarks = part.map(() => '?').join(',');
    const typeMarks = types.map(() => '?').join(',');
    const found = db.prepare(`SELECT shipmentCode,businessType,terminalReason,podDate,attemptNo,attemptSource,trackingStatus,currentStateJson
      FROM qc_tracking_ledger
      WHERE shipmentCode IN (${billMarks}) AND businessType IN (${typeMarks})`).all(...part, ...types);
    for (const row of found) result.set(`${text(row.businessType).toUpperCase()}|${billOf(row.shipmentCode)}`, row);
  }
  return result;
}

// shipmentCode is normalized before persistence throughout the pipeline. Keep the indexed
// column bare in large fact/event-table lookups; wrapping it in UPPER(TRIM(...)) forced
// repeated full scans on the multi-gigabyte production SQLite database.
function fallbackPodByMembership(rows, from, to, db) {
  const keys = new Set(rows.map(row => `${row.reportDate}|${row.businessType}|${row.shipmentCode}`));
  const out = new Map();
  const bills = [...new Set(rows.map(row => row.shipmentCode))];
  for (const part of chunks(bills, 220)) {
    const marks = part.map(() => '?').join(',');
    try {
      for (const row of db.prepare(`SELECT reportDate,shipmentCode,isPod FROM final_rows WHERE reportDate BETWEEN ? AND ? AND shipmentCode IN (${marks})`).all(from, to, ...part)) {
        if (!Number(row.isPod || 0)) continue;
        for (const type of CCSL_TYPES) {
          const key = `${dateKey(row.reportDate)}|${type}|${billOf(row.shipmentCode)}`;
          if (keys.has(key)) out.set(key, true);
        }
      }
    } catch {}
    try {
      for (const row of db.prepare(`SELECT reportDate,shipmentCode,isPod FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate BETWEEN ? AND ? AND shipmentCode IN (${marks})`).all(from, to, ...part)) {
        if (!Number(row.isPod || 0)) continue;
        for (const type of SHOPEE_TYPES) {
          const key = `${dateKey(row.reportDate)}|${type}|${billOf(row.shipmentCode)}`;
          if (keys.has(key)) out.set(key, true);
        }
      }
    } catch {}
    try {
      for (const row of db.prepare(`SELECT reportDate,shipmentCode,isPod FROM business_final_rows WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? AND shipmentCode IN (${marks})`).all(from, to, ...part)) {
        if (!Number(row.isPod || 0)) continue;
        const key = `${dateKey(row.reportDate)}|WHPP|${billOf(row.shipmentCode)}`;
        if (keys.has(key)) out.set(key, true);
      }
    } catch {}
  }
  return out;
}

function pushEvent(map, key, row) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(row);
}
function eventsByKey(rows, db) {
  const out = new Map();
  const groupedBills = new Map();
  for (const row of rows) {
    if (!groupedBills.has(row.businessType)) groupedBills.set(row.businessType, new Set());
    groupedBills.get(row.businessType).add(row.shipmentCode);
  }
  const coreBills = [...new Set(CCSL_TYPES.flatMap(type => [...(groupedBills.get(type) || [])]))];
  for (const part of chunks(coreBills, 220)) {
    const marks = part.map(() => '?').join(',');
    try {
      const found = db.prepare(`SELECT shipmentCode,eventTime,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,rawJson,id
        FROM track_events WHERE shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part);
      for (const event of found) for (const type of CCSL_TYPES) if (groupedBills.get(type)?.has(billOf(event.shipmentCode))) pushEvent(out, `${type}|${billOf(event.shipmentCode)}`, event);
    } catch {}
  }
  const shopeeBills = [...new Set(SHOPEE_TYPES.flatMap(type => [...(groupedBills.get(type) || [])]))];
  for (const part of chunks(shopeeBills, 220)) {
    const marks = part.map(() => '?').join(',');
    try {
      const found = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events
        WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part);
      for (const event of found) for (const type of SHOPEE_TYPES) if (groupedBills.get(type)?.has(billOf(event.shipmentCode))) pushEvent(out, `${type}|${billOf(event.shipmentCode)}`, event);
    } catch {}
  }
  const whppBills = [...(groupedBills.get('WHPP') || [])];
  for (const part of chunks(whppBills, 220)) {
    const marks = part.map(() => '?').join(',');
    try {
      const found = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events
        WHERE businessType='WHPP' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part);
      for (const event of found) pushEvent(out, `WHPP|${billOf(event.shipmentCode)}`, event);
    } catch {}
  }
  return out;
}

function resolvedAttempt(ledger = {}, events = []) {
  const strict = analyzeV246ShopeeAttemptCycle(events, { podDate: ledger?.podDate || '' });
  if (strict.attemptNo > 0) return { attemptNo: strict.attemptNo, source: strict.source };
  const ledgerNo = Math.max(0, Math.min(3, Math.floor(Number(ledger?.attemptNo || 0))));
  if (ledgerNo > 0 && strictSource(ledger?.attemptSource)) return { attemptNo: ledgerNo, source: text(ledger.attemptSource) };
  return { attemptNo: 0, source: '无真实START证据' };
}

function dailyFacts(rows, ledger, fallbackPod, events) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.reportDate}|${row.businessType}`;
    if (!groups.has(key)) groups.set(key, []);
    const ledgerRow = ledger.get(`${row.businessType}|${row.shipmentCode}`) || {};
    const attempt = resolvedAttempt(ledgerRow, events.get(`${row.businessType}|${row.shipmentCode}`) || []);
    const pod = text(ledgerRow.terminalReason).toUpperCase() === 'POD' || fallbackPod.get(`${row.reportDate}|${row.businessType}|${row.shipmentCode}`) === true;
    groups.get(key).push({ shipmentCode: row.shipmentCode, pod, attemptNo: attempt.attemptNo, attemptSource: attempt.source });
  }
  return [...groups.entries()].map(([key, members]) => {
    const [reportDate, businessType] = key.split('|');
    return summarizeV295FirstAttemptMembers(members, { businessType, reportDate, sourceReady: true });
  }).sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.businessType.localeCompare(b.businessType));
}

function pickDaily(daily, date, type) {
  return daily.find(row => row.reportDate === date && row.businessType === type) || summarizeV295FirstAttemptMembers([], { businessType: type, reportDate: date });
}

export function summarizeV295FirstAttemptRange(fromDate, toDate, db = getDb()) {
  const { from, to } = validRange(fromDate, toDate);
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const startedAt = Date.now();
  let phaseAt = startedAt;
  const timings = {};
  const members = membershipRows(from, to, db);
  timings.membershipMs = Date.now() - phaseAt; phaseAt = Date.now();
  const ledger = ledgerByKey(members, db);
  timings.ledgerMs = Date.now() - phaseAt; phaseAt = Date.now();
  const fallbackPod = fallbackPodByMembership(members, from, to, db);
  timings.fallbackPodMs = Date.now() - phaseAt; phaseAt = Date.now();
  const events = eventsByKey(members, db);
  timings.eventsMs = Date.now() - phaseAt; phaseAt = Date.now();
  const daily = dailyFacts(members, ledger, fallbackPod, events);
  timings.dailyFactsMs = Date.now() - phaseAt;
  const byType = {};
  for (const type of V295_FIRST_ATTEMPT_TYPES) byType[type] = mergeV295FirstAttemptFacts(type, daily.filter(row => row.businessType === type), { reportDate: to });
  const ccsl = mergeV295FirstAttemptFacts('CCSL', CCSL_TYPES.map(type => byType[type]), { reportDate: to });
  const shopee = mergeV295FirstAttemptFacts('SHOPEE', SHOPEE_TYPES.map(type => byType[type]), { reportDate: to });
  const home = mergeV295FirstAttemptFacts('HOME', [...CCSL_TYPES.map(type => byType[type]), byType.WHPP], { reportDate: to });
  const all = mergeV295FirstAttemptFacts('ALL', V295_FIRST_ATTEMPT_TYPES.map(type => byType[type]), { reportDate: to });
  const dates = [...new Set(members.map(row => row.reportDate))].sort();
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= 500) console.info('[CE-QC][V374_FIRST_ATTEMPT_PHASES]', JSON.stringify({ from, to, members: members.length, elapsedMs, ...timings }));
  const value = { ok: true, id: V295_FIRST_ATTEMPT_TRUTH_ID, queryPolicyId: V295_FIRST_ATTEMPT_QUERY_POLICY_ID, metricId: V295_FIRST_ATTEMPT_METRIC_ID, fromDate: from, toDate: to, dates, daily, byType, ccsl, shopee, home, all, source: 'LATEST_VALID_DAILY_MEMBERSHIP + SAVED_REAL_TRACK_START/FAILURE_CYCLE + TERMINAL_POD_TRUTH' };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function readV295FirstAttemptTrends(businessType = 'ALL', fromDate = '', toDate = '', db = getDb()) {
  const type = text(businessType || 'ALL').toUpperCase();
  if (![...V295_FIRST_ATTEMPT_TYPES, 'CCSL', 'SHOPEE', 'HOME', 'ALL'].includes(type)) throw new Error('V295业务板块无效');
  const truth = summarizeV295FirstAttemptRange(fromDate, toDate, db);
  const daily = truth.dates.map(reportDate => {
    if (TYPE_SET.has(type)) return pickDaily(truth.daily, reportDate, type);
    if (type === 'CCSL') return mergeV295FirstAttemptFacts('CCSL', CCSL_TYPES.map(t => pickDaily(truth.daily, reportDate, t)), { reportDate });
    if (type === 'SHOPEE') return mergeV295FirstAttemptFacts('SHOPEE', SHOPEE_TYPES.map(t => pickDaily(truth.daily, reportDate, t)), { reportDate });
    if (type === 'HOME') return mergeV295FirstAttemptFacts('HOME', [...CCSL_TYPES.map(t => pickDaily(truth.daily, reportDate, t)), pickDaily(truth.daily, reportDate, 'WHPP')], { reportDate });
    return mergeV295FirstAttemptFacts('ALL', V295_FIRST_ATTEMPT_TYPES.map(t => pickDaily(truth.daily, reportDate, t)), { reportDate });
  });
  const summary = type === 'CCSL' ? truth.ccsl : type === 'SHOPEE' ? truth.shopee : type === 'HOME' ? truth.home : type === 'ALL' ? truth.all : truth.byType[type];
  return {
    ok: true,
    id: V295_FIRST_ATTEMPT_TRUTH_ID,
    queryPolicyId: V295_FIRST_ATTEMPT_QUERY_POLICY_ID,
    metricId: V295_FIRST_ATTEMPT_METRIC_ID,
    businessType: type,
    fromDate: truth.fromDate,
    toDate: truth.toDate,
    dates: truth.dates,
    daily,
    firstAttemptEligible: daily.map(row => row.firstAttemptEligible),
    firstAttemptSuccess: daily.map(row => row.firstAttemptSuccess),
    firstAttemptRate: daily.map(row => row.firstAttemptRate),
    firstAttemptEvidenceComplete: daily.map(row => row.firstAttemptEvidenceComplete),
    firstAttemptSummary: summary,
    definition: summary?.firstAttemptDefinition || ''
  };
}

export function invalidateV295FirstAttemptTruth() { cache.clear(); }
globalThis.__CE_QC_INVALIDATE_V295_FIRST_ATTEMPT__ = invalidateV295FirstAttemptTruth;
console.info('[CE-QC][V295_FIRST_ATTEMPT_TRUTH]', V295_FIRST_ATTEMPT_TRUTH_ID, '首次妥投率=第一次派送成功/第一次派送尝试；首日POD保持独立；真实START缺失时不发布伪0%。');
console.info('[CE-QC][V374_FIRST_ATTEMPT_INDEXED_QUERY]', V295_FIRST_ATTEMPT_QUERY_POLICY_ID, 'membership/fact/event lookups keep normalized indexed columns bare; metric semantics unchanged; slow phases are logged.');