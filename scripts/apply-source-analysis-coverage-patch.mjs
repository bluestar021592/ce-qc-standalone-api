import fs from 'node:fs';

const file = 'src/rangeDashboardStoreV31.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
`export function loadRangeDashboard(fromDate, toDate) {
  const range = validateRange(fromDate, toDate, 180);
  const ccslDaily = queryCcslDailyLatest(range.from, range.to);
  const shopeeDaily = queryShopeeDailyLatest(range.from, range.to);
  const dates = listCompletedDates(range.from, range.to);

  const states = {
    CE: buildCcslState('CE', ccslDaily.filter(row => row.businessType === 'CE'), range, dates),
    CEAF: buildCcslState('CEAF', ccslDaily.filter(row => row.businessType === 'CEAF'), range, dates),
    TBKH: buildCcslState('TBKH', ccslDaily.filter(row => row.businessType === 'TBKH'), range, dates),
    ALI1688: buildCcslState('ALI1688', ccslDaily.filter(row => row.businessType === 'ALI1688'), range, dates),
    SHOPEECN: buildShopeeState('SHOPEECN', shopeeDaily.filter(row => row.businessType === 'SHOPEECN'), range, dates),
    SHOPEEVN: buildShopeeState('SHOPEEVN', shopeeDaily.filter(row => row.businessType === 'SHOPEEVN'), range, dates)
  };

  const aggregates = {
    CCSL: buildCcslState('CCSL', ccslDaily, range, dates),
    SHOPEE: buildShopeeState('SHOPEE', shopeeDaily, range, dates)
  };

  return {
    fromDate: range.from,
    toDate: range.to,
    dates,
    states,
    aggregates,
    queryMode: 'SQL_LATEST_VALID_COMPLETED_PER_DATE_V31',
    snapshotSelection: 'LATEST_VALID_COMPLETED_PER_DATE',
    shipmentRowsTransferred: 0
  };
}`,
`export function loadRangeDashboard(fromDate, toDate) {
  const range = validateRange(fromDate, toDate, 180);
  const sourceDaily = querySourceDailyLatest(range.from, range.to);
  const ccslDaily = queryCcslDailyLatest(range.from, range.to);
  const shopeeDaily = queryShopeeDailyLatest(range.from, range.to);
  const sourceDates = listSourceDates(range.from, range.to);
  const analyzedDates = listCompletedDates(range.from, range.to);

  const sourceFor = types => sourceDaily.filter(row => types.includes(row.businessType));
  const ccslFor = type => ccslDaily.filter(row => row.businessType === type);
  const shopeeFor = type => shopeeDaily.filter(row => row.businessType === type);

  const states = {
    CE: applySourceCoverage(buildCcslState('CE', ccslFor('CE'), range, analyzedDates), sourceFor(['CE']), ccslFor('CE')),
    CEAF: applySourceCoverage(buildCcslState('CEAF', ccslFor('CEAF'), range, analyzedDates), sourceFor(['CEAF']), ccslFor('CEAF')),
    TBKH: applySourceCoverage(buildCcslState('TBKH', ccslFor('TBKH'), range, analyzedDates), sourceFor(['TBKH']), ccslFor('TBKH')),
    ALI1688: applySourceCoverage(buildCcslState('ALI1688', ccslFor('ALI1688'), range, analyzedDates), sourceFor(['ALI1688']), ccslFor('ALI1688')),
    SHOPEECN: applySourceCoverage(buildShopeeState('SHOPEECN', shopeeFor('SHOPEECN'), range, analyzedDates), sourceFor(['SHOPEECN']), shopeeFor('SHOPEECN')),
    SHOPEEVN: applySourceCoverage(buildShopeeState('SHOPEEVN', shopeeFor('SHOPEEVN'), range, analyzedDates), sourceFor(['SHOPEEVN']), shopeeFor('SHOPEEVN'))
  };

  const aggregates = {
    CCSL: applySourceCoverage(buildCcslState('CCSL', ccslDaily, range, analyzedDates), sourceFor(CCSL_TYPES), ccslDaily),
    SHOPEE: applySourceCoverage(buildShopeeState('SHOPEE', shopeeDaily, range, analyzedDates), sourceFor(SHOPEE_TYPES), shopeeDaily)
  };

  const sourceTotal = sum(sourceDaily, 'total');
  const analyzedTotal = sum(ccslDaily, 'total') + sum(shopeeDaily, 'total');
  const missingAnalysisDates = sourceDates.filter(date => !analyzedDates.includes(date));
  return {
    fromDate: range.from,
    toDate: range.to,
    dates: sourceDates,
    sourceDates,
    analyzedDates,
    missingAnalysisDates,
    sourceTotal,
    analyzedTotal,
    analysisPending: Math.max(0, sourceTotal - analyzedTotal),
    analysisComplete: sourceTotal === analyzedTotal && missingAnalysisDates.length === 0,
    states,
    aggregates,
    queryMode: 'SQL_SOURCE_VALID_PLUS_ANALYSIS_COMPLETED_V32',
    sourceSelection: 'LATEST_VALID_IMPORT_PER_DATE',
    snapshotSelection: 'LATEST_VALID_COMPLETED_PER_DATE',
    shipmentRowsTransferred: 0
  };
}`,
'loadRangeDashboard dual denominator'
);

