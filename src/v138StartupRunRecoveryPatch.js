import { getDb, nowIso } from './db.js';

const PATCH_ID='2026-08-15-v138-startup-run-recovery-v1';

// A managed-backend restart destroys all in-memory request workers. Therefore any
// persisted lock still marked "running" at process startup cannot represent a live
// job in this new process. Convert only the runtime lock to paused and preserve the
// exact batchIndex/totalBatches/checkpoints and all business rows. The next normal
// Start/Continue request will recover from the saved checkpoint instead of waiting
// forever for a worker that no longer exists.
function recoverInterruptedRuns(){
  const db=getDb();
  const now=nowIso();
  const ccsl=db.prepare(`
    UPDATE run_locks
    SET status='paused',
        currentStage=CASE WHEN COALESCE(currentStage,'')='' THEN '后台重启·断点待恢复' ELSE currentStage END,
        errorMessage='后台已重启，等待从已保存断点继续',
        updatedAt=?
    WHERE status='running'
  `).run(now);
  const business=db.prepare(`
    UPDATE business_run_locks
    SET status='paused',
        currentStage=CASE WHEN COALESCE(currentStage,'')='' THEN '后台重启·断点待恢复' ELSE currentStage END,
        errorMessage='后台已重启，等待从已保存断点继续',
        updatedAt=?
    WHERE status='running'
  `).run(now);
  const result={ccslPaused:Number(ccsl.changes||0),businessPaused:Number(business.changes||0),at:now};
  if(result.ccslPaused||result.businessPaused)console.log(`[CE-QC][V138_RUN_RECOVERY] ${JSON.stringify(result)}`);
  return result;
}

export const V138_STARTUP_RUN_RECOVERY_RESULT=recoverInterruptedRuns();
export const V138_STARTUP_RUN_RECOVERY_PATCH_ID=PATCH_ID;
