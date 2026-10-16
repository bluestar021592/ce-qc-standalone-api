// V788: create a disposable *trial* database by SQLite online backup from
// the exact, previously isolated D: acceptance copy. Never read production.
// Never modify the source, do not modify/clear/import formal business records.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync,backup} from 'node:sqlite';
import {v788ReadSourceMembershipSignature} from './v788-whpp-tms-evidence-sidecar.mjs';

export const SOURCE=String.raw`D:\CE_QC_V788_验收副本\ce_qc_monitor.db`;
export const PILOT_ROOT=String.raw`D:\CE_QC_V788_试用沙盒`;
function norm(s){return path.win32.normalize(s).toLowerCase()}
function physicalPlainFile(file){
  const st=fs.lstatSync(file);
  if(st.isSymbolicLink()||!st.isFile()||norm(fs.realpathSync.native(file))!==norm(file))
    throw Error('V788_PILOT_UNSAFE_ISOLATED_FILE');
}
export async function makeV788PilotSnapshot(target,{source=SOURCE,pilotRoot=PILOT_ROOT}={}){
  if(process.platform!=='win32')throw Error('V788_PILOT_WINDOWS_REQUIRED');
  if(norm(source)!==norm(SOURCE)||norm(pilotRoot)!==norm(PILOT_ROOT))
    throw Error('V788_PILOT_ISOLATED_PATH_REQUIRED');
  physicalPlainFile(source);
  const srcDir=path.win32.dirname(source);
  if(norm(fs.realpathSync.native(srcDir))!==norm(srcDir))throw Error('V788_PILOT_SOURCE_DIRECTORY_REDIRECT');
  if(!fs.existsSync(pilotRoot))throw Error('V788_PILOT_ROOT_MISSING');
  if(norm(fs.realpathSync.native(pilotRoot))!==norm(pilotRoot))throw Error('V788_PILOT_ROOT_REDIRECT');
  const full=path.win32.resolve(target);
  const rootWithSep=norm(pilotRoot).replace(/[\\]+$/,'')+'\\';
  if(!norm(full).startsWith(rootWithSep)||!full.toLowerCase().endsWith('.db'))
    throw Error('V788_PILOT_OUTPUT_MUST_BE_IN_SANDBOX');
  if(fs.existsSync(full)||fs.existsSync(full+'.partial'))throw Error('V788_PILOT_OUTPUT_EXISTS');
  const folder=path.win32.dirname(full);
  if(!fs.existsSync(folder))throw Error('V788_PILOT_OUTPUT_FOLDER_MISSING');
  if(norm(fs.realpathSync.native(folder))!==norm(folder))throw Error('V788_PILOT_OUTPUT_REDIRECT');
  const stBefore=fs.statSync(source);
  const walBefore=statWal(source);
  const src=new DatabaseSync(source,{readOnly:true});
  let signature='';
  try{
    src.exec('PRAGMA query_only=ON');
    signature=v788ReadSourceMembershipSignature(src);
    // Node's built-in SQLite backup yields a transaction-consistent snapshot.
    // Destination is sandbox-only. Source DB handle is opened readOnly.
    await backup(src,full+'.partial');
  }finally{src.close()}
  if(stBefore.size!==fs.statSync(source).size
      ||stBefore.mtimeMs!==fs.statSync(source).mtimeMs
      ||JSON.stringify(walBefore)!==JSON.stringify(statWal(source))){
    fs.rmSync(full+'.partial',{force:true});
    throw Error('V788_PILOT_SOURCE_CHANGED_DURING_COPY');
  }
  fs.renameSync(full+'.partial',full);
  return {ok:true,mode:'DISPOSABLE_TRIAL_FROM_ISOLATED_COPY',
    sourceMembers:346,sourceSignature:signature,sourceReadOnly:true,
    formalDatabaseOpened:false,readyToPublish:false};
}
function statWal(file){
  try{const v=fs.statSync(file+'-wal');return {size:v.size,mtimeMs:v.mtimeMs}}
  catch(e){if(e?.code==='ENOENT')return null;throw e}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=process.argv.find(x=>x.startsWith('--out='));
  if(!arg){console.error('V788_PILOT_OUTPUT_REQUIRED');process.exitCode=2}
  else try{
    const result=await makeV788PilotSnapshot(arg.slice(6));
    console.log(JSON.stringify(result));
  }catch(e){
    console.error(String(e?.message||'V788_PILOT_SNAPSHOT_FAILED'));
    process.exitCode=1;
  }
}
