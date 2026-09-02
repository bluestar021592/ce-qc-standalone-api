import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV31 } from './rangeDashboardStoreV31.js';

const SHOPEE_TYPES = Object.freeze(['SHOPEECN', 'SHOPEEVN']);

/**
 * V33 is a narrow correctness layer over the preceding V31 historical range owner.
 *
 * It must not import rangeDashboardStoreFinal: the public Final owner reaches V33
 * through the historical decorator chain, so importing Final here creates a
 * multi-day recursive loop. Single-day V322 cache reads return before this layer.
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
    ), classified AS (
      SELECT
        reportDate,
        businessType,
        regionCode,
        shipmentCode,
        isPod,
        CASE
          WHEN isPod<>1 THEN 0
          WHEN explicitAttempt>0 THEN MIN(3,explicitAttempt)
          WHEN length(podTimestamp)>=10
               AND julianday(date(replace(substr(podTimestamp,1,10),'/','-'))) IS NOT NULL
          THEN MIN(3,MAX(1,
            CAST(julianday(date(replace(substr(podTimestamp,1,10),'/','-'))) - julianday(reportDate) AS INTEGER) + 1
          ))
          ELSE 0
        END AS attemptDay
      FROM prepared
    )
    SELECT
      reportDate,
      businessType,
      regionCode,
      COUNT(*) AS total,
      SUM(CASE WHEN isPod=1 THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN isPod=1 AND attemptDay=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN isPod=1 AND attemptDay=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN isPod=1 AND attemptDay>=3 THEN 1 ELSE 0 END) AS attempt3,
      SUM(CASE WHEN isPod=1 AND attemptDay=0 THEN 1 ELSE 0 END) AS podAttemptUnknown
    FROM classified
    GROUP BY reportDate,businessType,regionCode
    ORDER BY reportDate,businessType,regionCode
  `).all(fromDate, toDate).map(normalizeFact);
}

function patchShopeeState(state, rows, label) {
  if (!state?.dashboard) return;
  const dashboard = state.dashboard;
  const all = summarize(rows);
  patchMetrics(dashboard.metrics, all);

  const groups = dashboard.recipientGroups || {};
  patchGroup(groups.ALL, rows);
  patchGroup(groups.CN, rows.filter(row => row.businessType === 'SHOPEECN'));
  patchGroup(groups.VN, rows.filter(row => row.businessType === 'SHOPEEVN'));

  for (const regionCode of ['PP','PV','UNKNOWN']) {
    patchMetrics(dashboard.regions?.[regionCode], summarize(rows.filter(row => row.regionCode === regionCode)));
  }

  patchHistory(state, rows);
  patchRecipientTrends(dashboard, state.historySummary || []);
  patchDashboardRows(dashboard.dashboardRows, groups);
  patchDashboardRows(state.detailTabs?.dashboard?.rows, groups);
  patchDashboardRows(dashboard.detailTabs?.dashboard?.rows, groups);

  dashboard.dispatchAttemptAudit = {
    label,
    denominator: all.total,
    pod: all.pod,
    classifiedPod: all.attempt1 + all.attempt2 + all.attempt3,
    unclassifiedPod: all.podAttemptUnknown,
    rule: 'POD_ATTEMPT_THEN_CURRENT_ATTEMPT_THEN_POD_TIMESTAMP'
  };
}

function patchGroup(group, rows) {
  if (!group) return;
  const all = summarize(rows);
  patchMetrics(group.metrics, all);
  for (const regionCode of ['PP','PV','UNKNOWN']) {
    patchMetrics(group.regions?.[regionCode], summarize(rows.filter(row => row.regionCode === regionCode)));
  }
}

function patchMetrics(metrics, summary) {
  if (!metrics) return;
  metrics.dispatchAttempt1 = summary.attempt1;
  metrics.dispatchAttempt2 = summary.attempt2;
  metrics.dispatchAttempt3 = summary.attempt3;
  metrics.dispatchAttemptDenominator = summary.total;
  metrics.dispatchAttempt1Rate = rate(summary.attempt1, summary.total);
  metrics.dispatchAttempt2Rate = rate(summary.attempt2, summary.total);
  metrics.dispatchAttempt3Rate = rate(summary.attempt3, summary.total);
  metrics.firstAttemptCount = summary.attempt1;
  metrics.firstAttemptEligible = summary.total;
  metrics.firstAttemptRate = rate(summary.attempt1, summary.total);
  metrics.dispatchAttemptUnclassifiedPod = summary.podAttemptUnknown;
}

function patchHistory(state, rows) {
  if (!Array.isArray(state.historySummary)) return;
  for (const item of state.historySummary) {
    const reportDate = String(item?.reportDate || item?.summary?.reportDate || '');
    const summary = item?.summary;
    if (!reportDate || !summary) continue;
    const dayRows = rows.filter(row => row.reportDate === reportDate);
    const all = summarize(dayRows);
    const cn = summarize(dayRows.filter(row => row.businessType === 'SHOPEECN'));
    const vn = summarize(dayRows.filter(row => row.businessType === 'SHOPEEVN'));
    summary.metrics ||= {};
    summary.metrics['ALL_首派成功率'] = rate(all.attempt1, all.total);
    summary.metrics['CN_首派成功率'] = rate(cn.attempt1, cn.total);
    summary.metrics['VN_首派成功率'] = rate(vn.attempt1, vn.total);
    summary.firstPodRate = rate(all.attempt1, all.total);
  }
}

function patchRecipientTrends(dashboard, history) {
  if (!dashboard?.recipientTrends) return;
  for (const group of ['CN','VN']) {
    if (!dashboard.recipientTrends[group]) continue;
    dashboard.recipientTrends[group].firstAttemptRate = history.slice(-7).map(item => {
      const value = Number(item?.summary?.metrics?.[`${group}_首派成功率`] || 0);
      return { date: item.reportDate, value, hasData: true, status: value >= 90 ? 'normal' : 'warning' };
    });
  }
}

function patchDashboardRows(rows, groups) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    const key = String(row?.metricKey || '');
    const match = key.match(/^(ALL|CN|VN)_首派成功率$/);
    if (!match) continue;
    const value = Number(groups?.[match[1]]?.metrics?.firstAttemptRate || 0);
    row.数值 = `${value.toFixed(2)}%`;
    row.数值原值 = value;
  }
}

function summarize(rows) {
  return {
    total: sum(rows,'total'),
    pod: sum(rows,'pod'),
    attempt1: sum(rows,'attempt1'),
    attempt2: sum(rows,'attempt2'),
    attempt3: sum(rows,'attempt3'),
    podAttemptUnknown: sum(rows,'podAttemptUnknown')
  };
}

function normalizeFact(row) {
  return {
    ...row,
    total: Number(row.total || 0),
    pod: Number(row.pod || 0),
    attempt1: Number(row.attempt1 || 0),
    attempt2: Number(row.attempt2 || 0),
    attempt3: Number(row.attempt3 || 0),
    podAttemptUnknown: Number(row.podAttemptUnknown || 0)
  };
}

function sum(rows, key) {
  return (rows || []).reduce((total, row) => total + Number(row?.[key] || 0), 0);
}

function rate(value, total) {
  const denominator = Number(total || 0);
  return denominator ? Number((Number(value || 0) * 100 / denominator).toFixed(2)) : 0;
}
