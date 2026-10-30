// V788 local-only TMS evidence staging. It DOES NOT UPDATE the acceptance
// database, production database, current_state, ledger, or POD locks.
// Explicit --execute is required; without it, no file/credential/network I/O.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {initV788Sidecar,stageV788Batch,inspectV788Sidecar,v788SourceSignature}
  from './v788-whpp-tms-evidence-sidecar.mjs';
import {classifyWhppTmsError} from '../src/v788WhppStatusCoverage.js';
import {getTokenFile} from '../src/authStore.js';
import {CEClient} from '../src/ceClient.js';

const DIR=path.win32.join('D:/','CE_QC_V788_验收副本');
const SOURCE=path.win32.join(DIR,'ce_qc_monitor.db');
const SIDECAR=path.win32.join(DIR,'V788_WHPP_TMS_逐票证据.sqlite');
const REPORT=path.win32.join(DIR,'V788_WHPP_TMS_逐票证据验收.json');
const ORIGIN='https://otwms.cambodianexpress.com';
const TMS_URL=ORIGIN+'/api/tms-shipment/track';
const EXPECTED=[['2026-07-01',190],['2026-07-02',156]];
const BATCH=50;
const norm=value=>String(value||'').trim().toUpperCase();

function exactPhysicalFile(file){
  if(!fs.existsSync(file))throw Error('V788_ISOLATED_SOURCE_MISSING');
  if(!fs.statSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())
    throw Error('V788_SOURCE_NOT_REGULAR_FILE');
  const real=path.win32.normalize(fs.realpathSync.native(file)).toLowerCase();
  if(real!==path.win32.normalize(file).toLowerCase())throw Error('V788_ISOLATED_PATH_REDIRECT');
}
function checkOutputPath(file){
  if(!fs.existsSync(file))return;
  if(!fs.statSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()
    ||path.win32.normalize(fs.realpathSync.native(file)).toLowerCase()
      !==path.win32.normalize(file).toLowerCase())
    throw Error('V788_UNSAFE_OUTPUT_PATH');
}
function identity(){
  const info=f=>{try{const s=fs.statSync(f);return [s.size,s.mtimeMs]}catch(e){if(e.code==='ENOENT')return null;throw e}};
  return JSON.stringify({db:info(SOURCE),wal:info(SOURCE+'-wal')});
}
function readSources(){
  const db=new DatabaseSync(SOURCE,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON');
    const query=db.prepare("SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS code FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY code");
    const current=db.prepare("SELECT UPPER(TRIM(shipmentCode)) AS code,state FROM shipment_current_state WHERE businessType='WHPP' AND reportDate=?");
    return EXPECTED.map(([date,total])=>{
      const codes=query.all(date).map(r=>norm(r.code));
      if(codes.length!==total||new Set(codes).size!==total)throw Error('V788_SOURCE_MEMBERSHIP_CHANGED');
      const states=new Map(current.all(date).map(r=>[norm(r.code),r.state]));
      return {date,codes,states};
    });
  }finally{db.close()}
}
function token(){
  try{
    const t=JSON.parse(fs.readFileSync(getTokenFile(),'utf8'));
    const access=String(t.access_token||'').trim();
    let expires=Number(t.expires_at||0);
    if(expires>0&&expires<1e11)expires*=1000;
    if(!access||!expires||expires<=Date.now()+180000)return null;
    return {access,tenant:String(t.tenantId||t.tenant_id||'000000'),
      type:String(t.token_type||'bearer')};
  }catch{return null}
}
async function query(codes,t){
  // Use the same header/tenant/DNS behavior as the working CE QC client.
  // Deliberately call the raw HTTP client: postJson/refreshTokenIfNeeded can
  // mutate or erase the user's saved login and is forbidden for this tool.
  const client=new CEClient();
  const endpoint=new URL(String(client.baseURL||''));
  if(endpoint.origin!==ORIGIN||endpoint.username||endpoint.password
    ||(endpoint.pathname!=='/'&&endpoint.pathname!==''))
    throw Error('V788_TMS_ORIGIN_NOT_ALLOWED');
  const headers=client.headers();
  const blade=String(headers['Blade-Auth']||'');
  if(!blade.endsWith(' '+t.access)||!t.access)
    throw Error('V788_TMS_TOKEN_SOURCE_MISMATCH');
  const resp=await client.http.post('/api/tms-shipment/track',codes,{
    headers,timeout:18000,maxRedirects:0
  });
  const json=resp?.data;
  if(json?.success!==true)throw Object.assign(new Error('V788_TMS_API_REJECTED'),{
    ceCode:json?.code,ceMsg:json?.msg||json?.message});
  if(!Array.isArray(json.data))throw Error('V788_TMS_SCHEMA_INVALID');
  return json.data;
}
function sanitize(err){
  const s=String(err?.message||'');
  if(s.startsWith('V788_'))return s.slice(0,80);
  return 'V788_TMS_'+classifyWhppTmsError(err);
}
function saveReport(r){
  checkOutputPath(REPORT);
  const temp=REPORT+'.partial';
  checkOutputPath(temp);
  fs.writeFileSync(temp,JSON.stringify(r,null,2)+'\n','utf8');
  fs.renameSync(temp,REPORT);
}
export async function runV788Stage({execute=false}={}){
  if(!execute)return {status:'DRY_RUN',openedDatabase:false,queriedTms:false};
  if(process.platform!=='win32')throw Error('V788_WINDOWS_ONLY');
  exactPhysicalFile(SOURCE);
  if(path.win32.normalize(fs.realpathSync.native(DIR)).toLowerCase()!==path.win32.normalize(DIR).toLowerCase())throw Error('V788_ISOLATED_DIRECTORY_REDIRECT');
  checkOutputPath(SIDECAR);checkOutputPath(REPORT);checkOutputPath(REPORT+'.partial');
  const before=identity(),sources=readSources(),signature=v788SourceSignature(sources);
  // This is a NEW evidence file in the isolated directory, not an update to
  // ce_qc_monitor.db or its -wal. Do not allow a junction/symlink substitution.
  const ledger=new DatabaseSync(SIDECAR);
  const report={version:'V788_WHPP_TMS_EVIDENCE_SIDECAR_V1',
    status:'RUNNING',generatedAt:new Date().toISOString(),
    sourceMembers:346,sourceSignature:signature,isolatedCopyUnchanged:false,
    evidenceLocation:'ISOLATED_DIR_SEPARATE_SQLITE',batches:[]};
  try{
    initV788Sidecar(ledger,signature);
    let failure='';
    for(const source of sources){
      for(let index=0;index<Math.ceil(source.codes.length/BATCH);index++){
        const codes=source.codes.slice(index*BATCH,(index+1)*BATCH);
        const committed=ledger.prepare('SELECT requested FROM v788_batch_commits WHERE reportDate=? AND batchIndex=?').get(source.date,index);
        if(committed){
          if(committed.requested!==codes.length)throw Error('V788_SIDECAR_BATCH_SIZE_MISMATCH');
          // A batch is reusable only when EVERY exact requested member is
          // still present in the sidecar. Never silently skip a corrupt batch.
          const saved=ledger.prepare('SELECT shipmentCode FROM v788_tms_evidence WHERE reportDate=? AND shipmentCode=?');
          if(codes.some(code=>!saved.get(source.date,code)))
            throw Error('V788_SIDECAR_BATCH_MEMBERS_MISSING');
          report.batches.push({date:source.date,index,requested:codes.length,result:'REUSED'});
          continue;
        }
        const creds=token();
        if(!creds){failure='V788_TOKEN_EXPIRED_STOP';break}
        try{
          const rows=await query(codes,creds);
          const staged=stageV788Batch(ledger,{date:source.date,index,codes,rows});
          report.batches.push({date:source.date,index,requested:codes.length,
            result:'STAGED',matched:staged.matched});
        }catch(e){
          failure=sanitize(e);
          report.batches.push({date:source.date,index,requested:codes.length,
            result:'FAILED',failureCategory:classifyWhppTmsError(e)});
          break;
        }
        report.coverage=inspectV788Sidecar(ledger,sources);
        report.isolatedCopyUnchanged=before===identity();
        if(!report.isolatedCopyUnchanged){
          failure='V788_ISOLATED_SOURCE_CHANGED_DURING_READ';
          report.batches[report.batches.length-1].sourceChanged=true;
        }
        saveReport(report);
        if(failure)break;
        await new Promise(resolve=>setTimeout(resolve,400));
      }
      if(failure)break;
    }
    report.coverage=inspectV788Sidecar(ledger,sources);
    report.isolatedCopyUnchanged=before===identity();
    report.status=failure?'STOPPED_RETRYABLE':report.coverage.complete&&report.isolatedCopyUnchanged
      ?'346_TMS_ROWS_STAGED_NOT_BUSINESS_ACCEPTED':'EVIDENCE_INCOMPLETE';
    if(failure)report.failure=failure;
    saveReport(report);
    return {status:report.status,coverage:report.coverage,
      isolatedCopyUnchanged:report.isolatedCopyUnchanged,
      reportFile:REPORT};
  }finally{ledger.close()}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const r=await runV788Stage({execute:process.argv.includes('--execute')});
    console.log(JSON.stringify(r,null,2));
    if(r.status!=='DRY_RUN'&&r.status!=='346_TMS_ROWS_STAGED_NOT_BUSINESS_ACCEPTED')process.exitCode=2;
  }catch(e){
    console.error('[V788 STAGE] '+sanitize(e));process.exitCode=1;
  }
}
