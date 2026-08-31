import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v378-whpp-lock-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'v378.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.NODE_ENV='test';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {inspectV378WhppCompletionLock,V378_WHPP_COMPLETION_LOCK_REVISION}=await import('../src/v134WhppRunSupervisorPatch.js');
const db=getDb();
const date='2026-08-24';
const now='2026-08-31T05:00:00.000Z';

const finalizedSummary={
  batchId:'BATCH-0824-A',snapshotId:'SOURCE-0824-A',total:203,
  completed:true,snapshotStatus:'COMPLETED',reconciliationStatus:'COMPLETED',
  finalizedSnapshotId:'WHPP-FINAL-0824-A',finalizedAt:now
};
db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt)
  VALUES(?,?,?,?,?,?,?)`).run('WHPP',date,'8-24.xls',203,JSON.stringify(finalizedSummary),now,now);

const sameLifecycle=inspectV378WhppCompletionLock(date,{reportDate:date,sourceSnapshotId:'SOURCE-0824-A'},db);
assert.equal(sameLifecycle.revision,V378_WHPP_COMPLETION_LOCK_REVISION);
assert.equal(sameLifecycle.locked,true);
assert.equal(sameLifecycle.reason,'CURRENT_DAILY_ALREADY_FINALIZED');
assert.equal(sameLifecycle.finalizedSnapshotId,'WHPP-FINAL-0824-A');

// The persisted daily completion marker is authoritative. A transient in-memory
// source mismatch must never reopen a finalized daily before the re-import commit
// actually replaces business_daily_reports.summaryJson.
const transientDifferentState=inspectV378WhppCompletionLock(date,{reportDate:date,sourceSnapshotId:'SOURCE-0824-B'},db);
assert.equal(transientDifferentState.sourceMatches,false);
assert.equal(transientDifferentState.locked,true);
assert.equal(transientDifferentState.reason,'CURRENT_DAILY_ALREADY_FINALIZED');

// saveWhppDailyImport semantics for a real same-date re-upload overwrite summaryJson
// with the new source snapshot and remove the old finalized marker. Reproduce that
// database boundary directly and ensure the lock opens only after this durable write.
const reimportSummary={batchId:'BATCH-0824-B',snapshotId:'SOURCE-0824-B',total:203};
db.prepare("UPDATE business_daily_reports SET summaryJson=?,updatedAt=? WHERE businessType='WHPP' AND reportDate=?")
  .run(JSON.stringify(reimportSummary),'2026-08-31T05:10:00.000Z',date);
const afterReimport=inspectV378WhppCompletionLock(date,{reportDate:date,sourceSnapshotId:'SOURCE-0824-B'},db);
assert.equal(afterReimport.locked,false);
assert.equal(afterReimport.finalized,false);
assert.equal(afterReimport.reason,'CURRENT_DAILY_NOT_FINALIZED');

const source=fs.readFileSync(new URL('../src/v134WhppRunSupervisorPatch.js',import.meta.url),'utf8');
assert.match(source,/V378_WHPP_COMPLETION_LOCK_REVISION/);
assert.match(source,/locked: finalized/,
  'durable normalized-daily finalization must remain authoritative until a re-import replaces the marker');
assert.match(source,/const completionLock = inspectV378WhppCompletionLock\(state\.reportDate, state\)/,
  'every explicit WHPP launch must check the durable daily finalization marker before CE network work');
assert.match(source,/if \(persistedCompletion\.locked\) return false;/,
  'backend 5s continuity owner must not restart a finalized WHPP lifecycle');
assert.match(source,/if \(afterPersistedCompletion\.locked\) return false;/,
  'backend continuity must recheck the lock after recovery before launching');
assert.match(source,/error\?\.code === 'WHPP_ALREADY_FINALIZED'/,
  'duplicate start/resume must be a completed no-op instead of a new run');
assert.match(source,/accepted: false,[\s\S]*completed: true/,
  'duplicate finalized start must answer success without entering processing');

closeDb();
fs.rmSync(root,{recursive:true,force:true});
console.log('[V378] WHPP completion-lock smoke passed · persisted finalized daily is monotonic even across transient state-source mismatch · duplicate start/resume cannot re-enter processing · backend 5s supervisor cannot restart it · genuine same-date re-import clears the marker and unlocks the new lifecycle');
