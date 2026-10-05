import { getDb } from './db.js';

export function loadWhppCanonicalTruth(reportDate='', snapshotId=''){
  const db=getDb();
  const date=String(reportDate||'').trim().slice(0,10);
  if(!date)return empty(date);

  let batch=null;
  if(snapshotId){
    try{batch=db.prepare("SELECT snapshotId,batchId,reportDate FROM unified_import_batches WHERE snapshotId=? AND reportDate=? LIMIT 1").get(String(snapshotId),date)||null;}catch{}
  }
  if(!batch){
    try{batch=db.prepare("SELECT snapshotId,batchId,reportDate FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)||null;}catch{}
  }

  let members=[];
  if(batch?.snapshotId){
    try{
      members=db.prepare(`
        SELECT shipmentCode,regionCode,rowJson
        FROM unified_import_rows
        WHERE snapshotId=? AND reportDate=? AND UPPER(TRIM(businessType))='WHPP'
        ORDER BY rowNumber,shipmentCode
      `).all(batch.snapshotId,date).map(row=>memberRow(row,date));
    }catch{}
  }
  if(!members.length){
    try{
      members=db.prepare(`
        SELECT shipmentCode,'' regionCode,rowJson
        FROM business_daily_parse_rows
        WHERE businessType='WHPP' AND reportDate=?
        ORDER BY rowNumber,shipmentCode
      `).all(date).map(row=>memberRow(row,date));
    }catch{}
  }

  const memberMap=new Map(uniqueRows(members).map(row=>[billOf(row),row]));
  const bills=[...memberMap.keys()];
  if(!bills.length)return { ...empty(date), snapshotId:batch?.snapshotId||'', batchId:batch?.batchId||'' };

  const finalMap=queryRows(db,bills,`
    SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson
    FROM business_final_rows
    WHERE businessType='WHPP' AND reportDate=? AND shipmentCode IN (__MARKS__)
  `,[date],row=>normalizeFinal(row,date));

  const currentMap=queryRows(db,bills,`
    SELECT shipmentCode,state,apiStatus,lastEventTime,stateJson
    FROM shipment_current_state
    WHERE businessType='WHPP' AND reportDate=? AND shipmentCode IN (__MARKS__)
  `,[date],row=>normalizeCurrent(row,date));

  const scanMap=queryRows(db,bills,`
    SELECT shipmentCode,isPod,orderStatus,rawJson
    FROM business_scan_results
    WHERE businessType='WHPP' AND reportDate=? AND shipmentCode IN (__MARKS__)
  `,[date],row=>normalizeScan(row,date));

  const rows=bills.map(code=>{
    const member=memberMap.get(code)||{};
    const scan=scanMap.get(code)||{};
    const current=currentMap.get(code)||{};
    const final=finalMap.get(code)||{};
    const row={...member,...scan,...current,...final,shipmentCode:code,运单号:code,businessType:'WHPP',reportDate:date};
    const pod=isPodEvidence(final,current,scan,row);
    const returned=isReturnEvidence(final,current,scan,row);
    if(pod){
      row.isPod=1;row.是否POD='是';row.POD状态='POD';row.currentState='POD';
      if(!String(row.primaryCategory||'').trim())row.primaryCategory='POD';
    }else{
      row.isPod=0;row.是否POD='否';
      if(returned&&!String(row.currentState||'').trim())row.currentState='RETURNED';
    }
    row.finalRowAvailable=Boolean(finalMap.has(code)||currentMap.has(code)||scanMap.has(code));
    row.truthEvidence={
      final:Boolean(finalMap.has(code)),
      current:Boolean(currentMap.has(code)),
      scan:Boolean(scanMap.has(code)),
      pod,
      returned
    };
    return row;
  });

  return {
    reportDate:date,snapshotId:batch?.snapshotId||snapshotId||'',batchId:batch?.batchId||'',
    total:rows.length,rows,
    evidence:{
      finalRows:rows.filter(row=>row.truthEvidence.final).length,
      currentRows:rows.filter(row=>row.truthEvidence.current).length,
      scanRows:rows.filter(row=>row.truthEvidence.scan).length,
      podRows:rows.filter(row=>row.truthEvidence.pod).length,
      returnedRows:rows.filter(row=>row.truthEvidence.returned).length
    }
  };
}

function queryRows(db,bills,sql,params,normalize){
  const out=new Map();
  for(let i=0;i<bills.length;i+=350){
    const chunk=bills.slice(i,i+350);
    const marks=chunk.map(()=>'?').join(',');
    let rows=[];
    try{rows=db.prepare(sql.replace('__MARKS__',marks)).all(...params,...chunk);}catch{rows=[]}
    for(const source of rows){
      const row=normalize(source),bill=billOf(row);
      if(bill)out.set(bill,row);
    }
  }
  return out;
}
function memberRow(row,date){
  const raw=safeJson(row.rowJson);
  const code=String(row.shipmentCode||raw.shipmentCode||raw.运单号||'').trim().toUpperCase();
  return {...raw,shipmentCode:code,运单号:code,businessType:'WHPP',reportDate:date,regionCode:String(row.regionCode||raw.regionCode||raw.区域||'').trim().toUpperCase()};
}
function normalizeFinal(row,date){
  const raw=safeJson(row.rawJson);
  return {...raw,shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase(),businessType:'WHPP',reportDate:date,isPod:Number(row.isPod||0),primaryCategory:row.primaryCategory||raw.primaryCategory||raw.主分类||'',apiStatus:row.apiStatus||raw.apiStatus||'',carryStatus:row.carryStatus||raw.carryStatus||'',latestEventTime:row.latestEventTime||raw.latestEventTime||raw.最后节点时间||'',latestEventDesc:row.latestEventDesc||raw.latestEventDesc||raw.最后节点||'',latestNode:row.latestNode||raw.latestNode||''};
}
function normalizeCurrent(row,date){
  const raw=safeJson(row.stateJson);
  const state=String(row.state||raw.currentState||raw.scanNormalizedState||'').trim().toUpperCase();
  return {...raw,shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase(),businessType:'WHPP',reportDate:date,currentState:state,scanNormalizedState:state,apiStatus:row.apiStatus||raw.apiStatus||'',API状态:row.apiStatus||raw.API状态||'',latestEventTime:row.lastEventTime||raw.latestEventTime||raw.最后节点时间||'',最后节点时间:row.lastEventTime||raw.最后节点时间||''};
}
function normalizeScan(row,date){
  const raw=safeJson(row.rawJson);
  return {...raw,shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase(),businessType:'WHPP',reportDate:date,orderStatus:String(row.orderStatus??raw.orderStatus??''),scanIsPod:Number(row.isPod||0)};
}
function isPodEvidence(final,current,scan,row){
  if(Number(final?.isPod||0)===1||Number(scan?.scanIsPod||0)===1)return true;
  if(String(scan?.orderStatus||'')==='85')return true;
  const state=String(current?.currentState||row?.currentState||'').toUpperCase();
  if(['POD','DELIVERED','SIGNED'].includes(state))return true;
  return row?.是否POD==='是'||row?.POD状态==='POD';
}
function isReturnEvidence(final,current,scan,row){
  const values=[current?.currentState,final?.currentState,final?.primaryCategory,row?.退回状态,row?.primaryCategory,scan?.currentState].map(v=>String(v||'').trim().toUpperCase());
  return values.some(v=>['RETURN','RETURNED','RETURN_COMPLETED','已退回','退回','退回完成'].includes(v));
}
function uniqueRows(rows=[]){
  const out=new Map();for(const row of rows){const bill=billOf(row);if(bill&&!out.has(bill))out.set(bill,row);}return [...out.values()];
}
function billOf(row={}){return String(row.shipmentCode||row.运单号||'').trim().toUpperCase()}
function safeJson(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return{}}}
function empty(reportDate=''){return{reportDate,snapshotId:'',batchId:'',total:0,rows:[],evidence:{finalRows:0,currentRows:0,scanRows:0,podRows:0,returnedRows:0}}}
