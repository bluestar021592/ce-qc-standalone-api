const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const text=v=>String(v??'').trim();
const bill=v=>text(v).toUpperCase();
const date=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const safeJson=(v,fallback={})=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||''))||fallback);}catch{return fallback;}};
const chunks=(a,n=240)=>{const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out;};
function hasTable(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function regionOf(value){const raw=typeof value==='object'&&value!==null?value:safeJson(value,{});const code=text(raw.regionCode||raw.region_code||raw.区域||raw.region||raw.areaCode).toUpperCase();return code==='PP'?'PP':code==='PV'?'PV':'';}
function inclusive(a,b){a=date(a);b=date(b);if(!a||!b)return 0;const x=Date.parse(`${a}T00:00:00Z`),y=Date.parse(`${b}T00:00:00Z`);return Number.isFinite(x)&&Number.isFinite(y)&&y>=x?Math.floor((y-x)/86400000)+1:0;}
function marker(type){return `%${type}%`;}
function keyOf(d,b){d=date(d);b=bill(b);return d&&b?`${d}|${b}`:'';}
function addFallback(bucket,row){const key=keyOf(row.reportDate,row.shipmentCode),region=regionOf(row.rowJson||row);if(!key||!region)return;if(!bucket.has(key))bucket.set(key,new Set());bucket.get(key).add(region);}

export function resolveShopeeHistoricalRegions(db,businessType='',fromDate='',toDate=''){
  const type=text(businessType).toUpperCase(),from=date(fromDate),to=date(toDate),out=new Map(),fallback=new Map();
  if(!SHOPEE_TYPES.has(type)||!from||!to)return out;
  if(hasTable(db,'unified_import_batches')&&hasTable(db,'unified_import_rows'))try{
    const rows=db.prepare(`WITH candidates AS (
      SELECT b.rowid AS batchRowId,b.reportDate,b.snapshotId,b.createdAt
      FROM unified_import_batches b JOIN unified_import_rows u ON u.snapshotId=b.snapshotId AND u.reportDate=b.reportDate
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ? AND UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>''
      GROUP BY b.rowid,b.reportDate,b.snapshotId,b.createdAt
    ), ranked AS (
      SELECT reportDate,snapshotId,ROW_NUMBER() OVER(PARTITION BY reportDate ORDER BY createdAt DESC,batchRowId DESC) rn FROM candidates
    )
    SELECT r.reportDate,u.shipmentCode,u.regionCode,u.rowJson
    FROM ranked r JOIN unified_import_rows u ON u.snapshotId=r.snapshotId AND u.reportDate=r.reportDate
    WHERE r.rn=1 AND UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>''`).all(from,to,type,type);
    for(const row of rows){const k=keyOf(row.reportDate,row.shipmentCode),r=regionOf(row.regionCode?{regionCode:row.regionCode}:row.rowJson);if(k&&r)out.set(k,r);}
  }catch(error){console.warn('[CE-QC][SHOPEE_REGION_UNIFIED_FAILED]',type,error?.message||error);}
  const like=marker(type);
  if(hasTable(db,'shipment_daily_snapshots'))try{
    const rows=db.prepare(`SELECT reportDate,shipmentCode,rowJson FROM shipment_daily_snapshots
      WHERE reportDate BETWEEN ? AND ? AND TRIM(COALESCE(shipmentCode,''))<>'' AND (
        UPPER(TRIM(COALESCE(businessType,'')))=? OR (
          UPPER(TRIM(COALESCE(businessType,'')))='SHOPEE' AND UPPER(COALESCE(rowJson,'')) LIKE ?
        )
      )`).all(from,to,type,like);
    for(const row of rows)if(!out.has(keyOf(row.reportDate,row.shipmentCode)))addFallback(fallback,row);
  }catch(error){console.warn('[CE-QC][SHOPEE_REGION_SNAPSHOT_FAILED]',type,error?.message||error);}
  if(hasTable(db,'business_daily_parse_rows'))try{
    const rows=db.prepare(`SELECT reportDate,shipmentCode,rowJson FROM business_daily_parse_rows
      WHERE reportDate BETWEEN ? AND ? AND TRIM(COALESCE(shipmentCode,''))<>'' AND (
        UPPER(TRIM(COALESCE(businessType,'')))=? OR (
          UPPER(TRIM(COALESCE(businessType,'')))='SHOPEE' AND (
            UPPER(TRIM(COALESCE(recipient_group,'')))=? OR UPPER(COALESCE(recipient_raw,'')) LIKE ? OR
            UPPER(COALESCE(recipient_normalized,'')) LIKE ? OR UPPER(COALESCE(rowJson,'')) LIKE ?
          )
        )
      )`).all(from,to,type,type,like,like,like);
    for(const row of rows)if(!out.has(keyOf(row.reportDate,row.shipmentCode)))addFallback(fallback,row);
  }catch(error){console.warn('[CE-QC][SHOPEE_REGION_DAILY_FAILED]',type,error?.message||error);}
  for(const [key,regions] of fallback){if(out.has(key))continue;if(regions.size===1)out.set(key,[...regions][0]);}
  return out;
}

function firstHistoryTime(value){const parsed=safeJson(value,[]),rows=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.starts)?parsed.starts:[]);const first=rows?.[0];return text(first?.time||first?.eventTime||first?.scanTime||'');}
function strictLedgerStart(value){const parsed=safeJson(value,{});return text(parsed?.starts?.[0]?.time||parsed?.starts?.[0]?.eventTime||'');}
function preferExact(map,key,row,type){const old=map.get(key);if(!old||text(row.businessType).toUpperCase()===type||text(old.businessType).toUpperCase()!==type)map.set(key,row);}

