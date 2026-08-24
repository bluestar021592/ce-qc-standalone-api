import { getDb } from './db.js';
import {
  V284_DAILY_MEMBERSHIP_TRUTH_ID,
  readV284DailyFacts,
  readV284DashboardTrends,
  readV284ShopeeTrends,
  summarizeV284Range
} from './v284DailyMembershipTruth.js';

export const V284_EVIDENCE_COVERAGE_ID='2026-08-24-v286-seven-business-proven-coverage-v1';
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const CCSL=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE=['SHOPEECN','SHOPEEVN'];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(v,t)=>t?Number((n(v)*100/n(t)).toFixed(2)):0;
const key=(d,t,r='ALL')=>`${d}|${t}|${r}`;

function proofRows(fromDate,toDate,db=getDb()){
  return db.prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
        ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1),
    valid AS (
      SELECT DISTINCT l.reportDate,u.businessType,UPPER(TRIM(u.shipmentCode)) shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
             WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV' ELSE 'UNKNOWN' END regionCode
      FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
        AND TRIM(COALESCE(u.shipmentCode,''))<>''
      UNION ALL
      SELECT DISTINCT p.reportDate,'WHPP' businessType,UPPER(TRIM(p.shipmentCode)) shipmentCode,'UNKNOWN' regionCode
      FROM business_daily_parse_rows p
      LEFT JOIN latest l ON l.reportDate=p.reportDate
      WHERE p.businessType='WHPP' AND p.reportDate BETWEEN ? AND ?
        AND TRIM(COALESCE(p.shipmentCode,''))<>''
        AND NOT EXISTS (
          SELECT 1 FROM unified_import_rows u
          WHERE u.snapshotId=l.snapshotId AND u.reportDate=p.reportDate AND u.businessType='CEAF'
            AND UPPER(TRIM(u.shipmentCode))=UPPER(TRIM(p.shipmentCode))
        )
    )
    SELECT v.reportDate,v.businessType,v.regionCode,v.shipmentCode,
      CASE WHEN l.shipmentCode IS NOT NULL AND (
             l.trackingStatus='TERMINAL'
             OR TRIM(COALESCE(l.lastCheckedAt,''))<>''
             OR UPPER(TRIM(COALESCE(l.currentState,''))) NOT IN ('','OPEN')
           ) THEN 1
           WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') AND sf.shipmentCode IS NOT NULL THEN 1
           WHEN v.businessType IN ('CE','CEAF','TBKH','ALI1688') AND cf.shipmentCode IS NOT NULL THEN 1
           WHEN v.businessType='WHPP' AND wf.shipmentCode IS NOT NULL THEN 1
           ELSE 0 END proven
    FROM valid v
    LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=v.shipmentCode AND l.businessType=v.businessType
    LEFT JOIN final_rows cf ON v.businessType IN ('CE','CEAF','TBKH','ALI1688') AND cf.shipmentCode=v.shipmentCode AND cf.reportDate=v.reportDate
    LEFT JOIN business_final_rows sf ON v.businessType IN ('SHOPEECN','SHOPEEVN') AND sf.businessType='SHOPEE' AND sf.shipmentCode=v.shipmentCode AND sf.reportDate=v.reportDate
    LEFT JOIN business_final_rows wf ON v.businessType='WHPP' AND wf.businessType='WHPP' AND wf.shipmentCode=v.shipmentCode AND wf.reportDate=v.reportDate
    ORDER BY v.reportDate,v.businessType,v.regionCode,v.shipmentCode
  `).all(fromDate,toDate,fromDate,toDate).map(row=>({...row,proven:Number(row.proven||0)}));
}

export function readV284EvidenceCoverage(fromDate,toDate,db=getDb()){
  const rows=proofRows(fromDate,toDate,db);
  const byRegion=new Map(),byType=new Map(),unproven=[];
  for(const row of rows){
    const rk=key(row.reportDate,row.businessType,row.regionCode),tk=key(row.reportDate,row.businessType);
    const r=byRegion.get(rk)||{total:0,proven:0};r.total+=1;r.proven+=row.proven;byRegion.set(rk,r);
    const t=byType.get(tk)||{total:0,proven:0};t.total+=1;t.proven+=row.proven;byType.set(tk,t);
    if(!row.proven)unproven.push({reportDate:row.reportDate,businessType:row.businessType,regionCode:row.regionCode,shipmentCode:row.shipmentCode});
  }
  return {id:V284_EVIDENCE_COVERAGE_ID,truthId:V284_DAILY_MEMBERSHIP_TRUTH_ID,fromDate,toDate,rows,byRegion,byType,unproven};
}
function patchFact(row,proven){
  if(!row)return row;
  const out={...row,matched:Math.min(n(row.total),Math.max(0,n(proven)))};
  out.coverageRate=pct(out.matched,out.total);
  out.ready=out.total===0||out.matched>=out.total;
  out.ledgerReady=out.ready;
  if(n(out.pod)===0)out.attemptCoverageRate=null;
  if('evidenceSource' in out)out.evidenceSource=out.ready?'V286_PROVEN_SEVEN_BUSINESS_DAILY_MEMBERSHIP':'V286_PROVEN_EVIDENCE_COVERAGE_INCOMPLETE';
  return out;
}
function aggregateFact(source,type){
  const rows=(source||[]).filter(Boolean),out={businessType:type,reportDate:rows.at(-1)?.reportDate||'',total:0,matched:0,pod:0,sameDayPod:0,ocCurrent:0,pendingNonContinuous:0,pending3:0,oc1:0,oc2:0,cycle2:0,shopRetention2:0,workOrder:0,inboundNoScan:0,provinceOpen:0,returned:0,attempt1:0,attempt2:0,attempt3:0,attemptUnknown:0,signingDaysSum:0,signingDaysCount:0};
  for(const row of rows)for(const k of ['total','matched','pod','sameDayPod','ocCurrent','pendingNonContinuous','pending3','oc1','oc2','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen','returned','attempt1','attempt2','attempt3','attemptUnknown','signingDaysSum','signingDaysCount'])out[k]+=n(row[k]);
  out.coverageRate=pct(out.matched,out.total);out.podRate=pct(out.pod,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);out.ocRate=pct(out.ocCurrent,out.total);out.ready=out.total===0||out.matched>=out.total;
  const known=out.attempt1+out.attempt2+out.attempt3;out.attemptUnknown=Math.max(out.attemptUnknown,Math.max(0,out.pod-known));out.attemptCoverageRate=out.pod?pct(Math.min(out.pod,known),out.pod):null;const hasAttempt=out.pod>0&&known>0;out.attempt1Rate=hasAttempt?pct(out.attempt1,out.pod):null;out.attempt2Rate=hasAttempt?pct(out.attempt2,out.pod):null;out.attempt3Rate=hasAttempt?pct(out.attempt3,out.pod):null;out.avgPodDays=out.signingDaysCount?Number((out.signingDaysSum/out.signingDaysCount).toFixed(2)):null;return out;
}

export function readV284ProvenDailyFacts(fromDate,toDate,db=getDb()){
  const coverage=readV284EvidenceCoverage(fromDate,toDate,db);
  return readV284DailyFacts(fromDate,toDate,db).map(row=>patchFact(row,coverage.byType.get(key(row.reportDate,row.businessType))?.proven||0));
}

export function readV284ProvenDashboardTrends(businessType='ALL',fromDate='',toDate='',db=getDb()){
  const base=readV284DashboardTrends(businessType,fromDate,toDate,db);
  if(!base.dates?.length)return {...base,evidenceCoverageId:V284_EVIDENCE_COVERAGE_ID};
  const coverage=readV284EvidenceCoverage(base.dates[0],base.dates.at(-1),db);
  const type=String(base.businessType||businessType||'ALL').toUpperCase();
  const daily=(base.daily||[]).map(row=>{
    if(TYPES.includes(type))return patchFact(row,coverage.byType.get(key(row.reportDate,type))?.proven||0);
    const scope=type==='CCSL'?CCSL:type==='SHOPEE'?SHOPEE:TYPES;
    const proven=scope.reduce((sum,t)=>sum+n(coverage.byType.get(key(row.reportDate,t))?.proven),0);
    return patchFact(row,proven);
  });
  const val=(r,k)=>r.ready?n(r[k]):null;
  return {...base,daily,evidenceCoverageId:V284_EVIDENCE_COVERAGE_ID,pod:daily.map(r=>val(r,'pod')),podRate:daily.map(r=>val(r,'podRate')),oc:daily.map(r=>val(r,'ocCurrent')),ocRate:daily.map(r=>val(r,'ocRate')),sameDayPod:daily.map(r=>val(r,'sameDayPod')),sameDayPodRate:daily.map(r=>val(r,'sameDayPodRate')),coverageRate:daily.map(r=>r.coverageRate),missingDates:daily.filter(r=>!r.ready).map(r=>r.reportDate)};
}

export function readV284ProvenShopeeTrends(businessType='SHOPEECN',fromDate='',toDate='',options={},db=getDb()){
  const base=readV284ShopeeTrends(businessType,fromDate,toDate,options,db);
  if(!base.dates?.length)return {...base,evidenceCoverageId:V284_EVIDENCE_COVERAGE_ID};
  const coverage=readV284EvidenceCoverage(base.dates[0],base.dates.at(-1),db),type=String(businessType||'').toUpperCase();
  const daily=(base.daily||[]).map(row=>{
    const regions={};for(const [region,value]of Object.entries(row.regions||{}))regions[region]=patchFact(value,coverage.byRegion.get(key(row.reportDate,type,region))?.proven||0);
    return {...patchFact(row,coverage.byType.get(key(row.reportDate,type))?.proven||0),regions};
  });
  return {...base,daily,evidenceCoverageId:V284_EVIDENCE_COVERAGE_ID,pod:daily.map(r=>r.ready?r.pod:null),podRate:daily.map(r=>r.ready?r.podRate:null),avgPodDays:daily.map(r=>r.ready?r.avgPodDays:null),oc:daily.map(r=>r.ready?r.ocCurrent:null),ocRate:daily.map(r=>r.ready?r.ocRate:null),attempt1:daily.map(r=>r.ready?r.attempt1:null),attempt2:daily.map(r=>r.ready?r.attempt2:null),attempt3:daily.map(r=>r.ready?r.attempt3:null),attempt1Rate:daily.map(r=>r.ready?r.attempt1Rate:null),attempt2Rate:daily.map(r=>r.ready?r.attempt2Rate:null),attempt3Rate:daily.map(r=>r.ready?r.attempt3Rate:null),attemptUnknown:daily.map(r=>r.ready?r.attemptUnknown:null),attemptCoverageRate:daily.map(r=>r.ready&&n(r.pod)>0?r.attemptCoverageRate:null),ledgerReady:daily.map(r=>r.ready),coverageRate:daily.map(r=>r.coverageRate)};
}

export function summarizeV284ProvenRange(fromDate,toDate,db=getDb()){
  const base=summarizeV284Range(fromDate,toDate,db),daily=readV284ProvenDailyFacts(fromDate,toDate,db),byType={};
  for(const type of TYPES)byType[type]=aggregateFact(daily.filter(r=>r.businessType===type),type);
  const ccsl=aggregateFact(CCSL.map(t=>byType[t]),'CCSL'),shopee=aggregateFact(SHOPEE.map(t=>byType[t]),'SHOPEE'),whpp=byType.WHPP||aggregateFact([],'WHPP');
  const dates=[...new Set(daily.map(r=>r.reportDate))].sort();const missingDates=dates.filter(date=>daily.some(r=>r.reportDate===date&&r.total>0&&!r.ready));
  const sourceTotal=ccsl.total+shopee.total+whpp.total,analyzedTotal=ccsl.matched+shopee.matched+whpp.matched;
  return {...base,daily,byType,ccsl,shopee,whpp,evidenceCoverageId:V284_EVIDENCE_COVERAGE_ID,sourceTotal,analyzedTotal,analysisPending:Math.max(0,sourceTotal-analyzedTotal),missingDates,analysisComplete:missingDates.length===0&&analyzedTotal>=sourceTotal};
}

console.info('[CE-QC][V284_EVIDENCE_COVERAGE]',V284_EVIDENCE_COVERAGE_ID,'all seven businesses are covered with the same daily membership rules; WHPP excludes latest-VALID CEAF overlap and uses WHPP ledger/final evidence; ledger admission alone is not analysis proof.');
