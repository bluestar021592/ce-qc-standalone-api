function decodePayload(raw=''){
  try{return JSON.parse(Buffer.from(String(raw||''),'base64url').toString('utf8'));}
  catch{return {};}
}

const payload=decodePayload(process.argv[2]||'');
if(!payload.jobId||!payload.jobFile||!payload.statusFile){
  process.stderr.write('V505_PURGE_PREPARE_PAYLOAD_INVALID\n');
  process.exit(2);
}
try{
  // Claim the durable sidecar before loading DB/backup code or honoring the
  // startup delay. A parent crash cannot leave a genuinely running child
  // indistinguishable from an abandoned workerPid=0 task for minutes/hours.
  const { claimPurgeWorkerSidecar } = await import('../src/v505PurgeWorkerClaim.js');
  claimPurgeWorkerSidecar({jobFile:payload.jobFile,jobId:payload.jobId,allowedStatuses:['QUEUED','RUNNING']});

  const delayMs=Math.max(0,Math.min(10_000,Number(payload.delayMs||0)));
  if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));

  const { runPurgePreparationWorker } = await import('../src/dataPurge.js');
  await runPurgePreparationWorker(payload);
}catch(error){
  process.stderr.write(`${error?.message||String(error)}\n`);
  process.exitCode=3;
}
