import { getDb } from './db.js';

export const V329_THREE_BUSINESS_DAILY_CACHE_ID='2026-08-27-v329-three-business-nonblocking-daily-cache-v2';
export const V329_THREE_BUSINESS_TYPES=Object.freeze(['TBKH','SHOPEECN','SHOPEEVN']);
const TYPES=new Set(V329_THREE_BUSINESS_TYPES);
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function hasTable(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}

export function ensureV329ThreeBusinessDailyCache(db=getDb()){
  db.exec(`CREATE TABLE IF NOT EXISTS v329_three_business_daily_cache(
    businessType TEXT NOT NULL,
    reportDate TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    pod INTEGER NOT NULL DEFAULT 0,
    ocCurrent INTEGER NOT NULL DEFAULT 0,
    sameDayPod INTEGER NOT NULL DEFAULT 0,
    attempt1 INTEGER NOT NULL DEFAULT 0,
    attempt2 INTEGER NOT NULL DEFAULT 0,
    attempt3 INTEGER NOT NULL DEFAULT 0,
    signingDaysSum REAL NOT NULL DEFAULT 0,
    signingDaysCount INTEGER NOT NULL DEFAULT 0,
    ready INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL,
    PRIMARY KEY(businessType,reportDate)
  );
  CREATE INDEX IF NOT EXISTS idx_v329_three_business_daily_date ON v329_three_business_daily_cache(reportDate,businessType);`);
}

function finish(type,row={}){
  const total=n(row.total),pod=n(row.pod),attempt1=n(row.attempt1),attempt2=n(row.attempt2),attempt3=n(row.attempt3),attemptEvidenceCount=attempt1+attempt2+attempt3,signingDaysCount=n(row.signingDaysCount),signingDaysSum=n(row.signingDaysSum),signingComplete=pod===0||signingDaysCount>=pod,signingSampleAvailable=pod>0&&signingDaysCount>0,avg=signingSampleAvailable?Number((signingDaysSum/signingDaysCount).toFixed(2)):null,ready=row.ready===undefined||row.ready===null?total>0:Boolean(Number(row.ready));
  return {businessType:type,reportDate:dateKey(row.reportDate),total,matched:ready?total:0,pod,podRate:pct(pod,total)??0,ocCurrent:n(row.ocCurrent),ocRate:pct(row.ocCurrent,total)??0,sameDayPod:n(row.sameDayPod),sameDayPodRate:pct(row.sameDayPod,total)??0,attempt1,attempt2,attempt3,attempt1Known:attempt1,attempt2Known:attempt2,attempt3Known:attempt3,attemptEvidenceCount,attemptUnknown:Math.max(0,pod-attemptEvidenceCount),attemptCoverageRate:pct(attemptEvidenceCount,pod),attemptEvidenceComplete:pod===0||attemptEvidenceCount>=pod,signingDaysSum,signingDaysCount,signingSampleCount:signingDaysCount,signingCoverageRate:pct(signingDaysCount,pod),signingEvidenceComplete:signingComplete,signingSampleAvailable,avgSigningDays:avg,avgDispatchSigningDays:avg,ready,ledgerReady:ready,evidenceIncomplete:!ready||(pod>0&&(attemptEvidenceCount<pod||signingDaysCount<pod)),source:String(row.source||'V329_DAILY_CACHE'),updatedAt:String(row.updatedAt||'')};
}

