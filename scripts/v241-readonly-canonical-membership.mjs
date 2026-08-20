export const V241_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
export const V241_SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
export const V241_CCSL_TYPES=new Set(['CE','CEAF','TBKH','ALI1688']);

const bill=value=>String(value||'').trim().toUpperCase();
const familyOf=type=>V241_SHOPEE_TYPES.has(type)?'SHOPEE':(V241_CCSL_TYPES.has(type)?'CCSL':type);
const chunks=(values,size=240)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
const safeJson=(value,fallback={})=>{try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}};

export function v241TableExists(db,name){
  try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}
  catch{return false;}
}
function tableColumns(db,name){
  if(!v241TableExists(db,name))return new Set();
  try{return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row=>String(row.name||'')));}
  catch{return new Set();}
}

export function v241ReadLatestValidBatch(db,reportDate){
  if(!v241TableExists(db,'unified_import_batches'))return null;
  return db.prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE UPPER(COALESCE(b.status,'VALID'))='VALID' AND b.reportDate=?
    ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1
  `).get(reportDate)||null;
}

function addBills(set,rows=[]){for(const row of rows){const code=bill(row?.shipmentCode);if(code)set.add(code);}return set;}

// A partial re-import may supersede the previous batch without carrying every waybill.
// Keep the newest completed observation for each waybill across VALID + SUPERSEDED
// snapshots. If a waybill was reclassified, only its newest businessType wins; if it
// disappeared from the partial re-import, its older completed membership survives.
function unifiedArchiveMembers(db,reportDate,type){
  const set=new Set();
  if(!v241TableExists(db,'unified_import_batches')||!v241TableExists(db,'unified_import_rows')||!v241TableExists(db,'unified_snapshots'))return set;
  try{
    addBills(set,db.prepare(`
      WITH ranked AS (
        SELECT r.shipmentCode,UPPER(COALESCE(r.businessType,'')) businessType,
               ROW_NUMBER() OVER (
                 PARTITION BY UPPER(COALESCE(r.shipmentCode,''))
                 ORDER BY COALESCE(b.createdAt,'') DESC,COALESCE(b.batchId,'') DESC,COALESCE(r.id,0) DESC
               ) rn
        FROM unified_import_batches b
        INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND UPPER(COALESCE(s.status,''))='COMPLETED'
        INNER JOIN unified_import_rows r ON r.snapshotId=b.snapshotId
        WHERE b.reportDate=? AND UPPER(COALESCE(b.status,'VALID')) IN ('VALID','SUPERSEDED')
      )
      SELECT shipmentCode FROM ranked WHERE rn=1 AND businessType=?
    `).all(reportDate,type));
  }catch{}
  return set;
}

function businessParseMembers(db,reportDate,type){
  const set=new Set();
  if(!v241TableExists(db,'business_daily_parse_rows'))return set;
  try{
    if(type==='SHOPEECN'||type==='SHOPEEVN'){
      const group=type==='SHOPEECN'?'CN':'VN';
      addBills(set,db.prepare(`
        SELECT DISTINCT shipmentCode
        FROM business_daily_parse_rows
        WHERE reportDate=? AND (
          UPPER(COALESCE(businessType,''))=? OR
          (UPPER(COALESCE(businessType,''))='SHOPEE' AND UPPER(COALESCE(recipient_group,''))=?)
        )
      `).all(reportDate,type,group));
    }else{
      addBills(set,db.prepare(`
        SELECT DISTINCT shipmentCode
        FROM business_daily_parse_rows
        WHERE reportDate=? AND UPPER(COALESCE(businessType,''))=?
      `).all(reportDate,type));
    }
  }catch{}
  return set;
}
function sourceLedgerMembers(db,reportDate,type){return new Set([...unifiedArchiveMembers(db,reportDate,type),...businessParseMembers(db,reportDate,type)]);}

// Older completed Shopee runs can retain exact report-date normalized membership even
// when a later partial re-import did not persist the earlier CN/VN source rows. Those
// exact final rows are not trusted blindly: they are split only by an explicit exact
// businessType or persisted recipient_group, and a bill that is present in the other
// Shopee board's canonical source ledger is excluded so the newest explicit source
// reclassification wins. This recovers both a fully missing board and a partially
// truncated board without using aggregate cache counts as invented membership.
function persistedFinalMembers(db,reportDate,type){
  const set=new Set();
  if(!v241TableExists(db,'business_final_rows'))return set;
  const cols=tableColumns(db,'business_final_rows');
  try{
    if(type==='SHOPEECN'||type==='SHOPEEVN'){
      const group=type==='SHOPEECN'?'CN':'VN';
      if(cols.has('recipient_group')){
        addBills(set,db.prepare(`
          SELECT DISTINCT shipmentCode FROM business_final_rows
          WHERE reportDate=? AND (
            UPPER(COALESCE(businessType,''))=? OR
            (UPPER(COALESCE(businessType,''))='SHOPEE' AND UPPER(COALESCE(recipient_group,''))=?)
          )
        `).all(reportDate,type,group));
      }else{
        addBills(set,db.prepare(`SELECT DISTINCT shipmentCode FROM business_final_rows WHERE reportDate=? AND UPPER(COALESCE(businessType,''))=?`).all(reportDate,type));
      }
    }else if(type==='WHPP'){
      addBills(set,db.prepare(`SELECT DISTINCT shipmentCode FROM business_final_rows WHERE reportDate=? AND UPPER(COALESCE(businessType,''))='WHPP'`).all(reportDate));
    }
  }catch{}
  return set;
}

function latestValidSnapshotMembers(db,batch,type){
  const set=new Set();
  if(!batch?.snapshotId||!v241TableExists(db,'unified_import_rows'))return set;
  try{addBills(set,db.prepare("SELECT DISTINCT shipmentCode FROM unified_import_rows WHERE snapshotId=? AND UPPER(COALESCE(businessType,''))=?").all(batch.snapshotId,type));}catch{}
  return set;
}

function declaredDailyCount(db,reportDate,type){
  if(!v241TableExists(db,'business_daily_reports'))return null;
  try{
    const row=db.prepare("SELECT totalCount FROM business_daily_reports WHERE reportDate=? AND UPPER(COALESCE(businessType,''))=? LIMIT 1").get(reportDate,type);
    return row?Number(row.totalCount||0):null;
  }catch{return null;}
}

export function v241CollectSourceMembership(db,reportDate,type,batch=null){
  const archive=unifiedArchiveMembers(db,reportDate,type);
  const parse=businessParseMembers(db,reportDate,type);
  const latest=latestValidSnapshotMembers(db,batch,type);
  const members=new Set([...archive,...parse]);
  const persisted=V241_SHOPEE_TYPES.has(type)||type==='WHPP'?persistedFinalMembers(db,reportDate,type):new Set();
  const persistedSupplementBills=new Set();
  if(V241_SHOPEE_TYPES.has(type)){
    const otherType=type==='SHOPEECN'?'SHOPEEVN':'SHOPEECN';
    const otherExplicit=sourceLedgerMembers(db,reportDate,otherType);
    for(const code of persisted){
      if(otherExplicit.has(code)||members.has(code))continue;
      members.add(code);persistedSupplementBills.add(code);
    }
  }else if(type==='WHPP'&&members.size===0){
    for(const code of persisted){members.add(code);persistedSupplementBills.add(code);}
  }
  const declared=declaredDailyCount(db,reportDate,type);
  const baseCount=new Set([...archive,...parse]).size;
  const persistedAdded=persistedSupplementBills.size;
  const sourceMode=persistedAdded>0
    ?(baseCount>0?'CANONICAL_PLUS_PERSISTED_FINAL':'PERSISTED_FINAL_MEMBERSHIP_RECOVERY')
    :(baseCount>0?'CANONICAL_SOURCE_LEDGER':'MISSING');
  return {
    members,
    persistedSupplementBills,
    sourceCount:members.size,
    archiveUnifiedCount:archive.size,
    businessParseCount:parse.size,
    persistedFinalCandidateCount:persisted.size,
    persistedFinalSupplementCount:persistedAdded,
    sourceMode,
    latestValidSnapshotCount:latest.size,
    declaredDailyCount:declared,
    declaredMismatch:declared!==null&&declared>0&&declared!==members.size,
    recoveredBeyondLatest:[...members].filter(code=>!latest.has(code)).length
  };
}

function isAllowedCurrentType(requested,stored){
  const value=String(stored||'').trim().toUpperCase();
  return !value||value===requested||value===familyOf(requested);
}
function currentPod(row={}){
  const state=String(row.state||'').trim().toUpperCase();
  const api=String(row.apiStatus||'').trim().toUpperCase();
  const raw=safeJson(row.stateJson,{});
  const rawState=String(raw.currentState||raw.scanNormalizedState||'').trim().toUpperCase();
  return state==='POD'||rawState==='POD'||api==='POD'||Number(raw.isPod||0)===1||String(raw.orderStatus||'')==='85';
}

export function v241NormalizedStats(db,reportDate,type,members){
  const codes=[...members];
  const found=new Set(),pod=new Set(),blank=new Set();
  if(!codes.length)return{count:0,pod:0,blank:0,foundBills:found,podBills:pod};
  for(const part of chunks(codes)){
    const marks=part.map(()=>'?').join(',');
    let rows=[];
    try{
      if(type==='WHPP'){
        if(!v241TableExists(db,'business_final_rows'))continue;
        rows=db.prepare(`SELECT shipmentCode,isPod,primaryCategory FROM business_final_rows WHERE reportDate=? AND UPPER(COALESCE(businessType,''))='WHPP' AND shipmentCode IN (${marks})`).all(reportDate,...part);
      }else if(V241_SHOPEE_TYPES.has(type)){
        if(!v241TableExists(db,'business_final_rows'))continue;
        const cols=tableColumns(db,'business_final_rows');
        if(cols.has('recipient_group')){
          const group=type==='SHOPEECN'?'CN':'VN';
          rows=db.prepare(`SELECT shipmentCode,isPod,primaryCategory FROM business_final_rows WHERE reportDate=? AND (UPPER(COALESCE(businessType,''))=? OR (UPPER(COALESCE(businessType,''))='SHOPEE' AND UPPER(COALESCE(recipient_group,''))=?)) AND shipmentCode IN (${marks})`).all(reportDate,type,group,...part);
        }else{
          rows=db.prepare(`SELECT shipmentCode,isPod,primaryCategory FROM business_final_rows WHERE reportDate=? AND UPPER(COALESCE(businessType,'')) IN (?, 'SHOPEE') AND shipmentCode IN (${marks})`).all(reportDate,type,...part);
        }
      }else{
        if(!v241TableExists(db,'final_rows'))continue;
        rows=db.prepare(`SELECT shipmentCode,isPod,primaryCategory FROM final_rows WHERE reportDate=? AND shipmentCode IN (${marks})`).all(reportDate,...part);
      }
    }catch{rows=[];}
    for(const row of rows){const code=bill(row.shipmentCode);if(!members.has(code))continue;found.add(code);if(Number(row.isPod||0)===1)pod.add(code);if(!String(row.primaryCategory||'').trim())blank.add(code);}
  }
  return{count:found.size,pod:pod.size,blank:blank.size,foundBills:found,podBills:pod};
}

// shipment_current_state is intentionally mutable and can be sparse for waybills that
// are recovered from exact historical Shopee final rows after a later partial re-import.
// For those recovered-only waybills, and only when no newer current-state row exists,
// the exact report-date normalized row is the safe effective-current baseline. A real
// current row always wins; an explicit cross-board current type or a POD regression can
// never be hidden by this fallback.
export function v241CurrentStats(db,type,members,{fallbackBills=new Set(),normalized=null}={}){
  const codes=[...members];
  const observedFound=new Set(),observedPod=new Set(),currentTypeConflicts=new Set();
  if(codes.length&&v241TableExists(db,'shipment_current_state')){
    for(const part of chunks(codes)){
      const marks=part.map(()=>'?').join(',');
      let rows=[];
      try{rows=db.prepare(`SELECT shipmentCode,businessType,state,apiStatus,stateJson,reportDate,snapshotId,lastEventTime FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...part);}catch{rows=[];}
      for(const row of rows){
        const code=bill(row.shipmentCode);
        if(!members.has(code))continue;
        if(!isAllowedCurrentType(type,row.businessType)){currentTypeConflicts.add(code);continue;}
        observedFound.add(code);
        if(currentPod(row))observedPod.add(code);
      }
    }
  }
  const found=new Set(observedFound),pod=new Set(observedPod),normalizedFallbackBills=new Set();
  if(normalized&&fallbackBills?.size){
    for(const code of fallbackBills){
      if(found.has(code)||currentTypeConflicts.has(code)||!normalized.foundBills.has(code))continue;
      found.add(code);normalizedFallbackBills.add(code);
      if(normalized.podBills.has(code))pod.add(code);
    }
  }
  return{
    count:found.size,
    pod:pod.size,
    observedCount:observedFound.size,
    observedPod:observedPod.size,
    normalizedFallbackCount:normalizedFallbackBills.size,
    currentTypeConflictCount:currentTypeConflicts.size,
    foundBills:found,
    podBills:pod,
    observedFoundBills:observedFound,
    observedPodBills:observedPod,
    normalizedFallbackBills,
    currentTypeConflictBills:currentTypeConflicts
  };
}

