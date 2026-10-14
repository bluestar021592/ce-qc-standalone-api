import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CEClient} from '../src/ceClient.js';
import {hasDirectTmsShipmentStatus,classifyWhppTmsError} from '../src/v788WhppStatusCoverage.js';
import {DEFAULT_COPY,validateIsolatedCopy} from './v788-run-isolated-readonly-acceptance.mjs';

// Explicit opt-in. Importing this module or running it without --execute
// never opens the customer DB, reads tokens, or initiates a remote request.
const allowedOrigin='https://otwms.cambodianexpress.com';
const dates=['2026-07-01','2026-07-02'];
const selected=(codes,count)=>{
  if(codes.length<=count)return codes;
  const ids=new Set();
  for(let i=0;i<count;i++)ids.add(Math.floor(i*(codes.length-1)/Math.max(1,count-1)));
  return [...ids].map(i=>codes[i]);
};
const bill=row=>String(row?.shipmentCode||'').trim().toUpperCase();
function safeStatus(code){
  return ['60','80','81'].includes(code)?code:'other';
}
export function summarizeWhppTmsProbe(requested=[],rawRows=[]){
  const expected=new Set(requested.map(x=>String(x||'').trim().toUpperCase()));
  const matched=new Map();
  let unmatchedRows=0,statuslessRows=0;
  for(const row of rawRows){
    const code=bill(row);
    if(!expected.has(code)){unmatchedRows++;continue}
    if(!hasDirectTmsShipmentStatus(row)){statuslessRows++;continue}
    matched.set(code,String(row.shipmentStatus).trim());
  }
  const statuses={s60:0,s80:0,s81:0,other:0};
  for(const value of matched.values())statuses[{60:'s60',80:'s80',81:'s81'}[value]||'other']++;
  return {requested:expected.size,responseRows:rawRows.length,
    matchedWithDirectStatus:matched.size,
    missingDirectStatus:Math.max(0,expected.size-matched.size),
    unmatchedRows,statuslessRows,statuses};
}
export async function runV788LiveTmsProbe({execute=false,samplePerDate=3,clientFactory=()=>new CEClient()}={}){
  if(!execute)return {status:'DRY_RUN',note:'No DB read, authentication, or TMS request performed. Requires explicit --execute.'};
  const safe=validateIsolatedCopy(DEFAULT_COPY);
  if(!fs.existsSync(safe))throw Error('D盘指定的V788验收副本不存在，拒绝查询');
  const perDate=Math.max(1,Math.min(5,Math.floor(Number(samplePerDate)||3)));
  const db=new DatabaseSync(safe,{readOnly:true});
  const sources=[];
  try{
    db.exec('PRAGMA query_only=ON');
    const stmt=db.prepare(`SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS shipmentCode
      FROM business_daily_parse_rows
      WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''
      ORDER BY shipmentCode`);
    for(const date of dates){
      const rows=stmt.all(date).map(bill).filter(Boolean);
      sources.push({date,sourceMembers:rows.length,codes:selected(rows,perDate)});
    }
  }finally{db.close()}
  // Never send production credentials to a user-selected/overridden host.
  const client=clientFactory();
  if(new URL(String(client.baseURL||'')).origin!==allowedOrigin)
    throw Error('安全拦截：远程地址不是预期CE TMS官方地址');
  const headers=client.headers();
  const hasAuth=Boolean(headers['Blade-Auth']||headers.Authorization);
  const result={version:'V788_LIVE_TMS_SAFE_SAMPLE_V1',
    generatedAt:new Date().toISOString(),databaseCopyUnmodified:true,
    queries:[],status:hasAuth?'IN_PROGRESS':'AUTH_NOT_CONFIGURED',
    note:'Only small-sample CE TMS /api/tms-shipment/track queries; no DB edits, no token refresh, no order numbers or raw API payloads in report.'};
  if(hasAuth){
    for(const source of sources){
      const row={date:source.date,sourceMembers:source.sourceMembers,attempted:source.codes.length};
      if(!source.codes.length){row.result='NO_SOURCE';result.queries.push(row);continue}
      try{
        // Deliberately bypass postJson/refreshTokenIfNeeded. A failed/expired
        // token remains untouched; user can re-login to the normal APP.
        const response=await client.http.post('/api/tms-shipment/track',source.codes,{
          headers,timeout:15000
        });
        if(response?.data?.success!==true||!Array.isArray(response?.data?.data)){
          row.result='INVALID_API_RESPONSE';
        }else{
          row.result='RECEIVED';
          row.summary=summarizeWhppTmsProbe(source.codes,response.data.data);
        }
      }catch(error){row.result='API_ERROR';row.errorCategory=classifyWhppTmsError(error)}
      result.queries.push(row);
    }
    result.status=result.queries.every(x=>x.result==='RECEIVED')?'QUERIES_FINISHED':'INCOMPLETE';
  }
  const target=path.join(path.dirname(safe),'V788_TMS_真实接口抽样诊断.json');
  fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n','utf8');
  return {status:result.status,report:target,queries:result.queries};
}
import {fileURLToPath} from 'node:url';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const execute=process.argv.includes('--execute');
  const sampleArg=process.argv.find(x=>x.startsWith('--sample-per-date='));
  try{
    const result=await runV788LiveTmsProbe({execute,
      samplePerDate:sampleArg?Number(sampleArg.split('=')[1]):3});
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error('[V788 SAFE TMS PROBE] '+String(error?.message||error));process.exitCode=1}
}