replaceOnce(
`function latestSnapshotCte() {`,
`function latestSourceCte() {
  return \`WITH ranked_source AS (
    SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
           ROW_NUMBER() OVER (
             PARTITION BY b.reportDate
             ORDER BY b.createdAt DESC,b.batchId DESC
           ) AS rn
    FROM unified_import_batches b
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
  ), latest_source AS (
    SELECT reportDate,snapshotId FROM ranked_source WHERE rn=1
  )\`;
}

function querySourceDailyLatest(fromDate, toDate) {
  return getDb().prepare(\`
    \${latestSourceCte()}
    SELECT
      u.reportDate,
      u.businessType,
      CASE
        WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
        WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
        ELSE 'UNKNOWN'
      END AS regionCode,
      COUNT(DISTINCT u.shipmentCode) AS total
    FROM latest_source l
    INNER JOIN unified_import_rows u
      ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
    WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
    GROUP BY u.reportDate,u.businessType,regionCode
    ORDER BY u.reportDate,u.businessType,regionCode
  \`).all(fromDate, toDate).map(normalizeCountRow);
}

function applySourceCoverage(state, sourceRows, analyzedRows) {
  const sourceTotal = sum(sourceRows, 'total');
  const analyzedTotal = sum(analyzedRows, 'total');
  const sourceDates = uniqueDates(sourceRows);
  const analyzedDates = uniqueDates(analyzedRows);
  const missingAnalysisDates = sourceDates.filter(date => !analyzedDates.includes(date));
  const analysisPending = Math.max(0, sourceTotal - analyzedTotal);
  const analysisComplete = sourceTotal === analyzedTotal && missingAnalysisDates.length === 0;
  const sourceGroupCounts = {
    CN: sum(sourceRows.filter(row => row.businessType === 'SHOPEECN'), 'total'),
    VN: sum(sourceRows.filter(row => row.businessType === 'SHOPEEVN'), 'total')
  };

  state.sourceTotal = sourceTotal;
  state.analyzedTotal = analyzedTotal;
  state.analysisPending = analysisPending;
  state.analysisComplete = analysisComplete;
  state.sourceDates = sourceDates;
  state.analyzedDates = analyzedDates;
  state.missingAnalysisDates = missingAnalysisDates;
  state.periodDates = sourceDates;
  state.snapshotStatus = sourceDates.length ? (analysisComplete ? 'COMPLETED' : 'PARTIAL') : 'EMPTY';
  state.dailyReportReady = sourceDates.length > 0;
  state.dailyParseSummary = {
    ...(state.dailyParseSummary || {}),
    totalRecognized: sourceTotal,
    sourceTotal,
    analyzedTotal,
    analysisPending,
    ...(String(state.businessType || '').startsWith('SHOPEE') || state.businessType === 'SHOPEE'
      ? { groupCounts: sourceGroupCounts }
      : {})
  };
  state.dashboard = {
    ...(state.dashboard || {}),
    sourceTotal,
    analyzedTotal,
    analysisPending,
    analysisComplete,
    sourceDates,
    analyzedDates,
    missingAnalysisDates
  };
  state.sourceCoverage = {
    sourceTotal,
    analyzedTotal,
    analysisPending,
    analysisComplete,
    sourceDates,
    analyzedDates,
    missingAnalysisDates,
    sourceSelection: 'LATEST_VALID_IMPORT_PER_DATE',
    analysisSelection: 'LATEST_VALID_COMPLETED_PER_DATE'
  };
  state._snapshotSelection = 'SOURCE_LATEST_VALID + ANALYSIS_LATEST_VALID_COMPLETED';
  return state;
}

function uniqueDates(rows) {
  return [...new Set((rows || []).map(row => String(row.reportDate || '')).filter(Boolean))].sort();
}

function latestSnapshotCte() {`,
'source CTE and coverage helpers'
);

replaceOnce(
`function listCompletedDates(fromDate, toDate) {
  return getDb().prepare(\`${latestSnapshotCte()} SELECT reportDate FROM latest ORDER BY reportDate\`).all(fromDate,toDate).map(row => row.reportDate);
}`,
`function listSourceDates(fromDate, toDate) {
  return getDb().prepare(\`${latestSourceCte()} SELECT reportDate FROM latest_source ORDER BY reportDate\`).all(fromDate,toDate).map(row => row.reportDate);
}

function listCompletedDates(fromDate, toDate) {
  return getDb().prepare(\`${latestSnapshotCte()} SELECT reportDate FROM latest ORDER BY reportDate\`).all(fromDate,toDate).map(row => row.reportDate);
}`,
'source date list'
);

fs.writeFileSync(file, source, 'utf8');
