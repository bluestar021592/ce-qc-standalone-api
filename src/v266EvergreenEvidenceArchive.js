import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { getRuntimeConfig } from './db.js';
import { CEClient } from './ceClient.js';

export const V266_EVERGREEN_EVIDENCE_ARCHIVE_ID='2026-08-23-v266-evergreen-evidence-archive-v1';
export const V266_MIN_RETENTION_DAYS=366;
export const V266_RETENTION_POLICY='NO_AUTOMATIC_ARCHIVE_DELETE_BEFORE_OR_AFTER_RETENTION; annual cleanup requires an explicit future guarded action';
const gzipAsync=promisify(gzip),gunzipAsync=promisify(gunzip);
const cfg=getRuntimeConfig();
const archiveRoot=path.join(cfg.dataDir,'evidence_archive');
const sourceRoot=path.join(archiveRoot,'source_uploads');
const apiRoot=path.join(archiveRoot,'ce_api');
const importsRoot=path.resolve(cfg.importsDir);
const originalUnlink=fsPromises.unlink.bind(fsPromises);
const originalPostJson=CEClient.prototype.postJson;
let unlinkPatched=false,clientPatched=false;

const iso=()=>new Date().toISOString();
const retainUntil=(createdAt=iso())=>{const d=new Date(createdAt);d.setUTCDate(d.getUTCDate()+V266_MIN_RETENTION_DAYS);return d.toISOString();};
const safePart=value=>String(value||'unknown').replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||'unknown';
function isImportTemp(filePath=''){
  try{const rel=path.relative(importsRoot,path.resolve(String(filePath||'')));return Boolean(rel)&&!rel.startsWith('..')&&!path.isAbsolute(rel);}catch{return false;}
}
async function ensureDirs(){await Promise.all([fsPromises.mkdir(sourceRoot,{recursive:true}),fsPromises.mkdir(apiRoot,{recursive:true})]);}
async function sha256File(filePath){
  return new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');const stream=fs.createReadStream(filePath);stream.on('error',reject);stream.on('data',chunk=>h.update(chunk));stream.on('end',()=>resolve(h.digest('hex')));});
}
async function sniffExtension(filePath){
  let handle;try{handle=await fsPromises.open(filePath,'r');const buffer=Buffer.alloc(32);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);const b=buffer.subarray(0,bytesRead);if(b.length>=4&&b[0]===0x50&&b[1]===0x4b&&b[2]===0x03&&b[3]===0x04)return'.xlsx';if(b.length>=8&&b[0]===0xd0&&b[1]===0xcf&&b[2]===0x11&&b[3]===0xe0)return'.xls';const text=b.toString('utf8').trimStart();if(text.startsWith('{')||text.startsWith('['))return'.json';return'.bin';}catch{return'.bin';}finally{await handle?.close?.().catch(()=>{});}
}
async function archiveSourceFile(filePath,{reason='IMPORT_UNLINK_GUARD'}={}){
  if(!isImportTemp(filePath))return{archived:false,skipped:true,reason:'OUTSIDE_IMPORTS'};
  await ensureDirs();const stat=await fsPromises.stat(filePath);if(!stat.isFile())return{archived:false,skipped:true,reason:'NOT_FILE'};
  const hash=await sha256File(filePath),ext=await sniffExtension(filePath),createdAt=iso(),month=createdAt.slice(0,7);const dir=path.join(sourceRoot,month);await fsPromises.mkdir(dir,{recursive:true});
  const target=path.join(dir,`${hash}${ext}`),metaPath=path.join(dir,`${hash}.meta.json`);
  try{await fsPromises.access(target);}catch{await fsPromises.copyFile(filePath,target);}
  const meta={id:V266_EVERGREEN_EVIDENCE_ARCHIVE_ID,kind:'SOURCE_UPLOAD',sha256:hash,bytes:stat.size,extension:ext,capturedAt:createdAt,retainUntil:retainUntil(createdAt),reason,sourceTempName:path.basename(filePath),archivePath:target,policy:V266_RETENTION_POLICY};
  try{await fsPromises.writeFile(metaPath,JSON.stringify(meta,null,2),{flag:'wx'});}catch(error){if(error?.code!=='EEXIST')throw error;}
  return{archived:true,deduped:fs.existsSync(target),...meta};
}
async function archiveCeApiEvidence({endpoint='',requestBody=null,responseData=null,label=''}){
  await ensureDirs();const capturedAt=iso(),day=capturedAt.slice(0,10),folder=safePart(endpoint.replace(/^\/api\//,''));const dir=path.join(apiRoot,day,folder);await fsPromises.mkdir(dir,{recursive:true});
  const core={endpoint:String(endpoint||''),label:String(label||''),requestBody,responseData};const canonical=JSON.stringify(core);const hash=crypto.createHash('sha256').update(canonical).digest('hex');const target=path.join(dir,`${hash}.json.gz`);
  try{await fsPromises.access(target);return{archived:true,deduped:true,sha256:hash,path:target};}catch{}
  const payload={id:V266_EVERGREEN_EVIDENCE_ARCHIVE_ID,kind:'CE_API_EVIDENCE',capturedAt,retainUntil:retainUntil(capturedAt),policy:V266_RETENTION_POLICY,...core};const compressed=await gzipAsync(Buffer.from(JSON.stringify(payload),'utf8'),{level:6});await fsPromises.writeFile(target,compressed,{flag:'wx'}).catch(error=>{if(error?.code!=='EEXIST')throw error;});return{archived:true,deduped:false,sha256:hash,path:target,bytes:compressed.length};
}
export async function readV266ApiEvidence(filePath){const raw=await fsPromises.readFile(filePath);return JSON.parse((await gunzipAsync(raw)).toString('utf8'));}
export function getV266EvidenceArchivePaths(){return{archiveRoot,sourceRoot,apiRoot,importsRoot,retentionDays:V266_MIN_RETENTION_DAYS,policy:V266_RETENTION_POLICY};}

function patchImportDeletion(){
  if(unlinkPatched||globalThis.__CE_QC_V266_IMPORT_DELETE_GUARD__)return;unlinkPatched=true;globalThis.__CE_QC_V266_IMPORT_DELETE_GUARD__=true;
  fsPromises.unlink=async function v266ArchiveBeforeImportDelete(filePath,...args){
    if(!isImportTemp(filePath))return originalUnlink(filePath,...args);
    try{await archiveSourceFile(filePath,{reason:'PRESERVE_BEFORE_TEMP_DELETE'});}catch(error){console.error('[CE-QC][V266_EVIDENCE] source archive failed; original import temp is intentionally retained:',error?.message||error);throw error;}
    return originalUnlink(filePath,...args);
  };
}
function patchCeClient(){
  if(clientPatched||globalThis.__CE_QC_V266_CE_ARCHIVE_PATCH__)return;clientPatched=true;globalThis.__CE_QC_V266_CE_ARCHIVE_PATCH__=true;
  CEClient.prototype.postJson=async function v266EvidencePostJson(endpoint,body,label,canRetryAuth=true){
    const data=await originalPostJson.call(this,endpoint,body,label,canRetryAuth);
    try{await archiveCeApiEvidence({endpoint,requestBody:body,responseData:data,label});}catch(error){console.error('[CE-QC][V266_EVIDENCE] CE evidence archive failed; normalized runtime data remains available:',error?.message||error);}
    return data;
  };
}
async function seedExistingImportTemps(){
  try{await ensureDirs();const names=await fsPromises.readdir(importsRoot);let archived=0,failed=0;for(const name of names.slice(0,5000)){const filePath=path.join(importsRoot,name);try{const stat=await fsPromises.stat(filePath);if(!stat.isFile())continue;await archiveSourceFile(filePath,{reason:'STARTUP_EXISTING_IMPORT_SEED'});archived+=1;}catch{failed+=1;}}console.log('[CE-QC][V266_EVIDENCE]',JSON.stringify({id:V266_EVERGREEN_EVIDENCE_ARCHIVE_ID,seedExistingImports:true,archived,failed,archiveRoot,retentionDays:V266_MIN_RETENTION_DAYS,automaticDelete:false}));}catch(error){console.warn('[CE-QC][V266_EVIDENCE] existing import seed skipped:',error?.message||error);}
}

patchImportDeletion();patchCeClient();
if(!process.env.CI&&process.env.NODE_ENV!=='test'){const timer=setTimeout(()=>void seedExistingImportTemps(),30_000);timer.unref?.();}
console.log(`[CE-QC][V266_EVIDENCE] ${V266_EVERGREEN_EVIDENCE_ARCHIVE_ID} enabled: source uploads are archived before temp deletion; successful CE API bodies are gzip archived and deduplicated; retention >=${V266_MIN_RETENTION_DAYS} days; no automatic archive deletion.`);
