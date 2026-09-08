import { inspectV461WhppArchiveEvidence } from './v461WhppArchiveEvidence.js';

export const V462_WHPP_ARCHIVE_WORKER_ID='2026-09-08-v462-isolated-whpp-archive-evidence-worker-v1';

let running=false;
process.on('message',async message=>{
  if(running||message?.type!=='START')return;
  running=true;
  const reportDate=String(message.reportDate||'').trim();
  const memberBills=Array.isArray(message.memberBills)?message.memberBills:[];
  try{
    const result=await inspectV461WhppArchiveEvidence(reportDate,memberBills,{onProgress:progress=>{
      try{process.send?.({type:'PROGRESS',workerId:V462_WHPP_ARCHIVE_WORKER_ID,progress});}catch{}
    }});
    try{process.send?.({type:'DONE',workerId:V462_WHPP_ARCHIVE_WORKER_ID,result});}catch{}
    setTimeout(()=>process.exit(0),20).unref?.();
  }catch(error){
    try{process.send?.({type:'ERROR',workerId:V462_WHPP_ARCHIVE_WORKER_ID,error:error?.message||String(error)});}catch{}
    setTimeout(()=>process.exit(1),20).unref?.();
  }
});

console.info('[CE-QC][V462_WHPP_ARCHIVE_WORKER]',V462_WHPP_ARCHIVE_WORKER_ID,'offline gzip evidence scan only; no CE network call and no database mutation.');
