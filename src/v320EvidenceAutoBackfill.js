import express from 'express';
import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema, applyV246StrictAttemptEvidence } from './v246TrackingLedgerCore.js';

export const V320_EVIDENCE_AUTO_BACKFILL_ID='2026-08-26-v320-terminal-pod-auto-track-backfill-v1';
const CHUNK=50,CONCURRENCY=4,MAX_DAYS=180;
const runtimeEntry=String(process.argv[1]||'');
const REAL_RUNTIME=/(?:^|[\\/])(bootstrap|server)\.js$/i.test(runtimeEntry);
const state={status:'IDLE',phase:'WAITING',total:0,completed:0,queried:0,failed:0,updated:0,unresolved:0,fromDate:'',toDate:'',startedAt:'',updatedAt:'',completedAt:'',message:''};
const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const chunks=(values,size=CHUNK)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
function setState(patch){Object.assign(state,patch,{updatedAt:nowIso()});}
function isoMinusDays(date,days){const t=Date.parse(`${date}T00:00:00Z`);return Number.isFinite(t)?new Date(t-days*86400000).toISOString().slice(0,10):date;}
function historicalRange(db){ensureV246TrackingSchema(db);const row=db.prepare(`SELECT MIN(firstReportDate) minDate,MAX(lastImportedDate) maxDate FROM qc_tracking_ledger WHERE businessType IN ('SHOPEECN','SHOPEEVN')`).get()||{};const to=dateKey(row.maxDate),min=dateKey(row.minDate);if(!to)return null;const floor=isoMinusDays(to,MAX_DAYS-1),from=min&&min>floor?min:floor;return{fromDate:from,toDate:to};}
function processingBusy(db){try{if(db.prepare("SELECT 1 FROM run_locks WHERE status IN ('running','paused') LIMIT 1").get())return true;}catch{}try{if(db.prepare("SELECT 1 FROM business_run_locks WHERE status IN ('running','paused') LIMIT 1").get())return true;}catch{}return false;}
function localBackfillFromLedger(db,range){
  let updated=0;const rows=db.prepare(`SELECT shipmentCode,businessType,attemptNo,evidenceJson,lastCheckedAt FROM qc_tracking_ledger WHERE terminalReason='POD' AND businessType IN ('SHOPEECN','SHOPEEVN') AND firstReportDate<=? AND lastImportedDate>=? AND attemptNo>0 AND TRIM(COALESCE(json_extract(evidenceJson,'$.starts[0].time'),''))<>''`).all(range.toDate,range.fromDate);
  const stmt=db.prepare(`UPDATE business_final_rows SET
    firstAttemptAt=CASE WHEN TRIM(COALESCE(firstAttemptAt,''))='' THEN ? ELSE firstAttemptAt END,
    podAttemptNo=CASE WHEN COALESCE(isPod,0)=1 AND ? > 0 THEN ? ELSE podAttemptNo END,
    currentAttemptNo=CASE WHEN ? > 0 THEN ? ELSE currentAttemptNo END,
    attemptStatus=CASE WHEN ? > 0 THEN 'V320_STRICT_TRACK_BACKFILL' ELSE attemptStatus END,
    attemptConfidence=CASE WHEN ? > 0 THEN 'HIGH' ELSE attemptConfidence END,
    attemptUnknownReason=CASE WHEN ? > 0 THEN '' ELSE attemptUnknownReason END,
    attemptHistoryJson=?,attemptCalculatedAt=?,updatedAt=?
    WHERE UPPER(TRIM(shipmentCode))=? AND (UPPER(TRIM(businessType))='SHOPEE' OR UPPER(TRIM(businessType))=?)`);
  for(const row of rows){let evidence={};try{evidence=JSON.parse(row.evidenceJson||'{}')||{};}catch{}const start=text(evidence?.starts?.[0]?.time);if(!start)continue;const attempt=Math.max(0,Math.min(3,Number(row.attemptNo||0)));const now=nowIso();const info=JSON.stringify(evidence?.starts||[]);const result=stmt.run(start,attempt,attempt,attempt,attempt,attempt,attempt,attempt,info,now,now,billOf(row.shipmentCode),text(row.businessType).toUpperCase());updated+=Number(result?.changes||0);}
  return updated;
}
function candidates(db,range){
  return db.prepare(`SELECT l.shipmentCode,l.businessType,l.podDate,l.attemptNo,l.evidenceJson FROM qc_tracking_ledger l
    WHERE l.terminalReason='POD' AND l.businessType IN ('SHOPEECN','SHOPEEVN')
      AND l.firstReportDate<=? AND l.lastImportedDate>=?
      AND (COALESCE(l.attemptNo,0)<=0 OR TRIM(COALESCE(json_extract(l.evidenceJson,'$.starts[0].time'),''))='')
    ORDER BY l.firstReportDate,l.shipmentCode`).all(range.toDate,range.fromDate);
}
function eventBill(row={}){return billOf(row.shipmentCode||row.运单号||row.waybill||row.waybillNo||row.billCode||row.trackingNo);}
async function mapLimit(values,limit,worker){let next=0;const result=new Array(values.length);async function run(){while(true){const index=next++;if(index>=values.length)return;result[index]=await worker(values[index],index);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,values.length))},()=>run()));return result;}
function persistFinalEvidence(db,evidenceRows){
  const stmt=db.prepare(`UPDATE business_final_rows SET
    firstAttemptAt=CASE WHEN TRIM(COALESCE(firstAttemptAt,''))='' AND ?<>'' THEN ? ELSE firstAttemptAt END,
    podAttemptNo=CASE WHEN COALESCE(isPod,0)=1 AND ? > 0 THEN ? ELSE podAttemptNo END,
    currentAttemptNo=CASE WHEN ? > 0 THEN ? ELSE currentAttemptNo END,
    attemptStatus=CASE WHEN ? > 0 THEN 'V320_STRICT_TRACK_BACKFILL' ELSE attemptStatus END,
    attemptConfidence=CASE WHEN ? > 0 THEN 'HIGH' ELSE attemptConfidence END,
    attemptUnknownReason=CASE WHEN ? > 0 THEN '' ELSE '轨迹未取得可验证派件START' END,
    attemptHistoryJson=?,attemptCalculatedAt=?,updatedAt=?
    WHERE UPPER(TRIM(shipmentCode))=? AND (UPPER(TRIM(businessType))='SHOPEE' OR UPPER(TRIM(businessType))=?)`);
  let updated=0;const now=nowIso();for(const row of evidenceRows){const start=text(row.starts?.[0]?.time),attempt=Math.max(0,Math.min(3,Number(row.attemptNo||0))),history=JSON.stringify(row.starts||[]);const result=stmt.run(start,start,attempt,attempt,attempt,attempt,attempt,attempt,history,now,now,billOf(row.shipmentCode),text(row.businessType).toUpperCase());updated+=Number(result?.changes||0);}return updated;
}
async function runBackfill(){
  if(state.status==='RUNNING')return state;const db=getDb(),range=historicalRange(db);if(!range){setState({status:'COMPLETED',phase:'DONE',message:'没有需要补核的SHOPEE历史POD。',completedAt:nowIso()});return state;}if(processingBusy(db)){setState({status:'WAITING',phase:'FOREGROUND_BUSY',...range,message:'前台处理正在运行，V320证据补核延后。'});return state;}
  const local=localBackfillFromLedger(db,range),todo=candidates(db,range);setState({status:'RUNNING',phase:'TRACK_BACKFILL',...range,total:todo.length,completed:0,queried:0,failed:0,updated:local,unresolved:todo.length,startedAt:nowIso(),message:todo.length?`开始后台补核 ${todo.length} 票终态POD派件轨迹。`:'已有严格证据已全部写回。'});
  if(!todo.length){setState({status:'COMPLETED',phase:'DONE',unresolved:0,completedAt:nowIso(),message:'终态POD派件证据已完整写回。'});return state;}
  const client=new CEClient(),groups=chunks(todo);let completed=0,queried=0,failed=0,updated=local;const collected=[];
  await mapLimit(groups,CONCURRENCY,async group=>{const bills=group.map(r=>billOf(r.shipmentCode)).filter(Boolean);let events=[];try{events=await client.trackQuery(bills);queried+=bills.length;}catch(error){failed+=bills.length;completed+=group.length;setState({completed,queried,failed,updated,message:`证据补核 ${completed}/${todo.length} · 网络失败 ${failed}票将保留待下次重试`});return;}
    const byBill=new Map();for(const event of events||[]){const bill=eventBill(event);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);}const evidence=[];for(const row of group){const bill=billOf(row.shipmentCode),strict=analyzeV246ShopeeAttemptCycle(byBill.get(bill)||[],{podDate:row.podDate||''});evidence.push({shipmentCode:bill,businessType:row.businessType,attemptNo:strict.attemptNo,source:strict.source,startMode:strict.startMode,starts:strict.starts,failures:strict.failures,podDate:strict.podDate||row.podDate||''});}if(evidence.length){applyV246StrictAttemptEvidence(evidence,{db,reason:'V320_AUTO_TERMINAL_POD_BACKFILL'});updated+=persistFinalEvidence(db,evidence);collected.push(...evidence);}completed+=group.length;setState({completed,queried,failed,updated,message:`证据补核 ${completed}/${todo.length} · 已写回 ${updated} 条历史结果`});});
  const unresolved=candidates(db,range).length;setState({status:'COMPLETED',phase:'DONE',completed:todo.length,queried,failed,updated,unresolved,completedAt:nowIso(),message:unresolved?`后台补核完成；仍有 ${unresolved} 票没有取得真实派件START，保持未知，不伪造天数。`:'后台补核完成：可取得的终态POD真实派件START均已写回。'});return state;
}

