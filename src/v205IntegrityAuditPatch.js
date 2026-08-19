import express from 'express';
import { getDb } from './db.js';
import { collectV207ExportRows } from './v207ExportMembershipTruth.js';
import { collectV206ShopeeRows, summarizeV206ShopeeTiming, V206_SHOPEE_PRECISION_VERSION } from './v206ShopeePrecisionTruth.js';
import { loadV207CanonicalRowsForDate, V207_IMPORT_INTEGRITY_VERSION, V207_TYPES } from './v207UnifiedImportIntegrity.js';

export const V205_INTEGRITY_AUDIT_VERSION='2026-08-19-v207-clean-rebaseline-progress-audit-v3';
const TYPES=[...V207_TYPES];
const TYPE_SET=new Set(TYPES);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);

function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function latestDate(){const db=getDb(),dates=[];try{dates.push(String(db.prepare('SELECT MAX(reportDate) d FROM v207_daily_ownership').get()?.d||''));}catch{}try{dates.push(String(db.prepare("SELECT MAX(reportDate) d FROM unified_import_batches WHERE status IN ('VALID','SUPERSEDED')").get()?.d||''));}catch{}try{dates.push(String(db.prepare("SELECT MAX(reportDate) d FROM business_daily_reports WHERE businessType='WHPP'").get()?.d||''));}catch{}return dates.filter(Boolean).sort().at(-1)||'';}
function rangeOf(query={}){const to=dateKey(query.toDate)||dateKey(latestDate())||new Date().toISOString().slice(0,10);const from=dateKey(query.fromDate)||to;if(from>to)throw new Error('开始日期不能晚于结束日期。');return{from,to};}
function countByType(rows=[]){return Object.fromEntries(TYPES.map(type=>[type,rows.filter(row=>String(row.businessType||'').toUpperCase()===type).length]));}
function emptyCounts(){return Object.fromEntries(TYPES.map(type=>[type,0]));}

function knownDates(range){const db=getDb(),set=new Set();try{for(const row of db.prepare("SELECT DISTINCT reportDate FROM unified_import_batches WHERE status IN ('VALID','SUPERSEDED') AND reportDate BETWEEN ? AND ?").all(range.from,range.to))set.add(String(row.reportDate));}catch{}try{for(const row of db.prepare("SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ?").all(range.from,range.to))set.add(String(row.reportDate));}catch{}try{for(const row of db.prepare('SELECT DISTINCT reportDate FROM v207_daily_ownership WHERE reportDate BETWEEN ? AND ?').all(range.from,range.to))set.add(String(row.reportDate));}catch{}return[...set].filter(Boolean).sort();}
function legacyReferenceCounts(date){const db=getDb(),out=emptyCounts();try{for(const row of db.prepare(`SELECT r.businessType,COUNT(DISTINCT r.shipmentCode) count FROM unified_import_rows r JOIN unified_import_batches b ON b.batchId=r.batchId WHERE r.reportDate=? AND b.status IN ('VALID','SUPERSEDED') GROUP BY r.businessType`).all(date)){if(Object.prototype.hasOwnProperty.call(out,String(row.businessType)))out[String(row.businessType)]=Number(row.count||0);}}catch{}try{out.WHPP=Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count||0);}catch{}return out;}
function sumCounts(counts={}){return TYPES.reduce((s,t)=>s+Number(counts[t]||0),0);}
function dailyLedger(date){
  const rows=loadV207CanonicalRowsForDate(date),rebuilt=rows.length>0,counts=countByType(rows),current=rows.filter(row=>!row.v207RecoveredFromPrior),recovered=rows.filter(row=>row.v207RecoveredFromPrior),currentCounts=countByType(current),recoveredCounts=countByType(recovered),legacyCounts=legacyReferenceCounts(date),legacyReferenceUnique=sumCounts(legacyCounts);
  return{date,rebuilt,canonicalUnique:rows.length,currentUploadUnique:current.length,recoveredFromPrior:recovered.length,counts,currentCounts,recoveredCounts,legacyReferenceUnique,legacyCounts,completeReupload:rebuilt&&recovered.length===0,status:!rebuilt?'WAITING_REUPLOAD':recovered.length?'NO_LOSS_ARCHIVE_RECOVERY':'COMPLETE_REUPLOAD',recoveredSamples:recovered.slice(0,30).map(row=>({shipmentCode:row.shipmentCode,businessType:row.businessType}))};
}

function summaryHandler(req,res){
  try{
    const range=rangeOf(req.query),daily=knownDates(range).map(dailyLedger);
    const byBusiness=TYPES.map(type=>{
      const rebuiltCanonical=daily.reduce((s,d)=>s+Number(d.counts[type]||0),0),currentUpload=daily.reduce((s,d)=>s+Number(d.currentCounts[type]||0),0),preserved=daily.reduce((s,d)=>s+Number(d.recoveredCounts[type]||0),0),legacyReference=daily.reduce((s,d)=>s+Number(d.legacyCounts[type]||0),0);
      return{businessType:type,archiveUnique:rebuiltCanonical,currentUnique:currentUpload,atRiskMissing:preserved,datesAtRisk:daily.filter(d=>Number(d.recoveredCounts[type]||0)>0).length,rebuiltCanonical,currentUpload,preserved,legacyReference,datesRebuilt:daily.filter(d=>d.rebuilt&&Number(d.counts[type]||0)>0).length,datesPendingRebuild:daily.filter(d=>!d.rebuilt&&Number(d.legacyCounts[type]||0)>0).length};
    });
    const totals={archiveUnique:daily.reduce((s,d)=>s+d.canonicalUnique,0),currentUnique:daily.reduce((s,d)=>s+d.currentUploadUnique,0),atRiskMissing:daily.reduce((s,d)=>s+d.recoveredFromPrior,0),datesAtRisk:daily.filter(d=>d.recoveredFromPrior>0).length,expectedDates:daily.length,rebuiltDates:daily.filter(d=>d.rebuilt).length,pendingRebuildDates:daily.filter(d=>!d.rebuilt).length,completeReuploadDates:daily.filter(d=>d.completeReupload).length,noLossRecoveryDates:daily.filter(d=>d.status==='NO_LOSS_ARCHIVE_RECOVERY').length};
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,version:V205_INTEGRITY_AUDIT_VERSION,truthVersion:V207_IMPORT_INTEGRITY_VERSION,range,totals,byBusiness,daily,rule:'V207清洁重建：每个日期第一次用新版上传时，以这份文件建立全新七业务底账，不自动把旧系统可能有问题的成员复制进来；此后该日期再次上传只允许更新/新增，不允许静默删除已确认运单。',generatedAt:new Date().toISOString()});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
}

