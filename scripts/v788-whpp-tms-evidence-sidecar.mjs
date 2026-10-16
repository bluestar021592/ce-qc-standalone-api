// V788 WHPP per-waybill TMS proof ledger, deliberately SEPARATE from both
// the production database and the isolated acceptance copy.
// Persist only exact-requested CE shipmentCode/status/time/digest. Never store
// raw TMS payload, client data, tokens, or inferred signing times.
import {createHash} from 'node:crypto';
import {explicitWhppTms60PodTime} from '../src/whppPodTimeEvidence.js';

const DATE_COUNTS=Object.freeze({'2026-07-01':190,'2026-07-02':156});
// V3 actual CE TMS readonly reconciliation, not a count inferred from labels.
// A later change is a REVIEW condition, never silently accepted as the same history.
const EXPECTED_TERMINAL=Object.freeze({
  '2026-07-01':Object.freeze({s60:166,s81:24}),
  '2026-07-02':Object.freeze({s60:124,s81:32})
});
const normalize=value=>String(value||'').trim().toUpperCase();
const sha=value=>createHash('sha256').update(value).digest('hex');

// Derive the exact member-set fingerprint from an independently opened
// READ-ONLY WHPP daily source. No migrations, writes or production fallback.
export function v788ReadSourceMembershipSignature(db){
  const get=db.prepare("SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode");
  const sources=Object.entries(DATE_COUNTS).map(([date,expected])=>{
    const codes=get.all(date).map(row=>normalize(row.shipmentCode));
    if(codes.length!==expected||new Set(codes).size!==expected)
      throw Error('V788_ISOLATED_SOURCE_MEMBERSHIP_CHANGED');
    return {date,codes};
  });
  return v788SourceSignature(sources);
}
export function v788SourceSignature(sources=[]){
  const hash=createHash('sha256');
  for(const source of sources){
    hash.update(source.date+'\n'+source.codes.join('\n')+'\n');
  }
  return hash.digest('hex');
}

export function strictWhppTmsBatch(codes=[],rows=[],date=''){
  if(!Object.hasOwn(DATE_COUNTS,date))throw Error('V788_INVALID_SOURCE_DATE');
  if(!Array.isArray(codes)||!Array.isArray(rows))throw Error('V788_INVALID_TMS_SHAPE');
  const members=[...new Set(codes.map(normalize))];
  if(members.length!==codes.length||members.some(x=>!x))throw Error('V788_DUPLICATE_REQUEST_CODES');
  const expected=new Set(members),byBill=new Map();
  for(const row of rows){
    const code=normalize(row?.shipmentCode);
    if(!expected.has(code))throw Error('V788_TMS_UNREQUESTED_MEMBER');
    const status=String(row?.shipmentStatus??'').trim();
    if(!/^[0-9]+$/.test(status))throw Error('V788_TMS_MISSING_DIRECT_STATUS');
    if(byBill.has(code))throw Error('V788_TMS_DUPLICATE_MEMBER');
    byBill.set(code,{
      code,reportDate:date,shipmentStatus:status,
      explicitPodTime:explicitWhppTms60PodTime(row,date),
      apiDigest:sha(JSON.stringify(row))
    });
  }
  if(byBill.size!==members.length)throw Error('V788_TMS_PARTIAL_BATCH');
  return members.map(code=>byBill.get(code));
}

export function initV788Sidecar(db,sourceSignature){
  if(!/^[a-f0-9]{64}$/.test(String(sourceSignature)))throw Error('V788_INVALID_SOURCE_SIGNATURE');
  db.exec('CREATE TABLE IF NOT EXISTS v788_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS v788_tms_evidence(reportDate TEXT NOT NULL, shipmentCode TEXT NOT NULL, shipmentStatus TEXT NOT NULL, explicitPodTime TEXT NOT NULL DEFAULT "", apiDigest TEXT NOT NULL, verifiedAt TEXT NOT NULL, PRIMARY KEY(reportDate,shipmentCode))');
  db.exec('CREATE TABLE IF NOT EXISTS v788_batch_commits(reportDate TEXT NOT NULL,batchIndex INTEGER NOT NULL,requested INTEGER NOT NULL,committedAt TEXT NOT NULL,PRIMARY KEY(reportDate,batchIndex))');
  const get=db.prepare('SELECT value FROM v788_meta WHERE key=?').get('source_signature')?.value;
  if(get&&get!==sourceSignature)throw Error('V788_SIDECAR_SOURCE_IDENTITY_MISMATCH');
  if(!get)db.prepare('INSERT INTO v788_meta(key,value) VALUES(?,?)').run('source_signature',sourceSignature);
}

