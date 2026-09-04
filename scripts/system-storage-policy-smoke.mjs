import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-storage-core-'));
const dataRoot=path.join(root,'data-root');
const runtimeRoot=path.join(root,'runtime-root');
for(const dir of [dataRoot,runtimeRoot])fs.mkdirSync(dir,{recursive:true});

const saved={...process.env};
Object.assign(process.env,{
  DATA_DIR:dataRoot,
  DB_FILE:path.join(dataRoot,'ce_qc_monitor.db'),
  CE_QC_RUNTIME_DIR:runtimeRoot
});
for(const key of ['EXPORTS_DIR','IMPORTS_DIR','BACKUPS_DIR','LOGS_DIR','EVIDENCE_ARCHIVE_DIR','CE_QC_TEMP_DIR','TEMP','TMP'])delete process.env[key];

try{
  const {applyStoragePolicy,resolveStorageLayout,ensureStorageLayout,STORAGE_POLICY_ID}=await import('../src/storagePolicy.js');
  const {inspectPreUpdateBackups,prunePreUpdateBackups,pruneExpiredEvidence,pruneRuntimeTemps,STORAGE_MAINTENANCE_ID}=await import('../src/storageMaintenance.js');
  const layout=applyStoragePolicy({baseDir:root});
  ensureStorageLayout(layout);
  assert.equal(layout.id,STORAGE_POLICY_ID);
  assert.equal(path.normalize(layout.dataRoot),path.normalize(dataRoot));
  assert.equal(path.normalize(layout.runtimeRoot),path.normalize(runtimeRoot));
  assert.equal(path.normalize(layout.dbFile),path.normalize(path.join(dataRoot,'ce_qc_monitor.db')));
  for(const [key,dir] of [['exportsDir','exports'],['importsDir','imports'],['backupsDir','backups'],['logsDir','logs'],['evidenceArchiveDir','evidence_archive'],['tempDir','temp']]){
    assert.equal(path.normalize(layout[key]),path.normalize(path.join(runtimeRoot,dir)),`${key} must live under runtimeRoot`);
    assert.equal(fs.existsSync(layout[key]),true,`${key} must be created by core policy`);
  }

  fs.writeFileSync(layout.dbFile,Buffer.alloc(1024,'D'));
  const preRoot=path.join(dataRoot,'backups','pre_update');fs.mkdirSync(preRoot,{recursive:true});
  const times=[4,3,2].map(days=>new Date(Date.now()-days*24*60*60*1000));
  for(const [index,name] of ['20260901-010000','20260902-010000','20260903-010000'].entries()){
    const dir=path.join(preRoot,name);fs.mkdirSync(dir,{recursive:true});
    const dbCopy=path.join(dir,'ce_qc_monitor.db');fs.writeFileSync(dbCopy,Buffer.alloc(2048,name));
    fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({ok:true,name}));
    fs.utimesSync(dbCopy,times[index],times[index]);fs.utimesSync(dir,times[index],times[index]);
  }
  let inventory=inspectPreUpdateBackups(dataRoot);
  assert.equal(inventory.entries.filter(row=>row.complete).length,3);
  const pruned=prunePreUpdateBackups({dataRoot,keep:2,minAgeMs:24*60*60*1000});
  assert.equal(pruned.id,STORAGE_MAINTENANCE_ID);
  assert.equal(pruned.removed,1,'two verified rollback generations must remain');
  inventory=inspectPreUpdateBackups(dataRoot);
  assert.equal(inventory.entries.filter(row=>row.complete).length,2);
  assert.equal(fs.existsSync(layout.dbFile),true,'live database must never be touched by pre-update retention');
  assert.equal(fs.statSync(layout.dbFile).size,1024);

  const currentEvidence=path.join(layout.evidenceArchiveDir,'current.json.gz');
  const expiredEvidence=path.join(layout.evidenceArchiveDir,'expired.json.gz');
  fs.writeFileSync(currentEvidence,'current');fs.writeFileSync(expiredEvidence,'expired');
  const currentTime=new Date(Date.now()-100*24*60*60*1000),expiredTime=new Date(Date.now()-401*24*60*60*1000);
  fs.utimesSync(currentEvidence,currentTime,currentTime);fs.utimesSync(expiredEvidence,expiredTime,expiredTime);
  const evidence=pruneExpiredEvidence({roots:[layout.evidenceArchiveDir],retentionDays:400});
  assert.equal(evidence.removed,1);
  assert.equal(fs.existsSync(currentEvidence),true,'evidence inside retention window must remain');
  assert.equal(fs.existsSync(expiredEvidence),false,'evidence beyond >=366-day retention may be pruned');

  const protectedEvidence=path.join(layout.evidenceArchiveDir,'protected-365.json.gz');
  fs.writeFileSync(protectedEvidence,'protected');
  const protectedTime=new Date(Date.now()-365*24*60*60*1000);fs.utimesSync(protectedEvidence,protectedTime,protectedTime);
  const forcedShort=pruneExpiredEvidence({roots:[layout.evidenceArchiveDir],retentionDays:30});
  assert.equal(forcedShort.retentionDays,366,'configuration cannot reduce evidence retention below 366 days');
  assert.equal(fs.existsSync(protectedEvidence),true,'365-day evidence must remain even if an unsafe shorter retention is requested');

  const oldTemp=path.join(layout.tempDir,'old.tmp'),newTemp=path.join(layout.tempDir,'new.tmp');
  fs.writeFileSync(oldTemp,'old');fs.writeFileSync(newTemp,'new');
  fs.utimesSync(oldTemp,new Date(Date.now()-20*24*60*60*1000),new Date(Date.now()-20*24*60*60*1000));
  const tempResult=pruneRuntimeTemps({roots:[layout.tempDir],maxAgeDays:14});
  assert.equal(tempResult.removed,1);
  assert.equal(fs.existsSync(newTemp),true);

  const finalLayout=resolveStorageLayout({baseDir:root});
  assert.equal(path.normalize(finalLayout.evidenceArchiveDir),path.normalize(path.join(runtimeRoot,'evidence_archive')),'evidence cannot silently fall back to dataRoot/D after policy application');
  console.log('[SYSTEM STORAGE] passed · one core C/D layout · DB remains persistent-data · runtime/evidence/backups/exports/imports/logs/temp use runtime root · two verified rollback generations retained · evidence retention never drops below 366d · live DB untouched');
} finally {
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
  fs.rmSync(root,{recursive:true,force:true});
}
