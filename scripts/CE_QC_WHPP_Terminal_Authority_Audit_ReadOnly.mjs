import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.isAbsolute(process.env.DATA_DIR||'')?process.env.DATA_DIR:path.resolve(root,process.env.DATA_DIR||'D:\\CE CCSL金边数据库');
const dbFile=path.isAbsolute(process.env.DB_FILE||'')?process.env.DB_FILE:path.resolve(root,process.env.DB_FILE||path.join(dataDir,'ce_qc_monitor.db'));
const sampleBill=String(process.argv[2]||'CE01072600002').trim().toUpperCase();
if(!fs.existsSync(dbFile)){console.error(`RESULT: BLOCKED_DATABASE_NOT_FOUND ${dbFile}`);process.exit(20);}
const db=new DatabaseSync(dbFile,{readOnly:true});
try{
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
  const latestEvent=`NOT EXISTS(SELECT 1 FROM business_track_events n WHERE n.businessType=e.businessType AND n.reportDate=e.reportDate AND n.shipmentCode=e.shipmentCode AND (COALESCE(n.eventTime,'')>COALESCE(e.eventTime,'') OR (COALESCE(n.eventTime,'')=COALESCE(e.eventTime,'') AND n.id>e.id)))`;
  const scanPodMismatch=Number(db.prepare(`SELECT COUNT(*) count FROM business_scan_results s LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.reportDate=s.reportDate AND f.shipmentCode=s.shipmentCode WHERE s.businessType='WHPP' AND s.orderStatus='85' AND (f.shipmentCode IS NULL OR COALESCE(f.isPod,0)<>1 OR UPPER(COALESCE(f.primaryCategory,''))<>'POD')`).get()?.count||0);
  const scanReturnMismatch=Number(db.prepare(`SELECT COUNT(*) count FROM business_scan_results s LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.reportDate=s.reportDate AND f.shipmentCode=s.shipmentCode WHERE s.businessType='WHPP' AND s.orderStatus='100' AND (f.shipmentCode IS NULL OR COALESCE(f.primaryCategory,'')<>'退回')`).get()?.count||0);
  const scanCancelMismatch=Number(db.prepare(`SELECT COUNT(*) count FROM business_scan_results s LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.reportDate=s.reportDate AND f.shipmentCode=s.shipmentCode WHERE s.businessType='WHPP' AND s.orderStatus='10' AND (f.shipmentCode IS NULL OR COALESCE(f.primaryCategory,'')<>'订单取消')`).get()?.count||0);
  const trackPodMismatch=Number(db.prepare(`SELECT COUNT(*) count FROM business_track_events e LEFT JOIN business_scan_results s ON s.businessType='WHPP' AND s.reportDate=e.reportDate AND s.shipmentCode=e.shipmentCode LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.reportDate=e.reportDate AND f.shipmentCode=e.shipmentCode WHERE e.businessType='WHPP' AND ${latestEvent} AND e.eventCode='80' AND COALESCE(s.orderStatus,'') NOT IN ('10','85','100') AND (f.shipmentCode IS NULL OR COALESCE(f.isPod,0)<>1)`).get()?.count||0);
  const trackReturnMismatch=Number(db.prepare(`SELECT COUNT(*) count FROM business_track_events e LEFT JOIN business_scan_results s ON s.businessType='WHPP' AND s.reportDate=e.reportDate AND s.shipmentCode=e.shipmentCode LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.reportDate=e.reportDate AND f.shipmentCode=e.shipmentCode WHERE e.businessType='WHPP' AND ${latestEvent} AND e.eventCode='86' AND COALESCE(s.orderStatus,'') NOT IN ('10','85','100') AND (f.shipmentCode IS NULL OR COALESCE(f.primaryCategory,'')<>'退回')`).get()?.count||0);
  const currentOpenTerminal=Number(db.prepare(`SELECT COUNT(*) count FROM shipment_current_state c WHERE c.businessType='WHPP' AND UPPER(COALESCE(c.state,'')) NOT IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') AND EXISTS(SELECT 1 FROM business_scan_results s WHERE s.businessType='WHPP' AND s.shipmentCode=c.shipmentCode AND s.orderStatus IN ('10','85','100'))`).get()?.count||0);
  const total=scanPodMismatch+scanReturnMismatch+scanCancelMismatch+trackPodMismatch+trackReturnMismatch+currentOpenTerminal;
  console.log('CE QC WHPP TERMINAL AUTHORITY AUDIT - STRICT READ ONLY');
  console.log(`scan85->POD mismatches: ${scanPodMismatch}`);
  console.log(`scan100->RETURN mismatches: ${scanReturnMismatch}`);
  console.log(`scan10->CANCEL mismatches: ${scanCancelMismatch}`);
  console.log(`latest track80->POD mismatches: ${trackPodMismatch}`);
  console.log(`latest track86->RETURN mismatches: ${trackReturnMismatch}`);
  console.log(`current-state terminal contradictions: ${currentOpenTerminal}`);
  if(sampleBill){
    const sample=db.prepare(`SELECT s.reportDate,s.orderStatus,f.isPod,f.primaryCategory,f.carryStatus,c.state currentState,c.apiStatus currentApi,o.status carryOpenStatus,o.closeReason FROM business_scan_results s LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.reportDate=s.reportDate AND f.shipmentCode=s.shipmentCode LEFT JOIN shipment_current_state c ON c.shipmentCode=s.shipmentCode LEFT JOIN carryover_open_items o ON o.shipmentCode=s.shipmentCode WHERE s.businessType='WHPP' AND s.shipmentCode=? ORDER BY s.reportDate DESC LIMIT 1`).get(sampleBill)||null;
    const event=db.prepare(`SELECT eventCode,eventTime FROM business_track_events e WHERE e.businessType='WHPP' AND e.shipmentCode=? AND ${latestEvent} ORDER BY reportDate DESC LIMIT 1`).get(sampleBill)||null;
    console.log(`SAMPLE ${sampleBill}: ${JSON.stringify({...(sample||{}),latestEventCode:event?.eventCode||'',latestEventTime:event?.eventTime||''})}`);
  }
  console.log(`RESULT: ${total===0?'READY':'BLOCKED'}`);
  process.exitCode=total===0?0:10;
}finally{db.close();}