export function v241AuditType(db,reportDate,type,batch=null){
  const source=v241CollectSourceMembership(db,reportDate,type,batch);
  const normalized=v241NormalizedStats(db,reportDate,type,source.members);
  const current=v241CurrentStats(db,type,source.members,{fallbackBills:source.persistedSupplementBills,normalized});
  const missingNormalized=[...source.members].filter(code=>!normalized.foundBills.has(code));
  const missingCurrent=[...source.members].filter(code=>!current.foundBills.has(code));
  const podRegressions=[...normalized.podBills].filter(code=>!current.podBills.has(code));
  const pass=source.sourceCount===normalized.count
    && source.sourceCount===current.count
    && !source.declaredMismatch
    && current.currentTypeConflictCount===0
    && podRegressions.length===0
    && normalized.pod<=normalized.count
    && current.pod<=current.count;
  return {
    type,
    ...source,
    normalizedCount:normalized.count,
    normalizedPod:normalized.pod,
    blankCategory:normalized.blank,
    currentCount:current.count,
    currentPod:current.pod,
    observedCurrentCount:current.observedCount,
    observedCurrentPod:current.observedPod,
    normalizedFallbackCurrentCount:current.normalizedFallbackCount,
    currentTypeConflictCount:current.currentTypeConflictCount,
    podProgression:current.pod-normalized.pod,
    missingNormalizedCount:missingNormalized.length,
    missingCurrentCount:missingCurrent.length,
    podRegressionCount:podRegressions.length,
    missingNormalizedSample:missingNormalized.slice(0,8),
    missingCurrentSample:missingCurrent.slice(0,8),
    currentTypeConflictSample:[...current.currentTypeConflictBills].slice(0,8),
    normalizedFallbackSample:[...current.normalizedFallbackBills].slice(0,8),
    podRegressionSample:podRegressions.slice(0,8),
    pass
  };
}

export function v241ShopeeOverlap(db,reportDate,batch=null){
  const cn=v241CollectSourceMembership(db,reportDate,'SHOPEECN',batch).members;
  const vn=v241CollectSourceMembership(db,reportDate,'SHOPEEVN',batch).members;
  const overlap=[...cn].filter(code=>vn.has(code));
  return{count:overlap.length,sample:overlap.slice(0,12)};
}
