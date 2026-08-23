import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v255-storage-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'ce_qc_monitor.db');
process.env.ACCESS_MODE='LOCAL';

const {getRuntimeConfig,closeDb}=await import('../src/db.js');
const {pruneRedundantFullBackups,retentionPolicyStatus,safeWalCheckpoint,V255_RETENTION_STORAGE_ID}=await import('../src/v255RetentionStorageGuard.js');
const cfg=getRuntimeConfig();fs.mkdirSync(cfg.backupsDir,{recursive:true});
const now=Date.now();
for(let i=0;i<4;i++){
  const file=path.join(cfg.backupsDir,`full-${i}.db`);fs.writeFileSync(file,Buffer.alloc(32));
  const ageDays=i<2?i:20+i;const when=new Date(now-ageDays*24*60*60*1000);fs.utimesSync(file,when,when);
}
const before=fs.readdirSync(cfg.backupsDir).filter(n=>n.endsWith('.db')).length;
assert.equal(before,4);
const pruned=pruneRedundantFullBackups();
assert.equal(pruned.removed,2,'only old redundant full backups beyond newest two should be pruned');
assert.equal(fs.readdirSync(cfg.backupsDir).filter(n=>n.endsWith('.db')).length,2,'two newest full backups must remain');
const policy=retentionPolicyStatus();
assert.equal(policy.policyId,V255_RETENTION_STORAGE_ID);
assert.ok(policy.businessRetentionDays>=365,'business hot retention must cover at least one year');
assert.equal(policy.archiveRequiredBeforeBusinessDelete,true,'business data deletion requires verified cloud archive');
const wal=safeWalCheckpoint();assert.equal(wal.attempted,false,'small/missing WAL should not trigger checkpoint churn');
closeDb();fs.rmSync(root,{recursive:true,force:true});
console.log('[V255] storage retention smoke passed: one-year+ business retention + archive-before-delete + keep newest full backups + bounded WAL guard');
