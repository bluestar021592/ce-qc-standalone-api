process.env.CE_QC_V290_MAINTENANCE_CHILD='1';
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED='0';

const task=String(process.argv[2]||'').trim().toLowerCase();
const reason=String(process.argv[3]||'V290_CHILD').trim()||'V290_CHILD';
let exitCode=0;

async function run(){
  console.info('[CE-QC][V290_MAINTENANCE_WORKER_START]',JSON.stringify({task,reason,pid:process.pid}));
  switch(task){
    case 'v281-replay':{
      const { replayV281ArchivedReportDate,V281_PRIORITY_REPORT_DATE }=await import('./v281ArchivedHistoricalReparse.js');
      const result=await replayV281ArchivedReportDate(V281_PRIORITY_REPORT_DATE);
      console.info('[CE-QC][V290_MAINTENANCE_WORKER_RESULT]',JSON.stringify({task,reason,result}));
      break;
    }
    case 'v283-replay':{
      const { replayV283LegacyDecoratedHash,V283_PRIORITY_REPORT_DATE }=await import('./v283LegacyDecoratedHashReplay.js');
      const result=await replayV283LegacyDecoratedHash(V283_PRIORITY_REPORT_DATE);
      console.info('[CE-QC][V290_MAINTENANCE_WORKER_RESULT]',JSON.stringify({task,reason,result}));
      break;
    }
    case 'v284-audit':{
      const { auditV284PriorityRange }=await import('./v284DailyMembershipAudit.js');
      const result=auditV284PriorityRange({reason});
      console.info('[CE-QC][V290_MAINTENANCE_WORKER_RESULT]',JSON.stringify({task,reason,ok:result?.ok,analysisComplete:result?.analysisComplete,sourceTotal:result?.sourceTotal,analyzedTotal:result?.analyzedTotal,durationMs:result?.durationMs}));
      break;
    }
    case 'v284-priority':{
      const { refreshV284PriorityUnproven }=await import('./v284PriorityUnprovenRefresh.js');
      const result=await refreshV284PriorityUnproven({reason});
      console.info('[CE-QC][V290_MAINTENANCE_WORKER_RESULT]',JSON.stringify({task,reason,result}));
      break;
    }
    case 'v254-storage':{
      const fs=await import('node:fs');
      const path=await import('node:path');
      const { readV254StorageHealth }=await import('./v254StorageHealthPatch.js');
      const { getRuntimeConfig }=await import('./db.js');
      const result=readV254StorageHealth();
      try{
        const cfg=getRuntimeConfig();
        fs.mkdirSync(cfg.logsDir,{recursive:true});
        fs.writeFileSync(path.join(cfg.logsDir,'storage_health_latest.json'),JSON.stringify(result,null,2));
      }catch(error){console.warn('[CE-QC][V290_STORAGE_WRITE_FAILED]',error?.message||error);}
      console.info('[CE-QC][V254_STORAGE]',JSON.stringify(result));
      console.info('[CE-QC][V290_MAINTENANCE_WORKER_RESULT]',JSON.stringify({task,reason,ok:result?.ok,observedTotalGiB:result?.observedTotalGiB,createdAt:result?.createdAt}));
      break;
    }
    default:throw new Error(`Unknown V290 maintenance task: ${task||'(empty)'}`);
  }
}

try{await run();}
catch(error){exitCode=1;console.error('[CE-QC][V290_MAINTENANCE_WORKER_FAILED]',JSON.stringify({task,reason,error:error?.message||String(error),stack:error?.stack||''}));}
finally{
  try{const { closeDb }=await import('./db.js');closeDb();}catch{}
  process.exitCode=exitCode;
  setTimeout(()=>process.exit(exitCode),20).unref?.();
}
