import express from 'express';
import { getDb } from './db.js';
import { collectV205CanonicalRows, V205_CANONICAL_TRUTH_VERSION } from './v205CanonicalTruth.js';

export const V205_INTEGRITY_AUDIT_VERSION='2026-08-18-v205-qc-data-integrity-audit-v1';
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPE_SET=new Set([...TYPES,'WHPP']);

function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function rangeOf(query={}){const latest=String(getDb().prepare("SELECT MAX(reportDate) d FROM unified_import_batches WHERE status IN ('VALID','SUPERSEDED')").get()?.d||'');const to=dateKey(query.toDate)||dateKey(latest)||new Date().toISOString().slice(0,10);const from=dateKey(query.fromDate)||to;if(from>to)throw new Error('开始日期不能晚于结束日期。');return{from,to};}
function currentSnapshotForDate(db,date){return db.prepare(`SELECT b.snapshotId,b.batchId,b.status,s.status snapshotStatus,b.createdAt
  FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
  WHERE b.reportDate=? AND b.status='VALID' ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(date)||null;}
function datesInRange(db,range){return db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status IN ('VALID','SUPERSEDED') AND reportDate BETWEEN ? AND ? ORDER BY reportDate`).all(range.from,range.to).map(r=>r.reportDate);}
function countArchiveUnion(db,type,date){return Number(db.prepare(`SELECT COUNT(*) count FROM (SELECT DISTINCT r.shipmentCode FROM unified_import_rows r INNER JOIN unified_import_batches b ON b.snapshotId=r.snapshotId INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE r.businessType=? AND r.reportDate=? AND b.status IN ('VALID','SUPERSEDED') AND s.status='COMPLETED')`).get(type,date)?.count||0);}
function countSnapshot(db,type,snapshotId){if(!snapshotId)return 0;return Number(db.prepare('SELECT COUNT(DISTINCT shipmentCode) count FROM unified_import_rows WHERE snapshotId=? AND businessType=?').get(snapshotId,type)?.count||0);}
function countMissingFromCurrent(db,type,date,snapshotId){if(!snapshotId)return countArchiveUnion(db,type,date);return Number(db.prepare(`SELECT COUNT(*) count FROM (
  SELECT DISTINCT r.shipmentCode FROM unified_import_rows r INNER JOIN unified_import_batches b ON b.snapshotId=r.snapshotId INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
  WHERE r.businessType=? AND r.reportDate=? AND b.status IN ('VALID','SUPERSEDED') AND s.status='COMPLETED'
  EXCEPT SELECT shipmentCode FROM unified_import_rows WHERE snapshotId=? AND businessType=?
)`).get(type,date,snapshotId,type)?.count||0);}
function sampleMissing(db,type,date,snapshotId,limit=20){if(!snapshotId)return[];return db.prepare(`SELECT shipmentCode FROM (
  SELECT DISTINCT r.shipmentCode FROM unified_import_rows r INNER JOIN unified_import_batches b ON b.snapshotId=r.snapshotId INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
  WHERE r.businessType=? AND r.reportDate=? AND b.status IN ('VALID','SUPERSEDED') AND s.status='COMPLETED'
  EXCEPT SELECT shipmentCode FROM unified_import_rows WHERE snapshotId=? AND businessType=?
) ORDER BY shipmentCode LIMIT ?`).all(type,date,snapshotId,type,limit).map(r=>r.shipmentCode);}
function summaryHandler(req,res){
  try{
    const db=getDb(),range=rangeOf(req.query),dates=datesInRange(db,range),byBusiness=Object.fromEntries(TYPES.map(t=>[t,{businessType:t,archiveUnique:0,currentUnique:0,atRiskMissing:0,datesAtRisk:0}]));const daily=[];
    for(const date of dates){const current=currentSnapshotForDate(db,date);for(const type of TYPES){const archive=countArchiveUnion(db,type,date),currentCount=current?.snapshotStatus==='COMPLETED'?countSnapshot(db,type,current.snapshotId):0,missing=countMissingFromCurrent(db,type,date,current?.snapshotStatus==='COMPLETED'?current.snapshotId:'');const target=byBusiness[type];target.archiveUnique+=archive;target.currentUnique+=currentCount;target.atRiskMissing+=missing;if(missing)target.datesAtRisk++;if(archive||currentCount||missing)daily.push({date,businessType:type,archiveUnique:archive,currentUnique:currentCount,atRiskMissing:missing,currentSnapshotId:current?.snapshotId||'',currentSnapshotStatus:current?.snapshotStatus||'NONE',sampleMissing:missing?sampleMissing(db,type,date,current?.snapshotStatus==='COMPLETED'?current.snapshotId:'',10):[]});}}
    const totals=Object.values(byBusiness).reduce((a,x)=>({archiveUnique:a.archiveUnique+x.archiveUnique,currentUnique:a.currentUnique+x.currentUnique,atRiskMissing:a.atRiskMissing+x.atRiskMissing,datesAtRisk:a.datesAtRisk+x.datesAtRisk}),{archiveUnique:0,currentUnique:0,atRiskMissing:0,datesAtRisk:0});
    res.setHeader('Cache-Control','no-store');res.json({ok:true,version:V205_INTEGRITY_AUDIT_VERSION,truthVersion:V205_CANONICAL_TRUTH_VERSION,range,totals,byBusiness:Object.values(byBusiness),daily,rule:'历史完整性以所有已完成的VALID+SUPERSEDED日报快照并集为底账；最新同日上传不得静默删除旧已确认运单。',generatedAt:new Date().toISOString()});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
}
async function deepHandler(req,res){
  try{
    const type=String(req.query.businessType||'').toUpperCase();if(!TYPE_SET.has(type))return res.status(400).json({ok:false,error:'请选择有效业务板块。'});const range=rangeOf(req.query);const rows=await collectV205CanonicalRows(type,range);const official=rows.filter(r=>r.metricEligible!==false),review=official.filter(r=>r.dataIntegrityReview),terminal=official.filter(r=>r.pod||r.returned||r.cancelled),withEvidence=official.filter(r=>r.evidenceCoverage&&r.evidenceCoverage!=='DAILY_ONLY'),dailyOnly=official.filter(r=>!r.evidenceCoverage||r.evidenceCoverage==='DAILY_ONLY');
    const byStatus={};for(const row of official){const key=String(row.statusDesc||'未分类');byStatus[key]=(byStatus[key]||0)+1;}
    res.setHeader('Cache-Control','no-store');res.json({ok:true,version:V205_INTEGRITY_AUDIT_VERSION,truthVersion:V205_CANONICAL_TRUTH_VERSION,businessType:type,range,total:official.length,terminal:terminal.length,withEvidence:withEvidence.length,dailyOnly:dailyOnly.length,dataIntegrityReview:review.length,coverageRate:official.length?Number((withEvidence.length/official.length*100).toFixed(2)):0,byStatus:Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).slice(0,30),reviewSamples:review.slice(0,50).map(r=>({shipmentCode:r.shipmentCode,date:r.firstReportDate,statusCode:r.statusCode,statusDesc:r.statusDesc,latestEventTime:r.latestEventTime||'',latestEventDesc:r.latestEventDesc||'',evidenceCoverage:r.evidenceCoverage||'DAILY_ONLY'})),generatedAt:new Date().toISOString()});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
}

let installed=false;const previousListen=express.application.listen;
express.application.listen=function v205IntegrityAuditListen(...args){if(!installed){installed=true;this.get('/api/v205/integrity/summary',summaryHandler);this.get('/api/v205/integrity/deep',deepHandler);}return previousListen.apply(this,args);};
