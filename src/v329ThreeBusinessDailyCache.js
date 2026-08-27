import { getDb } from './db.js';

export const V329_THREE_BUSINESS_DAILY_CACHE_ID='2026-08-27-v343-three-business-cache-revision-region-signing-v1';
export const V329_THREE_BUSINESS_CACHE_REVISION='2026-08-27-signing-region-cache-v1';
export const V329_THREE_BUSINESS_TYPES=Object.freeze(['TBKH','SHOPEECN','SHOPEEVN']);
const TYPES=new Set(V329_THREE_BUSINESS_TYPES);
const SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function hasTable(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function addColumn(db,names,name,sql){if(names.has(name))return;db.exec(`ALTER TABLE v329_three_business_daily_cache ADD COLUMN ${name} ${sql}`);names.add(name);}
function ensureColumns(db){
  const names=new Set(db.prepare('PRAGMA table_info(v329_three_business_daily_cache)').all().map(row=>String(row.name||'')));
  addColumn(db,names,'firstAttemptEligible','INTEGER NOT NULL DEFAULT 0');
  addColumn(db,names,'firstAttemptSuccess','INTEGER NOT NULL DEFAULT 0');
  if(!names.has('firstAttemptUnknownPod')){addColumn(db,names,'firstAttemptUnknownPod','INTEGER NOT NULL DEFAULT 0');db.exec('UPDATE v329_three_business_daily_cache SET firstAttemptUnknownPod=pod');}
  addColumn(db,names,'ppSigningDaysSum','REAL NOT NULL DEFAULT 0');
  addColumn(db,names,'ppSigningDaysCount','INTEGER NOT NULL DEFAULT 0');
  addColumn(db,names,'pvSigningDaysSum','REAL NOT NULL DEFAULT 0');
  addColumn(db,names,'pvSigningDaysCount','INTEGER NOT NULL DEFAULT 0');
  addColumn(db,names,'cacheRevision',"TEXT NOT NULL DEFAULT ''");
}

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
    firstAttemptEligible INTEGER NOT NULL DEFAULT 0,
    firstAttemptSuccess INTEGER NOT NULL DEFAULT 0,
    firstAttemptUnknownPod INTEGER NOT NULL DEFAULT 0,
    ppSigningDaysSum REAL NOT NULL DEFAULT 0,
    ppSigningDaysCount INTEGER NOT NULL DEFAULT 0,
    pvSigningDaysSum REAL NOT NULL DEFAULT 0,
    pvSigningDaysCount INTEGER NOT NULL DEFAULT 0,
    cacheRevision TEXT NOT NULL DEFAULT '',
    ready INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL,
    PRIMARY KEY(businessType,reportDate)
  );
  CREATE INDEX IF NOT EXISTS idx_v329_three_business_daily_date ON v329_three_business_daily_cache(reportDate,businessType);`);
  ensureColumns(db);
  // Code upgrades that change signing evidence or region semantics must never keep
  // serving an older compact cache indefinitely. This is a tiny derived table only;
  // deleting stale revisions does not touch imported reports, final rows or ledger truth.
  db.prepare(`DELETE FROM v329_three_business_daily_cache WHERE COALESCE(cacheRevision,'')<>?`).run(V329_THREE_BUSINESS_CACHE_REVISION);
}

function firstUnknownOf(row,pod,attemptEvidenceCount){
  if(row.firstAttemptUnknownPod!==undefined&&row.firstAttemptUnknownPod!==null&&Number.isFinite(Number(row.firstAttemptUnknownPod)))return Math.max(0,Math.min(pod,n(row.firstAttemptUnknownPod)));
  return Math.max(0,pod-attemptEvidenceCount);
}
function avg(sum,count){return n(count)>0?Number((n(sum)/n(count)).toFixed(2)):null;}
function finish(type,row={}){
  const total=n(row.total),pod=n(row.pod),attempt1=n(row.attempt1),attempt2=n(row.attempt2),attempt3=n(row.attempt3),attemptEvidenceCount=attempt1+attempt2+attempt3;
  const signingDaysCount=n(row.signingDaysCount),signingDaysSum=n(row.signingDaysSum),signingComplete=pod===0||signingDaysCount>=pod,signingSampleAvailable=pod>0&&signingDaysCount>0;
  const ppSigningDaysSum=n(row.ppSigningDaysSum),ppSigningDaysCount=n(row.ppSigningDaysCount),pvSigningDaysSum=n(row.pvSigningDaysSum),pvSigningDaysCount=n(row.pvSigningDaysCount);
  const ready=row.ready===undefined||row.ready===null?total>0:Boolean(Number(row.ready)),firstAttemptEligible=n(row.firstAttemptEligible),firstAttemptSuccess=Math.min(firstAttemptEligible,n(row.firstAttemptSuccess)),firstAttemptUnknownPod=firstUnknownOf(row,pod,attemptEvidenceCount),attemptEvidenceComplete=pod===0||attemptEvidenceCount>=pod,firstAttemptEvidenceComplete=pod===0||firstAttemptUnknownPod===0,firstAttemptRate=firstAttemptEligible>0&&firstAttemptEvidenceComplete?pct(firstAttemptSuccess,firstAttemptEligible):null;
  return {businessType:type,reportDate:dateKey(row.reportDate),total,matched:ready?total:0,pod,podRate:pct(pod,total)??0,ocCurrent:n(row.ocCurrent),ocRate:pct(row.ocCurrent,total)??0,sameDayPod:n(row.sameDayPod),sameDayPodRate:pct(row.sameDayPod,total)??0,attempt1,attempt2,attempt3,attempt1Known:attempt1,attempt2Known:attempt2,attempt3Known:attempt3,attemptEvidenceCount,attemptUnknown:Math.max(0,pod-attemptEvidenceCount),attemptCoverageRate:pct(attemptEvidenceCount,pod),attemptEvidenceComplete,firstAttemptEligible,firstAttemptSuccess,firstAttemptUnknownPod,firstAttemptRate,firstAttemptEvidenceComplete,signingDaysSum,signingDaysCount,signingSampleCount:signingDaysCount,signingCoverageRate:pct(signingDaysCount,pod),signingEvidenceComplete:signingComplete,signingSampleAvailable,avgSigningDays:avg(signingDaysSum,signingDaysCount),avgDispatchSigningDays:avg(signingDaysSum,signingDaysCount),ppSigningDaysSum,ppSigningDaysCount,ppSigningSampleCount:ppSigningDaysCount,ppAvgSigningDays:avg(ppSigningDaysSum,ppSigningDaysCount),pvSigningDaysSum,pvSigningDaysCount,pvSigningSampleCount:pvSigningDaysCount,pvAvgSigningDays:avg(pvSigningDaysSum,pvSigningDaysCount),ready,ledgerReady:ready,evidenceIncomplete:!ready||(pod>0&&(attemptEvidenceCount<pod||signingDaysCount<pod||firstAttemptUnknownPod>0)),cacheRevision:String(row.cacheRevision||V329_THREE_BUSINESS_CACHE_REVISION),source:String(row.source||'V329_DAILY_CACHE'),updatedAt:String(row.updatedAt||'')};
}

export function writeV329ThreeBusinessDailyCache(businessType='',rows=[],db=getDb(),source='V329_ISOLATED_HISTORY_WORKER'){
  const type=String(businessType||'').toUpperCase();if(!TYPES.has(type))throw new Error('V329 cache only supports TBKH/SHOPEECN/SHOPEEVN');ensureV329ThreeBusinessDailyCache(db);const now=new Date().toISOString();
  const stmt=db.prepare(`INSERT INTO v329_three_business_daily_cache(businessType,reportDate,total,pod,ocCurrent,sameDayPod,attempt1,attempt2,attempt3,signingDaysSum,signingDaysCount,firstAttemptEligible,firstAttemptSuccess,firstAttemptUnknownPod,ppSigningDaysSum,ppSigningDaysCount,pvSigningDaysSum,pvSigningDaysCount,cacheRevision,ready,source,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET total=excluded.total,pod=excluded.pod,ocCurrent=excluded.ocCurrent,sameDayPod=excluded.sameDayPod,attempt1=excluded.attempt1,attempt2=excluded.attempt2,attempt3=excluded.attempt3,signingDaysSum=excluded.signingDaysSum,signingDaysCount=excluded.signingDaysCount,firstAttemptEligible=excluded.firstAttemptEligible,firstAttemptSuccess=excluded.firstAttemptSuccess,firstAttemptUnknownPod=excluded.firstAttemptUnknownPod,ppSigningDaysSum=excluded.ppSigningDaysSum,ppSigningDaysCount=excluded.ppSigningDaysCount,pvSigningDaysSum=excluded.pvSigningDaysSum,pvSigningDaysCount=excluded.pvSigningDaysCount,cacheRevision=excluded.cacheRevision,ready=excluded.ready,source=excluded.source,updatedAt=excluded.updatedAt`);
  db.exec('BEGIN IMMEDIATE');try{for(const row of rows){const d=dateKey(row.reportDate);if(!d||n(row.total)<=0)continue;const pod=n(row.pod),attemptEvidenceCount=n(row.attempt1)+n(row.attempt2)+n(row.attempt3),firstAttemptUnknownPod=firstUnknownOf(row,pod,attemptEvidenceCount);stmt.run(type,d,n(row.total),pod,n(row.ocCurrent),n(row.sameDayPod),n(row.attempt1),n(row.attempt2),n(row.attempt3),n(row.signingDaysSum),n(row.signingDaysCount),n(row.firstAttemptEligible),n(row.firstAttemptSuccess),firstAttemptUnknownPod,n(row.ppSigningDaysSum),n(row.ppSigningDaysCount),n(row.pvSigningDaysSum),n(row.pvSigningDaysCount),V329_THREE_BUSINESS_CACHE_REVISION,row.ready===false?0:1,source,now);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return{ok:true,id:V329_THREE_BUSINESS_DAILY_CACHE_ID,cacheRevision:V329_THREE_BUSINESS_CACHE_REVISION,businessType:type,rowCount:rows.filter(r=>n(r.total)>0).length,updatedAt:now};
}

function oldV328Fallback(type,to,db){
  // Counts-only V328 cache has no regional signing truth. Never let it reappear as
  // a fake zero/blank Shopee signing table after a cache revision upgrade.
  if(SHOPEE.has(type)||!hasTable(db,'v328_attempt_daily_cache'))return[];
  try{return db.prepare(`SELECT businessType,reportDate,total,pod,0 ocCurrent,0 sameDayPod,attempt1,attempt2,attempt3,0 signingDaysSum,0 signingDaysCount,0 firstAttemptEligible,0 firstAttemptSuccess,pod firstAttemptUnknownPod,0 ppSigningDaysSum,0 ppSigningDaysCount,0 pvSigningDaysSum,0 pvSigningDaysCount,? cacheRevision,1 ready,'V329_COMPAT_V328_COUNTS_ONLY' source,updatedAt FROM v328_attempt_daily_cache WHERE businessType=? AND reportDate<=? AND total>0 ORDER BY reportDate`).all(V329_THREE_BUSINESS_CACHE_REVISION,type,to);}catch{return[];}
}

export function readV329ThreeBusinessDailyCache(businessType='',toDate='',db=getDb(),fromDate=''){
  const type=String(businessType||'').toUpperCase(),to=dateKey(toDate),from=dateKey(fromDate);if(!TYPES.has(type))throw new Error('V329历史缓存仅支持TBKH、SHOPEECN、SHOPEEVN');if(!to)throw new Error('日期无效');ensureV329ThreeBusinessDailyCache(db);let rows=[];
  if(hasTable(db,'v329_three_business_daily_cache')){try{rows=from?db.prepare(`SELECT * FROM v329_three_business_daily_cache WHERE businessType=? AND reportDate BETWEEN ? AND ? AND total>0 AND cacheRevision=? ORDER BY reportDate`).all(type,from,to,V329_THREE_BUSINESS_CACHE_REVISION):db.prepare(`SELECT * FROM v329_three_business_daily_cache WHERE businessType=? AND reportDate<=? AND total>0 AND cacheRevision=? ORDER BY reportDate`).all(type,to,V329_THREE_BUSINESS_CACHE_REVISION);}catch{rows=[];}}
  if(!rows.length&&!from)rows=oldV328Fallback(type,to,db);const daily=rows.map(row=>finish(type,row)),dates=daily.map(r=>r.reportDate);
  return{ok:true,id:V329_THREE_BUSINESS_DAILY_CACHE_ID,cacheRevision:V329_THREE_BUSINESS_CACHE_REVISION,businessType:type,requestedFromDate:from||to,requestedToDate:to,fromDate:dates[0]||to,toDate:dates.at(-1)||to,dates,daily,historyExpanded:true,availableDayCount:dates.length,evidenceIncomplete:daily.some(r=>r.evidenceIncomplete),source:rows.length?String(rows[0].source||'V329_DAILY_CACHE'):'V329_CACHE_EMPTY',definitions:{history:'TBKH、SHOPEE CN、SHOPEE VN页面只读取独立子进程生成的轻量历史缓存；缓存逻辑升级后旧派生缓存自动失效并重建，不需要重新上传日报。',attempts:'每票初始1派；只有Pending/失败后再次START才加1派；未再次START不增加派次。',firstAttempt:'首次妥投率=真实首派成功票÷真实首派START尝试票；只有保存的严格START证据覆盖后发布。',averageDays:'平均签收天数=有真实POD日期样本的已完成POD包裹之(实际POD日期-首次日报锁定日期+1)总和÷真实签收天数样本数；未POD和缺少真实POD日期的票不参与平均。',regionAverage:'SHOPEE CN/VN同一平均签收逻辑按最新VALID日报区域拆分：PP=金边，PV=外省；区域未知不强行归类。',publication:'只要存在真实签收天数样本就发布样本平均；缺证据票继续后台补核，不伪造0。'}};
}

console.info('[CE-QC][V329_THREE_BUSINESS_DAILY_CACHE]',V329_THREE_BUSINESS_DAILY_CACHE_ID,V329_THREE_BUSINESS_CACHE_REVISION,'derived history cache auto-invalidates stale code revisions and persists PP/PV signing-day samples for Shopee.');
