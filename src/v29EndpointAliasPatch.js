import express from 'express';
import { refreshOpenCarryNow } from './carryoverRefreshScheduler.js';
import { publishManualRefreshTruth } from './manualRefreshPublication.js';

let installed=false;
let manualRefreshRequestInFlight=false;

function redirectToV27(pathname){
  return (req,res)=>{
    const query=req.originalUrl.includes('?')?req.originalUrl.slice(req.originalUrl.indexOf('?')):'';
    res.redirect(307,`${pathname}${query}`);
  };
}

async function manualOpenRefresh(req,res){
  if(manualRefreshRequestInFlight){
    return res.status(409).json({ok:false,code:'MANUAL_REFRESH_RUNNING',error:'最新数据正在更新，请等待当前扫描与轨迹查询完成。'});
  }
  manualRefreshRequestInFlight=true;
  try{
    const result=await refreshOpenCarryNow({reason:'MANUAL_USER_REFRESH'});
    if(result?.skipped&&result.reason==='FOREGROUND_PROCESSING_ACTIVE'){
      return res.status(409).json({ok:false,code:'BUSINESS_PROCESSING_ACTIVE',error:'当前仍有导入/扫描/轨迹任务运行，请完成后再手动更新。',result});
    }
    const publication=result?.refreshId?publishManualRefreshTruth(result.refreshId):{ok:true,skipped:true,reason:'NO_REFRESH_ID'};
    if(publication?.unbound){
      return res.status(409).json({ok:false,code:'MANUAL_REFRESH_PUBLICATION_UNBOUND',error:`最新轨迹已查询，但有 ${publication.unbound} 票无法绑定回已保存日报，已阻止把不完整结果当成最新看板。`,result,publication});
    }
    res.json({ok:true,manualOnly:true,autoRefreshDisabled:true,result,publication,completedAt:new Date().toISOString()});
  }catch(error){
    res.status(500).json({ok:false,code:'MANUAL_REFRESH_FAILED',error:error?.message||String(error)});
  }finally{
    manualRefreshRequestInFlight=false;
  }
}

const previousListen=express.application.listen;
express.application.listen=function v29EndpointAliasListen(...args){
  if(!installed){
    installed=true;
    // Current browser patches call /api/v29/*. Register these aliases before the
    // older V29 data-consistency routes so they land on the corrected V29 business
    // rule implementation registered at /api/v27/* by v29BusinessRulesPatch.
    this.get('/api/v29/metric-detail',redirectToV27('/api/v27/metric-detail'));
    this.get('/api/v29/carry-monitor',redirectToV27('/api/v27/carry-monitor'));
    this.get('/api/v29/carry-monitor-business',redirectToV27('/api/v27/carry-monitor-business'));

    // Manual-only data refresh. This deliberately rescans only the durable OPEN
    // unfinished-POD pool; POD/returned/other terminal rows are not queried again.
    this.post('/api/manual-open-refresh',manualOpenRefresh);
  }
  return previousListen.apply(this,args);
};