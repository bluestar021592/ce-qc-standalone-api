import { getDb } from './db.js';

export const V419_WHPP_EXPORT_MEMBERSHIP_ID='2026-09-03-v419-whpp-valid-completed-membership-export-v3';

const text=value=>String(value??'').trim();
const billOf=value=>text(value).toUpperCase();
const uniqueBills=values=>[...new Set((values||[]).map(billOf).filter(Boolean))];

function parseJson(value) {
  if (!value) return {};
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return {}; }
}

// Metadata only. Export split/count planning must never materialize every
// historical WHPP payloadJson just to discover eligible dates.
function latestValidCompletedSnapshots(fromDate,toDate,db=getDb()) {
  const rows=db.prepare(`
    SELECT snapshotId,reportDate,createdAt,id
    FROM business_export_snapshots
    WHERE businessType='WHPP'
      AND reportDate BETWEEN ? AND ?
      AND COALESCE(status,'VALID')='VALID'
      AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
    ORDER BY reportDate,createdAt DESC,id DESC
  `).all(fromDate,toDate);
  const byDate=new Map();
  for(const row of rows){const date=text(row.reportDate);if(date&&!byDate.has(date))byDate.set(date,row);}
  return [...byDate.values()].sort((a,b)=>text(a.reportDate).localeCompare(text(b.reportDate)));
}

function loadSnapshotPayload(snapshot={},db=getDb()) {
  if(!snapshot?.snapshotId)return {};
  const row=db.prepare(`
    SELECT payloadJson
    FROM business_export_snapshots
    WHERE snapshotId=? AND businessType='WHPP'
      AND COALESCE(status,'VALID')='VALID'
      AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
    LIMIT 1
  `).get(snapshot.snapshotId);
  return parseJson(row?.payloadJson);
}

