import { closeDb } from './db.js';
import { runV208ShopeeEvidenceSync } from './v208ShopeePrecisionEvidenceScheduler.js';

const reason=String(process.argv[2]||'BACKGROUND_WORKER');
try{
  const result=await runV208ShopeeEvidenceSync({reason});
  console.log('[CE-QC][V208_SHOPEE_EVIDENCE_WORKER_DONE]',JSON.stringify(result));
  if(result?.ok===false)process.exitCode=1;
}catch(error){console.error('[CE-QC][V208_SHOPEE_EVIDENCE_WORKER_FAILED]',error?.stack||error);process.exitCode=1;}finally{try{closeDb();}catch{}}
