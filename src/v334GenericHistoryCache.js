import { getDb } from './db.js';

export const V334_GENERIC_HISTORY_CACHE_ID='2026-08-27-v334-generic-saved-history-cache-v1';
export const V334_GENERIC_HISTORY_TYPES=Object.freeze(['CE','CEAF','ALI1688','WHPP','ALL']);
const TYPES=new Set(V334_GENERIC_HISTORY_TYPES);
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const date=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};

export function ensureV334GenericHistoryCache(db=getDb()){
  db.exec(`CREATE TABLE IF NOT EXISTS v334_generic_history_cache(
    businessType TEXT NOT NULL,
    reportDate TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    pod INTEGER NOT NULL DEFAULT 0,
    ocCurrent INTEGER NOT NULL DEFAULT 0,
    sameDayPod INTEGER NOT NULL DEFAULT 0,
    ready INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL,
    PRIMARY KEY(businessType,reportDate)
  );
  CREATE INDEX IF NOT EXISTS idx_v334_generic_history_date ON v334_generic_history_cache(reportDate,businessType);`);
}

function finish(type,row={}){
  const total=n(row.total),pod=n(row.pod),ocCurrent=n(row.ocCurrent),sameDayPod=n(row.sameDayPod),ready=row.ready===undefined||row.ready===null?total>0:Boolean(Number(row.ready));
  return{businessType:type,reportDate:date(row.reportDate),total,pod,ocCurrent,sameDayPod,podRate:pct(pod,total)??0,ocRate:pct(ocCurrent,total)??0,sameDayPodRate:pct(sameDayPod,total)??0,ready,ledgerReady:ready,evidenceIncomplete:!ready,source:String(row.source||'V334_GENERIC_HISTORY_CACHE'),updatedAt:String(row.updatedAt||'')};
}

export function writeV334GenericHistoryCache(businessType='',rows=[],db=getDb(),source='V334_GENERIC_HISTORY_WORKER'){
  const type=String(businessType||'').toUpperCase();if(!TYPES.has(type))throw new Error('V334通用历史缓存仅支持CE/CEAF/ALI1688/WHPP/ALL');ensureV334GenericHistoryCache(db);const now=new Date().toISOString(),stmt=db.prepare(`INSERT INTO v334_generic_history_cache(businessType,reportDate,total,pod,ocCurrent,sameDayPod,ready,source,updatedAt) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET total=excluded.total,pod=excluded.pod,ocCurrent=excluded.ocCurrent,sameDayPod=excluded.sameDayPod,ready=excluded.ready,source=excluded.source,updatedAt=excluded.updatedAt`);db.exec('BEGIN IMMEDIATE');try{for(const row of rows){const d=date(row.reportDate);if(!d||n(row.total)<=0)continue;stmt.run(type,d,n(row.total),n(row.pod),n(row.ocCurrent),n(row.sameDayPod),row.ready===false?0:1,source,now);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return{ok:true,id:V334_GENERIC_HISTORY_CACHE_ID,businessType:type,rowCount:rows.filter(r=>n(r.total)>0).length,updatedAt:now};
}

export function readV334GenericHistoryCache(businessType='',toDate='',db=getDb(),fromDate=''){
  const type=String(businessType||'').toUpperCase(),to=date(toDate),from=date(fromDate);if(!TYPES.has(type))throw new Error('V334通用历史缓存业务板块无效');if(!to)throw new Error('V334通用历史缓存日期无效');ensureV334GenericHistoryCache(db);let rows=[];try{rows=from?db.prepare('SELECT * FROM v334_generic_history_cache WHERE businessType=? AND reportDate BETWEEN ? AND ? AND total>0 ORDER BY reportDate').all(type,from,to):db.prepare('SELECT * FROM v334_generic_history_cache WHERE businessType=? AND reportDate<=? AND total>0 ORDER BY reportDate').all(type,to);}catch{}const daily=rows.map(row=>finish(type,row)),dates=daily.map(row=>row.reportDate);return{ok:true,id:V334_GENERIC_HISTORY_CACHE_ID,businessType:type,requestedFromDate:from||to,requestedToDate:to,fromDate:dates[0]||from||to,toDate:dates.at(-1)||to,dates,daily,historyExpanded:true,availableDayCount:dates.length,evidenceIncomplete:daily.some(row=>row.evidenceIncomplete),source:rows.length?String(rows[0].source||'V334_GENERIC_HISTORY_CACHE'):'V334_GENERIC_HISTORY_CACHE_EMPTY',definitions:{history:'CE、CEAF、ALI1688、WHPP与首页趋势只读取独立子进程生成的轻量历史缓存；网页线程不扫描历史大表。',selection:'顶部单日日期控制当天指标卡；单日看板的趋势默认展示截至该日已经保存的历史日报日期。'}};}

console.info('[CE-QC][V334_GENERIC_HISTORY_CACHE]',V334_GENERIC_HISTORY_CACHE_ID,'generic board history is persisted as a small read-only web cache; heavy reconstruction belongs to an isolated worker.');