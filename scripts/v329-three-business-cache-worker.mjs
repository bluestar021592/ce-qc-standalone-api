import { getDb,closeDb,nowIso } from '../src/db.js';
import { analyzeV246ShopeeAttemptCycle } from '../src/shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema, applyV246StrictAttemptEvidence } from '../src/v246TrackingLedgerCore.js';
import { readV328ThreeBusinessHistory,listV328HistoricalMembers,clearV328ThreeBusinessHistoryCache,V328_ATTEMPT_TYPES } from '../src/v328ThreeBusinessHistoryFast.js';
import { writeV329ThreeBusinessDailyCache } from '../src/v329ThreeBusinessDailyCache.js';
import { resolveShopeeHistoricalRegions, resolveShopeeSigningSamples } from '../src/shopeeHistoricalSigningTruth.js';

export const THREE_BUSINESS_HISTORY_WORKER_ID='2026-09-02-single-process-three-business-history-worker-v1';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i>0?[v.slice(0,i).replace(/^--/,''),v.slice(i+1)]:[v.replace(/^--/,''),'1'];}));
const type=String(args.type||'').toUpperCase(),to=String(args.to||'').slice(0,10),TYPE_SET=new Set(V328_ATTEMPT_TYPES),SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);
const ALLOW_NETWORK_REPAIR=String(process.env.CE_QC_HISTORY_NETWORK_REPAIR||'')==='1';
const text=v=>String(v??'').trim(),bill=v=>text(v).toUpperCase(),date=v=>{const s=text(v).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const safeJson=(v,fallback={})=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||''))||fallback);}catch{return fallback;}};
const send=p=>{try{process.send?.({kind:'V328_EVIDENCE_PROGRESS',type,...p});}catch{}};
const chunks=(a,n=300)=>{const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out;};
const inclusive=(a,b)=>{a=date(a);b=date(b);if(!a||!b)return 0;const x=Date.parse(`${a}T00:00:00Z`),y=Date.parse(`${b}T00:00:00Z`);return Number.isFinite(x)&&Number.isFinite(y)&&y>=x?Math.floor((y-x)/86400000)+1:0;};
const strict=v=>/^V246_STRICT_TRACK/i.test(text(v));
const strictStored=row=>strict(row.attemptSource)||/STRICT|V320|V328/i.test(text(row.attemptStatus))||text(row.attemptConfidence).toUpperCase()==='HIGH';
const eventBill=row=>bill(row?.shipmentCode||row?.运单号||row?.waybill||row?.waybillNo||row?.billCode||row?.trackingNo);
async function mapLimit(values,limit,worker){let next=0;async function run(){while(true){const i=next++;if(i>=values.length)return;await worker(values[i],i);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,values.length))},run));}

function ledgerMap(db,bills){
  const out=new Map();
  for(const part of chunks(bills)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    try{for(const r of db.prepare(`SELECT shipmentCode,firstReportDate,podDate,signingDays,attemptNo,attemptSource,terminalReason FROM qc_tracking_ledger WHERE businessType=? AND shipmentCode IN (${marks})`).all(type,...part))out.set(bill(r.shipmentCode),r);}catch{}
  }
  return out;
}
function oldAttemptMap(db,from,toDate){const out=new Map();try{for(const r of db.prepare(`SELECT reportDate,attempt1,attempt2,attempt3 FROM v328_attempt_daily_cache WHERE businessType=? AND reportDate BETWEEN ? AND ?`).all(type,from,toDate))out.set(date(r.reportDate),[Number(r.attempt1||0),Number(r.attempt2||0),Number(r.attempt3||0)]);}catch{}return out;}
function bestAttempts(base,ledger,old,pod){const choices=[base,ledger,old].map(v=>(v||[0,0,0]).map(x=>Math.max(0,Number(x||0)))).filter(v=>v.reduce((a,b)=>a+b,0)<=Math.max(0,pod));choices.sort((a,b)=>b.reduce((x,y)=>x+y,0)-a.reduce((x,y)=>x+y,0));return choices[0]||[0,0,0];}