async function deepHandler(req,res){
  try{
    const type=String(req.query.businessType||'').toUpperCase();if(!TYPE_SET.has(type))return res.status(400).json({ok:false,error:'请选择有效业务板块。'});
    const range=rangeOf(req.query);
    const pendingDates=knownDates(range).filter(date=>{const d=dailyLedger(date);return !d.rebuilt&&Number(d.legacyCounts[type]||0)>0;});
    if(pendingDates.length)return res.status(409).json({ok:false,code:'V207_REBASELINE_INCOMPLETE',error:`${type} 还有 ${pendingDates.length} 个历史日期尚未重新上传：${pendingDates.slice(0,12).join('、')}${pendingDates.length>12?'…':''}`,missingDates:pendingDates});
    const rows=SHOPEE_TYPES.has(type)?await collectV206ShopeeRows(type,range):await collectV207ExportRows(type,range);
    const official=rows.filter(r=>r.metricEligible!==false),review=official.filter(r=>r.dataIntegrityReview),terminal=official.filter(r=>r.pod||r.returned||r.cancelled),withEvidence=official.filter(r=>r.evidenceCoverage&&!['DAILY_ONLY','OWNERSHIP_ONLY'].includes(r.evidenceCoverage)),dailyOnly=official.filter(r=>!r.evidenceCoverage||['DAILY_ONLY','OWNERSHIP_ONLY'].includes(r.evidenceCoverage));
    const byStatus={};for(const row of official){const key=String(row.statusDesc||'未分类');byStatus[key]=(byStatus[key]||0)+1;}
    const timing=SHOPEE_TYPES.has(type)?summarizeV206ShopeeTiming(official):null;
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,version:V205_INTEGRITY_AUDIT_VERSION,truthVersion:SHOPEE_TYPES.has(type)?V206_SHOPEE_PRECISION_VERSION:V207_IMPORT_INTEGRITY_VERSION,businessType:type,range,total:official.length,terminal:terminal.length,withEvidence:withEvidence.length,dailyOnly:dailyOnly.length,dataIntegrityReview:review.length,coverageRate:official.length?Number((withEvidence.length/official.length*100).toFixed(2)):0,timing,byStatus:Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).slice(0,30),reviewSamples:review.slice(0,50).map(r=>({shipmentCode:r.shipmentCode,date:r.firstReportDate,statusCode:r.statusCode,statusDesc:r.statusDesc,latestEventTime:r.latestEventTime||'',latestEventDesc:r.latestEventDesc||'',evidenceCoverage:r.evidenceCoverage||'OWNERSHIP_ONLY',timingEvidenceStatus:r.timingEvidenceStatus||''})),generatedAt:new Date().toISOString()});
  }catch(error){res.status(500).json({ok:false,error:error.message});}
}

function rebaselineDailyHandler(req,res){try{const date=dateKey(req.query.reportDate)||latestDate();if(!date)return res.status(400).json({ok:false,error:'没有可核查的日报日期。'});const detail=dailyLedger(date);res.setHeader('Cache-Control','no-store');res.json({ok:true,version:V207_IMPORT_INTEGRITY_VERSION,...detail});}catch(error){res.status(400).json({ok:false,error:error.message});}}
function rebaselineRangeHandler(req,res){try{const range=rangeOf(req.query),rows=knownDates(range).map(dailyLedger);res.setHeader('Cache-Control','no-store');res.json({ok:true,version:V207_IMPORT_INTEGRITY_VERSION,range,rows,summary:{dates:rows.length,expectedDates:rows.length,rebuiltDates:rows.filter(d=>d.rebuilt).length,pendingRebuildDates:rows.filter(d=>!d.rebuilt).length,canonicalUnique:rows.reduce((s,d)=>s+d.canonicalUnique,0),currentUploadUnique:rows.reduce((s,d)=>s+d.currentUploadUnique,0),recoveredFromPrior:rows.reduce((s,d)=>s+d.recoveredFromPrior,0),completeDates:rows.filter(d=>d.completeReupload).length,recoveredDates:rows.filter(d=>d.status==='NO_LOSS_ARCHIVE_RECOVERY').length}});}catch(error){res.status(400).json({ok:false,error:error.message});}}

let installed=false;const previousListen=express.application.listen;
express.application.listen=function v207IntegrityAuditListen(...args){if(!installed){installed=true;this.get('/api/v205/integrity/summary',summaryHandler);this.get('/api/v205/integrity/deep',deepHandler);this.get('/api/v207/rebaseline/daily',rebaselineDailyHandler);this.get('/api/v207/rebaseline/range',rebaselineRangeHandler);}return previousListen.apply(this,args);};
