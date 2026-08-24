import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import { activeBusinessProcessingDetails, cambodiaClock, loadOpenCarryRows, processCarryFamilyForRefresh, applySuccessfulCarryRefresh } from './carryoverRefreshScheduler.js';
import { reconcileV246TrackingLedger } from './v246TrackingLedgerCore.js';
import { invalidateV284DailyMembershipTruth } from './v284DailyMembershipTruth.js';
import { readV284EvidenceCoverage } from './v284MembershipEvidenceCoverage.js';
import { auditV284PriorityRange } from './v284DailyMembershipAudit.js';

export const V284_PRIORITY_UNPROVEN_REFRESH_ID='2026-08-24-v286-seven-business-priority-unproven-refresh-v1';
const FROM='2026-08-17',TO='2026-08-21',MAX_TARGETS=100;
const CCSL=new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);
let running=false;

export async function refreshV284PriorityUnproven({db=getDb(),client=new CEClient(),logger=console,reason='V284_PRIORITY_UNPROVEN'}={}){
  if(running)return{ok:true,skipped:true,reason:'ALREADY_RUNNING'};
  const blockers=activeBusinessProcessingDetails(db);if(blockers.active)return{ok:true,skipped:true,reason:'FOREGROUND_PROCESSING_ACTIVE',blockers:blockers.blockers?.slice(0,3)||[]};
  const before=readV284EvidenceCoverage(FROM,TO,db);const targets=before.unproven;
  if(!targets.length)return{ok:true,skipped:true,reason:'NO_UNPROVEN_MEMBERS'};
  if(targets.length>MAX_TARGETS){const result={ok:true,skipped:true,reason:'UNPROVEN_OVER_SAFETY_LIMIT',count:targets.length,max:MAX_TARGETS,samples:targets.slice(0,20)};logger.warn?.('[CE-QC][V284_PRIORITY_REFRESH_SKIPPED]',JSON.stringify(result));return result;}
  running=true;const started=Date.now();
  try{
    const selection={businessType:'ALL',fromDate:FROM,toDate:TO,days:5};
    const admission=reconcileV246TrackingLedger(selection,{db,reason:`${reason}:ADMISSION`});
    const targetSet=new Set(targets.map(row=>String(row.shipmentCode||'').toUpperCase()));
    const open=loadOpenCarryRows(db).filter(row=>targetSet.has(String(row.shipmentCode||'').toUpperCase()));
    const clock=cambodiaClock(),refreshId=`V284-PRIORITY-${clock.date}-${Date.now()}`;
    const groups=[
      ['CCSL',open.filter(row=>CCSL.has(String(row.businessType||'').toUpperCase()))],
      ['SHOPEE',open.filter(row=>SHOPEE.has(String(row.businessType||'').toUpperCase()))],
      ['WHPP',open.filter(row=>String(row.businessType||'').toUpperCase()==='WHPP')]
    ];
    const outcomes=[];
    for(const [family,rows] of groups){if(!rows.length)continue;outcomes.push({family,...await processCarryFamilyForRefresh(family,rows,{client,reportDate:clock.date,refreshId:`${refreshId}-${family}`})});}
    const successfulRows=outcomes.flatMap(row=>row.successfulRows||[]),failedBills=[...new Set(outcomes.flatMap(row=>row.failedBills||[]))];
    if(successfulRows.length)applySuccessfulCarryRefresh(successfulRows,{snapshotId:refreshId,reportDate:clock.date});
    const finalRepair=reconcileV246TrackingLedger(selection,{db,reason:`${reason}:POST_TARGET_REFRESH`});
    invalidateV284DailyMembershipTruth();
    const after=readV284EvidenceCoverage(FROM,TO,db);
    const result={ok:true,id:V284_PRIORITY_UNPROVEN_REFRESH_ID,reason,targeted:targets.length,openTargets:open.length,refreshed:successfulRows.length,failed:failedBills.length,remainingUnproven:after.unproven.length,failedSamples:failedBills.slice(0,20),admissionRepaired:admission.repaired,finalRepair:finalRepair.repaired,durationMs:Date.now()-started};
    logger.info?.('[CE-QC][V284_PRIORITY_REFRESH_DONE]',JSON.stringify(result));
    auditV284PriorityRange({db,logger,reason:'POST_V284_TARGET_REFRESH'});
    return result;
  }catch(error){const result={ok:false,id:V284_PRIORITY_UNPROVEN_REFRESH_ID,reason,error:error?.message||String(error),durationMs:Date.now()-started};logger.error?.('[CE-QC][V284_PRIORITY_REFRESH_FAILED]',JSON.stringify(result));return result;}
  finally{running=false;}
}

function schedule(){if(process.env.NODE_ENV==='test'||process.env.CI)return;const timer=setTimeout(()=>refreshV284PriorityUnproven().catch(error=>console.error('[CE-QC][V284_PRIORITY_REFRESH_FAILED]',error?.message||error)),70_000);timer.unref?.();}
schedule();
console.info('[CE-QC][V284_PRIORITY_REFRESH]',V284_PRIORITY_UNPROVEN_REFRESH_ID,`priority=${FROM}..${TO}`,`maxTargets=${MAX_TARGETS}`,'small proven-evidence gaps across all seven businesses use the existing CCSL/SHOPEE/WHPP carry pipelines; failures remain unproven.');
