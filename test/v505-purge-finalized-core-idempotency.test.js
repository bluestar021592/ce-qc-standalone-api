import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('V505 core finalizer treats an already-finalized durable receipt as terminal and never re-enters cleanup',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-finalized-core-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {finalizeCommittedPurge}=await import('../src/dataPurge.js');
  const db=getDb();
  const cfg=getRuntimeConfig();
  const challengeId='00000000-0000-4000-8000-000000000521';
  const executeJobId='00000000-0000-4000-8000-000000000522';
  const finalizedAt='2026-09-12T10:20:00.000Z';
  try{
    // Legitimate activity created only after the old purge already finalized.
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-12');
    fs.mkdirSync(cfg.importsDir,{recursive:true});
    fs.mkdirSync(cfg.exportsDir,{recursive:true});
    const importSentinel=path.join(cfg.importsDir,'new-import-after-finalize.txt');
    const exportSentinel=path.join(cfg.exportsDir,'new-export-after-finalize.txt');
    fs.writeFileSync(importSentinel,'new import must survive','utf8');
    fs.writeFileSync(exportSentinel,'new export must survive','utf8');

    const receipt={
      version:2,challengeId,executeJobId,administrator:'core-finalized@example.test',
      committedAt:'2026-09-12T10:19:00.000Z',finalizedAt,finalizationState:'SAFE_POSTCHECK_PASSED',
      recoveryBlockUntil:Date.now()-60_000,sourceFingerprintMatched:true,
      sourceFingerprintGate:'BEGIN_IMMEDIATE_LOCKED_BEFORE_DELETE',
      // Deliberately unavailable now. A terminal finalized receipt must not need
      // to reopen or re-verify the old backup after normal writes resumed.
      backup:{filePath:path.join(dir,'old-backup-no-longer-mounted.db'),sha256:'c'.repeat(64),size:123,mtimeMs:1,integrity:'ok',method:'test'},
      before:{daily_reports:1},after:{daily_reports:0},
      fileCleanupWarnings:['historical cleanup warning preserved in durable receipt']
    };
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_last_commit_receipt',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify(receipt),finalizedAt);
    db.prepare("DELETE FROM app_meta WHERE key='data_purge_block_until'").run();

    const recovered=await finalizeCommittedPurge({
      challengeId,executeJobId,
      user:{email:'core-finalized@example.test',role:'ADMIN'},
      recoveredAfterCommit:true
    });

    assert.equal(recovered.recoveredAfterFinalize,true,'already-finalized receipt must take the terminal idempotent path');
    assert.equal(recovered.finalizedAt,finalizedAt);
    assert.deepEqual(recovered.fileCleanupWarnings,receipt.fileCleanupWarnings,'durable finalization warnings must survive recovery');
    assert.equal(recovered.integrity,'committed-with-warnings');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,1,'terminal recovery must not validate/delete legitimate new business data against the old zero-state');
    assert.equal(fs.existsSync(importSentinel),true,'terminal recovery must not re-enter import cleanup');
    assert.equal(fs.existsSync(exportSentinel),true,'terminal recovery must not re-enter export cleanup');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
