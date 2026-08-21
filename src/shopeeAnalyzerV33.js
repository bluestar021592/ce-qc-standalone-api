import {
  analyzeShopeeShipment as analyzeShopeeShipmentV32,
  classifyShopeeScanStatus,
  classifyShopeeRegion
} from './shopeeAnalyzerV32.js';
import { normalizeEvent } from './analyzer.js';
import { resolveV202AttemptCycle } from './v202DeliveryTruth.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-20-v239-current-pending-special-closure-v1';
const POD_RE=/\bPOD\b|DELIVERED|签收|妥投|已妥投|Successfully delivered|4004/i;
const PENDING_RE=/\bPENDING\b|Pending|派送失败|无法联系|无人接听|地址错误|改派/i;
const RETURN_RE=/RETURN(?:ED|_COMPLETED)?|退回完成|已退回|退件完成|P4008/i;
const DELIVERY_RE=/Parcel start to deliver|out\s*for\s*delivery|派送中|派件中|正在为您派送|正在派送|Deliver to Buyer/i;
const SPECIAL_NORMAL_STATES=new Set(['SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION']);

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
function dayValue(value=''){const d=dateKey(value);if(!d)return null;const [y,m,day]=d.split('-').map(Number);return Date.UTC(y,m-1,day);}
function consecutive(dates=[]){for(let i=1;i<dates.length;i+=1){const a=dayValue(dates[i-1]),b=dayValue(dates[i]);if(a===null||b===null||Math.round((b-a)/86400000)!==1)return false;}return true;}
function activePendingEpisode(rawEvents=[]){
  const sorted=(Array.isArray(rawEvents)?rawEvents:[]).map((row,index)=>({...normalizeEvent(row),__index:index})).filter(row=>dateKey(eventTime(row))).sort((a,b)=>eventTime(a).localeCompare(eventTime(b))||a.__index-b.__index);
  if(!sorted.length||eventCode(sorted.at(-1))!=='150')return{days:0,dates:[],continuous:false};
  let boundary=-1;
  for(let i=sorted.length-2;i>=0;i-=1){if(eventCode(sorted[i])!=='150'){boundary=i;break;}}
  const dates=[...new Set(sorted.slice(boundary+1).filter(row=>eventCode(row)==='150').map(row=>dateKey(eventTime(row))).filter(Boolean))].sort();
  return{days:dates.length||1,dates,continuous:dates.length<=1||consecutive(dates)};
}
function reconcileCurrentPending(base={},rawEvents=[]){
  if(String(base.currentState||'').toUpperCase()!=='PENDING'&&base.Pending状态!=='是')return base;
  const episode=activePendingEpisode(rawEvents);
  if(!episode.days)return base;
  const category=episode.days>=3?'Pending3次及以上':`Pending${episode.days}次`;
  const tags=(Array.isArray(base.tags)?base.tags:[]).filter(tag=>!/^PENDING_/.test(String(tag||'')));
  if(episode.days===1)tags.push('PENDING_1');
  if(episode.days===2)tags.push('PENDING_2');
  if(episode.days>=3)tags.push('PENDING_3_PLUS');
  if(episode.days>=2&&episode.continuous)tags.push('PENDING_CONTINUOUS');
  if(episode.days>=2&&!episode.continuous)tags.push('PENDING_NON_CONTINUOUS');
  return{
    ...base,
    primaryCategory:category,主分类:category,异常分类:category,
    Pending状态:'是',Pending次数:episode.days,Pending当前次数:episode.days,Pending日期:episode.dates.join('、'),
    Pending连续性:episode.days===1?'单次':episode.continuous?'连续':'不连续',pendingContinuity:episode.days===1?'单次':episode.continuous?'连续':'不连续',
    Pending连续:episode.days>=2&&episode.continuous?'是':'否',Pending不连续:episode.days>=2&&!episode.continuous?'是':'否',
    returnRequired:episode.days>=3,退回待处理:episode.days>=3?'是':'否',tags:[...new Set(tags)]
  };
}
function reconcileSpecialNormal(base={}){
  const state=String(base.specialState||base.currentState||base.primaryCategory||'').toUpperCase();
  if(!SPECIAL_NORMAL_STATES.has(state))return base;
  const tags=(Array.isArray(base.tags)?base.tags:[]).filter(tag=>!/^(PENDING_|OC_|CYCLE_|INBOUND_NO_SCAN|SEVERE_OVERDUE|NODE_STALE)/.test(String(tag||'')));
  return{
    ...base,
    trackRequired:false,trackSkippedReason:'SPECIAL_NORMAL_DESTINATION',carry状态:'closed_normal',跨日状态:'已闭环',
    Pending状态:'否',Pending次数:0,Pending当前次数:0,Pending日期:'',Pending连续:'否',Pending不连续:'否',
    OC状态:'否',OC天数:0,盘点状态:'否',盘点天数:0,入库无扫描节点:'否',returnRequired:false,退回待处理:'否',
    tags:[...new Set([...tags,'SPECIAL_NORMAL_DESTINATION'])]
  };
}

export function analyzeShopeeShipment(args={}){
  let base=analyzeShopeeShipmentV32(args);
  base=reconcileCurrentPending(base,args.events||[]);
  base=reconcileSpecialNormal(base);
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