function standardMembershipMeta(reportDate,db=getDb()) {
  let header=null,actual=0;
  try { header=db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||null; }
  catch { header=null; }
  if(!header)return {header:false,expected:null,actual:0,complete:false,rotated:true};
  const expected=Math.max(0,Number(header.totalCount||0));
  try { actual=Number(db.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''").get(reportDate)?.count||0); }
  catch { actual=0; }
  if(actual===expected)return {header:true,expected,actual,complete:true,rotated:false};
  if(expected>0&&actual===0)return {header:true,expected,actual,complete:false,rotated:true};
  const error=new Error(`WHPP_EXPORT_DAILY_MEMBERSHIP_INCOMPLETE:${reportDate}:${expected}/${actual}`);
  error.code='WHPP_EXPORT_DAILY_MEMBERSHIP_INCOMPLETE';error.reportDate=reportDate;error.expected=expected;error.actual=actual;throw error;
}

function standardMembershipRows(reportDate,db=getDb()) {
  return db.prepare(`
    SELECT shipmentCode,rowJson,sheetName,rowNumber
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''
    ORDER BY rowNumber,id
  `).all(reportDate).map(row=>({
    ...parseJson(row.rowJson),
    shipmentCode:billOf(row.shipmentCode),
    运单号:billOf(row.shipmentCode),
    rowJson:row.rowJson,
    sheetName:row.sheetName||'',
    rowNumber:Number(row.rowNumber||0),
    membershipSource:'WHPP_STANDARD_DAILY'
  })).filter(row=>row.shipmentCode);
}

function latestValidUnifiedMembershipRows(reportDate,db=getDb()) {
  let batch=null;
  try {
    batch=db.prepare(`
      SELECT b.snapshotId
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate=?
        AND EXISTS(
          SELECT 1 FROM unified_import_rows u
          WHERE u.snapshotId=b.snapshotId AND u.reportDate=b.reportDate
            AND UPPER(TRIM(u.businessType))='WHPP'
            AND TRIM(COALESCE(u.shipmentCode,''))<>''
        )
      ORDER BY b.createdAt DESC,b.batchId DESC
      LIMIT 1
    `).get(reportDate)||null;
  } catch { batch=null; }
  if(!batch?.snapshotId)return [];
  let rows=[];
  try {
    rows=db.prepare(`
      SELECT shipmentCode,regionCode,rowJson,rowNumber
      FROM unified_import_rows
      WHERE snapshotId=? AND reportDate=? AND UPPER(TRIM(businessType))='WHPP'
        AND TRIM(COALESCE(shipmentCode,''))<>''
      ORDER BY rowNumber,shipmentCode
    `).all(batch.snapshotId,reportDate);
  } catch { rows=[]; }
  const seen=new Set(),out=[];
  for(const row of rows){
    const bill=billOf(row.shipmentCode);if(!bill||seen.has(bill))continue;seen.add(bill);
    out.push({
      ...parseJson(row.rowJson),shipmentCode:bill,运单号:bill,regionCode:row.regionCode||parseJson(row.rowJson).regionCode||'',
      rowJson:row.rowJson,rowNumber:Number(row.rowNumber||0),membershipSource:'WHPP_VALID_UNIFIED_DAILY'
    });
  }
  return out;
}

function snapshotMembershipRows(snapshot={},db=getDb()) {
  const payload=loadSnapshotPayload(snapshot,db),state=payload.state||{};
  const pnhBills=uniqueBills(state.pnhBills||[]);
  const dailyRows=Array.isArray(state.dailyParseRows)?state.dailyParseRows:[];
  const dailyByBill=new Map();
  for(const row of dailyRows){
    const bill=billOf(row?.shipmentCode||row?.运单号||row?.waybill);if(!bill)continue;
    dailyByBill.set(bill,{...row,shipmentCode:bill,运单号:bill,membershipSource:'WHPP_VALID_COMPLETED_SNAPSHOT_DAILY'});
  }
  if(pnhBills.length){
    if(dailyByBill.size){
      const dailyBills=[...dailyByBill.keys()].sort(),pnhSorted=[...pnhBills].sort();
      const equal=dailyBills.length===pnhSorted.length&&dailyBills.every((bill,index)=>bill===pnhSorted[index]);
      if(!equal){
        const error=new Error(`WHPP_EXPORT_SNAPSHOT_MEMBERSHIP_MISMATCH:${snapshot.reportDate}:${pnhBills.length}/${dailyByBill.size}`);
        error.code='WHPP_EXPORT_SNAPSHOT_MEMBERSHIP_MISMATCH';error.reportDate=snapshot.reportDate;error.pnhCount=pnhBills.length;error.dailyCount=dailyByBill.size;throw error;
      }
    }
    return pnhBills.map(bill=>({...(dailyByBill.get(bill)||{}),shipmentCode:bill,运单号:bill,membershipSource:'WHPP_VALID_COMPLETED_SNAPSHOT_PNH'}));
  }
  if(dailyByBill.size)return [...dailyByBill.values()];
  // finalRows is deliberately NOT a membership fallback. WHPP pipeline builds
  // finalRows from today + carry, so using it here would misclassify carryover
  // as immutable daily membership.
  const error=new Error(`WHPP_EXPORT_MEMBERSHIP_UNRECOVERABLE:${snapshot.reportDate}`);
  error.code='WHPP_EXPORT_MEMBERSHIP_UNRECOVERABLE';error.reportDate=snapshot.reportDate;throw error;
}

function validateRecoveredCount(rows,meta,reportDate,source) {
  const actual=uniqueBills(rows.map(row=>row?.shipmentCode||row?.运单号)).length;
  if(meta.header&&meta.expected!==null&&actual!==meta.expected){
    const error=new Error(`WHPP_EXPORT_RECOVERED_MEMBERSHIP_MISMATCH:${reportDate}:${meta.expected}/${actual}:${source}`);
    error.code='WHPP_EXPORT_RECOVERED_MEMBERSHIP_MISMATCH';error.reportDate=reportDate;error.expected=meta.expected;error.actual=actual;error.source=source;throw error;
  }
  return rows;
}

function membershipRows(snapshot,db=getDb()) {
  const meta=standardMembershipMeta(snapshot.reportDate,db);
  if(meta.complete)return meta.expected===0?[]:standardMembershipRows(snapshot.reportDate,db);
  const unified=latestValidUnifiedMembershipRows(snapshot.reportDate,db);
  if(unified.length)return validateRecoveredCount(unified,meta,snapshot.reportDate,'WHPP_VALID_UNIFIED_DAILY');
  return validateRecoveredCount(snapshotMembershipRows(snapshot,db),meta,snapshot.reportDate,'WHPP_VALID_COMPLETED_SNAPSHOT');
}

function membershipCount(snapshot,db=getDb()) {
  const meta=standardMembershipMeta(snapshot.reportDate,db);
  if(meta.complete)return meta.expected;
  const unified=latestValidUnifiedMembershipRows(snapshot.reportDate,db);
  if(unified.length)return validateRecoveredCount(unified,meta,snapshot.reportDate,'WHPP_VALID_UNIFIED_DAILY').length;
  return validateRecoveredCount(snapshotMembershipRows(snapshot,db),meta,snapshot.reportDate,'WHPP_VALID_COMPLETED_SNAPSHOT').length;
}

function finalRowsByBill(reportDate,bills=[],db=getDb()) {
  const map=new Map(),codes=uniqueBills(bills);
  for(let i=0;i<codes.length;i+=300){
    const part=codes.slice(i,i+300),marks=part.map(()=>'?').join(',');if(!marks)continue;
    let rows=[];
    try { rows=db.prepare(`SELECT * FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? AND UPPER(TRIM(shipmentCode)) IN (${marks}) ORDER BY shipmentCode`).all(reportDate,...part); }
    catch { rows=[]; }
    for(const row of rows){const bill=billOf(row.shipmentCode);if(bill)map.set(bill,row);}
  }
  return map;
}

function normalizeWhppRow(finalRow = {}, memberRow = {}, reportDate = '') {
  const finalRaw = parseJson(finalRow.rawJson);
  const memberRaw = parseJson(memberRow.rowJson||memberRow);
  const merged = { ...memberRaw, ...memberRow, ...finalRaw };
  const shipmentCode=billOf(memberRow.shipmentCode||memberRow.运单号||finalRow.shipmentCode||merged.shipmentCode||merged.运单号);
  const isPod=Number(finalRow.isPod||0);
  return {
    ...merged,
    reportDate,
    businessType: 'WHPP',
    shipmentCode,
    运单号: shipmentCode,
    isPod,
    是否POD: merged.是否POD || (isPod ? '是' : '否'),
    primaryCategory: finalRow.primaryCategory || merged.primaryCategory || merged.主分类 || '',
    currentState: merged.currentState || finalRow.primaryCategory || '',
    API状态: merged.API状态 || finalRow.apiStatus || '',
    carry状态: merged.carry状态 || finalRow.carryStatus || '',
    latestEventTime: finalRow.latestEventTime || merged.latestEventTime || merged.最后节点时间 || '',
    最后节点时间: finalRow.latestEventTime || merged.最后节点时间 || merged.latestEventTime || '',
    latestEventDesc: finalRow.latestEventDesc || merged.latestEventDesc || merged.最后节点 || '',
    最后节点: finalRow.latestEventDesc || merged.最后节点 || merged.latestEventDesc || '',
    latestNode: finalRow.latestNode || merged.latestNode || merged.latestNodeCode || '',
    recipient_raw: finalRow.recipient_raw || merged.recipient_raw || merged.recipientRaw || '',
    recipient_normalized: finalRow.recipient_normalized || merged.recipient_normalized || merged.recipientNormalized || '',
    recipient_group: 'WHPP',
    source_row_number: Number(finalRow.source_row_number || memberRow.rowNumber || merged.source_row_number || merged.rowNumber || 0),
    sheetName: memberRow.sheetName || merged.sheetName || '',
    whppExportMembershipSource:memberRow.membershipSource||'WHPP_VALID_COMPLETED_SNAPSHOT_PNH',
    v419WhppExportMembershipId:V419_WHPP_EXPORT_MEMBERSHIP_ID
  };
}

export function listCompletedWhppSnapshots(fromDate, toDate) {
  const db=getDb(),snapshots=latestValidCompletedSnapshots(fromDate,toDate,db),out=[];
  for(const snapshot of snapshots){
    const members=membershipRows(snapshot,db),memberBills=members.map(row=>row.shipmentCode||row.运单号),finals=finalRowsByBill(snapshot.reportDate,memberBills,db),rows=[];
    for(const member of members){
      const bill=billOf(member.shipmentCode||member.运单号);if(!bill)continue;
      rows.push(normalizeWhppRow(finals.get(bill)||{},member,snapshot.reportDate));
    }
    out.push({snapshotId:snapshot.snapshotId||`WHPP-RANGE-${snapshot.reportDate}`,reportDate:snapshot.reportDate,payload:{finalRows:rows},membershipSource:members[0]?.membershipSource||(rows.length?'WHPP_RECOVERED_DAILY':'WHPP_STANDARD_DAILY_ZERO')});
  }
  return out;
}

export function countCompletedWhppRows(fromDate, toDate) {
  const db=getDb();
  return latestValidCompletedSnapshots(fromDate,toDate,db).reduce((sum,snapshot)=>sum+membershipCount(snapshot,db),0);
}

export function whppDailyCounts(fromDate, toDate) {
  const db=getDb();
  return latestValidCompletedSnapshots(fromDate,toDate,db).map(snapshot=>({reportDate:snapshot.reportDate,businessType:'WHPP',count:membershipCount(snapshot,db)}));
}

console.info('[CE-QC][V419_WHPP_EXPORT_MEMBERSHIP]',V419_WHPP_EXPORT_MEMBERSHIP_ID,'WHPP export membership is immutable daily truth only: complete standard daily first, then latest VALID unified daily, then VALID+COMPLETED snapshot pnhBills/dailyParseRows. finalRows is status enrichment only because WHPP pipeline finalRows includes today+carry. Snapshot payloadJson is loaded lazily only when persisted daily/unified membership is unavailable.');