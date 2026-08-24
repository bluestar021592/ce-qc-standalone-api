import { getDb } from './db.js';
import { V284_DAILY_MEMBERSHIP_TRUTH_ID, readV284DailyFacts, summarizeV284Range, invalidateV284DailyMembershipTruth } from './v284DailyMembershipTruth.js';

export const V284_DAILY_MEMBERSHIP_AUDIT_ID='2026-08-24-v284-real-db-0817-0821-membership-audit-v1';
const FROM='2026-08-17';
const TO='2026-08-21';
let running=false;

export function auditV284PriorityRange({db=getDb(),logger=console,reason='MANUAL_AUDIT'}={}){
  if(running)return{ok:false,skipped:true,reason:'AUDIT_ALREADY_RUNNING'};
  running=true;
  const started=Date.now();
  try{
    invalidateV284DailyMembershipTruth();
    const summary=summarizeV284Range(FROM,TO,db);
    const daily=readV284DailyFacts(FROM,TO,db).map(row=>({
      reportDate:row.reportDate,
      businessType:row.businessType,
      total:Number(row.total||0),
      matched:Number(row.matched||0),
      coverageRate:Number(row.coverageRate||0),
      pod:Number(row.pod||0),
      podRate:Number(row.podRate||0),
      oc:Number(row.ocCurrent||0),
      ocRate:Number(row.ocRate||0),
      sameDayPod:Number(row.sameDayPod||0),
      sameDayPodRate:Number(row.sameDayPodRate||0),
      attempt1:Number(row.attempt1||0),
      attempt2:Number(row.attempt2||0),
      attempt3:Number(row.attempt3||0),
      ready:Boolean(row.ready)
    }));
    const result={
      ok:true,id:V284_DAILY_MEMBERSHIP_AUDIT_ID,truthId:V284_DAILY_MEMBERSHIP_TRUTH_ID,reason,
      fromDate:FROM,toDate:TO,sourceTotal:summary.sourceTotal,analyzedTotal:summary.analyzedTotal,
      analysisPending:summary.analysisPending,analysisComplete:summary.analysisComplete,missingDates:summary.missingDates,
      daily,durationMs:Date.now()-started
    };
    logger.info?.('[CE-QC][V284_REAL_DB_AUDIT]',JSON.stringify(result));
    return result;
  }catch(error){
    const result={ok:false,id:V284_DAILY_MEMBERSHIP_AUDIT_ID,reason,error:error?.message||String(error),durationMs:Date.now()-started};
    logger.error?.('[CE-QC][V284_REAL_DB_AUDIT_FAILED]',JSON.stringify(result));
    return result;
  }finally{running=false;}
}

function schedule(){
  if(process.env.NODE_ENV==='test'||process.env.CI)return;
  for(const [delay,reason] of [[20_000,'POST_STARTUP_AFTER_V283_PRIMARY'],[55_000,'POST_EVIDENCE_SEED_AND_V283_RETRY']]){
    const timer=setTimeout(()=>auditV284PriorityRange({reason}),delay);
    timer.unref?.();
  }
}
schedule();
console.info('[CE-QC][V284_AUDIT]',V284_DAILY_MEMBERSHIP_AUDIT_ID,`priority=${FROM}..${TO}`,'read-only per-day total/matched/POD/OC/attempt coverage audit scheduled after V283 repair windows.');
