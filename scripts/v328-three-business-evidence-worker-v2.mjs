import { getDb, closeDb, nowIso } from '../src/db.js';
import { CEClient } from '../src/ceClient.js';
import { analyzeV246ShopeeAttemptCycle } from '../src/shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema, applyV246StrictAttemptEvidence } from '../src/v246TrackingLedgerCore.js';
import { listV328HistoricalDates, listV328HistoricalMembers, readV328ThreeBusinessHistory, V328_ATTEMPT_TYPES } from '../src/v328ThreeBusinessHistoryFast.js';

const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i>0?[v.slice(0,i).replace(/^--/,''),v.slice(i+1)]:[v.replace(/^--/,''),'1'];}));
const type=String(args.type||'').toUpperCase();
const requestedTo=String(args.to||'').slice(0,10);
const TYPE_SET=new Set(V328_ATTEMPT_TYPES);
const SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);
const CHUNK=50,CONCURRENCY=4;
const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const safeJson=(v,fallback={})=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||''))||fallback);}catch{return fallback;}};
const chunks=(values,size=CHUNK)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
const send=payload=>{try{process.send?.({kind:'V328_EVIDENCE_PROGRESS',type,...payload});}catch{}};
const strictSource=v=>/^V246_STRICT_TRACK/i.test(text(v));
const strictStored=row=>strictSource(row.attemptSource)||/STRICT|V320|V328/i.test(text(row.attemptStatus))||text(row.attemptConfidence).toUpperCase()==='HIGH';
const eventBill=row=>billOf(row?.shipmentCode||row?.运单号||row?.waybill||row?.waybillNo||row?.billCode||row?.trackingNo);
const inclusiveDays=(a,b)=>{const x=Date.parse(`${dateKey(a)}T00:00:00Z`),y=Date.parse(`${dateKey(b)}T00:00:00Z`);return Number.isFinite(x)&&Number.isFinite(y)&&y>=x?Math.floor((y-x)/86400000)+1:0;};
async function mapLimit(values,limit,worker){let next=0;async function run(){while(true){const i=next++;if(i>=values.length)return;await worker(values[i],i);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,values.length))},run));}

function evidenceOf(row={}){
  const evidence=safeJson(row.evidenceJson,{}),raw=safeJson(row.rawJson,{}),history=safeJson(row.attemptHistoryJson,[]);
  const starts=Array.isArray(history)?history:(Array.isArray(history?.starts)?history.starts:[]);
  const storedStrict=strictStored(row);
  const start=text(evidence?.starts?.[0]?.time||(storedStrict?row.firstAttemptAt:'')||(storedStrict?starts?.[0]?.time:'')||raw.strictFirstAttemptAt||'');
  const terminalPodAt=Number(row.isPod||0)===1?row.latestEventTime:'';
  const podDate=dateKey(row.ledgerPodDate||row.podDate||row.podTime||raw.POD时间||raw.podTime||raw.签收时间||terminalPodAt||'');
  const ledgerNo=strictSource(row.attemptSource)?Number(row.ledgerAttemptNo||row.attemptNo||0):0;
  const explicit=storedStrict?Number(row.podAttemptNo||row.currentAttemptNo||0):0;
  return{attemptNo:Math.max(0,Math.min(3,ledgerNo||explicit||0)),start,podDate};
}
function memberDatesByBill(members=[]){const map=new Map();for(const row of members){const bill=billOf(row.shipmentCode),date=dateKey(row.reportDate);if(!bill||!date)continue;if(!map.has(bill))map.set(bill,new Set());map.get(bill).add(date);}return map;}
function putCandidate(out,bill,date,patch={}){bill=billOf(bill);date=dateKey(date);if(!bill||!date)return;const key=`${date}|${bill}`,old=out.get(key)||{shipmentCode:bill,reportDate:date};out.set(key,{...old,...patch,shipmentCode:bill,reportDate:date});}

