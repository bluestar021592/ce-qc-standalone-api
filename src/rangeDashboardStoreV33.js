import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV31 } from './rangeDashboardStoreV31.js';

const SHOPEE_TYPES = Object.freeze(['SHOPEECN', 'SHOPEEVN']);

/**
 * V33 is a narrow dispatch-attempt correctness layer over the preceding V31
 * historical SQL owner.
 *
 * Do not import rangeDashboardStoreFinal here. The public Final owner already
 * reaches V33 through V320 -> V295 -> V294 -> V284 -> V191 -> V55Compact ->
 * V58 -> V55 -> V36. Importing Final from this layer creates a recursive
 * multi-day owner loop. Single-day V322 cache reads returned before that loop,
 * which is why the defect was visible only on explicit historical ranges.
 *
 * Dispatch attempt classification uses the strongest persisted evidence in this
 * order: podAttemptNo -> currentAttemptNo -> POD timestamp relative to report day.
 * This preserves exact track-derived attempt numbers while allowing terminal POD
 * rows that retained currentAttemptNo to participate instead of rendering 0%.
 */
export function loadRangeDashboard(fromDate, toDate) {
  const range = loadRangeDashboardV31(fromDate, toDate);
  const facts = queryDispatchAttemptFacts(range.fromDate, range.toDate);

  for (const type of SHOPEE_TYPES) {
    patchShopeeState(range.states?.[type], facts.filter(row => row.businessType === type), type);
  }
  patchShopeeState(range.aggregates?.SHOPEE, facts, 'SHOPEE');

  return {
    ...range,
    queryMode: `${range.queryMode || 'SQL'}+SHOPEE_DISPATCH_TIMESTAMP_V33`,
    dispatchAttemptRuleVersion: '2026-08-11-pod-attempt-current-attempt-timestamp-fallback-v2'
  };
}

function queryDispatchAttemptFacts(fromDate, toDate) {
  const db = getDb();
  return db.prepare(`
    WITH latest AS (
      SELECT b.reportDate,b.snapshotId
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s
        ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
      WHERE b.status='VALID'
        AND b.reportDate BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1
          FROM unified_import_batches newer
          INNER JOIN unified_snapshots ns
            ON ns.snapshotId=newer.snapshotId AND ns.status='COMPLETED'
          WHERE newer.status='VALID'
            AND newer.reportDate=b.reportDate
            AND newer.createdAt>b.createdAt
        )
    ), valid AS (
      SELECT DISTINCT
        u.reportDate,
        u.businessType,
        u.shipmentCode,
        CASE
          WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
          WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
          ELSE 'UNKNOWN'
        END AS regionCode
      FROM latest l
      INNER JOIN unified_import_rows u
        ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('SHOPEECN','SHOPEEVN')
    ), prepared AS (
      SELECT
        v.reportDate,
        v.businessType,
        v.regionCode,
        v.shipmentCode,
        COALESCE(f.isPod,0) AS isPod,
        COALESCE(
          NULLIF(CAST(f.podAttemptNo AS INTEGER),0),
          NULLIF(CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0),
          NULLIF(CAST(f.currentAttemptNo AS INTEGER),0),
          NULLIF(CAST(json_extract(f.rawJson,'$.currentAttemptNo') AS INTEGER),0),
          0
        ) AS explicitAttempt,
        COALESCE(
          NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),
          NULLIF(json_extract(f.rawJson,'$.podTime'),''),
          NULLIF(json_extract(f.rawJson,'$.podClosedAt'),''),
          NULLIF(json_extract(f.rawJson,'$.terminalObservedAt'),''),
          ''
        ) AS podTimestamp
      FROM valid v
      LEFT JOIN business_final_rows f
        ON f.businessType='SHOPEE'
       AND f.shipmentCode=v.shipmentCode
       AND f.reportDate=v.reportDate
    )
    SELECT
      reportDate,businessType,regionCode,shipmentCode,isPod,
      CASE
        WHEN isPod<>1 THEN 0
        WHEN explicitAttempt>0 THEN MIN(3, explicitAttempt)
        WHEN length(podTimestamp)>=10
             AND julianday(date(replace(substr(podTimestamp,1,10),'/','-'))) IS NOT NULL
        THEN MIN(3, MAX(1,
          CAST(julianday(date(replace(substr(podTimestamp,1,10),'/','-'))) - julianday(reportDate) AS INTEGER) + 1
        ))
        ELSE 0
      END AS attemptNo
    FROM prepared
  `).all(fromDate, toDate);
}

function patchShopeeState(state, facts, type) {
  if (!state?.dashboard) return;
  const scoped = type === 'SHOPEE' ? facts : facts.filter(row => row.businessType === type);
  const all = summarize(scoped);
  patchMetrics(state.dashboard.metrics, all);
  patchMetrics(state.v55Summary, all);
  patchMetrics(state.dashboard.v55Summary, all);

  const groups = state.dashboard.recipientGroups || {};
  patchMetrics(groups.ALL?.metrics, all);
  if (type === 'SHOPEE') {
    patchMetrics(groups.CN?.metrics, summarize(scoped.filter(row => row.businessType === 'SHOPEECN')));
    patchMetrics(groups.VN?.metrics, summarize(scoped.filter(row => row.businessType === 'SHOPEEVN')));
  } else {
    const group = type === 'SHOPEECN' ? 'CN' : 'VN';
    patchMetrics(groups[group]?.metrics, all);
  }

  for (const region of ['PP','PV','UNKNOWN']) {
    patchMetrics(state.dashboard.regions?.[region], summarize(scoped.filter(row => row.regionCode === region)));
    patchMetrics(groups.ALL?.regions?.[region], summarize(scoped.filter(row => row.regionCode === region)));
    if (type === 'SHOPEE') {
      patchMetrics(groups.CN?.regions?.[region], summarize(scoped.filter(row => row.businessType === 'SHOPEECN' && row.regionCode === region)));
      patchMetrics(groups.VN?.regions?.[region], summarize(scoped.filter(row => row.businessType === 'SHOPEEVN' && row.regionCode === region)));
    }
  }
}

function summarize(rows) {
  const pod = rows.filter(row => Number(row.isPod || 0) === 1);
  const a1 = pod.filter(row => Number(row.attemptNo || 0) === 1).length;
  const a2 = pod.filter(row => Number(row.attemptNo || 0) === 2).length;
  const a3 = pod.filter(row => Number(row.attemptNo || 0) >= 3).length;
  const unknown = Math.max(0, pod.length - a1 - a2 - a3);
  return { pod: pod.length, a1, a2, a3, unknown };
}

function patchMetrics(metrics, s) {
  if (!metrics || !s) return;
  metrics.dispatchAttempt1 = s.a1;
  metrics.dispatchAttempt2 = s.a2;
  metrics.dispatchAttempt3 = s.a3;
  metrics.dispatchAttemptUnclassifiedPod = s.unknown;
  metrics.dispatchAttemptDenominator = s.pod;
  metrics.dispatchAttempt1Rate = pct(s.a1, s.pod);
  metrics.dispatchAttempt2Rate = pct(s.a2, s.pod);
  metrics.dispatchAttempt3Rate = pct(s.a3, s.pod);
}

function pct(value, total) {
  return total ? Number((Number(value || 0) * 100 / Number(total)).toFixed(2)) : 0;
}
