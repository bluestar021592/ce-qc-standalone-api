// CE QC detail: read-only, exact daily snapshot + business + waybill.
// Does not fall back to CCSL data for WHPP or invent a terminal state.
const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']);
export function qcDetailRead(db,{reportDate='',shipmentCode='',businessType='',snapshotId=''}={}){
  const date=String(reportDate||'').trim(),bill=String(shipmentCode||'').trim().toUpperCase();
  const business=String(businessType||'').trim().toUpperCase(),snap=String(snapshotId||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!bill||bill.length>80||!TYPES.has(business))
    return {ok:false,code:'QC_DETAIL_INPUT_INVALID',status:400,error:'日期、业务类型或运单号无效'};
  const batch=snap
    ?db.prepare("SELECT snapshotId,batchId,reportDate FROM unified_import_batches WHERE snapshotId=? AND reportDate=? AND status='VALID' LIMIT 1").get(snap,date)
    :db.prepare("SELECT snapshotId,batchId,reportDate FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(date);
  if(!batch)return {ok:false,code:'QC_DETAIL_SNAPSHOT_MISSING',status:404,error:'此日期没有匹配的有效日报快照'};
  const src=db.prepare("SELECT shipmentCode,businessType,reportDate,snapshotId,regionCode,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson FROM unified_import_rows WHERE batchId=? AND shipmentCode=? AND businessType=? LIMIT 1")
    .get(batch.batchId,bill,business);
  // Action-center WHPP members may come from the separate WHPP ledger.
  // Bind every source to exact reportDate + WHPP + shipmentCode; saved
  // processing records alone must never be described as verified import.
  const whppDaily=business==='WHPP'?db.prepare(
    "SELECT sheetName,rowNumber,source_row_number,recipient_normalized,createdAt FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND UPPER(TRIM(shipmentCode))=? ORDER BY id DESC LIMIT 3"
  ).all(date,bill):[];
  function safeStateJson(raw){try{return JSON.parse(String(raw||'{}'))||{}}catch{return {}}}
  function matchingWhppSaved(payload,kind,whppSnapshotId=''){
    const state=payload?.state&&typeof payload.state==='object'?payload.state:payload;
    if(!state||String(state.reportDate||'').slice(0,10)!==date)return null;
    const final=(state.finalRows||[]).find(r=>
      String(r.shipmentCode||r.运单号||r.waybill||'').trim().toUpperCase()===bill
      && (!r.reportDate||String(r.reportDate).slice(0,10)===date)
      && (!r.businessType||String(r.businessType).toUpperCase()==='WHPP'));
    return final?{state,final,kind,whppSnapshotId}:null;
  }
  let whppSaved=null;
  if(business==='WHPP'){
    const row=db.prepare("SELECT valueJson FROM business_states WHERE businessType='WHPP'").get();
    if(row)whppSaved=matchingWhppSaved(safeStateJson(row.valueJson),'WHPP_CURRENT');
    if(!whppSaved){
      const saved=db.prepare("SELECT snapshotId,payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY id DESC LIMIT 4").all(date);
      for(const candidate of saved){
        whppSaved=matchingWhppSaved(safeStateJson(candidate.payloadJson),'WHPP_ARCHIVED',candidate.snapshotId);
        if(whppSaved)break;
      }
    }
  }
  if(!src&&!whppDaily.length&&!whppSaved)return{
    ok:false,code:'QC_DETAIL_MEMBER_MISSING',status:404,
    error:'统一日报、WHPP独立日报及该日期已保存的WHPP处理记录中均未找到这票'};
  const sourceVerified=Boolean(src||whppDaily.length);
  const sourceKind=src?'UNIFIED_IMPORT':whppDaily.length?'WHPP_DAILY_PARSE':'WHPP_FINAL_ONLY';
  function safeJson(input){
    try{return input&&typeof input==='string'?JSON.parse(input):input&&typeof input==='object'?input:{}}catch{return {}}
  }
  function rawView(record){
    if(!record)return null;
    const raw=safeJson(record.rawJson);
    return {...record,rawJson:undefined,sourceStatus:String(raw.shipmentStatus||raw.orderStatus||raw.apiStatus||''),
      description:String(raw.eventDesc||raw.description||raw.statusText||raw.轨迹描述||'').slice(0,350)};
  }
  const exact=[business,date,bill];
  const scan=rawView(db.prepare('SELECT isPod,orderStatus,updatedAt,rawJson FROM business_scan_results WHERE businessType=? AND reportDate=? AND shipmentCode=? LIMIT 1').get(...exact));
  const finalRow=rawView(db.prepare('SELECT isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,updatedAt,rawJson FROM business_final_rows WHERE businessType=? AND reportDate=? AND shipmentCode=? LIMIT 1').get(...exact));
  const track=rawView(db.prepare('SELECT shipmentStatus,statusText,apiStatus,updatedAt,rawJson FROM business_shipment_tracks WHERE businessType=? AND reportDate=? AND shipmentCode=? LIMIT 1').get(...exact));
  const events=db.prepare('SELECT eventTime,eventCode,rawJson FROM business_track_events WHERE businessType=? AND reportDate=? AND shipmentCode=? ORDER BY eventTime DESC,id DESC LIMIT 50').all(...exact).map(e=>{
    const parsed=safeJson(e.rawJson);
    return {eventTime:e.eventTime,eventCode:e.eventCode,
      description:String(parsed.description||parsed.eventDesc||parsed.statusText||parsed.remark||parsed.轨迹描述||'').slice(0,350)};
  });
  const daily=db.prepare("SELECT sheetName,rowNumber,source_row_number,recipient_normalized,createdAt FROM business_daily_parse_rows WHERE businessType=? AND reportDate=? AND shipmentCode=? ORDER BY id DESC LIMIT 3").all(...exact);
  const current=db.prepare('SELECT reportDate,snapshotId,state,apiStatus,lastEventTime,updatedAt FROM shipment_current_state WHERE shipmentCode=? AND businessType=? LIMIT 1').get(bill,business)||null;
  const source={shipmentCode:src.shipmentCode,businessType:src.businessType,reportDate:src.reportDate,
    snapshotId:src.snapshotId,regionCode:src.regionCode||'',
    recipient:src.recipientNormalized||'',sheetName:src.sheetName||'',rowNumber:src.rowNumber||null,
    classificationReason:src.classificationReason||''};
  const hasProcessingEvidence=Boolean(scan||finalRow||track||events.length);
  const evidence={source:true,scan:!!scan,final:!!finalRow,shipmentTrack:!!track,
    trackEvents:events.length,whppDailyRows:daily.length,currentState:!!current};
  const notice=hasProcessingEvidence?'已找到该业务和日期的处理证据。请以最终有效轨迹与明确终态为准。':
    '已找到此运单的日报来源，但该日期缺少已保存的扫描、轨迹或最终判断记录；待核验不代表已经POD或处理完成。';
  return{ok:true,detail:{shipmentCode:bill,businessType:business,reportDate:date,
    snapshotId:batch.snapshotId,source,scan,finalRow,track,events,daily,
    current:current?{...current,note:current.reportDate===date?'当前状态记录':'跨日期最新状态，仅供参考，不作为本日报终态证明'}:null,
    evidence,notice,hasProcessingEvidence}};
}