function buildRows(db,baseline,members){
  const useful=(baseline.daily||[]).filter(r=>Number(r.total||0)>0),dates=new Map(useful.map(r=>[date(r.reportDate),r])),firstByBill=new Map(),membersByDate=new Map();
  for(const m of members){const b=bill(m.shipmentCode),d=date(m.reportDate);if(!b||!d||!dates.has(d))continue;if(!firstByBill.has(b)||d<firstByBill.get(b))firstByBill.set(b,d);if(!membersByDate.has(d))membersByDate.set(d,[]);membersByDate.get(d).push(b);}
  const from=baseline.fromDate||useful[0]?.reportDate||to,end=baseline.toDate||to,regions=SHOPEE.has(type)?resolveShopeeHistoricalRegions(db,type,from,end):new Map(),signing=SHOPEE.has(type)?resolveShopeeSigningSamples(db,type,from,end,members):new Map(),led=ledgerMap(db,[...firstByBill.keys()]),old=oldAttemptMap(db,from,end),out=[];
  for(const row of useful){
    const d=date(row.reportDate),acc={a1:0,a2:0,a3:0,sum:0,count:0,ppSum:0,ppCount:0,pvSum:0,pvCount:0,firstEligible:0,firstSuccess:0,strictPodKnown:0};
    for(const b of membersByDate.get(d)||[]){
      const l=led.get(b)||{},strictAttempt=strict(l.attemptSource)&&Number(l.attemptNo||0)>0;
      if(strictAttempt)acc.firstEligible++;
      let days=0;
      if(SHOPEE.has(type))days=Number(signing.get(`${d}|${b}`)||0);
      else if(text(l.terminalReason)==='POD'){
        const p=date(l.podDate),start=date(l.firstReportDate)||firstByBill.get(b)||d;
        days=Number(l.signingDays||0)>0?Number(l.signingDays):inclusive(start,p);
      }
      if(days>0){
        acc.sum+=days;acc.count++;
        const region=regions.get(`${d}|${b}`)||'UNKNOWN';
        if(region==='PP'){acc.ppSum+=days;acc.ppCount++;}else if(region==='PV'){acc.pvSum+=days;acc.pvCount++;}
      }
      if(text(l.terminalReason)==='POD'&&strictAttempt){
        acc.strictPodKnown++;
        const a=Number(l.attemptNo||0);
        if(a===1){acc.a1++;acc.firstSuccess++;}else if(a===2)acc.a2++;else if(a>=3)acc.a3++;
      }
    }
    const pod=Number(row.pod||0),attempts=bestAttempts([row.attempt1,row.attempt2,row.attempt3],[acc.a1,acc.a2,acc.a3],old.get(d),pod),firstAttemptUnknownPod=Math.max(0,pod-acc.strictPodKnown);
    const baselineCount=Number(row.signingDaysCount||row.dispatchSigningDaysCount||0),baselineSum=Number(row.signingDaysSum||row.dispatchSigningDaysSum||0),useBaseline=!SHOPEE.has(type)&&baselineCount>acc.count&&baselineSum>0;
    out.push({reportDate:d,total:Number(row.total||0),pod,ocCurrent:Number(row.ocCurrent||0),sameDayPod:Number(row.sameDayPod||0),attempt1:attempts[0],attempt2:attempts[1],attempt3:attempts[2],signingDaysSum:useBaseline?baselineSum:acc.sum,signingDaysCount:useBaseline?baselineCount:acc.count,ppSigningDaysSum:acc.ppSum,ppSigningDaysCount:acc.ppCount,pvSigningDaysSum:acc.pvSum,pvSigningDaysCount:acc.pvCount,firstAttemptEligible:acc.firstEligible,firstAttemptSuccess:acc.firstSuccess,firstAttemptUnknownPod,ready:row.ready!==false});
  }
  return out;
}

