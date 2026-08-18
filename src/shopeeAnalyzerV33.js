import {
  analyzeShopeeShipment as analyzeShopeeShipmentV32,
  classifyShopeeScanStatus,
  classifyShopeeRegion
} from './shopeeAnalyzerV32.js';
import { normalizeEvent } from './analyzer.js';
import { resolveV202AttemptCycle } from './v202DeliveryTruth.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-18-v202-real-delivery-attempt-cycle-v33';
const POD_RE=/\bPOD\b|DELIVERED|签收|妥投|已妥投|Successfully delivered|4004/i;
const PENDING_RE=/\bPENDING\b|Pending|派送失败|无法联系|无人接听|地址错误|改派/i;
const RETURN_RE=/RETURN(?:ED|_COMPLETED)?|退回完成|已退回|退件完成|P4008/i;
const DELIVERY_RE=/Parcel start to deliver|out\s*for\s*delivery|派送中|派件中|正在为您派送|正在派送|Deliver to Buyer/i;

function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function eventCode(event={}){return String(event.eventCode??event.trackingEventCode??event.statusCode??'').trim().toUpperCase();}
function eventTime(event={}){return String(event.eventTime||event.creationDate||event.lastUpdateDate||'').trim();}
function eventText(event={}){return [event.eventCode,event.trackingEventCode,event.statusCode,event.trackingEventDesc,event.trackingEventDescZh,event.trackingEventDescKm,event.place,event.locationCode,event.eventShop,event.remark].map(v=>String(v||'')).join(' ');}
function toCycleEvent(event={}){
  const normalized=normalizeEvent(event),code=eventCode(normalized),text=eventText(normalized),time=eventTime(normalized);
  if(!dateKey(time))return null;
  if(code==='80'||code==='4004'||POD_RE.test(text))return{kind:'POD',time,source:`CE轨迹${code||'POD'}`};
  if(code==='86'||code==='P4008'||RETURN_RE.test(text))return{kind:'RETURN',time,source:`CE轨迹${code||'RETURN'}`};
  if(code==='150'||PENDING_RE.test(text))return{kind:'FAIL',time,source:`CE轨迹${code||'Pending'}`};
  // 4003 is Shopee's real "Deliver to Buyer" attempt node; CE trajectory 70 is
  // actual delivery/out-for-delivery. Code 60 is assignment only and is excluded.
  if(code==='4003'||code==='70'||DELIVERY_RE.test(text))return{kind:'START',time,source:`CE轨迹${code||'派送开始'}`};
  return null;
}
function synthetic(kind,date,source,suffix){const d=dateKey(date);return d?{kind,time:`${d} ${suffix||'12:00:00'}`,source}:null;}
function priorCycleEvents(prior={}){
  const out=[];
  for(const value of Array.isArray(prior.attemptStartTimes)?prior.attemptStartTimes:[]){const e=synthetic('START',value,'历史已确认派送开始','08:00:00');if(e)out.push(e);}
  for(const value of Array.isArray(prior.failedAttemptDates)?prior.failedAttemptDates:[]){const e=synthetic('FAIL',value,'历史已确认派送失败','23:00:00');if(e)out.push(e);}
  return out;
}
function dailyStartEvidence(args={}){
  const daily=args.dailyRow||{};
  const status=String(daily.statusCode||daily.状态标识||daily.status||'').trim().toUpperCase();
  const desc=String(daily.statusDesc||daily.状态说明||daily.状态描述||'');
  if(!['W','Y'].includes(status)&&!DELIVERY_RE.test(desc))return null;
  return synthetic('START',args.reportDate||args.analysisDate,'日报W/Y真实派送状态日','12:00:00');
}

export function analyzeShopeeShipment(args={}){
  const base=analyzeShopeeShipmentV32(args);
  const events=[...priorCycleEvents(args.priorRow||{})];
  for(const raw of Array.isArray(args.events)?args.events:[]){const event=toCycleEvent(raw);if(event)events.push(event);}
  const daily=dailyStartEvidence(args);if(daily)events.push(daily);
  if(base.是否POD==='是'&&dateKey(base.POD时间)){events.push({kind:'POD',time:base.POD时间,source:'分析结果POD事实'});}
  const cycle=resolveV202AttemptCycle(events);
  const podAttempt=base.是否POD==='是'?Number(cycle.attemptNo||0):0;
  return{
    ...base,
    analysisRuleVersion:SHOPEE_ANALYSIS_RULE_VERSION,
    dispatchDayNo:podAttempt,
    podAttemptNo:podAttempt,
    currentAttemptNo:Number(cycle.currentAttemptNo||0),
    attemptStartTimes:cycle.attemptStarts||[],
    failedAttemptDates:cycle.failureDates||[],
    attemptEvidence:(cycle.evidence||[]).join('｜'),
    attemptStatus:podAttempt?'REAL_DELIVERY_CYCLE_CONFIRMED':(base.是否POD==='是'?'UNKNOWN_NO_COMPLETE_DELIVERY_CYCLE':'OPEN_DELIVERY_CYCLE'),
    attemptConfidence:podAttempt?'HIGH':'UNKNOWN',
    attemptUnknownReason:base.是否POD==='是'&&!podAttempt?'已POD但缺少“真实派送开始→失败/重派→POD”的完整派次证据，禁止按经过天数猜派次':'',
    attemptCalculatedAt:new Date().toISOString()
  };
}

export { classifyShopeeScanStatus, classifyShopeeRegion };
