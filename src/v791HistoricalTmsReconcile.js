// V791: bounded, evidence-only historical TMS terminal reconciliation.
// This module never calls the API or writes SQLite by itself.
import { classifyShipmentStatus } from './shipmentStatusTruth.js';

const code=v=>String(v||'').trim().toUpperCase();
const text=v=>String(v??'').trim();
const parse=v=>{try{return v&&typeof v==='object'?v:JSON.parse(String(v||'{}'))||{}}catch{return{}}};
const TERMINAL=new Set(['60','80','81']);
// Compare terminal event times only when their timezone conventions match.
// A naive Cambodia-local time cannot safely be ordered against a UTC/offset
// time without knowing its source timezone; ambiguous evidence stays OPEN.
function comparableTerminalTime(raw){
  const value=text(raw);
  const m=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/i.exec(value);
  if(!m)return null;
  const [year,month,day,hour,minute,second,millis]=[
    Number(m[1]),Number(m[2]),Number(m[3]),Number(m[4]),
    Number(m[5]),Number(m[6]||0),Number((m[7]||'').padEnd(3,'0')||0)
  ];
  const utc=Date.UTC(year,month-1,day,hour,minute,second,millis);
  const d=new Date(utc);
  if(!Number.isFinite(utc)||d.getUTCFullYear()!==year
    ||d.getUTCMonth()!==month-1||d.getUTCDate()!==day
    ||d.getUTCHours()!==hour||d.getUTCMinutes()!==minute
    ||d.getUTCSeconds()!==second)return null;
  const zone=m[8]||'';
  let epoch=utc;
  if(zone&&zone.toUpperCase()!=='Z'){
    const hours=Number(zone.slice(1,3)),minutes=Number(zone.slice(4,6));
    if(hours>14||minutes>59||(hours===14&&minutes!==0))return null;
    epoch-=(zone[0]==='+'?1:-1)*(hours*60+minutes)*60000;
  }
  return {epoch,kind:zone?'zoned':'local'};
}
function terminalTimeOrder(previous,incoming){
  const a=comparableTerminalTime(previous),b=comparableTerminalTime(incoming);
  if(!a||!b||a.kind!==b.kind)return null;
  return Math.sign(b.epoch-a.epoch);
}

export function planHistoricalTmsReconcile(candidates=[],tmsRows=[],checkedAt=''){
  const observations=new Map(), confounded=new Set();
  for(const row of tmsRows||[]){
    const bill=code(row.shipmentCode);
    if(!bill)continue;
    const truth=classifyShipmentStatus(row);
    if(!truth.recognized||!TERMINAL.has(truth.code))continue;
    // Never use shipment creationDate as a fabricated POD timestamp.
    const time=text(row.podTime||row.deliveryTime||row.returnedTime||row.returnTime
      ||row.statusTime||row.updateTime||row.eventTime);
    const previous=observations.get(bill);
    // Different terminal codes require strictly ordered, comparable event
    // times. String comparison incorrectly ranks "T" after a space and
    // mishandles timezone offsets, potentially closing the wrong status.
    const order=previous?terminalTimeOrder(previous.time,time):null;
    if(previous&&previous.status!==truth.code){
      if(order===null||order===0){confounded.add(bill);continue}
      if(order<0)continue;
    }
    if(!previous||!previous.time||(time&&order!==null&&order>=0))
      observations.set(bill,{status:truth.code,time,source:truth.source});
  }
  const updates=[],scanResults=[],unverified=[],conflicts=[];
  for(const candidate of candidates||[]){
    const bill=code(candidate.shipmentCode),businessType=code(candidate.businessType);
    if(!bill||!businessType)continue;
    const observation=observations.get(bill);
    if(confounded.has(bill)){conflicts.push({shipmentCode:bill,businessType,reason:'CONFLICTING_TMS_TERMINALS'});continue}
    if(!observation){unverified.push({shipmentCode:bill,businessType,reason:'TMS_TERMINAL_NOT_VERIFIED'});continue}
    const existing=code(candidate.terminalReason||candidate.closeReason);
    if(['POD','RETURNED','ORDER_CANCELLED'].includes(existing)){
      const same=(existing==='POD'&&observation.status==='60')
        ||(existing==='RETURNED'&&observation.status==='81');
      if(!same){conflicts.push({shipmentCode:bill,businessType,reason:'EXISTING_TERMINAL_CONFLICT'});continue}
    }
    const data=parse(candidate.stateJson);
    const proof={source:'TMS_SHIPMENT_STATUS',verified:true,
      shipmentCode:bill,businessType,shipmentStatus:observation.status,
      verifiedAt:text(checkedAt),eventTime:observation.time};
    const common={...data,shipmentCode:bill,businessType,
      shipmentStatus:observation.status,shipmentStatusSource:observation.source,
      terminalEvidence:proof};
    let update;
    if(observation.status==='60')update={...common,currentState:'POD',
      是否POD:'是',POD状态:'POD',退回状态:'',primaryCategory:'POD',
      ...(observation.time?{POD时间:observation.time}:{})};
    else if(observation.status==='81')update={...common,currentState:'RETURN_COMPLETED',
      是否POD:'否',POD状态:'未POD',退回状态:'已退回',primaryCategory:'退回',
      ...(observation.time?{退回完成时间:observation.time}:{})};
    else update={...common,currentState:'RETURN_IN_PROGRESS',
      是否POD:'否',POD状态:'未POD',退回状态:'退回处理中',primaryCategory:'退回中',
      ...(observation.time?{退回开始时间:observation.time}:{})};
    updates.push(update);
    scanResults.push({shipmentCode:bill,businessType,
      shipmentStatus:observation.status,shipmentStatusSource:observation.source,
      shipmentStatusTime:observation.time,queryStatus:'success'});
  }
  return {updates,scanResults,unverified,conflicts,
    matched:updates.length,checked:candidates.length,
    closedPod:updates.filter(row=>row.shipmentStatus==='60').length,
    returned:updates.filter(row=>row.shipmentStatus==='81').length,
    returnInProgress:updates.filter(row=>row.shipmentStatus==='80').length};
}