function evidenceOf(row={}){
  const evidence=safeJson(row.evidenceJson,{}),raw=safeJson(row.rawJson,{}),history=safeJson(row.attemptHistoryJson,[]),starts=Array.isArray(history)?history:(Array.isArray(history?.starts)?history.starts:[]),storedStrict=strictStored(row);
  const start=text(evidence?.starts?.[0]?.time||(storedStrict?row.firstAttemptAt:'')||(storedStrict?starts?.[0]?.time:'')||raw.strictFirstAttemptAt||''),terminalPodAt=Number(row.isPod||0)===1?row.latestEventTime:'',podDate=date(row.ledgerPodDate||row.podDate||row.podTime||raw.POD时间||raw.podTime||raw.签收时间||terminalPodAt||''),ledgerNo=strict(row.attemptSource)?Number(row.ledgerAttemptNo||row.attemptNo||0):0,explicit=storedStrict?Number(row.podAttemptNo||row.currentAttemptNo||0):0;
  return{attemptNo:Math.max(0,Math.min(3,ledgerNo||explicit||0)),start,podDate};
}
function memberDatesByBill(members=[]){const map=new Map();for(const row of members){const b=bill(row.shipmentCode),d=date(row.reportDate);if(!b||!d)continue;if(!map.has(b))map.set(b,new Set());map.get(b).add(d);}return map;}
function putCandidate(out,b,d,patch={}){b=bill(b);d=date(d);if(!b||!d)return;const key=`${d}|${b}`,old=out.get(key)||{shipmentCode:b,reportDate:d};out.set(key,{...old,...patch,shipmentCode:b,reportDate:d});}
function knownPodCandidates(db,members,from,toDate){
  ensureV246TrackingSchema(db);
  const out=new Map(),datesByBill=memberDatesByBill(members),allBills=[...datesByBill.keys()];
  for(const bills of chunks(allBills,200)){
    const marks=bills.map(()=>'?').join(',');if(!marks)continue;
    if(SHOPEE.has(type)){
      try{for(const r of db.prepare(`SELECT f.shipmentCode,f.reportDate,f.isPod,f.rawJson,f.latestEventTime,f.firstAttemptAt,f.podAttemptNo,f.currentAttemptNo,f.attemptStatus,f.attemptConfidence,f.attemptHistoryJson,l.terminalReason,l.podDate ledgerPodDate,l.attemptNo ledgerAttemptNo,l.attemptSource,l.evidenceJson FROM business_final_rows f LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=f.shipmentCode AND l.businessType=? WHERE f.businessType IN ('SHOPEE',?) AND f.reportDate BETWEEN ? AND ? AND f.shipmentCode IN (${marks})`).all(type,type,from,toDate,...bills)){if(Number(r.isPod||0)!==1&&text(r.terminalReason)!=='POD')continue;putCandidate(out,r.shipmentCode,r.reportDate,r);}}catch{}
      try{for(const r of db.prepare(`SELECT shipmentCode,podTime FROM business_pod_locks WHERE businessType IN ('SHOPEE',?) AND shipmentCode IN (${marks})`).all(type,...bills)){for(const d of datesByBill.get(bill(r.shipmentCode))||[])putCandidate(out,r.shipmentCode,d,{isPod:1,podTime:r.podTime||''});}}catch{}
    }else{
      try{for(const r of db.prepare(`SELECT f.shipmentCode,f.reportDate,f.isPod,f.rawJson,l.terminalReason,l.podDate ledgerPodDate,l.attemptNo ledgerAttemptNo,l.attemptSource,l.evidenceJson FROM final_rows f LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=f.shipmentCode AND l.businessType='TBKH' WHERE f.reportDate BETWEEN ? AND ? AND f.shipmentCode IN (${marks})`).all(from,toDate,...bills)){if(Number(r.isPod||0)!==1&&text(r.terminalReason)!=='POD')continue;putCandidate(out,r.shipmentCode,r.reportDate,r);}}catch{}
      try{for(const r of db.prepare(`SELECT shipmentCode,podTime FROM pod_locks WHERE shipmentCode IN (${marks})`).all(...bills)){for(const d of datesByBill.get(bill(r.shipmentCode))||[])putCandidate(out,r.shipmentCode,d,{isPod:1,podTime:r.podTime||''});}}catch{}
    }
    try{for(const r of db.prepare(`SELECT shipmentCode,podDate,attemptNo ledgerAttemptNo,attemptSource,evidenceJson FROM qc_tracking_ledger WHERE businessType=? AND terminalReason='POD' AND shipmentCode IN (${marks})`).all(type,...bills)){for(const d of datesByBill.get(bill(r.shipmentCode))||[])putCandidate(out,r.shipmentCode,d,{isPod:1,ledgerPodDate:r.podDate||'',ledgerAttemptNo:r.ledgerAttemptNo||0,attemptSource:r.attemptSource||'',evidenceJson:r.evidenceJson||'{}'});}}catch{}
  }
  return out;
}
function addDiscoveryCandidates(candidates,members,baseline){
  const expected=new Map((baseline.daily||[]).map(r=>[date(r.reportDate),Number(r.pod||0)])),known=new Map();for(const row of candidates.values())known.set(row.reportDate,(known.get(row.reportDate)||0)+1);
  const missingDays=new Set([...expected].filter(([d,pod])=>pod>(known.get(d)||0)).map(([d])=>d));if(!missingDays.size)return;
  for(const row of members){const d=date(row.reportDate),b=bill(row.shipmentCode);if(!missingDays.has(d)||!b)continue;const key=`${d}|${b}`;if(!candidates.has(key))candidates.set(key,{shipmentCode:b,reportDate:d,discoverPod:true});}
}
function savedEvents(db,bills,from,toDate){
  const result=new Map(bills.map(b=>[b,[]]));
  for(const part of chunks(bills,180)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    if(type==='TBKH'){
      try{for(const r of db.prepare(`SELECT shipmentCode,eventTime,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,rawJson,id FROM track_events WHERE shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part)){const b=eventBill(r);if(result.has(b))result.get(b).push(r);}}catch{}
      try{for(const r of db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events WHERE businessType='TBKH' AND reportDate BETWEEN ? AND ? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(from,toDate,...part)){const b=eventBill(r);if(result.has(b))result.get(b).push(r);}}catch{}
    }else for(const owner of ['SHOPEE',type]){try{for(const r of db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events WHERE businessType=? AND reportDate BETWEEN ? AND ? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(owner,from,toDate,...part)){const b=eventBill(r);if(result.has(b))result.get(b).push(r);}}catch{}}
  }
  return result;
}
function ensureLegacyAttemptCache(db){db.exec(`CREATE TABLE IF NOT EXISTS v328_attempt_daily_cache(businessType TEXT NOT NULL,reportDate TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0,pod INTEGER NOT NULL DEFAULT 0,attempt1 INTEGER NOT NULL DEFAULT 0,attempt2 INTEGER NOT NULL DEFAULT 0,attempt3 INTEGER NOT NULL DEFAULT 0,signingDaysSum REAL NOT NULL DEFAULT 0,signingDaysCount INTEGER NOT NULL DEFAULT 0,unknownEvidence INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT '',updatedAt TEXT NOT NULL,PRIMARY KEY(businessType,reportDate));CREATE INDEX IF NOT EXISTS idx_v328_attempt_cache_date ON v328_attempt_daily_cache(reportDate,businessType);`);}
function upsertPodLedger(db,row,evidence={}){
  ensureV246TrackingSchema(db);const now=nowIso(),b=bill(row.shipmentCode),d=date(row.reportDate),pod=date(evidence.podDate||evidenceOf(row).podDate);if(!b||!d)return;
  db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt) VALUES(?,?,?,?,?,'','FINAL','POD','','POD','POD','',?,?,?,NULL,?,'{}',?,'V329_HISTORY_POD_REPAIR',?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,firstReportDate=CASE WHEN excluded.firstReportDate<qc_tracking_ledger.firstReportDate THEN excluded.firstReportDate ELSE qc_tracking_ledger.firstReportDate END,lastImportedDate=CASE WHEN excluded.lastImportedDate>qc_tracking_ledger.lastImportedDate THEN excluded.lastImportedDate ELSE qc_tracking_ledger.lastImportedDate END,trackingStatus='FINAL',terminalReason='POD',currentState='POD',podDate=CASE WHEN excluded.podDate<>'' THEN excluded.podDate ELSE qc_tracking_ledger.podDate END,attemptNo=CASE WHEN excluded.attemptNo>0 THEN excluded.attemptNo ELSE qc_tracking_ledger.attemptNo END,attemptSource=CASE WHEN excluded.attemptNo>0 THEN excluded.attemptSource ELSE qc_tracking_ledger.attemptSource END,evidenceJson=CASE WHEN excluded.attemptNo>0 THEN excluded.evidenceJson ELSE qc_tracking_ledger.evidenceJson END,lastCheckedAt=excluded.lastCheckedAt,lastRepairReason=excluded.lastRepairReason,updatedAt=excluded.updatedAt`).run(b,type,d,d,'V329_HISTORY',pod,Number(evidence.attemptNo||0),text(evidence.source||''),JSON.stringify({starts:evidence.starts||[],failures:evidence.failures||[]}),now,now,now);
}
function persistShopeeFinal(db,evidenceRows){if(!SHOPEE.has(type)||!evidenceRows.length)return 0;const now=nowIso(),stmt=db.prepare(`UPDATE business_final_rows SET firstAttemptAt=CASE WHEN TRIM(COALESCE(firstAttemptAt,''))='' AND ?<>'' THEN ? ELSE firstAttemptAt END,podAttemptNo=CASE WHEN COALESCE(isPod,0)=1 AND ?>0 THEN ? ELSE podAttemptNo END,currentAttemptNo=CASE WHEN ?>0 THEN ? ELSE currentAttemptNo END,attemptStatus=CASE WHEN ?>0 THEN 'V329_STRICT_TRACK_BACKFILL' ELSE attemptStatus END,attemptConfidence=CASE WHEN ?>0 THEN 'HIGH' ELSE attemptConfidence END,attemptUnknownReason=CASE WHEN ?>0 THEN '' ELSE attemptUnknownReason END,attemptHistoryJson=?,attemptCalculatedAt=?,updatedAt=? WHERE shipmentCode=? AND businessType IN ('SHOPEE',?)`);let updated=0;for(const e of evidenceRows){const start=text(e.starts?.[0]?.time),a=Math.max(0,Math.min(3,Number(e.attemptNo||0)));updated+=Number(stmt.run(start,start,a,a,a,a,a,a,a,JSON.stringify(e.starts||[]),now,now,bill(e.shipmentCode),type)?.changes||0);}return updated;}
function writeLegacyAttemptCache(db,baseline,evidenceByKey,source){
  ensureLegacyAttemptCache(db);const byDay=new Map();for(const [key,e] of evidenceByKey){const d=key.slice(0,10);if(!byDay.has(d))byDay.set(d,{attempt1:0,attempt2:0,attempt3:0,sum:0,count:0});const x=byDay.get(d),a=Number(e.attemptNo||0);if(a===1)x.attempt1++;else if(a===2)x.attempt2++;else if(a>=3)x.attempt3++;const days=inclusive(e.start,e.podDate);if(days>0){x.sum+=days;x.count++;}}
  const stmt=db.prepare(`INSERT INTO v328_attempt_daily_cache(businessType,reportDate,total,pod,attempt1,attempt2,attempt3,signingDaysSum,signingDaysCount,unknownEvidence,source,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET total=excluded.total,pod=excluded.pod,attempt1=excluded.attempt1,attempt2=excluded.attempt2,attempt3=excluded.attempt3,signingDaysSum=excluded.signingDaysSum,signingDaysCount=excluded.signingDaysCount,unknownEvidence=excluded.unknownEvidence,source=excluded.source,updatedAt=excluded.updatedAt`),now=nowIso();for(const row of baseline.daily||[]){const x=byDay.get(row.reportDate)||{attempt1:0,attempt2:0,attempt3:0,sum:0,count:0},known=x.attempt1+x.attempt2+x.attempt3;stmt.run(type,row.reportDate,Number(row.total||0),Number(row.pod||0),x.attempt1,x.attempt2,x.attempt3,x.sum,x.count,Math.max(0,Number(row.pod||0)-known),source,now);}
}
async function optionalNetworkRepair(db,still,evidenceByKey){
  if(!ALLOW_NETWORK_REPAIR||!still.length)return{queried:0,failed:0,networkKnown:0};
  const { CEClient }=await import('../src/ceClient.js');const client=new CEClient(),groups=chunks(still,50);let completed=0,queried=0,failed=0,networkKnown=0;
  await mapLimit(groups,4,async group=>{const bills=group.map(r=>r.shipmentCode),byBill=new Map();let events=[];try{events=await client.trackQuery(bills);queried+=bills.length;}catch{failed+=bills.length;completed+=group.length;send({status:'RUNNING',phase:'EVIDENCE_NETWORK',cacheReady:true,cacheVersion:1,total:still.length,completed,queried,failed,known:evidenceByKey.size,message:`${type} 显式历史轨迹补核 ${completed}/${still.length}`});return;}for(const event of events||[]){const b=eventBill(event);if(!byBill.has(b))byBill.set(b,[]);byBill.get(b).push(event);}const batchStrict=[];for(const row of group){const existing=evidenceOf(row),cycle=analyzeV246ShopeeAttemptCycle(byBill.get(row.shipmentCode)||[],{podDate:existing.podDate||''}),podDate=date(existing.podDate||cycle.podDate);if(!podDate)continue;upsertPodLedger(db,row,{...cycle,podDate});if(cycle.attemptNo<=0||!cycle.starts?.[0]?.time)continue;const e={shipmentCode:row.shipmentCode,businessType:type,reportDate:row.reportDate,attemptNo:cycle.attemptNo,source:cycle.source,starts:cycle.starts,failures:cycle.failures,podDate,start:text(cycle.starts[0].time)};batchStrict.push(e);evidenceByKey.set(`${row.reportDate}|${row.shipmentCode}`,e);networkKnown++;}if(batchStrict.length){applyV246StrictAttemptEvidence(batchStrict,{db,reason:'V329_EXPLICIT_NETWORK_HISTORY_REPAIR'});persistShopeeFinal(db,batchStrict);}completed+=group.length;send({status:'RUNNING',phase:'EVIDENCE_NETWORK',cacheReady:true,cacheVersion:1,total:still.length,completed,queried,failed,known:evidenceByKey.size,message:`${type} 显式历史轨迹补核 ${completed}/${still.length}`});});
  return{queried,failed,networkKnown};
}
async function repairHistoricalEvidence(db,baseline,members){
  const from=baseline.fromDate||baseline.daily?.[0]?.reportDate||to,toDate=baseline.toDate||to,candidates=knownPodCandidates(db,members,from,toDate);addDiscoveryCandidates(candidates,members,baseline);
  const rows=[...candidates.values()],evidenceByKey=new Map(),needSaved=[];send({status:'RUNNING',phase:'EVIDENCE_SAVED',cacheReady:true,cacheVersion:1,fromDate:from,toDate,total:rows.length,completed:0,queried:0,networkRepairEnabled:ALLOW_NETWORK_REPAIR,message:`${type} 在同一历史worker内读取已保存SQLite派次/POD证据`});
  for(const row of rows){const e=evidenceOf(row),key=`${row.reportDate}|${row.shipmentCode}`;if(!row.discoverPod&&e.podDate)upsertPodLedger(db,row,e);if(!row.discoverPod&&e.attemptNo>0&&e.start&&e.podDate)evidenceByKey.set(key,{...e,shipmentCode:row.shipmentCode,reportDate:row.reportDate});else needSaved.push(row);}
  const eventMap=savedEvents(db,[...new Set(needSaved.map(r=>r.shipmentCode))],from,toDate),still=[],savedStrict=[];
  for(const row of needSaved){const existing=evidenceOf(row),cycle=analyzeV246ShopeeAttemptCycle(eventMap.get(row.shipmentCode)||[],{podDate:existing.podDate||''}),podDate=date(existing.podDate||cycle.podDate),isPod=Boolean(podDate);if(isPod)upsertPodLedger(db,row,{...cycle,podDate});if(isPod&&cycle.attemptNo>0&&cycle.starts?.[0]?.time){const e={shipmentCode:row.shipmentCode,businessType:type,reportDate:row.reportDate,attemptNo:cycle.attemptNo,source:cycle.source,starts:cycle.starts,failures:cycle.failures,podDate,start:text(cycle.starts[0].time)};savedStrict.push(e);evidenceByKey.set(`${row.reportDate}|${row.shipmentCode}`,e);}else still.push(row);}
  if(savedStrict.length){applyV246StrictAttemptEvidence(savedStrict,{db,reason:'V329_SAVED_EVENT_HISTORY_REPAIR'});persistShopeeFinal(db,savedStrict);}
  const network=await optionalNetworkRepair(db,still,evidenceByKey);if(!ALLOW_NETWORK_REPAIR&&still.length)send({status:'RUNNING',phase:'EVIDENCE_SAVED_ONLY',cacheReady:true,cacheVersion:1,total:still.length,completed:still.length,queried:0,failed:0,known:evidenceByKey.size,message:`${type} 已保存证据读取完成；${still.length}票缺少历史START/POD证据，保持未知，不自动请求CE接口`});
  writeLegacyAttemptCache(db,baseline,evidenceByKey,ALLOW_NETWORK_REPAIR?'V329_SAVED_PLUS_EXPLICIT_NETWORK_STRICT_TRACK':'V329_SAVED_ONLY_STRICT_TRACK');
  const expectedPod=(baseline.daily||[]).reduce((s,r)=>s+Number(r.pod||0),0),known=evidenceByKey.size;return{code:0,total:expectedPod,known,unresolved:Math.max(0,expectedPod-known),...network};
}

async function main(){
  if(!TYPE_SET.has(type)||!date(to))throw new Error('V329 worker requires --type=TBKH|SHOPEECN|SHOPEEVN and --to=YYYY-MM-DD');
  send({status:'RUNNING',phase:'CACHE_BUILD',cacheReady:false,cacheVersion:0,message:`${type} 正在单一独立进程建立历史缓存`});
  const db=getDb(),baseline=readV328ThreeBusinessHistory(type,to,db),members=listV328HistoricalMembers(type,baseline.fromDate||to,baseline.toDate||to,db),initial=buildRows(db,baseline,members);
  writeV329ThreeBusinessDailyCache(type,initial,db,'V343_BASELINE_PERSISTED_MEMBER_ALIGNED_REGION_SIGNING');
  send({status:'RUNNING',phase:'CACHE_READY',cacheReady:true,cacheVersion:1,total:initial.reduce((s,r)=>s+r.pod,0),completed:0,message:`${type} 历史缓存已就绪；同一worker继续补派次/POD/签收证据`});
  const repair=await repairHistoricalEvidence(db,baseline,members);clearV328ThreeBusinessHistoryCache();
  const finalRows=buildRows(db,baseline,members);writeV329ThreeBusinessDailyCache(type,finalRows,db,'V343_FINAL_SAVED_MEMBER_ALIGNED_STRICT_START_POD_REGION');
  const pod=finalRows.reduce((s,r)=>s+r.pod,0),attemptKnown=finalRows.reduce((s,r)=>s+r.attempt1+r.attempt2+r.attempt3,0),signingKnown=finalRows.reduce((s,r)=>s+r.signingDaysCount,0),firstEligible=finalRows.reduce((s,r)=>s+r.firstAttemptEligible,0),firstSuccess=finalRows.reduce((s,r)=>s+r.firstAttemptSuccess,0),firstUnknownPod=finalRows.reduce((s,r)=>s+r.firstAttemptUnknownPod,0);
  send({status:'COMPLETED',phase:'DONE',cacheReady:true,cacheVersion:2,total:pod,completed:pod,known:attemptKnown,signingKnown,firstEligible,firstSuccess,firstUnknownPod,unresolved:Math.max(0,pod-attemptKnown),signingUnresolved:Math.max(0,pod-signingKnown),queried:repair.queried||0,failed:repair.failed||0,message:`${type} 单一历史worker完成；派次 ${attemptKnown}/${pod}，签收天数 ${signingKnown}/${pod}，首派尝试 ${firstEligible}，首派成功 ${firstSuccess}，严格首派POD证据待补 ${firstUnknownPod}`});
}
try{await main();}catch(error){send({status:'FAILED',phase:'FAILED',cacheReady:false,message:error?.message||String(error)});process.exitCode=1;}finally{try{closeDb();}catch{}}
