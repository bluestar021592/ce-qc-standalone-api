function sanitizePostCommitBlockEnv(){
  const raw=process.env.PURGE_POST_COMMIT_BLOCK_MS;
  if(raw===undefined||raw===null||String(raw).trim()==='')return;
  const value=Number(raw);
  if(Number.isFinite(value))return;
  process.env.PURGE_POST_COMMIT_BLOCK_MS=String(24*60*60_000);
}

function decodePayload(){
  const raw=String(process.argv[2]||'');
  if(!raw)throw new Error('V505_PURGE_EXECUTE_PAYLOAD_MISSING');
  return JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
}

try{
  sanitizePostCommitBlockEnv();
  const payload=decodePayload();

  // Claim the filesystem task immediately, before artificial delay, DB startup
  // or any destructive module is loaded. This closes the parent-crash window
  // where a durable QUEUED sidecar could otherwise remain workerPid=0 forever.
  const { claimPurgeWorkerSidecar } = await import('../src/v505PurgeWorkerClaim.js');
  claimPurgeWorkerSidecar({jobFile:payload.jobFile,jobId:payload.jobId,allowedStatuses:['QUEUED','RUNNING','COMMITTED']});

  // Resolve and compare the exact database path sealed by PREPARE, its persisted
  // challenge and the verified backup manifest before getDb() is ever called.
  // If the original drive disappeared and getRuntimeConfig() would fall back to
  // project/data, the worker stops here and never opens or creates that fallback DB.
  const { assertPurgeExecuteSealedDatabasePath, assertPurgeExecuteReadOnlyPreflight } = await import('../src/v505PurgeExecuteReadOnlyPreflight.js');
  const initialPathBinding=assertPurgeExecuteSealedDatabasePath(payload);
  process.env.CE_QC_PURGE_SEALED_DB_FILE=String(initialPathBinding.sealedDatabasePath||'');

  const delay=Math.max(0,Math.min(10_000,Number(payload.delayMs||0)));
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));

  // The startup delay is intentionally outside SQLite. Recheck the sealed path
  // after that delay so a drive/path change during the handoff window cannot
  // redirect the following getDb() call to a fallback database. Refresh the DB
  // layer's exact path binding from this second validated result.
  const finalPathBinding=assertPurgeExecuteSealedDatabasePath(payload);
  process.env.CE_QC_PURGE_SEALED_DB_FILE=String(finalPathBinding.sealedDatabasePath||'');

  // This SELECT-only preflight opens only the just-revalidated sealed source.
  // db.js independently compares getRuntimeConfig().dbFile to the validated
  // CE_QC_PURGE_SEALED_DB_FILE before creating runtime dirs or opening SQLite.
  // Only after those checks succeed do we load the coordinator/destructive path.
  assertPurgeExecuteReadOnlyPreflight(payload);

  const { runPurgeExecutionWorker } = await import('../src/v505PurgeCoordinator.js');
  await runPurgeExecutionWorker(payload);
  process.exit(0);
}catch(error){
  process.stderr.write(`[V505 PURGE EXECUTE WORKER] ${error?.stack||error?.message||String(error)}\n`);
  process.exit(1);
}
