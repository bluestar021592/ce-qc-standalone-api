import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb,closeDb } from '../src/db.js';
import { readV328ThreeBusinessHistory,listV328HistoricalMembers,clearV328ThreeBusinessHistoryCache,V328_ATTEMPT_TYPES } from '../src/v328ThreeBusinessHistoryFast.js';
import { writeV329ThreeBusinessDailyCache } from '../src/v329ThreeBusinessDailyCache.js';

const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i>0?[v.slice(0,i).replace(/^--/,''),v.slice(i+1)]:[v.replace(/^--/,''),'1'];}));
const type=String(args.type||'').toUpperCase(),to=String(args.to||'').slice(0,10),TYPE_SET=new Set(V328_ATTEMPT_TYPES),SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);
const text=v=>String(v??'').trim(),bill=v=>text(v).toUpperCase(),date=v=>{const s=text(v).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const send=p=>{try{process.send?.({kind:'V328_EVIDENCE_PROGRESS',type,...p});}catch{}};
const chunks=(a,n=300)=>{const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out;};
const inclusive=(a,b)=>{a=date(a);b=date(b);if(!a||!b)return 0;const x=Date.parse(`${a}T00:00:00Z`),y=Date.parse(`${b}T00:00:00Z`);return Number.isFinite(x)&&Number.isFinite(y)&&y>=x?Math.floor((y-x)/86400000)+1:0;};
const strict=v=>/^V246_STRICT_TRACK/i.test(text(v));
const workerV2=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'v328-three-business-evidence-worker-v2.mjs');

function ledgerMap(db,bills){
  const out=new Map();
  for(const part of chunks(bills)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    try{for(const r of db.prepare(`SELECT shipmentCode,firstReportDate,podDate,signingDays,attemptNo,attemptSource,terminalReason FROM qc_tracking_ledger WHERE businessType=? AND shipmentCode IN (${marks})`).all(type,...part))out.set(bill(r.shipmentCode),r);}catch{}
  }
  return out;
}
function oldAttemptMap(db,from,to){const out=new Map();try{for(const r of db.prepare(`SELECT reportDate,attempt1,attempt2,attempt3 FROM v328_attempt_daily_cache WHERE businessType=? AND reportDate BETWEEN ? AND ?`).all(type,from,to))out.set(date(r.reportDate),[Number(r.attempt1||0),Number(r.attempt2||0),Number(r.attempt3||0)]);}catch{}return out;}
function bestAttempts(base,ledger,old,pod){const choices=[base,ledger,old].map(v=>(v||[0,0,0]).map(x=>Math.max(0,Number(x||0)))).filter(v=>v.reduce((a,b)=>a+b,0)<=Math.max(0,pod));choices.sort((a,b)=>b.reduce((x,y)=>x+y,0)-a.reduce((x,y)=>x+y,0));return choices[0]||[0,0,0];}
function regionMap(db,from,to){
  const out=new Map();if(!SHOPEE.has(type))return out;
  try{
    const rows=db.prepare(`WITH candidates AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId
      FROM unified_import_batches b JOIN unified_import_rows u ON u.snapshotId=b.snapshotId AND u.reportDate=b.reportDate
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ? AND UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>''
      GROUP BY b.reportDate,b.snapshotId,b.createdAt,b.batchId
    ), ranked AS (
      SELECT reportDate,snapshotId,ROW_NUMBER() OVER(PARTITION BY reportDate ORDER BY createdAt DESC,batchId DESC) rn FROM candidates
    ), members AS (
      SELECT r.reportDate,UPPER(TRIM(u.shipmentCode)) shipmentCode,
        CASE WHEN UPPER(TRIM(COALESCE(u.regionCode,'')))='PP' THEN 'PP' WHEN UPPER(TRIM(COALESCE(u.regionCode,'')))='PV' THEN 'PV' ELSE 'UNKNOWN' END regionCode
      FROM ranked r JOIN unified_import_rows u ON u.snapshotId=r.snapshotId AND u.reportDate=r.reportDate
      WHERE r.rn=1 AND UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>''
    ) SELECT reportDate,shipmentCode,
      CASE WHEN SUM(CASE WHEN regionCode='PP' THEN 1 ELSE 0 END)>0 THEN 'PP' WHEN SUM(CASE WHEN regionCode='PV' THEN 1 ELSE 0 END)>0 THEN 'PV' ELSE 'UNKNOWN' END regionCode
      FROM members GROUP BY reportDate,shipmentCode`).all(from,to,type,type);
    for(const r of rows)out.set(`${date(r.reportDate)}|${bill(r.shipmentCode)}`,String(r.regionCode||'UNKNOWN'));
  }catch(error){console.warn('[CE-QC][V329_REGION_MAP_FAILED]',type,error?.message||error);}
  return out;
}