export function writeV329ThreeBusinessDailyCache(businessType='',rows=[],db=getDb(),source='V329_ISOLATED_HISTORY_WORKER'){
  const type=String(businessType||'').toUpperCase();if(!TYPES.has(type))throw new Error('V329 cache only supports TBKH/SHOPEECN/SHOPEEVN');ensureV329ThreeBusinessDailyCache(db);const now=new Date().toISOString();const stmt=db.prepare(`INSERT INTO v329_three_business_daily_cache(businessType,reportDate,total,pod,ocCurrent,sameDayPod,attempt1,attempt2,attempt3,signingDaysSum,signingDaysCount,ready,source,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET total=excluded.total,pod=excluded.pod,ocCurrent=excluded.ocCurrent,sameDayPod=excluded.sameDayPod,attempt1=excluded.attempt1,attempt2=excluded.attempt2,attempt3=excluded.attempt3,signingDaysSum=excluded.signingDaysSum,signingDaysCount=excluded.signingDaysCount,ready=excluded.ready,source=excluded.source,updatedAt=excluded.updatedAt`);db.exec('BEGIN IMMEDIATE');try{for(const row of rows){const d=dateKey(row.reportDate);if(!d||n(row.total)<=0)continue;stmt.run(type,d,n(row.total),n(row.pod),n(row.ocCurrent),n(row.sameDayPod),n(row.attempt1),n(row.attempt2),n(row.attempt3),n(row.signingDaysSum),n(row.signingDaysCount),row.ready===false?0:1,source,now);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return{ok:true,id:V329_THREE_BUSINESS_DAILY_CACHE_ID,businessType:type,rowCount:rows.filter(r=>n(r.total)>0).length,updatedAt:now};
}

function oldV328Fallback(type,to,db){if(!hasTable(db,'v328_attempt_daily_cache'))return[];try{return db.prepare(`SELECT businessType,reportDate,total,pod,0 ocCurrent,0 sameDayPod,attempt1,attempt2,attempt3,0 signingDaysSum,0 signingDaysCount,1 ready,'V329_COMPAT_V328_COUNTS_ONLY' source,updatedAt FROM v328_attempt_daily_cache WHERE businessType=? AND reportDate<=? AND total>0 ORDER BY reportDate`).all(type,to);}catch{return[];}}

export function readV329ThreeBusinessDailyCache(businessType='',toDate='',db=getDb(),fromDate=''){
  const type=String(businessType||'').toUpperCase(),to=dateKey(toDate),from=dateKey(fromDate);if(!TYPES.has(type))throw new Error('V329历史缓存仅支持TBKH、SHOPEECN、SHOPEEVN');if(!to)throw new Error('日期无效');let rows=[];if(hasTable(db,'v329_three_business_daily_cache')){try{rows=from?db.prepare(`SELECT * FROM v329_three_business_daily_cache WHERE businessType=? AND reportDate BETWEEN ? AND ? AND total>0 ORDER BY reportDate`).all(type,from,to):db.prepare(`SELECT * FROM v329_three_business_daily_cache WHERE businessType=? AND reportDate<=? AND total>0 ORDER BY reportDate`).all(type,to);}catch{rows=[];}}if(!rows.length&&!from)rows=oldV328Fallback(type,to,db);const daily=rows.map(row=>finish(type,row)),dates=daily.map(r=>r.reportDate);return{ok:true,id:V329_THREE_BUSINESS_DAILY_CACHE_ID,businessType:type,requestedFromDate:from||to,requestedToDate:to,fromDate:dates[0]||to,toDate:dates.at(-1)||to,dates,daily,historyExpanded:true,availableDayCount:dates.length,evidenceIncomplete:daily.some(r=>r.evidenceIncomplete),source:rows.length?String(rows[0].source||'V329_DAILY_CACHE'):'V329_CACHE_EMPTY',definitions:{history:'TBKH、SHOPEE CN、SHOPEE VN页面只读取独立子进程生成的轻量历史缓存，主网页线程不再扫描15GB历史表。',attempts:'每票初始1派；只有Pending/失败后再次START才加1派；未再次START的异常不增加派次。',averageDays:'平均签收天数=有真实POD日期样本的已完成POD包裹之(实际POD日期-首次日报锁定日期+1)总和÷真实签收天数样本数；未POD和缺少真实POD日期的票不参与平均。',publication:'只要存在真实签收天数样本就发布样本平均；签收证据覆盖率仍单独保留，缺证据票继续后台补核，不再把已有真实平均值整天清空。'}};}

console.info('[CE-QC][V329_THREE_BUSINESS_DAILY_CACHE]',V329_THREE_BUSINESS_DAILY_CACHE_ID,'TBKH/CN/VN history reads are cache-only on the web process; average signing days publish from proven real-POD samples while incomplete coverage remains explicitly diagnosed.');