function knownPodCandidates(db,members,from,to){
  ensureV246TrackingSchema(db);
  const out=new Map(),datesByBill=memberDatesByBill(members),allBills=[...datesByBill.keys()];
  for(const bills of chunks(allBills,200)){
    const marks=bills.map(()=>'?').join(',');if(!marks)continue;
    if(SHOPEE.has(type)){
      try{for(const r of db.prepare(`SELECT f.shipmentCode,f.reportDate,f.isPod,f.rawJson,f.latestEventTime,f.firstAttemptAt,f.podAttemptNo,f.currentAttemptNo,f.attemptStatus,f.attemptConfidence,f.attemptHistoryJson,l.terminalReason,l.podDate ledgerPodDate,l.attemptNo ledgerAttemptNo,l.attemptSource,l.evidenceJson FROM business_final_rows f LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=f.shipmentCode AND l.businessType=? WHERE f.businessType IN ('SHOPEE',?) AND f.reportDate BETWEEN ? AND ? AND f.shipmentCode IN (${marks})`).all(type,type,from,to,...bills)){if(Number(r.isPod||0)!==1&&text(r.terminalReason)!=='POD')continue;putCandidate(out,r.shipmentCode,r.reportDate,r);}}catch{}
      try{for(const r of db.prepare(`SELECT shipmentCode,podTime FROM business_pod_locks WHERE businessType IN ('SHOPEE',?) AND shipmentCode IN (${marks})`).all(type,...bills)){for(const d of datesByBill.get(billOf(r.shipmentCode))||[])putCandidate(out,r.shipmentCode,d,{isPod:1,podTime:r.podTime||''});}}catch{}
    }else{
      try{for(const r of db.prepare(`SELECT f.shipmentCode,f.reportDate,f.isPod,f.rawJson,l.terminalReason,l.podDate ledgerPodDate,l.attemptNo ledgerAttemptNo,l.attemptSource,l.evidenceJson FROM final_rows f LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=f.shipmentCode AND l.businessType='TBKH' WHERE f.reportDate BETWEEN ? AND ? AND f.shipmentCode IN (${marks})`).all(from,to,...bills)){if(Number(r.isPod||0)!==1&&text(r.terminalReason)!=='POD')continue;putCandidate(out,r.shipmentCode,r.reportDate,r);}}catch{}
      try{for(const r of db.prepare(`SELECT shipmentCode,podTime FROM pod_locks WHERE shipmentCode IN (${marks})`).all(...bills)){for(const d of datesByBill.get(billOf(r.shipmentCode))||[])putCandidate(out,r.shipmentCode,d,{isPod:1,podTime:r.podTime||''});}}catch{}
    }
    try{for(const r of db.prepare(`SELECT shipmentCode,podDate,attemptNo ledgerAttemptNo,attemptSource,evidenceJson FROM qc_tracking_ledger WHERE businessType=? AND terminalReason='POD' AND shipmentCode IN (${marks})`).all(type,...bills)){for(const d of datesByBill.get(billOf(r.shipmentCode))||[])putCandidate(out,r.shipmentCode,d,{isPod:1,ledgerPodDate:r.podDate||'',ledgerAttemptNo:r.ledgerAttemptNo||0,attemptSource:r.attemptSource||'',evidenceJson:r.evidenceJson||'{}'});}}catch{}
  }
  return out;
}
function addDiscoveryCandidates(candidates,members,baseline){
  const expected=new Map((baseline.daily||[]).map(r=>[dateKey(r.reportDate),Number(r.pod||0)]));
  const known=new Map();for(const row of candidates.values())known.set(row.reportDate,(known.get(row.reportDate)||0)+1);
  const missingDays=new Set([...expected].filter(([d,pod])=>pod>(known.get(d)||0)).map(([d])=>d));
  if(!missingDays.size)return;
  for(const row of members){const d=dateKey(row.reportDate),bill=billOf(row.shipmentCode);if(!missingDays.has(d)||!bill)continue;const key=`${d}|${bill}`;if(!candidates.has(key))candidates.set(key,{shipmentCode:bill,reportDate:d,discoverPod:true});}
}
function savedEvents(db,bills,from,to){
  const result=new Map(bills.map(b=>[b,[]]));
  for(const part of chunks(bills,180)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    if(type==='TBKH'){
      try{for(const r of db.prepare(`SELECT shipmentCode,eventTime,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,rawJson,id FROM track_events WHERE shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part)){const b=eventBill(r);if(result.has(b))result.get(b).push(r);}}catch{}
      try{for(const r of db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events WHERE businessType='TBKH' AND reportDate BETWEEN ? AND ? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(from,to,...part)){const b=eventBill(r);if(result.has(b))result.get(b).push(r);}}catch{}
    }else for(const owner of ['SHOPEE',type]){try{for(const r of db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events WHERE businessType=? AND reportDate BETWEEN ? AND ? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(owner,from,to,...part)){const b=eventBill(r);if(result.has(b))result.get(b).push(r);}}catch{}}
  }
  return result;
}
function ensureDailyCache(db){db.exec(`CREATE TABLE IF NOT EXISTS v328_attempt_daily_cache(businessType TEXT NOT NULL,reportDate TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0,pod INTEGER NOT NULL DEFAULT 0,attempt1 INTEGER NOT NULL DEFAULT 0,attempt2 INTEGER NOT NULL DEFAULT 0,attempt3 INTEGER NOT NULL DEFAULT 0,signingDaysSum REAL NOT NULL DEFAULT 0,signingDaysCount INTEGER NOT NULL DEFAULT 0,unknownEvidence INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT '',updatedAt TEXT NOT NULL,PRIMARY KEY(businessType,reportDate));CREATE INDEX IF NOT EXISTS idx_v328_attempt_cache_date ON v328_attempt_daily_cache(reportDate,businessType);`);}
function upsertPodLedger(db,row,evidence={}){
  ensureV246TrackingSchema(db);const now=nowIso(),bill=billOf(row.shipmentCode),d=dateKey(row.reportDate),pod=dateKey(evidence.podDate||evidenceOf(row).podDate);if(!bill||!d)return;
  db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt) VALUES(?,?,?,?,?,'','FINAL','POD','','POD','POD','',?,?,?,NULL,?,'{}',?,'V328_HISTORY_POD_REPAIR',?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,firstReportDate=CASE WHEN excluded.firstReportDate<qc_tracking_ledger.firstReportDate THEN excluded.firstReportDate ELSE qc_tracking_ledger.firstReportDate END,lastImportedDate=CASE WHEN excluded.lastImportedDate>qc_tracking_ledger.lastImportedDate THEN excluded.lastImportedDate ELSE qc_tracking_ledger.lastImportedDate END,trackingStatus='FINAL',terminalReason='POD',currentState='POD',podDate=CASE WHEN excluded.podDate<>'' THEN excluded.podDate ELSE qc_tracking_ledger.podDate END,attemptNo=CASE WHEN excluded.attemptNo>0 THEN excluded.attemptNo ELSE qc_tracking_ledger.attemptNo END,attemptSource=CASE WHEN excluded.attemptNo>0 THEN excluded.attemptSource ELSE qc_tracking_ledger.attemptSource END,evidenceJson=CASE WHEN excluded.attemptNo>0 THEN excluded.evidenceJson ELSE qc_tracking_ledger.evidenceJson END,lastCheckedAt=excluded.lastCheckedAt,lastRepairReason=excluded.lastRepairReason,updatedAt=excluded.updatedAt`).run(bill,type,d,d,'V328_HISTORY',pod,Number(evidence.attemptNo||0),text(evidence.source||''),JSON.stringify({starts:evidence.starts||[],failures:evidence.failures||[]}),now,now,now);
}
function persistShopeeFinal(db,evidenceRows){if(!SHOPEE.has(type)||!evidenceRows.length)return 0;const now=nowIso(),stmt=db.prepare(`UPDATE business_final_rows SET firstAttemptAt=CASE WHEN TRIM(COALESCE(firstAttemptAt,''))='' AND ?<>'' THEN ? ELSE firstAttemptAt END,podAttemptNo=CASE WHEN COALESCE(isPod,0)=1 AND ?>0 THEN ? ELSE podAttemptNo END,currentAttemptNo=CASE WHEN ?>0 THEN ? ELSE currentAttemptNo END,attemptStatus=CASE WHEN ?>0 THEN 'V328_STRICT_TRACK_BACKFILL' ELSE attemptStatus END,attemptConfidence=CASE WHEN ?>0 THEN 'HIGH' ELSE attemptConfidence END,attemptUnknownReason=CASE WHEN ?>0 THEN '' ELSE attemptUnknownReason END,attemptHistoryJson=?,attemptCalculatedAt=?,updatedAt=? WHERE shipmentCode=? AND businessType IN ('SHOPEE',?)`);let updated=0;for(const e of evidenceRows){const start=text(e.starts?.[0]?.time),a=Math.max(0,Math.min(3,Number(e.attemptNo||0)));updated+=Number(stmt.run(start,start,a,a,a,a,a,a,a,JSON.stringify(e.starts||[]),now,now,billOf(e.shipmentCode),type)?.changes||0);}return updated;}
function writeDailyCache(db,baseline,evidenceByKey){ensureDailyCache(db);const byDay=new Map();for(const [key,e] of evidenceByKey){const d=key.slice(0,10);if(!byDay.has(d))byDay.set(d,{attempt1:0,attempt2:0,attempt3:0,sum:0,count:0});const x=byDay.get(d),a=Number(e.attemptNo||0);if(a===1)x.attempt1++;else if(a===2)x.attempt2++;else if(a>=3)x.attempt3++;const days=inclusiveDays(e.start,e.podDate);if(days>0){x.sum+=days;x.count++;}}
  const stmt=db.prepare(`INSERT INTO v328_attempt_daily_cache(businessType,reportDate,total,pod,attempt1,attempt2,attempt3,signingDaysSum,signingDaysCount,unknownEvidence,source,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET total=excluded.total,pod=excluded.pod,attempt1=excluded.attempt1,pod=excluded.pod,attempt2=excluded.attempt2,attempt3=excluded.attempt3,signingDaysSum=excluded.signingDaysSum,signingDaysCount=excluded.signingDaysCount,unknownEvidence=excluded.unknownEvidence,source=excluded.source,updatedAt=excluded.updatedAt`),now=nowIso();for(const row of baseline.daily||[]){const x=byDay.get(row.reportDate)||{attempt1:0,attempt2:0,attempt3:0,sum:0,count:0},known=x.attempt1+x.attempt2+x.attempt3;stmt.run(type,row.reportDate,Number(row.total||0),Number(row.pod||0),x.attempt1,x.attempt2,x.attempt3,x.sum,x.count,Math.max(0,Number(row.pod||0)-known),'V328_V2_SAVED_PLUS_NETWORK_STRICT_TRACK',now);}}

async function main(){
  if(!TYPE_SET.has(type)||!requestedTo)throw new Error('V328 worker requires --type=TBKH|SHOPEECN|SHOPEEVN and --to=YYYY-MM-DD');
  const db=getDb(),dates=listV328HistoricalDates(type,requestedTo,db);if(!dates.length){send({status:'COMPLETED',phase:'DONE',total:0,completed:0,unresolved:0,message:'无历史日报'});return;}
  const from=dates[0],to=dates.at(-1),members=listV328HistoricalMembers(type,from,to,db),baseline=readV328ThreeBusinessHistory(type,to,db),candidates=knownPodCandidates(db,members,from,to);addDiscoveryCandidates(candidates,members,baseline);
  const rows=[...candidates.values()],evidenceByKey=new Map(),needSaved=[];send({status:'RUNNING',phase:'SAVED_EVIDENCE',fromDate:from,toDate:to,total:rows.length,completed:0,queried:0,message:`${type} 历史派次/签收证据后台校准开始`});
  for(const row of rows){const e=evidenceOf(row),key=`${row.reportDate}|${row.shipmentCode}`;if(!row.discoverPod&&e.podDate)upsertPodLedger(db,row,e);if(!row.discoverPod&&e.attemptNo>0&&e.start&&e.podDate)evidenceByKey.set(key,{...e,shipmentCode:row.shipmentCode,reportDate:row.reportDate});else needSaved.push(row);}
  const eventMap=savedEvents(db,[...new Set(needSaved.map(r=>r.shipmentCode))],from,to),still=[];const savedStrict=[];
  for(const row of needSaved){const existing=evidenceOf(row),strict=analyzeV246ShopeeAttemptCycle(eventMap.get(row.shipmentCode)||[],{podDate:existing.podDate||''}),podDate=dateKey(existing.podDate||strict.podDate),isPod=Boolean(podDate);if(isPod)upsertPodLedger(db,row,{...strict,podDate});if(isPod&&strict.attemptNo>0&&strict.starts?.[0]?.time){const e={shipmentCode:row.shipmentCode,businessType:type,reportDate:row.reportDate,attemptNo:strict.attemptNo,source:strict.source,starts:strict.starts,failures:strict.failures,podDate,start:text(strict.starts[0].time)};savedStrict.push(e);evidenceByKey.set(`${row.reportDate}|${row.shipmentCode}`,e);}else still.push(row);}
  if(savedStrict.length){applyV246StrictAttemptEvidence(savedStrict,{db,reason:'V328_V2_SAVED_EVENT_HISTORY_REPAIR'});persistShopeeFinal(db,savedStrict);}
  const groups=chunks(still,CHUNK);let completed=0,queried=0,failed=0,networkKnown=0;const client=new CEClient();
  await mapLimit(groups,CONCURRENCY,async group=>{const bills=group.map(r=>r.shipmentCode),byBill=new Map();let events=[];try{events=await client.trackQuery(bills);queried+=bills.length;}catch{failed+=bills.length;completed+=group.length;send({status:'RUNNING',phase:'NETWORK_EVIDENCE',total:still.length,completed,queried,failed,known:evidenceByKey.size,message:`${type} 轨迹补核 ${completed}/${still.length}`});return;}for(const event of events||[]){const b=eventBill(event);if(!byBill.has(b))byBill.set(b,[]);byBill.get(b).push(event);}const batchStrict=[];for(const row of group){const existing=evidenceOf(row),strict=analyzeV246ShopeeAttemptCycle(byBill.get(row.shipmentCode)||[],{podDate:existing.podDate||''}),podDate=dateKey(existing.podDate||strict.podDate);if(!podDate)continue;upsertPodLedger(db,row,{...strict,podDate});if(strict.attemptNo<=0||!strict.starts?.[0]?.time)continue;const e={shipmentCode:row.shipmentCode,businessType:type,reportDate:row.reportDate,attemptNo:strict.attemptNo,source:strict.source,starts:strict.starts,failures:strict.failures,podDate,start:text(strict.starts[0].time)};batchStrict.push(e);evidenceByKey.set(`${row.reportDate}|${row.shipmentCode}`,e);networkKnown++;}if(batchStrict.length){applyV246StrictAttemptEvidence(batchStrict,{db,reason:'V328_V2_NETWORK_HISTORY_REPAIR'});persistShopeeFinal(db,batchStrict);}completed+=group.length;send({status:'RUNNING',phase:'NETWORK_EVIDENCE',total:still.length,completed,queried,failed,known:evidenceByKey.size,message:`${type} 轨迹补核 ${completed}/${still.length}`});});
  writeDailyCache(db,baseline,evidenceByKey);const expectedPod=(baseline.daily||[]).reduce((s,r)=>s+Number(r.pod||0),0),known=evidenceByKey.size,unresolved=Math.max(0,expectedPod-known);send({status:'COMPLETED',phase:'DONE',fromDate:from,toDate:to,total:expectedPod,completed:expectedPod,queried,failed,known,unresolved,networkKnown,message:`${type} 历史派次/签收天数校准完成；已取得 ${known}/${expectedPod} 票真实START+POD证据`});
}
try{await main();}catch(error){send({status:'FAILED',phase:'FAILED',message:error?.message||String(error)});process.exitCode=1;}finally{try{closeDb();}catch{}}
