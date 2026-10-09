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
    const matches=r=>String(r?.shipmentCode||r?.运单号||r?.waybill||'').trim().toUpperCase()===bill
      && (!r.reportDate||String(r.reportDate).slice(0,10)===date)
      && (!r.businessType||String(r.businessType).toUpperCase()==='WHPP');
    const final=(state.finalRows||[]).find(matches)||null;
    const scan=(state.scanResults||[]).find(matches)||null;
    const hasEvents=(state.trackEvents||[]).some(matches);
    return final||scan||hasEvents?{state,final,scan,kind,whppSnapshotId}:null;
  }
  let whppSaved=null;
  // A verified unified WHPP member can still have scan/final evidence only
  // in the independent WHPP saved state. Load exact-day saved evidence for
  // both verified and unverified members; it never becomes import proof.
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
  // A duplicate number assigned to CE in the unified sheet cannot silently
  // be re-labelled WHPP. Expose the classification conflict to the QC user.
  const otherUnified=business==='WHPP'&&!src?db.prepare(
    'SELECT businessType FROM unified_import_rows WHERE batchId=? AND UPPER(TRIM(shipmentCode))=? LIMIT 1'
  ).get(batch.batchId,bill):null;
  const classificationConflict=Boolean(otherUnified&&String(otherUnified.businessType).toUpperCase()!==business);
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
  const savedScan=whppSaved?.scan||null;
  const scan=rawView(db.prepare('SELECT isPod,orderStatus,updatedAt,rawJson FROM business_scan_results WHERE businessType=? AND reportDate=? AND shipmentCode=? LIMIT 1').get(...exact))
    ||(savedScan?{isPod:savedScan.isPod??savedScan.是否POD??null,orderStatus:savedScan.orderStatus||'',
      updatedAt:savedScan.updatedAt||'',sourceNote:'WHPP已保存扫描结果'}:null);
  const persistedFinal=rawView(db.prepare('SELECT isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,updatedAt,rawJson FROM business_final_rows WHERE businessType=? AND reportDate=? AND shipmentCode=? LIMIT 1').get(...exact));
  const whppFinal=whppSaved?.final;
  const finalRow=persistedFinal||(whppFinal?{
    isPod:whppFinal.isPod??whppFinal.是否POD??null,
    primaryCategory:whppFinal.primaryCategory||whppFinal.主分类||whppFinal.异常分类||'',
    apiStatus:whppFinal.apiStatus||whppFinal.API状态||'',
    carryStatus:whppFinal.carryStatus||'',
    latestEventTime:whppFinal.latestEventTime||whppFinal.最后节点时间||'',
    latestEventDesc:whppFinal.latestEventDesc||whppFinal.最后节点||'',
    latestNode:whppFinal.latestNode||whppFinal.最后节点||'',
    updatedAt:whppFinal.updatedAt||'',sourceNote:'WHPP独立保存结果，非日报成员证明'
  }:null);
  const track=rawView(db.prepare('SELECT shipmentStatus,statusText,apiStatus,updatedAt,rawJson FROM business_shipment_tracks WHERE businessType=? AND reportDate=? AND shipmentCode=? LIMIT 1').get(...exact));
  const events=db.prepare('SELECT eventTime,eventCode,rawJson FROM business_track_events WHERE businessType=? AND reportDate=? AND shipmentCode=? ORDER BY eventTime DESC,id DESC LIMIT 50').all(...exact).map(e=>{
    const parsed=safeJson(e.rawJson);
    return {eventTime:e.eventTime,eventCode:e.eventCode,
      description:String(parsed.description||parsed.eventDesc||parsed.statusText||parsed.remark||parsed.轨迹描述||'').slice(0,350)};
  });
  // WHPP saves some history in the exact-dated state rather than event SQL.
  // Never borrow events from a later date or a different waybill.
  if(events.length===0&&whppSaved){
    for(const event of whppSaved.state.trackEvents||[]){
      if(String(event.shipmentCode||event.运单号||event.waybill||'').trim().toUpperCase()!==bill)continue;
      if(event.reportDate&&String(event.reportDate).slice(0,10)!==date)continue;
      if(event.businessType&&String(event.businessType).toUpperCase()!=='WHPP')continue;
      events.push({eventTime:String(event.eventTime||event.time||event.时间||''),
        eventCode:String(event.eventCode||event.statusCode||''),
        description:String(event.description||event.eventDesc||event.statusText||event.轨迹描述||'').slice(0,350)});
      if(events.length>=50)break;
    }
    events.sort((a,b)=>String(b.eventTime).localeCompare(String(a.eventTime)));
  }
  const daily=business==='WHPP'?whppDaily:db.prepare("SELECT sheetName,rowNumber,source_row_number,recipient_normalized,createdAt FROM business_daily_parse_rows WHERE businessType=? AND reportDate=? AND shipmentCode=? ORDER BY id DESC LIMIT 3").all(...exact);
  const current=db.prepare('SELECT reportDate,snapshotId,state,apiStatus,lastEventTime,updatedAt FROM shipment_current_state WHERE shipmentCode=? AND businessType=? LIMIT 1').get(bill,business)||null;
  const dailySource=whppDaily[0]||{};
  const source={
    shipmentCode:bill,businessType:business,reportDate:date,
    snapshotId:src?.snapshotId||whppSaved?.whppSnapshotId||whppSaved?.state?.sourceSnapshotId||'',
    regionCode:src?.regionCode||whppFinal?.regionCode||whppFinal?.区域||'',
    recipient:src?.recipientNormalized||dailySource.recipient_normalized||'',
    sheetName:src?.sheetName||dailySource.sheetName||'',
    rowNumber:src?.rowNumber??dailySource.rowNumber??null,
    classificationReason:src?.classificationReason||'',
    sourceKind,sourceVerified,classificationConflict,
    otherUnifiedBusiness:classificationConflict?otherUnified.businessType:'',
    sourceNote:classificationConflict?
      '业务分类冲突：统一日报归属'+otherUnified.businessType+'，WHPP独立来源存在该运单；请核实分类，不合并两业务统计':
      src?'统一日报成员已匹配':whppDaily.length?
      'WHPP独立日报成员已匹配；非统一日报快照中的WHPP成员':
      '仅匹配该日WHPP保存的处理记录；日报来源尚未逐票验证'
  };
  const hasProcessingEvidence=Boolean(scan||finalRow||track||events.length);
  const whppCancelledFinal=business==='WHPP'
    && String(finalRow?.primaryCategory||'').trim()==='订单取消'
    && ['CLOSED','CLOSED_CANCELLED'].includes(String(finalRow?.carryStatus||whppFinal?.carry状态||'').trim().toUpperCase());
  const evidence={source:sourceVerified,scan:!!scan,final:!!finalRow,shipmentTrack:!!track,
    trackEvents:events.length,whppDailyRows:daily.length,currentState:!!current};
  const notice=classificationConflict?
    '存在跨业务分类冲突：统一日报与WHPP独立记录对同一单号归属不同；两侧证据分开显示，请先核实，不能重复计入业务票数。':
    !sourceVerified?
    '找到该日期的WHPP处理记录，但尚未核实其日报来源成员；不能据此认定已POD或处理完成。':
    whppCancelledFinal?
    '此日WHPP已保存订单取消及CLOSED闭环证据；该单不是POD，也不应因缺少轨迹进入普通未处理异常。可继续核对原始取消依据。':
    hasProcessingEvidence?
    '找到该业务日期的日报来源与处理证据，请以最后有效轨迹和可信终态为准。':
    '已确认日报来源，但缺少已保存的扫描、轨迹或最终判断；没有轨迹不代表未POD。';
  return{ok:true,detail:{shipmentCode:bill,businessType:business,reportDate:date,
    snapshotId:batch.snapshotId,source,scan,finalRow,track,events,daily,
    current:current?{...current,note:current.reportDate===date?'当前状态记录':'跨日期最新状态，仅供参考，不作为本日报终态证明'}:null,
    evidence,notice,hasProcessingEvidence,terminalOutcome:whppCancelledFinal?'ORDER_CANCELLED':''}};
}
