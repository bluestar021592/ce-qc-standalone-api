import { runPurgeExecutionWorker } from '../src/v505PurgeCoordinator.js';

function decodePayload(){
  const raw=String(process.argv[2]||'');
  if(!raw)throw new Error('V505_PURGE_EXECUTE_PAYLOAD_MISSING');
  return JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
}

try{
  const payload=decodePayload();
  const delay=Math.max(0,Math.min(10_000,Number(payload.delayMs||0)));
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  await runPurgeExecutionWorker(payload);
  process.exit(0);
}catch(error){
  process.stderr.write(`[V505 PURGE EXECUTE WORKER] ${error?.stack||error?.message||String(error)}\n`);
  process.exit(1);
}
