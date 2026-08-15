import express from 'express';
import { getDb } from './db.js';
import { classifyUnifiedBusiness } from './unifiedExcelParser.js';

export const V137_CLASSIFICATION_AUDIT_ID='2026-08-15-v137-readonly-classification-audit-v1';
const BUSINESS_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);

function dateOnly(value=''){const v=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';}
function safe(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function valueFromRaw(raw={},pattern){for(const [key,value] of Object.entries(raw||{}))if(pattern.test(String(key||''))&&String(value??'').trim())return String(value??'').trim();return'';}
function evidence(row={}){
  const raw=row.raw&&typeof row.raw==='object'?row.raw:safe(row.rawJson||row.rowJson||{}).raw||{};
  const recipient=String(row.recipientRaw||row.recipient_raw||row.recipientNormalized||row.recipient_normalized||'').trim()||valueFromRaw(raw,/收件|收货|recipient|receiver|consignee/i);
  const sender=String(row.senderRaw||row.sender_raw||row.senderNormalized||row.sender_normalized||'').trim()||valueFromRaw(raw,/发件|寄件|发货|sender|shipper|consignor/i);
  const customer=String(row.customerNameRaw||row.customerNameNormalized||'').trim()||valueFromRaw(raw,/客户|customer|client/i);
  return {recipient,sender,customer};
}

function latestRows(from,to){
  return getDb().prepare(`
    WITH ranked AS (
      SELECT reportDate,snapshotId,createdAt,batchId,ROW_NUMBER() OVER(PARTITION BY reportDate ORDER BY createdAt DESC,batchId DESC) rn
      FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ?
    )
    SELECT u.reportDate,u.shipmentCode,u.businessType,u.rowJson,u.recipientRaw,u.recipientNormalized
    FROM ranked r INNER JOIN unified_import_rows u ON u.snapshotId=r.snapshotId AND u.reportDate=r.reportDate
    WHERE r.rn=1 ORDER BY u.reportDate,u.shipmentCode
  `).all(from,to);
}

export function auditHistoricalClassification(fromDate,toDate){
  const rows=latestRows(fromDate,toDate);const mismatches=[];const byDate={};const stored={};const recomputed={};let unresolved=0;
  for(const dbRow of rows){
    const parsed=safe(dbRow.rowJson);const bill=billOf(dbRow)||billOf(parsed);const ev=evidence({...parsed,...dbRow});
    const classified=classifyUnifiedBusiness(bill,ev.recipient,ev.customer,ev.sender);
    const oldType=String(dbRow.businessType||parsed.businessType||'').toUpperCase();const newType=String(classified?.businessType||'').toUpperCase();
    stored[oldType]=(stored[oldType]||0)+1;if(newType)recomputed[newType]=(recomputed[newType]||0)+1;else unresolved++;
    const date=String(dbRow.reportDate||'');byDate[date]??={total:0,mismatch:0,unresolved:0};byDate[date].total++;
    if(!newType){byDate[date].unresolved++;continue;}
    if(oldType!==newType){byDate[date].mismatch++;if(mismatches.length<200)mismatches.push({reportDate:date,shipmentCode:bill,storedBusinessType:oldType,recomputedBusinessType:newType,classificationSource:classified.source,matchedValue:classified.matchedValue,recipient:ev.recipient,sender:ev.sender});}
  }
  return {ok:true,patchId:V137_CLASSIFICATION_AUDIT_ID,readOnly:true,fromDate,toDate,total:rows.length,mismatchCount:Object.values(byDate).reduce((n,item)=>n+item.mismatch,0),unresolvedCount:unresolved,storedCounts:stored,recomputedCounts:recomputed,byDate,samples:mismatches,note:'只读审计；不会修改unified_import_rows、历史快照或业务归属。'};
}

function handler(req,res){try{
  const latest=getDb().prepare("SELECT MIN(reportDate) minDate,MAX(reportDate) maxDate FROM unified_import_batches WHERE status='VALID'").get()||{};
  const from=dateOnly(req.query.from)||String(latest.minDate||'');const to=dateOnly(req.query.to)||String(latest.maxDate||'');
  if(!from||!to||from>to)return res.status(400).json({ok:false,error:'没有可审计的日报日期范围'});
  const result=auditHistoricalClassification(from,to);res.setHeader('Cache-Control','no-store');res.json(result);
}catch(error){console.error('[CE-QC][V137][CLASSIFICATION_AUDIT]',error?.stack||error);res.status(500).json({ok:false,patchId:V137_CLASSIFICATION_AUDIT_ID,error:error?.message||String(error)});}}

const previousListen=express.application.listen;let installed=false;
express.application.listen=function v137ClassificationAuditListen(...args){if(!installed){installed=true;this.get('/api/v137/classification-audit',handler);}return previousListen.apply(this,args);};
