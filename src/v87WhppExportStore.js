import { getDb } from './db.js';

export function countCompletedWhppRows(fromDate, toDate) {
  return Number(getDb().prepare(`
    SELECT COUNT(*) AS count
    FROM business_final_rows f
    WHERE f.businessType='WHPP'
      AND f.reportDate BETWEEN ? AND ?
      AND EXISTS (
        SELECT 1 FROM business_export_snapshots s
        WHERE s.businessType='WHPP' AND s.reportDate=f.reportDate
      )
  `).get(fromDate, toDate)?.count || 0);
}

export function listCompletedWhppSnapshots(fromDate, toDate) {
  const db = getDb();
  const dates = db.prepare(`
    SELECT DISTINCT f.reportDate
    FROM business_final_rows f
    WHERE f.businessType='WHPP'
      AND f.reportDate BETWEEN ? AND ?
      AND EXISTS (
        SELECT 1 FROM business_export_snapshots s
        WHERE s.businessType='WHPP' AND s.reportDate=f.reportDate
      )
    ORDER BY f.reportDate
  `).all(fromDate, toDate).map(row => row.reportDate);

  const rowsForDate = db.prepare(`
    SELECT f.*,p.rowJson AS dailyRowJson,p.sheetName,p.rowNumber
    FROM business_final_rows f
    LEFT JOIN business_daily_parse_rows p
      ON p.businessType='WHPP' AND p.reportDate=f.reportDate AND p.shipmentCode=f.shipmentCode
    WHERE f.businessType='WHPP' AND f.reportDate=?
    ORDER BY f.shipmentCode
  `);

  return dates.map(reportDate => {
    const rows = rowsForDate.all(reportDate).map(row => normalizeWhppRow(row, reportDate));
    return {
      snapshotId: `WHPP-RANGE-${reportDate}`,
      reportDate,
      payload: { finalRows: rows }
    };
  });
}

export function whppDailyCounts(fromDate, toDate) {
  return getDb().prepare(`
    SELECT f.reportDate,COUNT(*) AS count
    FROM business_final_rows f
    WHERE f.businessType='WHPP'
      AND f.reportDate BETWEEN ? AND ?
      AND EXISTS (
        SELECT 1 FROM business_export_snapshots s
        WHERE s.businessType='WHPP' AND s.reportDate=f.reportDate
      )
    GROUP BY f.reportDate
    ORDER BY f.reportDate
  `).all(fromDate, toDate).map(row => ({ reportDate: row.reportDate, businessType: 'WHPP', count: Number(row.count || 0) }));
}

function normalizeWhppRow(row = {}, reportDate = '') {
  const finalRaw = parseJson(row.rawJson);
  const dailyRaw = parseJson(row.dailyRowJson);
  const merged = { ...dailyRaw, ...finalRaw };
  return {
    ...merged,
    reportDate,
    businessType: 'WHPP',
    shipmentCode: row.shipmentCode || merged.shipmentCode || merged.运单号 || '',
    运单号: row.shipmentCode || merged.shipmentCode || merged.运单号 || '',
    isPod: Number(row.isPod || 0),
    是否POD: merged.是否POD || (Number(row.isPod || 0) ? '是' : '否'),
    primaryCategory: row.primaryCategory || merged.primaryCategory || merged.主分类 || '',
    currentState: merged.currentState || row.primaryCategory || '',
    API状态: merged.API状态 || row.apiStatus || '',
    carry状态: merged.carry状态 || row.carryStatus || '',
    latestEventTime: row.latestEventTime || merged.latestEventTime || merged.最后节点时间 || '',
    最后节点时间: row.latestEventTime || merged.最后节点时间 || merged.latestEventTime || '',
    latestEventDesc: row.latestEventDesc || merged.latestEventDesc || merged.最后节点 || '',
    最后节点: row.latestEventDesc || merged.最后节点 || merged.latestEventDesc || '',
    latestNode: row.latestNode || merged.latestNode || merged.latestNodeCode || '',
    recipient_raw: row.recipient_raw || merged.recipient_raw || merged.recipientRaw || '',
    recipient_normalized: row.recipient_normalized || merged.recipient_normalized || merged.recipientNormalized || '',
    recipient_group: 'WHPP',
    source_row_number: Number(row.source_row_number || row.rowNumber || merged.source_row_number || merged.rowNumber || 0),
    sheetName: row.sheetName || merged.sheetName || ''
  };
}

function parseJson(value) {
  if (!value) return {};
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return {}; }
}