function buildRows(db,baseline,members){
  const useful=(baseline.daily||[]).filter(r=>Number(r.total||0)>0),dates=new Map(useful.map(r=>[date(r.reportDate),r])),firstByBill=new Map(),membersByDate=new Map();
  for(const m of members){const b=bill(m.shipmentCode),d=date(m.reportDate);if(!b||!d||!dates.has(d))continue;if(!firstByBill.has(b)||d<firstByBill.get(b))firstByBill.set(b,d);if(!membersByDate.has(d))membersByDate.set(d,[]);membersByDate.get(d).push(b);}
  const from=baseline.fromDate||useful[0]?.reportDate||to,regions=regionMap(db,from,baseline.toDate||to),led=ledgerMap(db,[...firstByBill.keys()]),old=oldAttemptMap(db,from,baseline.toDate||to),out=[];
  for(const row of useful){
    const d=date(row.reportDate),acc={a1:0,a2:0,a3:0,sum:0,count:0,ppSum:0,ppCount:0,pvSum:0,pvCount:0,firstEligible:0,firstSuccess:0,strictPodKnown:0};
    for(const b of membersByDate.get(d)||[]){
      const l=led.get(b);if(!l)continue;
      const strictAttempt=strict(l.attemptSource)&&Number(l.attemptNo||0)>0;
      if(strictAttempt)acc.firstEligible++;
      if(text(l.terminalReason)==='POD'){
        const p=date(l.podDate),start=date(l.firstReportDate)||firstByBill.get(b)||d,days=Number(l.signingDays||0)>0?Number(l.signingDays):inclusive(start,p);
        if(days>0){
          acc.sum+=days;acc.count++;
          const region=regions.get(`${d}|${b}`)||'UNKNOWN';
          if(region==='PP'){acc.ppSum+=days;acc.ppCount++;}else if(region==='PV'){acc.pvSum+=days;acc.pvCount++;}
        }
        if(strictAttempt){
          acc.strictPodKnown++;
          const a=Number(l.attemptNo||0);
          if(a===1){acc.a1++;acc.firstSuccess++;}else if(a===2)acc.a2++;else if(a>=3)acc.a3++;
        }
      }
    }
    const pod=Number(row.pod||0),attempts=bestAttempts([row.attempt1,row.attempt2,row.attempt3],[acc.a1,acc.a2,acc.a3],old.get(d),pod),firstAttemptUnknownPod=Math.max(0,pod-acc.strictPodKnown);
    out.push({reportDate:d,total:Number(row.total||0),pod,ocCurrent:Number(row.ocCurrent||0),sameDayPod:Number(row.sameDayPod||0),attempt1:attempts[0],attempt2:attempts[1],attempt3:attempts[2],signingDaysSum:acc.sum,signingDaysCount:acc.count,ppSigningDaysSum:acc.ppSum,ppSigningDaysCount:acc.ppCount,pvSigningDaysSum:acc.pvSum,pvSigningDaysCount:acc.pvCount,firstAttemptEligible:acc.firstEligible,firstAttemptSuccess:acc.firstSuccess,firstAttemptUnknownPod,ready:row.ready!==false});
  }
  return out;
}
function runLegacyRepair(){return new Promise(resolve=>{const child=fork(workerV2,[`--type=${type}`,`--to=${to}`],{env:{...process.env,CE_QC_V329_CHILD:'1'},stdio:['ignore','ignore','ignore','ipc']});child.on('message',m=>{if(m?.kind!=='V328_EVIDENCE_PROGRESS')return;send({...m,status:'RUNNING',cacheReady:true,cacheVersion:1,phase:`EVIDENCE_${m.phase||'RUNNING'}`});});child.on('error',e=>resolve({code:1,error:e?.message||String(e)}));child.on('exit',code=>resolve({code:Number(code||0)}));});}

async function main(){
  if(!TYPE_SET.has(type)||!date(to))throw new Error('V329 worker requires --type=TBKH|SHOPEECN|SHOPEEVN and --to=YYYY-MM-DD');
  send({status:'RUNNING',phase:'CACHE_BUILD',cacheReady:false,cacheVersion:0,message:`${type} 正在独立进程建立历史缓存`});
  let db=getDb();const baseline=readV328ThreeBusinessHistory(type,to,db),members=listV328HistoricalMembers(type,baseline.fromDate||to,baseline.toDate||to,db),initial=buildRows(db,baseline,members);
  writeV329ThreeBusinessDailyCache(type,initial,db,'V343_BASELINE_PERSISTED_HISTORY_REGION_SIGNING');
  send({status:'RUNNING',phase:'CACHE_READY',cacheReady:true,cacheVersion:1,total:initial.reduce((s,r)=>s+r.pod,0),completed:0,message:`${type} 历史缓存已就绪，后台继续补派次/POD/签收证据`});
  closeDb();const repair=await runLegacyRepair();db=getDb();clearV328ThreeBusinessHistoryCache();
  const finalRows=buildRows(db,baseline,members);writeV329ThreeBusinessDailyCache(type,finalRows,db,'V343_FINAL_SAVED_MEMBERS_STRICT_START_POD_REGION');
  const pod=finalRows.reduce((s,r)=>s+r.pod,0),attemptKnown=finalRows.reduce((s,r)=>s+r.attempt1+r.attempt2+r.attempt3,0),signingKnown=finalRows.reduce((s,r)=>s+r.signingDaysCount,0),firstEligible=finalRows.reduce((s,r)=>s+r.firstAttemptEligible,0),firstSuccess=finalRows.reduce((s,r)=>s+r.firstAttemptSuccess,0),firstUnknownPod=finalRows.reduce((s,r)=>s+r.firstAttemptUnknownPod,0);
  send({status:repair.code===0?'COMPLETED':'FAILED',phase:repair.code===0?'DONE':'PARTIAL_DONE',cacheReady:true,cacheVersion:2,total:pod,completed:pod,known:attemptKnown,signingKnown,firstEligible,firstSuccess,firstUnknownPod,unresolved:Math.max(0,pod-attemptKnown),signingUnresolved:Math.max(0,pod-signingKnown),message:`${type} 历史缓存完成；派次 ${attemptKnown}/${pod}，签收天数 ${signingKnown}/${pod}，首派尝试 ${firstEligible}，首派成功 ${firstSuccess}，严格首派POD证据待补 ${firstUnknownPod}`});if(repair.code!==0)process.exitCode=1;
}
try{await main();}catch(error){send({status:'FAILED',phase:'FAILED',cacheReady:false,message:error?.message||String(error)});process.exitCode=1;}finally{try{closeDb();}catch{}}
