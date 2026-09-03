import { getDb } from './db.js';

export const V419_WHPP_EXPORT_MEMBERSHIP_ID='2026-09-03-v419-whpp-valid-completed-membership-export-v1';

const text=value=>String(value??'').trim();
const billOf=value=>text(value).toUpperCase();

function parseJson(value) {
  if (!value) return {};
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return {}; }
}

function latestValidCompletedSnapshots(fromDate,toDate,db=getDb()) {
  const rows=db.prepare(`
    SELECT snapshotId,reportDate,payloadJson,createdAt,id
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

function standardMembershipRows(reportDate,db=getDb()) {
  try {
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
  } catch { return []; }
}

function snapshotMembershipRows(snapshot={}) {
  const payload=parseJson(snapshot.payloadJson),state=payload.state||{},map=new Map();
  const add=(value={},source='WHPP_VALID_COMPLETED_SNAPSHOT')=>{
    const raw=typeof value==='string'?{shipmentCode:value,运单号:value}:{...value};
    const bill=billOf(raw.shipmentCode||raw.运单号||raw.waybill);
    if(!bill)return;
    const prior=map.get(bill)||{};
    map.set(bill,{...prior,...raw,shipmentCode:bill,运单号:bill,membershipSource:source});
  };
  for(const bill of state.pnhBills||[])add(bill);
  for(const row of state.finalRows||[])add(row);
  for(const row of state.dailyParseRows||[])add(row);
  return [...map.values()];
}

function membershipRows(snapshot,db=getDb()) {
  const standard=standardMembershipRows(snapshot.reportDate,db);
  if(standard.length)return standard;
  return snapshotMembershipRows(snapshot);
}

function finalRowsByBill(reportDate,db=getDb()) {
  const map=new Map();
  let rows=[];
  try { rows=db.prepare(`SELECT * FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate); }
  catch { rows=[]; }
  for(const row of rows){const bill=billOf(row.shipmentCode);if(bill)map.set(bill,row);}
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
    whppExportMembershipSource:memberRow.membershipSource||'WHPP_VALID_COMPLETED_SNAPSHOT',
    v419WhppExportMembershipId:V419_WHPP_EXPORT_MEMBERSHIP_ID
  };
}

export function listCompletedWhppSnapshots(fromDate, toDate) {
  const db=getDb(),snapshots=latestValidCompletedSnapshots(fromDate,toDate,db),out=[];
  for(const snapshot of snapshots){
    const members=membershipRows(snapshot,db),finals=finalRowsByBill(snapshot.reportDate,db),rows=[];
    for(const member of members){
      const bill=billOf(member.shipmentCode||member.运单号);if(!bill)continue;
      rows.push(normalizeWhppRow(finals.get(bill)||{},member,snapshot.reportDate));
    }
    out.push({snapshotId:snapshot.snapshotId||`WHPP-RANGE-${snapshot.reportDate}`,reportDate:snapshot.reportDate,payload:{finalRows:rows},membershipSource:members[0]?.membershipSource||'WHPP_VALID_COMPLETED_SNAPSHOT'});
  }
  return out;
}

export function countCompletedWhppRows(fromDate, toDate) {
  return listCompletedWhppSnapshots(fromDate,toDate).reduce((sum,snapshot)=>sum+Number(snapshot.payload?.finalRows?.length||0),0);
}

export function whppDailyCounts(fromDate, toDate) {
  return listCompletedWhppSnapshots(fromDate,toDate).map(snapshot=>({reportDate:snapshot.reportDate,businessType:'WHPP',count:Number(snapshot.payload?.finalRows?.length||0)}));
}

console.info('[CE-QC][V419_WHPP_EXPORT_MEMBERSHIP]',V419_WHPP_EXPORT_MEMBERSHIP_ID,'WHPP export dates require VALID+COMPLETED snapshots; membership comes from standard daily rows first, immutable valid snapshot membership only as historical fallback; residual final rows can enrich status but never create export members.');