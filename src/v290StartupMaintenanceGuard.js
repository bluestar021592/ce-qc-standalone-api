import { scheduleV290MaintenanceChild } from './v290MaintenanceChildLauncher.js';
import { V290_INTERACTIVE_STARTUP_GRACE_ID,V290_INTERACTIVE_BOOT_AT,v290AutoTaskDelay } from './v290InteractiveStartupGrace.js';

export const V290_STARTUP_MAINTENANCE_GUARD_ID='2026-08-24-v290-web-main-thread-startup-maintenance-guard-v1';

if(!globalThis.__CE_QC_V290_STARTUP_MAINTENANCE_GUARD__){
  globalThis.__CE_QC_V290_STARTUP_MAINTENANCE_GUARD__=true;
  const nativeSetTimeout=globalThis.setTimeout.bind(globalThis);
  const nativeSetInterval=globalThis.setInterval.bind(globalThis);
  const sourceOf=fn=>{try{return typeof fn==='function'?Function.prototype.toString.call(fn):'';}catch{return'';}};
  const elapsed=()=>Date.now()-V290_INTERACTIVE_BOOT_AT;

  const TIMEOUT_RULES=[
    {name:'V281_ARCHIVE_REPLAY',match:/replayV281ArchivedReportDate/,target:300_000,child:'v281-replay'},
    {name:'V283_LEGACY_REPLAY',match:/replayV283LegacyDecoratedHash/,target:360_000,child:'v283-replay'},
    {name:'V284_REAL_DB_AUDIT_PRIMARY',match:/auditV284PriorityRange/,whenDelay:d=>Number(d)<40_000,target:480_000,child:'v284-audit'},
    {name:'V284_REAL_DB_AUDIT_RECHECK',match:/auditV284PriorityRange/,whenDelay:d=>Number(d)>=40_000,target:660_000,child:'v284-audit'},
    {name:'V284_PRIORITY_UNPROVEN',match:/refreshV284PriorityUnproven/,target:540_000,child:'v284-priority'},
    {name:'V252_STARTUP_90DAY',match:/V252_STARTUP_90DAY_ADMISSION_AUDIT/,target:600_000},
    {name:'V262_STARTUP_OR_REQUESTED_EVIDENCE',match:/runV262ShopeeStrictEvidenceBackfill/,whenDelay:d=>Number(d)<60*60_000,target:720_000},
    {name:'V264_TBKH_STARTUP_AUTO',match:/runV264TbkhOpenAttemptLifecycle\(\{reason:'STARTUP_AUTO'\}\)/,target:780_000},
    {name:'V246_STARTUP_90DAY',match:/STARTUP_90DAY_ANTI_LEAK/,target:840_000}
  ];

  const INTERVAL_RULES=[
    {name:'V252_LIFECYCLE_POLL',match:/lifecycleTick\(\)/,notBefore:600_000},
    {name:'V264_TBKH_CONTINUOUS_POLL',match:/runV264TbkhOpenAttemptLifecycle\(\{reason:'CONTINUOUS_POLL'\}\)/,notBefore:780_000},
    {name:'V246_SCHEDULER_POLL',match:/scheduledTick\(\)/,notBefore:840_000}
  ];

  globalThis.setTimeout=function v290ProtectedTimeout(callback,delay,...args){
    const source=sourceOf(callback);
    for(const rule of TIMEOUT_RULES){
      if(!rule.match.test(source)||rule.whenDelay&&!rule.whenDelay(delay))continue;
      if(rule.child){
        const reason=`${rule.name}:V290_FIRST_PAINT_PROTECTED`;
        console.info('[CE-QC][V290_TIMEOUT_RELOCATED]',JSON.stringify({name:rule.name,originalDelayMs:Number(delay)||0,targetAfterBootMs:rule.target,mode:'CHILD_PROCESS'}));
        return scheduleV290MaintenanceChild(rule.child,{targetAfterBootMs:rule.target,reason});
      }
      const effective=v290AutoTaskDelay(rule.target);
      console.info('[CE-QC][V290_TIMEOUT_DEFERRED]',JSON.stringify({name:rule.name,originalDelayMs:Number(delay)||0,effectiveDelayMs:effective,targetAfterBootMs:rule.target}));
      return nativeSetTimeout(callback,effective,...args);
    }
    return nativeSetTimeout(callback,delay,...args);
  };

  globalThis.setInterval=function v290ProtectedInterval(callback,delay,...args){
    const source=sourceOf(callback);
    for(const rule of INTERVAL_RULES){
      if(!rule.match.test(source))continue;
      const guarded=function v290IntervalGuard(...cbArgs){
        if(elapsed()<rule.notBefore){
          if(!guarded.__logged){guarded.__logged=true;console.info('[CE-QC][V290_INTERVAL_HELD]',JSON.stringify({name:rule.name,notBeforeMs:rule.notBefore,elapsedMs:elapsed()}));}
          return;
        }
        return callback(...cbArgs);
      };
      console.info('[CE-QC][V290_INTERVAL_GUARDED]',JSON.stringify({name:rule.name,intervalMs:Number(delay)||0,notBeforeMs:rule.notBefore}));
      return nativeSetInterval(guarded,delay,...args);
    }
    return nativeSetInterval(callback,delay,...args);
  };

  console.info('[CE-QC][V290_STARTUP_GUARD]',V290_STARTUP_MAINTENANCE_GUARD_ID,`grace=${V290_INTERACTIVE_STARTUP_GRACE_ID}`,'automatic V281/V283/V284 work is moved off the 5177 process; V246/V252/V262/V264 automatic startup work is staggered after first paint.');
}
