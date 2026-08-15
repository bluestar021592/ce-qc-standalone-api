import express from 'express';
import { getDb } from './db.js';

export const V139_INSTANT_BOOTSTRAP_ID='2026-08-15-v139-v43-light-current-import-shell-v5';
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const CACHE_MS=5_000;
let countCache=null;
let identityCache=null;

function n(value){const x=Number(value);return Number.isFinite(x)?x:0;}
function latestImportIdentity(){
  const now=Date.now();
  if(identityCache&&now-identityCache.at<1_000)return identityCache.value;
  let value=null;
  try{
    value=getDb().prepare(`
      SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.fileHash,b.createdAt,
             COALESCE(s.status,'IMPORTED') AS snapshotStatus
      FROM unified_import_batches b
      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.status='VALID'
      ORDER BY b.reportDate DESC,b.createdAt DESC
      LIMIT 1
    `).get()||null;
  }catch(error){console.warn('[CE-QC][V139_BOOTSTRAP] latest-import probe skipped',error?.message||error);}
  identityCache={at:now,value};
  return value;
}
function currentCounts(snapshotId=''){
  const now=Date.now();
  if(countCache?.snapshotId===snapshotId&&now-countCache.at<CACHE_MS)return countCache;
  const counts=Object.fromEntries(TYPES.map(type=>[type,0]));
  const finalCounts=Object.fromEntries(TYPES.map(type=>[type,0]));
  if(snapshotId){
    try{
      const rows=getDb().prepare(`SELECT businessType,COUNT(DISTINCT shipmentCode) AS count FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType`).all(snapshotId);
      for(const row of rows)if(counts[row.businessType]!==undefined)counts[row.businessType]=n(row.count);
      const finals=getDb().prepare(`
        SELECT u.businessType,
          COUNT(DISTINCT CASE
            WHEN u.businessType IN ('CE','CEAF','TBKH','ALI1688') AND f.shipmentCode IS NOT NULL THEN u.shipmentCode
            WHEN u.businessType IN ('SHOPEECN','SHOPEEVN') AND bf.shipmentCode IS NOT NULL THEN u.shipmentCode
            WHEN u.businessType='WHPP' AND wf.shipmentCode IS NOT NULL THEN u.shipmentCode
            ELSE NULL END) AS finalized
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
      for(const row of finals)if(finalCounts[row.businessType]!==undefined)finalCounts[row.businessType]=n(row.finalized);
    }catch(error){console.warn('[CE-QC][V139_BOOTSTRAP] current-count probe skipped',error?.message||error);}
  }
  countCache={snapshotId,at:now,counts,finalCounts};
  return countCache;
}
function shell(type,unified,total,finalized){
  const shopee=type.startsWith('SHOPEE');
  const dashboard=shopee?{
    sourceTotal:total,metrics:{total},
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
  const latest=latestImportIdentity();
  const source=payload?.unifiedImport||{};
  const unified=latest?{...source,...latest}:source;
  if(!unified?.snapshotId||!unified?.reportDate)return payload;
  payload.unifiedImport=unified;
  const snapshotId=String(unified.snapshotId);
  const {counts,finalCounts}=currentCounts(snapshotId);
  unified.classificationCounts={...(source.classificationCounts||{}),...counts};
  const total=Object.values(counts).reduce((sum,value)=>sum+n(value),0);
  unified.summary={...(source.summary||{}),validUniqueWaybills:total,totalUnique:total};
  unified.sourceReconciliation={...(source.sourceReconciliation||{}),validUniqueWaybills:total,classifiedWaybills:total,difference:0,balanced:true};
  payload.businessStates ||= {};
  for(const type of TYPES){
    const businessTotal=n(counts[type]);
    const current=payload.businessStates[type]||{};
    const sameDate=String(current.reportDate||'')===String(unified.reportDate||'');
    const completeForSlice=businessTotal===0||finalCounts[type]>=businessTotal;
    if(sameDate&&completeForSlice&&!current._instantImportShell)continue;
    payload.businessStates[type]=shell(type,unified,businessTotal,finalCounts[type]);
  }
  payload.v139={instantCurrentImport:true,base:'V43_LIGHT_BOOTSTRAP',reportDate:unified.reportDate,snapshotId,counts,finalCounts};
  return payload;
}
function currentAware(sourceHandler){
  return async function v139CurrentImportBootstrap(req,res,next){
    const originalJson=res.json.bind(res);
    res.json=body=>originalJson(transform(body));
    try{
      const result=sourceHandler(req,res,next);
      if(result&&typeof result.then==='function')await result;
      return result;
    }catch(error){
      console.error('[CE-QC][V139_BOOTSTRAP]',error?.stack||error);
      if(!res.headersSent)return originalJson({ok:false,code:'V139_BOOTSTRAP_FAILED',error:error?.message||String(error)});
      if(typeof next==='function')return next(error);
    }
  };
}

const previousGet=express.application.get;
let installed=false;
express.application.get=function v139BootstrapGet(path,...handlers){
  if(!installed&&path==='/api/bootstrap'&&handlers.length){
    installed=true;
    const sourceHandler=handlers.find(value=>typeof value==='function');
    if(!sourceHandler)return previousGet.call(this,path,...handlers);
    this.route(path).get(currentAware(sourceHandler));
    return this;
  }
  return previousGet.call(this,path,...handlers);
};
