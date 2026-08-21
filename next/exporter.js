import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { getDataDb, nextRuntime, nowIso } from './db.js';
import { BUSINESSES, boardSummary, businessSummary } from './store.js';

const running=new Set();

export function startExport({reportDate='',businessType='ALL'}={}){
  const type=String(businessType||'ALL').toUpperCase();if(type!=='ALL'&&!BUSINESSES.includes(type))throw new Error('业务板块无效。');
  const summary=boardSummary(reportDate);if(!summary.reportDate)throw new Error('没有可导出的日报。');
  const jobId=crypto.randomUUID(),db=getDataDb(),createdAt=nowIso();
  db.prepare('INSERT INTO export_jobs(jobId,status,periodType,businessType,fromDate,toDate,createdAt) VALUES(?,?,?,?,?,?,?)').run(jobId,'QUEUED','daily',type,summary.reportDate,summary.reportDate,createdAt);
  queueMicrotask(()=>runExport(jobId,summary.reportDate,type).catch(error=>console.error('[QC-NEXT][EXPORT]',error)));
  return{jobId,status:'QUEUED',reportDate:summary.reportDate,businessType:type};
}

export function exportStatus(jobId){return getDataDb().prepare('SELECT * FROM export_jobs WHERE jobId=?').get(String(jobId||''))||null;}
export function exportFile(jobId){const job=exportStatus(jobId);if(!job||job.status!=='COMPLETED'||!job.filePath)return null;return fs.existsSync(job.filePath)?job.filePath:null;}

async function runExport(jobId,reportDate,type){
  if(running.has(jobId))return;running.add(jobId);const db=getDataDb();
  db.prepare("UPDATE export_jobs SET status='RUNNING' WHERE jobId=?").run(jobId);
  try{
    const workbook=new ExcelJS.Workbook();workbook.creator='CE QC Next';workbook.created=new Date();
    const selected=type==='ALL'?BUSINESSES:[type];const all=boardSummary(reportDate);
    const summarySheet=workbook.addWorksheet('管理汇总');
    summarySheet.columns=[{header:'业务板块',key:'business',width:18},{header:'总票数',key:'total',width:12},{header:'已POD',key:'pod',width:12},{header:'已退回',key:'returned',width:12},{header:'未闭环',key:'open',width:12},{header:'POD率',key:'podRate',width:12},{header:'Pending1+',key:'pending1',width:12},{header:'Pending2+',key:'pending2',width:12},{header:'Pending3+',key:'pending3',width:12},{header:'OC2+',key:'oc2',width:12},{header:'580',key:'retention580',width:10},{header:'PP',key:'pp',width:10},{header:'PV',key:'pv',width:10}];
    for(const business of selected){const b=all.boards[business];summarySheet.addRow({business,total:b.total,pod:b.pod,returned:b.returned,open:b.open,podRate:b.podRate,pending1:b.pending1,pending2:b.pending2,pending3:b.pending3,oc2:b.oc2,retention580:b.retention580,pp:b.pp,pv:b.pv});}
    styleHeader(summarySheet);
    for(const business of selected){
      const b=businessSummary(business,reportDate),sheet=workbook.addWorksheet(safeSheet(business));
      sheet.columns=[{header:'运单号',key:'shipmentCode',width:22},{header:'区域',key:'regionCode',width:10},{header:'收件人',key:'recipientRaw',width:24},{header:'状态',key:'state',width:20},{header:'是否POD',key:'isPod',width:10},{header:'已退回',key:'isReturned',width:10},{header:'Pending天数',key:'pendingDays',width:14},{header:'OC天数',key:'ocDays',width:12},{header:'特殊状态',key:'specialState',width:22},{header:'最后节点时间',key:'lastEventTime',width:22},{header:'最后节点',key:'lastEventDesc',width:40}];
      for(const row of b.rows||[])sheet.addRow({...row,isPod:Number(row.isPod)?'是':'否',isReturned:Number(row.isReturned)?'是':'否'});styleHeader(sheet);sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'K1'};
    }
    const dir=nextRuntime().exportsDir;fs.mkdirSync(dir,{recursive:true});const fileName=`CE_QC_NEXT_${type}_${reportDate}_${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`,filePath=path.join(dir,fileName);
    await workbook.xlsx.writeFile(filePath);
    db.prepare("UPDATE export_jobs SET status='COMPLETED',filePath=?,completedAt=? WHERE jobId=?").run(filePath,nowIso(),jobId);
  }catch(error){db.prepare("UPDATE export_jobs SET status='FAILED',errorMessage=?,completedAt=? WHERE jobId=?").run(String(error?.message||error),nowIso(),jobId);throw error;}finally{running.delete(jobId);}
}

function styleHeader(sheet){const row=sheet.getRow(1);row.font={bold:true};row.alignment={vertical:'middle'};row.height=24;}
function safeSheet(value){return String(value||'Sheet').replace(/[\\/*?:\[\]]/g,'_').slice(0,31);}
