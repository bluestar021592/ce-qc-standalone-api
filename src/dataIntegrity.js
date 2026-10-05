import { getDb } from './db.js';
import { loadLightweightUnifiedBusinessState } from './lightweightDashboardStore.js';
import { loadWhppState } from './whppStore.js';
import { buildWhppDashboard } from './whppReporting.js';
import { buildCanonicalBusinessAccounting } from './businessAccounting.js';

const TYPES=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];

export function buildDataIntegrityReport({snapshotId='',reportDate=''}={}){
  const db=getDb();
  const batch=resolveBatch(db,snapshotId,reportDate);
  if(!batch)return emptyReport();

  const sourceSets=Object.fromEntries(TYPES.map(type=>[type,new Set()]));
  for(const row of db.prepare('SELECT businessType,shipmentCode FROM unified_import_rows WHERE snapshotId=?').all(batch.snapshotId)){
    const type=String(row.businessType||'').toUpperCase(),code=norm(row.shipmentCode);
    if(sourceSets[type]&&code)sourceSets[type].add(code);
  }

  const whppState=loadWhppState();
  if(String(whppState?.reportDate||'')===String(batch.reportDate||'')){
    for(const code of whppState.pnhBills||[])if(norm(code))sourceSets.WHPP.add(norm(code));
  }

  const businesses={};
  for(const type of TYPES){
    if(type==='WHPP')businesses[type]=whppIntegrity(sourceSets[type],whppState,batch.reportDate);
    else businesses[type]=standardIntegrity(type,sourceSets[type],batch.snapshotId);
  }

  const sourceTotal=TYPES.reduce((sum,type)=>sum+businesses[type].sourceCount,0);
  const stateTotal=TYPES.reduce((sum,type)=>sum+businesses[type].stateMemberCount,0);
  const accountedTotal=TYPES.reduce((sum,type)=>sum+businesses[type].accounted,0);
  const scanTotal=TYPES.reduce((sum,type)=>sum+businesses[type].scanCount,0);
  const missingFromState=TYPES.reduce((sum,type)=>sum+Math.max(0,businesses[type].sourceCount-businesses[type].stateMemberCount),0);
  const waitingScan=TYPES.reduce((sum,type)=>sum+businesses[type].waitingScan,0);
  const accountingDifference=TYPES.reduce((sum,type)=>sum+Math.abs(businesses[type].difference),0);
  const sourceUnique=new Set(TYPES.flatMap(type=>[...sourceSets[type]])).size;

  return {
    ok:true,reportDate:batch.reportDate,snapshotId:batch.snapshotId,
    source:{classifiedTotal:sourceTotal,uniqueWaybills:sourceUnique,balanced:sourceTotal===sourceUnique},
    processing:{stateMemberTotal:stateTotal,scanCount:scanTotal,waitingScan,missingFromState},
    accounting:{accountedTotal,difference:accountingDifference,balanced:accountingDifference===0&&stateTotal===sourceTotal},
    businesses,
    safeForDashboard:sourceTotal===sourceUnique&&missingFromState===0&&accountingDifference===0,
    processingComplete:waitingScan===0&&missingFromState===0
  };
}

function standardIntegrity(type,sourceSet,snapshotId){
  const state=loadLightweightUnifiedBusinessState(type,snapshotId,{includeHistory:false});
  const accounting=buildCanonicalBusinessAccounting(state,type);
  const stateSet=new Set((state.finalRows||[]).map(row=>norm(row.shipmentCode||row.运单号)).filter(Boolean));
  const scanSet=new Set((state.scanResults||[]).map(row=>norm(row.shipmentCode||row.运单号)).filter(Boolean));
  const finalSet=new Set((state.finalRows||[]).filter(row=>row.finalRowAvailable!==false).map(row=>norm(row.shipmentCode||row.运单号)).filter(Boolean));
  const sourceCount=sourceSet.size;
  return {
    businessType:type,sourceCount,
    stateMemberCount:stateSet.size,
    scanCount:scanSet.size,
    waitingScan:Math.max(0,sourceCount-scanSet.size),
    finalizedCount:finalSet.size,
    unprocessedCount:Number(accounting.counts?.unprocessed||0),
    accounted:accounting.accounted,
    difference:sourceCount-accounting.accounted,
    balanced:sourceCount===stateSet.size&&sourceCount===accounting.accounted,
    scanComplete:scanSet.size>=sourceCount,
    missingFromState:Math.max(0,sourceCount-stateSet.size),
    extraInState:Math.max(0,stateSet.size-sourceCount),
    counts:accounting.counts||{}
  };
}

function whppIntegrity(sourceSet,state,reportDate){
  const sourceCount=sourceSet.size;
  if(!state||String(state.reportDate||'')!==String(reportDate||'')){
    return {businessType:'WHPP',sourceCount,stateMemberCount:0,scanCount:0,waitingScan:sourceCount,finalizedCount:0,unprocessedCount:sourceCount,accounted:0,difference:sourceCount,balanced:sourceCount===0,scanComplete:sourceCount===0,missingFromState:sourceCount,extraInState:0,counts:{}};
  }
  const dashboard=buildWhppDashboard(state);
  const allRows=dashboard?.detailTabs?.all?.rows||[];
  const stateSet=new Set(allRows.map(row=>norm(row.shipmentCode||row.运单号)).filter(Boolean));
  const scanSet=new Set((state.scanResults||[]).map(row=>norm(row.shipmentCode||row.运单号)).filter(Boolean));
  const finalizedCount=allRows.filter(row=>row.finalRowAvailable!==false).length;
  const accounted=Number(dashboard?.accounting?.accounted||0);
  const unresolved=Number(dashboard?.accounting?.unresolved||0);
  return {
    businessType:'WHPP',sourceCount,
    stateMemberCount:stateSet.size,
    scanCount:scanSet.size,
    waitingScan:Math.max(0,sourceCount-scanSet.size),
    finalizedCount,
    unprocessedCount:Math.max(0,sourceCount-accounted+unresolved),
    accounted,
    difference:sourceCount-accounted,
    balanced:sourceCount===stateSet.size&&sourceCount===accounted,
    scanComplete:scanSet.size>=sourceCount,
    missingFromState:Math.max(0,sourceCount-stateSet.size),
    extraInState:Math.max(0,stateSet.size-sourceCount),
    counts:{total:Number(dashboard?.metrics?.total||0),pod:Number(dashboard?.metrics?.pod||0),returned:Number(dashboard?.metrics?.returned||0),unresolved:Number(dashboard?.metrics?.unresolved||0)}
  };
}

function resolveBatch(db,snapshotId,reportDate){
  if(snapshotId)return db.prepare("SELECT snapshotId,reportDate FROM unified_import_batches WHERE snapshotId=? LIMIT 1").get(snapshotId)||null;
  if(reportDate)return db.prepare("SELECT snapshotId,reportDate FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(reportDate)||null;
  return db.prepare("SELECT snapshotId,reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,rowid DESC LIMIT 1").get()||null;
}
function norm(value){return String(value||'').trim().toUpperCase()}
function emptyReport(){return{ok:true,reportDate:'',snapshotId:'',source:{classifiedTotal:0,uniqueWaybills:0,balanced:true},processing:{stateMemberTotal:0,scanCount:0,waitingScan:0,missingFromState:0},accounting:{accountedTotal:0,difference:0,balanced:true},businesses:{},safeForDashboard:true,processingComplete:true}}