export function resolveShopeeSigningSamples(db,businessType='',fromDate='',toDate='',members=[]){
  const type=text(businessType).toUpperCase(),from=date(fromDate),to=date(toDate),out=new Map();
  if(!SHOPEE_TYPES.has(type)||!from||!to)return out;
  const memberKeys=new Set(),bills=new Set();
  for(const row of members||[]){const k=keyOf(row.reportDate,row.shipmentCode);if(!k)continue;memberKeys.add(k);bills.add(bill(row.shipmentCode));}
  if(!bills.size)return out;
  const finalByKey=new Map(),ledgerByBill=new Map(),lockByBill=new Map();
  if(hasTable(db,'business_final_rows'))for(const part of chunks([...bills])){
    const marks=part.map(()=>'?').join(',');
    try{for(const row of db.prepare(`SELECT businessType,reportDate,shipmentCode,isPod,latestEventTime,firstAttemptAt,attemptHistoryJson,rawJson
      FROM business_final_rows WHERE businessType IN ('SHOPEE',?) AND reportDate BETWEEN ? AND ? AND UPPER(TRIM(shipmentCode)) IN (${marks})`).all(type,from,to,...part)){
      const k=keyOf(row.reportDate,row.shipmentCode);if(k&&memberKeys.has(k))preferExact(finalByKey,k,row,type);
    }}catch(error){console.warn('[CE-QC][SHOPEE_SIGNING_FINAL_FAILED]',type,error?.message||error);}
  }
  if(hasTable(db,'qc_tracking_ledger'))for(const part of chunks([...bills])){
    const marks=part.map(()=>'?').join(',');
    try{for(const row of db.prepare(`SELECT shipmentCode,firstReportDate,podDate,signingDays,attemptNo,attemptSource,terminalReason,evidenceJson
      FROM qc_tracking_ledger WHERE businessType=? AND UPPER(TRIM(shipmentCode)) IN (${marks})`).all(type,...part))ledgerByBill.set(bill(row.shipmentCode),row);}catch(error){console.warn('[CE-QC][SHOPEE_SIGNING_LEDGER_FAILED]',type,error?.message||error);}
  }
  if(hasTable(db,'business_pod_locks'))for(const part of chunks([...bills])){
    const marks=part.map(()=>'?').join(',');
    try{for(const row of db.prepare(`SELECT businessType,shipmentCode,podTime FROM business_pod_locks WHERE businessType IN ('SHOPEE',?) AND UPPER(TRIM(shipmentCode)) IN (${marks})`).all(type,...part))preferExact(lockByBill,bill(row.shipmentCode),row,type);}catch(error){console.warn('[CE-QC][SHOPEE_SIGNING_LOCK_FAILED]',type,error?.message||error);}
  }
  for(const member of members||[]){
    const k=keyOf(member.reportDate,member.shipmentCode);if(!k||out.has(k))continue;
    const b=bill(member.shipmentCode),final=finalByKey.get(k)||{},ledger=ledgerByBill.get(b)||{},lock=lockByBill.get(b)||{},raw=safeJson(final.rawJson,{});
    const isPod=Number(final.isPod||0)===1||text(ledger.terminalReason).toUpperCase()==='POD'||Boolean(date(lock.podTime));
    if(!isPod)continue;
    const start=strictLedgerStart(ledger.evidenceJson)||text(final.firstAttemptAt)||firstHistoryTime(final.attemptHistoryJson)||text(raw.strictFirstAttemptAt||raw.firstAttemptAt||raw['首次派件时间']||raw['首次派送时间']);
    const pod=text(raw['POD时间']||raw.podTime||raw['签收时间']||ledger.podDate||lock.podTime||(Number(final.isPod||0)===1?final.latestEventTime:''));
    const days=inclusive(start,pod);
    if(days>0)out.set(k,days);
  }
  return out;
}
