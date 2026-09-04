import { V384_CCSL_PROCESSING_PROOF_ID } from './v384CcslProcessingProof.js';

export const V418_STATUS_PROOF_FAST_PATH_ID='2026-09-02-v418-large-db-set-join-status-proof-v1';
export const V426_CCSL_TERMINAL_CLOSURE_PROOF_ID='2026-09-04-v426-current-member-pod-lock-closure-v1';

const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const terminalClosureCache=new Map();
const TERMINAL_COMPLETE_CACHE_MS=60_000;
const TERMINAL_INCOMPLETE_CACHE_MS=1_500;

function whppDailyCount(db,reportDate=''){
  const date=text(reportDate);
  if(!date)return{ok:false,count:0,reason:'WHPP_DATE_MISSING'};
  try{
    const report=db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null;
    const actual=n(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''").get(date)?.count);
    if(!report)return{ok:actual>=0,count:actual,reason:'WHPP_DAILY_PARSE_ROWS_ONLY'};
    const expected=n(report.totalCount);
    if(expected!==actual)return{ok:false,count:0,expected,actual,reason:'WHPP_DAILY_MEMBERSHIP_INCOMPLETE'};
    return{ok:true,count:actual,expected,actual,reason:'WHPP_STANDARD_DAILY_VERIFIED'};
  }catch(error){
    try{
      const actual=n(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''").get(date)?.count);
      return{ok:true,count:actual,reason:'WHPP_DAILY_PARSE_ROWS_COMPAT'};
    }catch{return{ok:false,count:0,reason:`WHPP_DAILY_READ_FAILED:${text(error?.message||error)}`};}
  }
}

export function readV418CurrentMembershipCounts(db,batch={}){
  const result={CE:0,CEAF:0,TBKH:0,ALI1688:0,SHOPEECN:0,SHOPEEVN:0,WHPP:0,CCSL:0,SHOPEE:0,TOTAL:0};
  const sid=text(batch.snapshotId),date=text(batch.reportDate);
  if(!db||!sid||!date)return{...result,_source:'V418_SCOPE_MISSING',_fastPathId:V418_STATUS_PROOF_FAST_PATH_ID};
  try{
    const rows=db.prepare(`SELECT businessType,COUNT(DISTINCT shipmentCode) count
      FROM unified_import_rows
      WHERE snapshotId=? AND reportDate=?
      GROUP BY businessType`).all(sid,date);
    for(const row of rows){
      const type=text(row.businessType).toUpperCase();
      if(type!=='WHPP'&&TYPES.includes(type))result[type]=n(row.count);
    }
  }catch(error){
    return{...result,_source:`V418_CURRENT_MEMBERSHIP_READ_FAILED:${text(error?.message||error)}`,_fastPathId:V418_STATUS_PROOF_FAST_PATH_ID};
  }
  const whpp=whppDailyCount(db,date);
  result.WHPP=whpp.ok?n(whpp.count):0;
  result.CCSL=result.CE+result.CEAF+result.TBKH+result.ALI1688;
  result.SHOPEE=result.SHOPEECN+result.SHOPEEVN;
  result.TOTAL=result.CCSL+result.SHOPEE+result.WHPP;
  result._source='UNIFIED_SNAPSHOT_IMMUTABLE_CLASSIFICATION_COUNTS';
  result._fastSource='V418_INDEXED_CURRENT_MEMBERSHIP_COUNTS';
  result._fastPathId=V418_STATUS_PROOF_FAST_PATH_ID;
  result._whppMembershipOk=Boolean(whpp.ok);
  result._whppMembershipReason=whpp.reason;
  return result;
}

// V426: A missing dashboard completion snapshot must not force a restart when every
// member of the exact current VALID CCSL cohort already has an immutable POD lock.
// This is deliberately narrower than the normal V384/V418 processing proof: it does
// not infer from scanTotal=0, progress checkpoints, a run status, or stale same-day
// facts. It joins only the exact current import membership to immutable pod_locks.
// One missing current member keeps the stage incomplete and on the normal recovery path.
export function readV418CcslTerminalClosureProof(db,{reportDate='',snapshotId='',force=false}={}){
  const date=text(reportDate),sid=text(snapshotId),key=`${sid}:${date}`;
  if(!db||!date||!sid)return{ok:false,id:V426_CCSL_TERMINAL_CLOSURE_PROOF_ID,fastPathId:V418_STATUS_PROOF_FAST_PATH_ID,source:0,covered:0,missing:0,complete:false,reason:'INVALID_SCOPE',queryMode:'V426_SCOPE_MISSING'};
  const cached=terminalClosureCache.get(key);
  if(!force&&cached&&Date.now()-cached.at<cached.ttl)return{...cached.value,cacheHit:true};
  let value;
  try{
    const row=db.prepare(`SELECT COUNT(*) source,
      COALESCE(SUM(CASE WHEN EXISTS(
        SELECT 1 FROM pod_locks p WHERE p.shipmentCode=u.shipmentCode
      ) THEN 1 ELSE 0 END),0) covered
      FROM unified_import_rows u
      WHERE u.snapshotId=? AND u.reportDate=?
        AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')`).get(sid,date)||{};
    const source=n(row.source),covered=n(row.covered),missing=Math.max(0,source-covered);
    value={
      ok:true,id:V426_CCSL_TERMINAL_CLOSURE_PROOF_ID,fastPathId:V418_STATUS_PROOF_FAST_PATH_ID,
      source,covered,missing,complete:source>0&&covered>=source,
      reason:source>0&&covered>=source?'EXACT_CURRENT_MEMBERS_ALL_POD_LOCKED':'CURRENT_MEMBER_POD_LOCK_COVERAGE_INCOMPLETE',
      queryMode:'V426_INDEXED_CURRENT_MEMBERSHIP_POD_LOCK_EXISTS',cacheHit:false
    };
  }catch(error){
    value={ok:false,id:V426_CCSL_TERMINAL_CLOSURE_PROOF_ID,fastPathId:V418_STATUS_PROOF_FAST_PATH_ID,source:0,covered:0,missing:0,complete:false,reason:'V426_TERMINAL_CLOSURE_QUERY_FAILED',queryMode:'V426_SET_JOIN_FAILED',error:text(error?.message||error),cacheHit:false};
  }
  terminalClosureCache.set(key,{value,at:Date.now(),ttl:value.complete?TERMINAL_COMPLETE_CACHE_MS:TERMINAL_INCOMPLETE_CACHE_MS});
  if(terminalClosureCache.size>24){for(const [cacheKey,item] of terminalClosureCache){if(Date.now()-item.at>TERMINAL_COMPLETE_CACHE_MS*2)terminalClosureCache.delete(cacheKey);}}
  return value;
}

export function readV418CcslProcessingProof(db,{reportDate='',snapshotId='',boundary=''}={}){
  const date=text(reportDate),sid=text(snapshotId),life=text(boundary);
  if(!db||!date||!sid)return{ok:false,id:V384_CCSL_PROCESSING_PROOF_ID,fastPathId:V418_STATUS_PROOF_FAST_PATH_ID,source:0,covered:0,missing:0,complete:false,reasons:{INVALID_SCOPE:1},missingBills:[],missingReasons:[],queryMode:'V418_SCOPE_MISSING'};
  const scanBoundary=life?" AND COALESCE(s.updatedAt,'')>=?":'';
  const finalBoundary=life?" AND COALESCE(f.updatedAt,'')>=?":'';
  const params=life?[life,life,sid,date]:[sid,date];
  try{
    const row=db.prepare(`SELECT COUNT(*) source,
      COALESCE(SUM(CASE WHEN
        p.shipmentCode IS NOT NULL
        OR (
          s.shipmentCode IS NOT NULL
          AND UPPER(COALESCE(s.scanCategory,'')) NOT LIKE '%API失败%'
          AND UPPER(COALESCE(s.scanCategory,'')) NOT LIKE '%待重试%'
          AND (
            COALESCE(s.isPod,0)=1 OR COALESCE(s.orderStatus,'') IN ('85','100')
            OR (
              f.shipmentCode IS NOT NULL
              AND UPPER(COALESCE(f.primaryCategory,'')) NOT LIKE '%待重试%'
              AND UPPER(COALESCE(f.category,'')) NOT LIKE '%待重试%'
              AND UPPER(COALESCE(f.qcConclusion,'')) NOT LIKE '%API失败%'
            )
          )
        )
        THEN 1 ELSE 0 END),0) covered
      FROM unified_import_rows u
      LEFT JOIN pod_locks p ON p.shipmentCode=u.shipmentCode
      LEFT JOIN scan_results s
        ON s.shipmentCode=u.shipmentCode AND s.reportDate=u.reportDate${scanBoundary}
      LEFT JOIN final_rows f
        ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate${finalBoundary}
      WHERE u.snapshotId=? AND u.reportDate=?
        AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')`).get(...params)||{};
    const source=n(row.source),covered=n(row.covered),missing=Math.max(0,source-covered);
    return{
      ok:true,id:V384_CCSL_PROCESSING_PROOF_ID,fastPathId:V418_STATUS_PROOF_FAST_PATH_ID,
      source,covered,missing,complete:covered>=source,reasons:missing?{MISSING_VALID_PROCESSING_PROOF:missing}:{},
      missingBills:[],missingReasons:[],lifecycleBoundary:life,queryMode:'V418_SET_JOIN_CURRENT_SNAPSHOT_ONLY'
    };
  }catch(error){
    return{ok:false,id:V384_CCSL_PROCESSING_PROOF_ID,fastPathId:V418_STATUS_PROOF_FAST_PATH_ID,source:0,covered:0,missing:0,complete:false,reasons:{V418_FAST_QUERY_FAILED:1},missingBills:[],missingReasons:[],lifecycleBoundary:life,queryMode:'V418_SET_JOIN_FAILED',error:text(error?.message||error)};
  }
}

export function readV418BusinessSuccessCoverage(db,{businessType='',date='',snapshotId='',boundary='',memberTypes=[]}={}){
  const type=text(businessType).toUpperCase(),reportDate=text(date),sid=text(snapshotId),life=text(boundary);
  if(!db||!reportDate||!memberTypes.length)return{ok:false,count:0,reason:'INVALID_SCOPE',fastPathId:V418_STATUS_PROOF_FAST_PATH_ID};
  const boundarySql=life?" AND COALESCE(f.updatedAt,'')>=?":'';
  try{
    if(type==='WHPP'){
      const params=['WHPP',reportDate];
      if(life)params.push(life);
      params.push(reportDate);
      const count=n(db.prepare(`SELECT COUNT(DISTINCT d.shipmentCode) count
        FROM business_daily_parse_rows d
        JOIN business_final_rows f
          ON f.businessType=? AND f.shipmentCode=d.shipmentCode AND f.reportDate=?${boundarySql}
        WHERE d.businessType='WHPP' AND d.reportDate=?
          AND TRIM(COALESCE(d.shipmentCode,''))<>''
          AND UPPER(COALESCE(f.apiStatus,''))='SUCCESS'`).get(...params)?.count);
      return{ok:true,count,reason:'V418_WHPP_CURRENT_MEMBER_SET_JOIN',fastPathId:V418_STATUS_PROOF_FAST_PATH_ID};
    }
    if(!sid)return{ok:false,count:0,reason:'SNAPSHOT_ID_MISSING',fastPathId:V418_STATUS_PROOF_FAST_PATH_ID};
    const marks=memberTypes.map(()=>'?').join(',');
    const params=[type,reportDate];
    if(life)params.push(life);
    params.push(sid,reportDate,...memberTypes);
    const count=n(db.prepare(`SELECT COUNT(*) count
      FROM unified_import_rows u
      JOIN business_final_rows f
        ON f.businessType=? AND f.shipmentCode=u.shipmentCode AND f.reportDate=?${boundarySql}
      WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN (${marks})
        AND UPPER(COALESCE(f.apiStatus,''))='SUCCESS'`).get(...params)?.count);
    return{ok:true,count,reason:'V418_CURRENT_MEMBER_SET_JOIN',fastPathId:V418_STATUS_PROOF_FAST_PATH_ID};
  }catch(error){
    return{ok:false,count:0,reason:`V418_SUCCESS_COVERAGE_FAILED:${text(error?.message||error)}`,fastPathId:V418_STATUS_PROOF_FAST_PATH_ID};
  }
}
