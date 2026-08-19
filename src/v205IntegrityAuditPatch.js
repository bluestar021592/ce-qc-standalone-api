import express from 'express';
import { getDb } from './db.js';
import { collectV207ExportRows } from './v207ExportMembershipTruth.js';
import { collectV206ShopeeRows, summarizeV206ShopeeTiming, V206_SHOPEE_PRECISION_VERSION } from './v206ShopeePrecisionTruth.js';
import { loadV207CanonicalRows, loadV207CanonicalRowsForDate, V207_IMPORT_INTEGRITY_VERSION, V207_TYPES } from './v207UnifiedImportIntegrity.js';

export const V205_INTEGRITY_AUDIT_VERSION='2026-08-19-v207-qc-no-loss-integrity-audit-v2';
const TYPES=[...V207_TYPES];
const TYPE_SET=new Set(TYPES);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);

function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function latestDate(){const db=getDb();let date='';try{date=String(db.prepare('SELECT MAX(reportDate) d FROM v207_daily_ownership').get()?.d||'');}catch{}if(!date)try{date=String(db.prepare("SELECT MAX(reportDate) d FROM unified_import_batches WHERE status IN ('VALID','SUPERSEDED')").get()?.d||'');}catch{}if(!date)try{date=String(db.prepare("SELECT MAX(reportDate) d FROM business_daily_reports WHERE businessType='WHPP'").get()?.d||'');}catch{}return date;}
function rangeOf(query={}){const to=dateKey(query.toDate)||dateKey(latestDate())||new Date().toISOString().slice(0,10);const from=dateKey(query.fromDate)||to;if(from>to)throw new Error('开始日期不能晚于结束日期。');return{from,to};}
function nextDate(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function dateList(range){const out=[];for(let d=range.from;d<=range.to;d=nextDate(d))out.push(d);return out;}
function countByType(rows=[]){return Object.fromEntries(TYPES.map(type=>[type,rows.filter(row=>String(row.businessType||'').toUpperCase()===type).length]));}

function dailyLedger(date){
  const rows=loadV207CanonicalRowsForDate(date);
  const counts=countByType(rows);
  const current=rows.filter(row=>!row.v207RecoveredFromPrior);
  const recovered=rows.filter(row=>row.v207RecoveredFromPrior);
  const currentCounts=countByType(current),recoveredCounts=countByType(recovered);
  return{date,canonicalUnique:rows.length,currentUploadUnique:current.length,recoveredFromPrior:recovered.length,counts,currentCounts,recoveredCounts,completeReupload:recovered.length===0,recoveredSamples:recovered.slice(0,30).map(row=>({shipmentCode:row.shipmentCode,businessType:row.businessType}))};
}

function summaryHandler(req,res){
  try{
    const range=rangeOf(req.query),daily=dateList(range).map(dailyLedger).filter(item=>item.canonicalUnique>0);
    const byBusiness=TYPES.map(type=>{
      const archiveUnique=daily.reduce((s,d)=>s+Number(d.counts[type]||0),0);
      const currentUnique=daily.reduce((s,d)=>s+Number(d.currentCounts[type]||0),0);
      const atRiskMissing=daily.reduce((s,d)=>s+Number(d.recoveredCounts[type]||0),0);
      return{businessType:type,archiveUnique,currentUnique,atRiskMissing,datesAtRisk:daily.filter(d=>Number(d.recoveredCounts[type]||0)>0).length};
    });
    const totals={archiveUnique:daily.reduce((s,d)=>s+d.canonicalUnique,0),currentUnique:daily.reduce((s,d)=>s+d.currentUploadUnique,0),atRiskMissing:daily.reduce((s,d)=>s+d.recoveredFromPrior,0),datesAtRisk:daily.filter(d=>d.recoveredFromPrior>0).length};
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,version:V205_INTEGRITY_AUDIT_VERSION,truthVersion:V207_IMPORT_INTEGRITY_VERSION,range,totals,byBusiness,daily,rule:'V207七业务不可丢失底账：同一日报日期再次上传时，本次出现的票更新字段和明确归属；历史已确认但本次缺少的票不会删除，而是标记为“历史底账自动保留”。只有用户执行管理员全量清除才会删除该底账。',generatedAt:new Date().toISOString()});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
}