export function stageV788Batch(db,{date,index,codes,rows}){
  const items=strictWhppTmsBatch(codes,rows,date);
  if(!Number.isInteger(index)||index<0||index>3)throw Error('V788_INVALID_BATCH_INDEX');
  const existing=db.prepare('SELECT requested FROM v788_batch_commits WHERE reportDate=? AND batchIndex=?').get(date,index);
  if(existing){
    if(existing.requested!==items.length)throw Error('V788_BATCH_REPLAY_COUNT_MISMATCH');
    const get=db.prepare('SELECT shipmentStatus,explicitPodTime,apiDigest FROM v788_tms_evidence WHERE reportDate=? AND shipmentCode=?');
    for(const item of items){
      const saved=get.get(date,item.code);
      if(!saved||saved.shipmentStatus!==item.shipmentStatus)throw Error('V788_BATCH_REPLAY_STATUS_CHANGED');
    }
    return {reused:true,matched:items.length};
  }
  // One transaction per complete, unambiguous batch. No partial evidence.
  db.exec('BEGIN IMMEDIATE');
  try{
    const stamp=new Date().toISOString();
    const insert=db.prepare('INSERT INTO v788_tms_evidence(reportDate,shipmentCode,shipmentStatus,explicitPodTime,apiDigest,verifiedAt) VALUES(?,?,?,?,?,?)');
    for(const item of items){
      insert.run(date,item.code,item.shipmentStatus,item.explicitPodTime,item.apiDigest,stamp);
    }
    db.prepare('INSERT INTO v788_batch_commits(reportDate,batchIndex,requested,committedAt) VALUES(?,?,?,?)').run(date,index,items.length,stamp);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK')}catch{};throw error}
  return {reused:false,matched:items.length};
}

export function inspectV788Sidecar(db,sources=[]){
  const expected=new Map();
  for(const src of sources){
    if(!Object.hasOwn(DATE_COUNTS,src.date)||src.codes.length!==DATE_COUNTS[src.date])throw Error('V788_SOURCE_SET_CHANGED');
    for(const code of src.codes){const key=src.date+'|'+code;if(expected.has(key))throw Error('V788_DUPLICATE_SOURCE_MEMBER');expected.set(key,normalize(src.states?.get(code)||''))}
  }
  const rows=db.prepare('SELECT reportDate,shipmentCode,shipmentStatus,explicitPodTime FROM v788_tms_evidence ORDER BY reportDate,shipmentCode').all();
  const statuses={s60:0,s80:0,s81:0,other:0};
  const byDate=Object.fromEntries(Object.keys(DATE_COUNTS).map(date=>[date,{s60:0,s80:0,s81:0,other:0}]));
  let unexpected=0,conflicts=0,podWithTime=0;
  const seen=new Set();
  for(const r of rows){
    const key=r.reportDate+'|'+r.shipmentCode;
    if(!expected.has(key)){unexpected++;continue}
    seen.add(key);
    const status=String(r.shipmentStatus||''),state=expected.get(key);
    const category=status==='60'?'s60':status==='80'?'s80':status==='81'?'s81':'other';
    statuses[category]++;
    byDate[r.reportDate][category]++;
    if(status==='60'&&r.explicitPodTime)podWithTime++;
    if((status==='60'&&['RETURNED','RETURN_COMPLETED','RETURNING','RETURN_IN_PROGRESS'].includes(state))
      ||(status==='81'&&['POD','RETURNING','RETURN_IN_PROGRESS'].includes(state))
      ||(status==='80'&&['POD','RETURNED','RETURN_COMPLETED'].includes(state)))conflicts++;
  }
  const batches=db.prepare('SELECT COUNT(*) AS n FROM v788_batch_commits').get().n;
  const distributionMatches=Object.entries(EXPECTED_TERMINAL).every(([date,n])=>
    byDate[date].s60===n.s60&&byDate[date].s81===n.s81
      &&byDate[date].s80===0&&byDate[date].other===0);
  return {expectedMembers:expected.size,persistedMembers:seen.size,missingMembers:expected.size-seen.size,
    unexpectedMembers:unexpected,conflictingExistingStates:conflicts,
    podWithExplicitTime:podWithTime,statuses,byDate,distributionMatchesV3:distributionMatches,
    completedBatches:batches,expectedBatches:8,
    complete:batches===8&&seen.size===expected.size&&unexpected===0
      &&conflicts===0&&distributionMatches};
}

/**
 * Read-only cross-check used by the in-app progress panel. The JSON report
 * alone is never authoritative: verify the independent SQLite file itself.
 * This only attests to saved terminal counts/source digest, not POD time,
 * ledger closure, or actual seven-business export acceptance.
 */
export function verifyV788PersistedSidecar(db,expectedSourceSignature=''){
  const signature=db.prepare("SELECT value FROM v788_meta WHERE key='source_signature' LIMIT 1").get()?.value||'';
  if(!/^[a-f0-9]{64}$/.test(String(expectedSourceSignature||''))
      ||signature!==expectedSourceSignature){
    return {verified:false,reason:'SOURCE_SIGNATURE_MISMATCH'};
  }
  const rows=db.prepare("SELECT reportDate,shipmentStatus,COUNT(*) n FROM v788_tms_evidence GROUP BY reportDate,shipmentStatus").all();
  // Exact-member fingerprint derived from saved waybill IDs must equal the
  // original read-only source signature. Matching only 346/290/56 totals is
  // insufficient: substituted or missing waybills would otherwise look green.
  const savedMembers=db.prepare('SELECT reportDate,shipmentCode FROM v788_tms_evidence ORDER BY reportDate,shipmentCode').all();
  const savedSources=Object.keys(DATE_COUNTS).map(date=>({
    date,codes:savedMembers.filter(item=>item.reportDate===date).map(item=>String(item.shipmentCode||'').trim().toUpperCase())
  }));
  const exactMemberSetMatches=v788SourceSignature(savedSources)===expectedSourceSignature;
  const byDate=Object.fromEntries(Object.keys(DATE_COUNTS).map(date=>[date,{s60:0,s80:0,s81:0,other:0}]));
  let total=0,invalidDates=0;
  for(const row of rows){
    if(!Object.hasOwn(byDate,row.reportDate)){invalidDates+=Number(row.n||0);continue}
    const kind=row.shipmentStatus==='60'?'s60':row.shipmentStatus==='80'?'s80':row.shipmentStatus==='81'?'s81':'other';
    byDate[row.reportDate][kind]+=Number(row.n||0);
    total+=Number(row.n||0);
  }
  const commits=db.prepare('SELECT reportDate,batchIndex,requested FROM v788_batch_commits ORDER BY reportDate,batchIndex').all();
  let exactBatches=commits.length===8;
  for(const date of Object.keys(DATE_COUNTS)){
    const expectedBatches=Math.ceil(DATE_COUNTS[date]/50);
    const own=commits.filter(x=>x.reportDate===date);
    if(own.length!==expectedBatches)exactBatches=false;
    for(let i=0;i<expectedBatches;i++){
      const expected=i===expectedBatches-1?DATE_COUNTS[date]-50*i:50;
      if(!own.some(x=>x.batchIndex===i&&Number(x.requested)===expected))exactBatches=false;
    }
  }
  const terminalMatches=Object.entries(EXPECTED_TERMINAL).every(([date,counts])=>
    byDate[date].s60===counts.s60&&byDate[date].s81===counts.s81
      &&byDate[date].s80===0&&byDate[date].other===0);
  const verified=total===346&&invalidDates===0&&exactBatches&&terminalMatches
    &&exactMemberSetMatches;
  return {verified,reason:verified?'SAVED_PROOF_MATCHES_V3':'SAVED_PROOF_INCOMPLETE_OR_DRIFTED',
    storedMembers:total,batches:commits.length,byDate,exactMemberSetMatches,
    distributionMatchesV3:terminalMatches};
}
