import { getDb } from './db.js';

const CCSL_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES=Object.freeze(['SHOPEECN','SHOPEEVN']);

function normalizeDate(value){
  const text=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new Error(`无效日报日期：${text||'EMPTY'}`);
  return text;
}
function normalizeScope(value){
  return String(value||'').trim().toUpperCase()==='SHOPEE'?'SHOPEE':'CCSL';
}
function billOf(row={}){return String(row.shipmentCode||row.运单号||'').trim().toUpperCase();}
function safeCarryRow(row={}){
  let parsed={};
  try{parsed=JSON.parse(row.stateJson||'{}')||{};}catch{}
  return {
    ...parsed,
    shipmentCode:row.shipmentCode,
    运单号:row.shipmentCode,
    businessType:row.businessType,
    sourceReportDate:row.sourceReportDate,
    lastReportDate:row.lastReportDate,
    sourceType:'HISTORICAL_CARRY'
  };
}

export function getExactValidUnifiedBatch(reportDate,{db=getDb()}={}){
  const date=normalizeDate(reportDate);
  return db.prepare(`SELECT batchId,snapshotId,reportDate,sourceName,fileHash,createdAt
    FROM unified_import_batches
    WHERE reportDate=? AND status='VALID'
    ORDER BY createdAt DESC,rowid DESC
    LIMIT 1`).get(date)||null;
}

export function loadHistoricalCarryForRun(reportDate,scope='CCSL',{db=getDb()}={}){
  const date=normalizeDate(reportDate);
  const normalizedScope=normalizeScope(scope);
  const types=normalizedScope==='SHOPEE'?SHOPEE_TYPES:CCSL_TYPES;
  const placeholders=types.map(()=>'?').join(',');
  const startedAt=Date.now();
  const rows=db.prepare(`SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,stateJson
    FROM carryover_open_items
    WHERE status='OPEN'
      AND sourceReportDate<?
      AND businessType IN (${placeholders})
    ORDER BY businessType,sourceReportDate,shipmentCode`).all(date,...types);
  const hydrated=rows.map(safeCarryRow);
  const bills=[...new Set(hydrated.map(billOf).filter(Boolean))];
  const result={scope:normalizedScope,reportDate:date,bills,rows:hydrated,count:bills.length,elapsedMs:Date.now()-startedAt};
  console.log(`[CE-QC][UNIFIED_RUN_PREP] scope=${normalizedScope} reportDate=${date} carry=${result.count} elapsedMs=${result.elapsedMs}`);
  return result;
}

export function prepareUnifiedRunState(state={},scope='CCSL',{db=getDb()}={}){
  const normalizedScope=normalizeScope(scope);
  const date=normalizeDate(state.reportDate);
  const batch=getExactValidUnifiedBatch(date,{db});
  if(!batch){
    const error=new Error(`日报 ${date} 没有有效综合日报批次，禁止猜测遗留范围。`);
    error.code='UNIFIED_VALID_BATCH_MISSING';
    throw error;
  }
  const carry=loadHistoricalCarryForRun(date,normalizedScope,{db});
  const podSet=new Set((state.podLocks||[]).map(value=>String(value||'').trim().toUpperCase()).filter(Boolean));
  const carryBills=carry.bills.filter(bill=>!podSet.has(bill));
  const priorCarryRows=carry.rows.filter(row=>!podSet.has(billOf(row)));
  const currentBills=[...new Set((state.pnhBills||[]).map(value=>String(value||'').trim().toUpperCase()).filter(Boolean))];
  return {
    ...state,
    carryBills,
    priorCarryRows,
    scanPool:[...new Set([...currentBills,...carryBills])].filter(bill=>!podSet.has(bill)),
    __unifiedRunPreparation:{
      scope:normalizedScope,
      reportDate:date,
      batchId:batch.batchId,
      snapshotId:batch.snapshotId,
      currentCount:currentBills.length,
      carryCount:carryBills.length,
      preparedAt:new Date().toISOString(),
      source:'carryover_open_items:OPEN:sourceReportDate<reportDate'
    }
  };
}

export function inspectUnifiedRunPreparation(){
  return {ccslTypes:[...CCSL_TYPES],shopeeTypes:[...SHOPEE_TYPES],policy:'LAZY_ON_EXPLICIT_RUN',terminalPolicy:'OPEN_ONLY',currentDayPolicy:'SOURCE_REPORT_DATE_LT_REPORT_DATE'};
}
