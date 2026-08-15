import express from 'express';
import { getDb } from './db.js';
import { v27BootstrapHandler } from './v27ServerPatch.js';

export const V139_INSTANT_BOOTSTRAP_ID='2026-08-15-v139-seven-business-current-import-shell-v2';
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];

function n(value){const x=Number(value);return Number.isFinite(x)?x:0;}
function currentImportCounts(snapshotId=''){
  const result=Object.fromEntries(TYPES.map(type=>[type,0]));
  if(!snapshotId)return result;
  try{
    const rows=getDb().prepare(`SELECT businessType,COUNT(DISTINCT shipmentCode) AS count FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType`).all(snapshotId);
    for(const row of rows)if(result[row.businessType]!==undefined)result[row.businessType]=n(row.count);
  }catch(error){console.warn('[CE-QC][V139_BOOTSTRAP] import-count probe skipped',error?.message||error);}
  return result;
}
function currentFinalCounts(snapshotId=''){
  const result=Object.fromEntries(TYPES.map(type=>[type,0]));
  if(!snapshotId)return result;
  try{
    const rows=getDb().prepare(`
      SELECT u.businessType,
        SUM(CASE
          WHEN u.businessType IN ('CE','CEAF','TBKH','ALI1688') AND f.shipmentCode IS NOT NULL THEN 1
          WHEN u.businessType IN ('SHOPEECN','SHOPEEVN') AND bf.shipmentCode IS NOT NULL THEN 1
          WHEN u.businessType='WHPP' AND wf.shipmentCode IS NOT NULL THEN 1
          ELSE 0 END) AS finalized
      FROM unified_import_rows u
      LEFT JOIN final_rows f
        ON u.businessType IN ('CE','CEAF','TBKH','ALI1688')
       AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      LEFT JOIN business_final_rows bf
        ON u.businessType IN ('SHOPEECN','SHOPEEVN')
       AND bf.businessType='SHOPEE' AND bf.shipmentCode=u.shipmentCode AND bf.reportDate=u.reportDate
      LEFT JOIN business_final_rows wf
        ON u.businessType='WHPP'
       AND wf.businessType='WHPP' AND wf.shipmentCode=u.shipmentCode AND wf.reportDate=u.reportDate
      WHERE u.snapshotId=?
      GROUP BY u.businessType
    `).all(snapshotId);
    for(const row of rows)if(result[row.businessType]!==undefined)result[row.businessType]=n(row.finalized);
  }catch(error){console.warn('[CE-QC][V139_BOOTSTRAP] final-count probe skipped',error?.message||error);}
  return result;
}
function shell(type,unified,total,finalized){
  const shopee=type.startsWith('SHOPEE');
  const dashboard=shopee?{
    sourceTotal:total,
    metrics:{total},
    recipientGroups:{ALL:{metrics:{total}},CN:{metrics:{total:type==='SHOPEECN'?total:0}},VN:{metrics:{total:type==='SHOPEEVN'?total:0}}}
  }:{sourceTotal:total,pnh:total,totalMonitored:total,todayPod:0,podRate:0,categories:{}};
  return {
    businessType:type,viewBusinessType:type,reportDate:String(unified.reportDate||''),snapshotId:String(unified.snapshotId||''),
    snapshotStatus:'PROCESSING',sourceTotal:total,dailyReportReady:true,
    dailyParseSummary:{sourceTotal:total,totalRecognized:total},dashboard,
    processing:{running:true,paused:false,phase:'后台扫描/轨迹处理中'},
    _instantImportShell:true,_compact:true,_fastSqlSummary:true,
    _verifiedFinalCount:finalized,_sourceTotal:total,
    finalRows:[],detailTabs:{},historySummary:[]
  };
}
function transform(payload={}){
  const unified=payload?.unifiedImport;
  if(!unified?.snapshotId||!unified?.reportDate)return payload;
  const snapshotId=String(unified.snapshotId);
  const counts=currentImportCounts(snapshotId);
  const finalCounts=currentFinalCounts(snapshotId);
  unified.classificationCounts={...(unified.classificationCounts||{}),...counts};
  unified.summary={...(unified.summary||{}),validUniqueWaybills:Object.values(counts).reduce((sum,value)=>sum+n(value),0)};
  payload.businessStates ||= {};
  for(const type of TYPES){
    const total=n(counts[type]);
    const current=payload.businessStates[type]||{};
    const sameDate=String(current.reportDate||'')===String(unified.reportDate||'');
    const completeForSlice=total===0||finalCounts[type]>=total;
    if(sameDate&&completeForSlice&&!current._instantImportShell)continue;
    payload.businessStates[type]=shell(type,unified,total,finalCounts[type]);
  }
  payload.v139={instantCurrentImport:true,reportDate:unified.reportDate,snapshotId,counts,finalCounts};
  return payload;
}
async function handler(req,res){
  const originalJson=res.json.bind(res);
  res.json=body=>originalJson(transform(body));
  try{return await v27BootstrapHandler(req,res);}catch(error){console.error('[CE-QC][V139_BOOTSTRAP]',error?.stack||error);if(!res.headersSent)return originalJson({ok:false,code:'V139_BOOTSTRAP_FAILED',error:error?.message||String(error)});}
}

const previousGet=express.application.get;
let installed=false;
express.application.get=function v139BootstrapGet(path,...handlers){
  if(!installed&&path==='/api/bootstrap'&&handlers.length){
    installed=true;
    // Register directly through route() so the legacy V27 app.get interceptor cannot
    // replace this current-import-aware bootstrap with its completed-date-only handler.
    this.route(path).get(handler);
    return this;
  }
  return previousGet.call(this,path,...handlers);
};