let scheduled=false;function scheduleAfterListening(server){if(!REAL_RUNTIME||scheduled||!server)return;scheduled=true;const activate=()=>{const timer=setTimeout(async function attempt(){try{const result=await runBackfill();console.log('[CE-QC][V320_EVIDENCE_AUTO_BACKFILL]',JSON.stringify({...result,id:V320_EVIDENCE_AUTO_BACKFILL_ID}));if(result.status==='WAITING'){const retry=setTimeout(attempt,60_000);retry.unref?.();}}catch(error){setState({status:'FAILED',phase:'FAILED',message:error?.message||String(error)});console.error('[CE-QC][V320_EVIDENCE_AUTO_BACKFILL_FAILED]',error?.stack||error);}},8000);timer.unref?.();};if(server.listening)activate();else server.once('listening',activate);}
const previousListen=express.application.listen;express.application.listen=function v320EvidenceBackfillListen(...args){const server=previousListen.apply(this,args);scheduleAfterListening(server);return server;};
export function inspectV320EvidenceBackfill(){return{id:V320_EVIDENCE_AUTO_BACKFILL_ID,...state};}
export async function runV320EvidenceBackfillNow(){return runBackfill();}

console.info('[CE-QC][V320_EVIDENCE_AUTO_BACKFILL_READY]',V320_EVIDENCE_AUTO_BACKFILL_ID,REAL_RUNTIME?'real runtime will backfill missing terminal-POD dispatch evidence after listen':'smoke/test process: network backfill disabled');
