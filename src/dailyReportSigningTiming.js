export const DAILY_REPORT_SIGNING_TIMING_REVISION='2026-10-07-v744-terminal-daily-report-signing-time-v1';

function text(value){return String(value??'').trim();}
function normalizeDate(value){
  const raw=text(value);
  const match=raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if(!match)return'';
  return `${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
}
export function naturalSigningDays(orderTime='',deliveryTime=''){
  const start=normalizeDate(orderTime),end=normalizeDate(deliveryTime);
  if(!start||!end)return 0;
  const a=Date.parse(start+'T00:00:00+07:00'),b=Date.parse(end+'T00:00:00+07:00');
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)return 0;
  return Math.floor((b-a)/86400000)+1;
}
function pick(raw={},keys=[]){
  for(const key of keys){
    const value=raw?.[key];
    if(text(value))return text(value);
  }
  return'';
}
export function dailyReportProvesPod(raw={}){
  raw=raw&&typeof raw==='object'?raw:{};
  const flag=pick(raw,['状态标识','statusFlag','status']).toUpperCase();
  if(['Y','POD','DELIVERED','SIGNED'].includes(flag))return true;
  const orderStatus=pick(raw,['orderStatus','订单状态']).toUpperCase();
  if(orderStatus==='85')return true;
  const shipmentStatus=pick(raw,['shipmentStatus']).toUpperCase();
  if(shipmentStatus==='60')return true;
  const desc=pick(raw,['状态说明','statusDesc','statusText','shipmentStatusDesc','currentState','POD状态','签收状态']).toUpperCase();
  if(!desc)return false;
  if(/未签收|未妥投|签收失败|妥投失败|PENDING|RETURN|退回|取消|CANCEL/.test(desc))return false;
  return /(^|[^A-Z])POD([^A-Z]|$)|DELIVERED|SIGNED|已签收|签收成功|已妥投|妥投成功/.test(desc);
}
export function extractDailyReportSigningEvidence(raw={}){
  raw=raw&&typeof raw==='object'?raw:{};
  if(!dailyReportProvesPod(raw))return{ok:false,reason:'DAILY_REPORT_NOT_POD',days:0,attempt:0,evidenceSource:'daily_report_delivery_time'};
  const orderTime=pick(raw,['下单时间','下单日期','订单时间','订单日期','orderTime','orderDate','bookingDate']);
  const deliveryTime=pick(raw,['派件时间','签收时间','POD时间','podTime','deliveryTime','deliveryDate','deliveredAt','deliveryCompletedAt']);
  if(!orderTime)return{ok:false,reason:'DAILY_REPORT_ORDER_TIME_MISSING',days:0,attempt:0,evidenceSource:'daily_report_delivery_time'};
  if(!deliveryTime)return{ok:false,reason:'DAILY_REPORT_DELIVERY_TIME_MISSING',days:0,attempt:0,evidenceSource:'daily_report_delivery_time'};
  const days=naturalSigningDays(orderTime,deliveryTime);
  if(days<=0)return{ok:false,reason:'DAILY_REPORT_TIME_RANGE_INVALID',startTime:orderTime,podTime:deliveryTime,days:0,attempt:0,evidenceSource:'daily_report_delivery_time'};
  return{
    ok:true,reason:'',startTime:orderTime,podTime:deliveryTime,days,attempt:0,
    startMode:'DAILY_REPORT_ORDER_TO_DELIVERY',attemptSource:'',
    evidenceSource:'daily_report_delivery_time',revision:DAILY_REPORT_SIGNING_TIMING_REVISION
  };
}
