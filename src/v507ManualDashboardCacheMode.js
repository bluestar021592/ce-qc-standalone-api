const AUTO_CACHE_REASONS = /STARTUP_WARM|TEN_MINUTE_REFRESH/;

export const V507_MANUAL_DASHBOARD_CACHE_MODE_ID='2026-09-13-v507-manual-dashboard-cache-v2';

function isAutomaticDashboardCacheTimer(callback){
  if(typeof callback!=='function')return false;
  let source='';
  try{source=Function.prototype.toString.call(callback);}catch{}
  return /launchDashboardCacheWorker/.test(source)&&AUTO_CACHE_REASONS.test(source);
}

function skippedTimer(nativeSetTimeout){
  const timer=nativeSetTimeout(()=>{},0);
  timer?.unref?.();
  return timer;
}

export function wrapV507ManualOnlyListenCallback(callback){
  if(typeof callback!=='function')return callback;
  return function v507ManualOnlyDashboardCacheListenCallback(...callbackArgs){
    const nativeSetTimeout=globalThis.setTimeout;
    const nativeSetInterval=globalThis.setInterval;
    const nativeConsoleLog=console.log;
    globalThis.setTimeout=function v507ManualCacheTimeout(fn,delay,...rest){
      if(isAutomaticDashboardCacheTimer(fn))return skippedTimer(nativeSetTimeout);
      return nativeSetTimeout(fn,delay,...rest);
    };
    globalThis.setInterval=function v507ManualCacheInterval(fn,delay,...rest){
      if(isAutomaticDashboardCacheTimer(fn))return skippedTimer(nativeSetTimeout);
      return nativeSetInterval(fn,delay,...rest);
    };
    console.log=function v507ManualCacheLog(...items){
      if(typeof items[0]==='string'&&items[0].startsWith('Dashboard cache: background refresh every ')){
        return nativeConsoleLog.call(console,'Dashboard cache: manual/event-driven refresh only (timed refresh disabled)');
      }
      return nativeConsoleLog.apply(console,items);
    };
    try{return callback.apply(this,callbackArgs);}
    finally{
      globalThis.setTimeout=nativeSetTimeout;
      globalThis.setInterval=nativeSetInterval;
      console.log=nativeConsoleLog;
      console.info('[CE-QC][V507_MANUAL_DASHBOARD_CACHE] startup/timed dashboard-cache refresh disabled; import/run/manual refresh remains event-driven.');
    }
  };
}

export function v507ManualDashboardCacheModeForTests(){return{manualOnly:true,id:V507_MANUAL_DASHBOARD_CACHE_MODE_ID};}