async function deepHandler(req,res){
  try{
    const type=String(req.query.businessType||'').toUpperCase();if(!TYPE_SET.has(type))return res.status(400).json({ok:false,error:'请选择有效业务板块。'});
    const range=rangeOf(req.query);
    const rows=SHOPEE_TYPES.has(type)?await collectV206ShopeeRows(type,range):await collectV207ExportRows(type,range);
    const official=rows.filter(r=>r.metricEligible!==false),review=official.filter(r=>r.dataIntegrityReview),terminal=official.filter(r=>r.pod||r.returned||r.cancelled),withEvidence=official.filter(r=>r.evidenceCoverage&&!['DAILY_ONLY','OWNERSHIP_ONLY'].includes(r.evidenceCoverage)),dailyOnly=official.filter(r=>!r.evidenceCoverage||['DAILY_ONLY','OWNERSHIP_ONLY'].includes(r.evidenceCoverage));
    const byStatus={};for(const row of official){const key=String(row.statusDesc||'未分类');byStatus[key]=(byStatus[key]||0)+1;}
    const timing=SHOPEE_TYPES.has(type)?summarizeV206ShopeeTiming(official):null;
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,version:V205_INTEGRITY_AUDIT_VERSION,truthVersion:SHOPEE_TYPES.has(type)?V206_SHOPEE_PRECISION_VERSION:V207_IMPORT_INTEGRITY_VERSION,businessType:type,range,total:official.length,terminal:terminal.length,withEvidence:withEvidence.length,dailyOnly:dailyOnly.length,dataIntegrityReview:review.length,coverageRate:official.length?Number((withEvidence.length/official.length*100).toFixed(2)):0,timing,byStatus:Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).slice(0,30),reviewSamples:review.slice(0,50).map(r=>({shipmentCode:r.shipmentCode,date:r.firstReportDate,statusCode:r.statusCode,statusDesc:r.statusDesc,latestEventTime:r.latestEventTime||'',latestEventDesc:r.latestEventDesc||'',evidenceCoverage:r.evidenceCoverage||'OWNERSHIP_ONLY',timingEvidenceStatus:r.timingEvidenceStatus||''})),generatedAt:new Date().toISOString()});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
}

function rebaselineDailyHandler(req,res){
  try{const date=dateKey(req.query.reportDate)||latestDate();if(!date)return res.status(400).json({ok:false,error:'没有可核查的日报日期。'});const detail=dailyLedger(date);res.setHeader('Cache-Control','no-store');res.json({ok:true,version:V207_IMPORT_INTEGRITY_VERSION,...detail,status:detail.completeReupload?'COMPLETE_REUPLOAD':'NO_LOSS_ARCHIVE_RECOVERY'});}catch(error){res.status(400).json({ok:false,error:error.message});}
}
function rebaselineRangeHandler(req,res){
  try{const range=rangeOf(req.query),rows=dateList(range).map(dailyLedger).filter(item=>item.canonicalUnique>0);res.setHeader('Cache-Control','no-store');res.json({ok:true,version:V207_IMPORT_INTEGRITY_VERSION,range,rows,summary:{dates:rows.length,canonicalUnique:rows.reduce((s,d)=>s+d.canonicalUnique,0),currentUploadUnique:rows.reduce((s,d)=>s+d.currentUploadUnique,0),recoveredFromPrior:rows.reduce((s,d)=>s+d.recoveredFromPrior,0),completeDates:rows.filter(d=>d.completeReupload).length,recoveredDates:rows.filter(d=>!d.completeReupload).length}});}catch(error){res.status(400).json({ok:false,error:error.message});}
}

let installed=false;const previousListen=express.application.listen;
express.application.listen=function v207IntegrityAuditListen(...args){if(!installed){installed=true;this.get('/api/v205/integrity/summary',summaryHandler);this.get('/api/v205/integrity/deep',deepHandler);this.get('/api/v207/rebaseline/daily',rebaselineDailyHandler);this.get('/api/v207/rebaseline/range',rebaselineRangeHandler);}return previousListen.apply(this,args);};
