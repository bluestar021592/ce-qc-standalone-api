import { getDb } from './db.js';
import { getLatestUnifiedImport, listUnifiedImportHistory } from './unifiedImportStore.js';

const TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']);
const TIMING_TYPES = Object.freeze(['TBKH','SHOPEECN','SHOPEEVN']);

function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function safeJson(value) {
  try { return value && typeof value === 'object' ? value : JSON.parse(String(value || '{}')); }
  catch { return {}; }
}
function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
}
function signedDays(reportDate, terminalValue) {
  const start = normalizeDate(reportDate);
  const end = normalizeDate(terminalValue);
  if (!start || !end) return 0;
  const startMs = Date.parse(`${start}T00:00:00+07:00`);
  const endMs = Date.parse(`${end}T00:00:00+07:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 86400000) + 1;
}
function terminalTime(row = {}, raw = {}) {
  return raw.POD时间 || raw.podTime || raw.签收时间 || raw.signedAt || raw.terminalObservedAt
    || row.latestEventTime || row.lastEventTime || raw.lastCheckedAt || raw.analysisDate || '';
}
function attemptNo(row = {}, raw = {}, days = 0) {
  const explicit = n(
    row.podAttemptNo
      ?? raw.podAttemptNo
      ?? raw.currentAttemptNo
      ?? raw.dispatchDayNo
      ?? raw.POD派次
      ?? raw.签收派次
      ?? raw.派次
      ?? raw.派送次数,
    0
  );
  if (explicit > 0) return Math.min(3, Math.max(1, Math.trunc(explicit)));
  return days > 0 ? Math.min(3, Math.max(1, Math.trunc(days))) : 0;
}
function average(list = []) {
  const valid = list.map(row => n(row.days, 0)).filter(value => value > 0);
  if (!valid.length) return { avgDays: null, podCount: 0 };
  const value = valid.reduce((sum, item) => sum + item, 0) / valid.length;
  return { avgDays: Number(value.toFixed(2)), podCount: valid.length };
}
function summarizeTimingRows(rows = []) {
  const usable = rows.filter(row => row.isPod && row.days > 0);
  return {
    overall: average(usable),
    pp: average(usable.filter(row => row.region === 'PP')),
    pv: average(usable.filter(row => row.region === 'PV')),
    attempt1: average(usable.filter(row => row.attempt === 1)),
    attempt2: average(usable.filter(row => row.attempt === 2)),
    attempt3: average(usable.filter(row => row.attempt >= 3))
  };
}
function membershipRows(snapshotId, reportDate, businessType) {
  const db = getDb();
  if (!snapshotId || !reportDate || !TIMING_TYPES.includes(businessType)) return [];

  if (businessType === 'TBKH') {
    const rows = db.prepare(`
      SELECT u.shipmentCode,u.regionCode,u.reportDate,
             COALESCE(f.isPod,0) AS isPod,
             COALESCE(f.lastEventTime,'') AS terminalTime,
             COALESCE(f.rawJson,'{}') AS rawJson
      FROM unified_import_rows u
      LEFT JOIN final_rows f
        ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE u.snapshotId=? AND u.reportDate=? AND UPPER(TRIM(u.businessType))='TBKH'
      ORDER BY u.rowNumber,u.shipmentCode
    `).all(snapshotId, reportDate);
    return rows.map(row => {
      const raw = safeJson(row.rawJson);
      const days = signedDays(reportDate, terminalTime(row, raw));
      return {
        shipmentCode: row.shipmentCode,
        region: String(row.regionCode || '').toUpperCase(),
        isPod: Number(row.isPod || 0) === 1,
        days,
        attempt: attemptNo(row, raw, days)
      };
    });
  }

  const rows = db.prepare(`
    SELECT u.businessType,u.shipmentCode,u.regionCode,u.reportDate,
           COALESCE(f.isPod,0) AS isPod,
           COALESCE(f.latestEventTime,'') AS terminalTime,
           COALESCE(f.podAttemptNo,0) AS podAttemptNo,
           COALESCE(f.rawJson,'{}') AS rawJson
    FROM unified_import_rows u
    LEFT JOIN business_final_rows f
      ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE u.snapshotId=? AND u.reportDate=? AND UPPER(TRIM(u.businessType))=?
    ORDER BY u.rowNumber,u.shipmentCode
  `).all(snapshotId, reportDate, businessType);

  return rows.map(row => {
    const raw = safeJson(row.rawJson);
    const days = signedDays(reportDate, terminalTime(row, raw));
    return {
      shipmentCode: row.shipmentCode,
      region: String(row.regionCode || '').toUpperCase(),
      isPod: Number(row.isPod || 0) === 1,
      days,
      attempt: attemptNo(row, raw, days)
    };
  });
}
function timingForBatch(batch, businessType) {
  if (!batch?.snapshotId || !batch?.reportDate) {
    return {
      businessType,
      reportDate: batch?.reportDate || '',
      overall:{avgDays:null,podCount:0},pp:{avgDays:null,podCount:0},pv:{avgDays:null,podCount:0},
      attempt1:{avgDays:null,podCount:0},attempt2:{avgDays:null,podCount:0},attempt3:{avgDays:null,podCount:0}
    };
  }
  const summary = summarizeTimingRows(membershipRows(batch.snapshotId, batch.reportDate, businessType));
  return { businessType, reportDate: batch.reportDate, ...summary };
}
function classificationForBatch(batch) {
  if (!batch) {
    return {
      reportDate:'',snapshotId:'',total:0,classified:0,autoRecognized:0,unrecognized:0,conflicts:0,
      accuracyRate:0,coverageRate:0,balanced:false,counts:Object.fromEntries(TYPES.map(type=>[type,0])),
      businesses:TYPES.map(type=>({businessType:type,count:0,share:0,status:'暂无日报'}))
    };
  }
  const counts = Object.assign(Object.fromEntries(TYPES.map(type=>[type,0])), batch.classificationCounts || {});
  const total = n(batch.summary?.validUniqueWaybills, 0);
  const classified = TYPES.reduce((sum,type)=>sum+n(counts[type],0),0);
  const conflicts = Math.max(0, n(batch.summary?.classificationConflicts, 0));
  const unrecognized = Math.max(0, total - classified);
  const autoRecognized = Math.max(0, classified - conflicts);
  const balanced = Boolean(batch.sourceReconciliation?.balanced) && classified === total;
  const accuracyRate = total ? Number((autoRecognized * 100 / total).toFixed(2)) : 0;
  const coverageRate = total ? Number((classified * 100 / total).toFixed(2)) : 0;
  return {
    reportDate:batch.reportDate||'',
    snapshotId:batch.snapshotId||'',
    total,classified,autoRecognized,unrecognized,conflicts,accuracyRate,coverageRate,balanced,counts,
    businesses:TYPES.map(type=>({
      businessType:type,
      count:n(counts[type],0),
      share:total?Number((n(counts[type],0)*100/total).toFixed(2)):0,
      status:balanced?'已分类':'待核验'
    }))
  };
}

export function buildHomeQualitySummary() {
  const latest = getLatestUnifiedImport();
  const history = listUnifiedImportHistory(7);
  const classification = classificationForBatch(latest);
  const timing = Object.fromEntries(TIMING_TYPES.map(type => [type, timingForBatch(latest, type)]));
  const timingTrend = Object.fromEntries(TIMING_TYPES.map(type => [
    type,
    history.slice().reverse().map(batch => {
      const current = timingForBatch(batch, type);
      return {
        reportDate: batch.reportDate || '',
        avgDays: current.overall.avgDays,
        podCount: current.overall.podCount
      };
    })
  ]));
  return {
    ok:true,
    generatedAt:new Date().toISOString(),
    reportDate:latest?.reportDate||'',
    snapshotId:latest?.snapshotId||'',
    classification,
    timing,
    timingTrend
  };
}
