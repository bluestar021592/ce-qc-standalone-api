import path from 'node:path';
import os from 'node:os';

export const V303_STORAGE_POLICY_ID='2026-08-25-v303-cd-split-storage-v1';

function runtimeRoot(){
  if(String(process.env.CE_QC_RUNTIME_DIR||'').trim())return path.resolve(String(process.env.CE_QC_RUNTIME_DIR).trim());
  if(String(process.env.EXPORTS_DIR||'').trim())return path.dirname(path.resolve(String(process.env.EXPORTS_DIR).trim()));
  if(process.platform==='win32'){
    const local=String(process.env.LOCALAPPDATA||'').trim();
    if(local)return path.join(local,'CE_QC_RUNTIME');
    return path.join(String(process.env.SystemDrive||'C:'),'CE_QC_RUNTIME');
  }
  return path.join(os.homedir(),'.ce-qc-runtime');
}

const root=runtimeRoot();
if(!process.env.EXPORTS_DIR)process.env.EXPORTS_DIR=path.join(root,'exports');
if(!process.env.IMPORTS_DIR)process.env.IMPORTS_DIR=path.join(root,'imports');
if(!process.env.BACKUPS_DIR)process.env.BACKUPS_DIR=path.join(root,'backups');
if(!process.env.LOGS_DIR)process.env.LOGS_DIR=path.join(root,'logs');
if(!process.env.EVIDENCE_ARCHIVE_DIR)process.env.EVIDENCE_ARCHIVE_DIR=path.join(root,'evidence_archive');

process.env.CE_QC_RUNTIME_DIR=root;
console.log('[CE-QC][V303_STORAGE_POLICY]',JSON.stringify({id:V303_STORAGE_POLICY_ID,runtimeRoot:root,exportsDir:process.env.EXPORTS_DIR,importsDir:process.env.IMPORTS_DIR,backupsDir:process.env.BACKUPS_DIR,logsDir:process.env.LOGS_DIR,evidenceArchiveDir:process.env.EVIDENCE_ARCHIVE_DIR,databasePolicy:'PRIMARY_SQLITE_STAYS_ON_DATA_DIR'}));
