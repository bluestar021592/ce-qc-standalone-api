import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const V241_WHPP_AUDIT='2026-08-20-v241-whpp-current-terminal-readonly-v1';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.isAbsolute(process.env.DATA_DIR||'')?process.env.DATA_DIR:path.resolve(root,process.env.DATA_DIR||'D:\\CE CCSL金边数据库');
const dbFile=path.isAbsolute(process.env.DB_FILE||'')?process.env.DB_FILE:path.resolve(root,process.env.DB_FILE||path.join(dataDir,'ce_qc_monitor.db'));
const sampleBill=String(process.argv[2]||'CE01072600002').trim().toUpperCase();
if(!fs.existsSync(dbFile)){console.error(`RESULT: BLOCKED_DATABASE_NOT_FOUND ${dbFile}`);process.exit(20);}

const db=new DatabaseSync(dbFile,{readOnly:true});
try{
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
  const currentPod=`(UPPER(COALESCE(c.state,''))='POD' OR UPPER(COALESCE(json_extract(c.stateJson,'$.currentState'),''))='POD' OR COALESCE(json_extract(c.stateJson,'$.isPod'),0)=1 OR CAST(COALESCE(json_extract(c.stateJson,'$.orderStatus'),'') AS TEXT)='85')`;
  const currentReturn=`(UPPER(COALESCE(c.state,'')) IN ('RETURNED','RETURN_COMPLETED') OR UPPER(COALESCE(json_extract(c.stateJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED'))`;
  const currentCancel=`(UPPER(COALESCE(c.state,'')) IN ('ORDER_CANCELLED','CANCELLED','CANCELED') OR UPPER(COALESCE(json_extract(c.stateJson,'$.currentState'),'')) IN ('ORDER_CANCELLED','CANCELLED','CANCELED'))`;
  const currentTerminal=`(${currentPod} OR ${currentReturn} OR ${currentCancel})`;

  const podLockCurrentMismatch=Number(db.prepare(`
    SELECT COUNT(*) count
    FROM business_pod_locks p
    LEFT JOIN shipment_current_state c ON c.shipmentCode=p.shipmentCode
    WHERE p.businessType='WHPP' AND NOT ${currentPod}
  `).get()?.count||0);

  const latestScanMismatch=Number(db.prepare(`
    WITH latest_scan AS (
      SELECT s.* FROM business_scan_results s
      WHERE s.businessType='WHPP' AND NOT EXISTS(
        SELECT 1 FROM business_scan_results n
        WHERE n.businessType='WHPP' AND n.shipmentCode=s.shipmentCode
          AND (COALESCE(n.reportDate,'')>COALESCE(s.reportDate,'') OR (COALESCE(n.reportDate,'')=COALESCE(s.reportDate,'') AND COALESCE(n.updatedAt,'')>COALESCE(s.updatedAt,'')))
      )
    )
    SELECT COUNT(*) count
    FROM latest_scan s
    LEFT JOIN shipment_current_state c ON c.shipmentCode=s.shipmentCode
    LEFT JOIN business_pod_locks p ON p.businessType='WHPP' AND p.shipmentCode=s.shipmentCode
    WHERE p.shipmentCode IS NULL AND s.orderStatus IN ('10','85','100') AND (
      (s.orderStatus='85' AND NOT ${currentPod}) OR
      (s.orderStatus='100' AND NOT ${currentReturn}) OR
      (s.orderStatus='10' AND NOT ${currentCancel})
    )
  `).get()?.count||0);

  const latestTrackMismatch=Number(db.prepare(`
    WITH latest_scan AS (
      SELECT s.* FROM business_scan_results s
      WHERE s.businessType='WHPP' AND NOT EXISTS(
        SELECT 1 FROM business_scan_results n
        WHERE n.businessType='WHPP' AND n.shipmentCode=s.shipmentCode
          AND (COALESCE(n.reportDate,'')>COALESCE(s.reportDate,'') OR (COALESCE(n.reportDate,'')=COALESCE(s.reportDate,'') AND COALESCE(n.updatedAt,'')>COALESCE(s.updatedAt,'')))
      )
    ), latest_event AS (
      SELECT e.* FROM business_track_events e
      WHERE e.businessType='WHPP' AND NOT EXISTS(
        SELECT 1 FROM business_track_events n
        WHERE n.businessType='WHPP' AND n.shipmentCode=e.shipmentCode
          AND (COALESCE(n.eventTime,'')>COALESCE(e.eventTime,'') OR (COALESCE(n.eventTime,'')=COALESCE(e.eventTime,'') AND n.id>e.id))
      )
    )
    SELECT COUNT(*) count
    FROM latest_event e
    LEFT JOIN latest_scan s ON s.shipmentCode=e.shipmentCode
    LEFT JOIN shipment_current_state c ON c.shipmentCode=e.shipmentCode
    LEFT JOIN business_pod_locks p ON p.businessType='WHPP' AND p.shipmentCode=e.shipmentCode
    WHERE p.shipmentCode IS NULL
      AND COALESCE(s.orderStatus,'') NOT IN ('10','85','100')
      AND e.eventCode IN ('80','86')
      AND ((e.eventCode='80' AND NOT ${currentPod}) OR (e.eventCode='86' AND NOT ${currentReturn}))
  `).get()?.count||0);

  const currentTerminalCarryOpen=Number(db.prepare(`
    SELECT COUNT(*) count
    FROM shipment_current_state c
    INNER JOIN carryover_open_items o ON o.shipmentCode=c.shipmentCode
    WHERE c.businessType='WHPP' AND UPPER(COALESCE(o.status,''))='OPEN' AND ${currentTerminal}
  `).get()?.count||0);

  const currentTerminalLegacyCarryActive=Number(db.prepare(`
    SELECT COUNT(DISTINCT c.shipmentCode) count
    FROM shipment_current_state c
    INNER JOIN business_carry_bills b ON b.shipmentCode=c.shipmentCode AND b.businessType='WHPP'
    WHERE c.businessType='WHPP' AND UPPER(COALESCE(b.status,''))='ACTIVE' AND ${currentTerminal}
  `).get()?.count||0);

  // Historical final rows are immutable daily analysis evidence. They can lag a later
  // POD/return/cancel current state, so V241 reports that lag but does not reject a
  // correct mutable terminal truth. The display/carry authority is current state + POD lock.
  const historicalFinalLag=Number(db.prepare(`
    SELECT COUNT(*) count
    FROM business_final_rows f
    INNER JOIN shipment_current_state c ON c.shipmentCode=f.shipmentCode
    WHERE f.businessType='WHPP' AND ${currentTerminal} AND (
      (${currentPod} AND COALESCE(f.isPod,0)<>1) OR
      (${currentReturn} AND COALESCE(f.primaryCategory,'')<>'退回') OR
      (${currentCancel} AND COALESCE(f.primaryCategory,'')<>'订单取消')
    )
  `).get()?.count||0);

  const total=podLockCurrentMismatch+latestScanMismatch+latestTrackMismatch+currentTerminalCarryOpen+currentTerminalLegacyCarryActive;
  console.log(`CE QC WHPP TERMINAL AUTHORITY AUDIT - ${V241_WHPP_AUDIT} - STRICT READ ONLY`);
  console.log(`POD-lock -> current POD mismatches: ${podLockCurrentMismatch}`);
  console.log(`latest terminal scan -> current terminal mismatches: ${latestScanMismatch}`);
  console.log(`latest terminal track -> current terminal mismatches: ${latestTrackMismatch}`);
  console.log(`current terminal but carryover_open_items still OPEN: ${currentTerminalCarryOpen}`);
  console.log(`current terminal but legacy business_carry_bills still ACTIVE: ${currentTerminalLegacyCarryActive}`);
  console.log(`historical normalized final-row lag (diagnostic only): ${historicalFinalLag}`);

  if(sampleBill){
    const sample=db.prepare(`
      SELECT c.reportDate,c.state currentState,c.apiStatus,c.lastEventTime,
             p.podTime,p.source podSource,o.status carryOpenStatus,o.closeReason
      FROM shipment_current_state c
      LEFT JOIN business_pod_locks p ON p.businessType='WHPP' AND p.shipmentCode=c.shipmentCode
      LEFT JOIN carryover_open_items o ON o.shipmentCode=c.shipmentCode
      WHERE c.shipmentCode=? LIMIT 1
    `).get(sampleBill)||null;
    const scan=db.prepare("SELECT reportDate,orderStatus,isPod,updatedAt FROM business_scan_results WHERE businessType='WHPP' AND shipmentCode=? ORDER BY reportDate DESC,updatedAt DESC LIMIT 1").get(sampleBill)||null;
    const event=db.prepare("SELECT reportDate,eventCode,eventTime FROM business_track_events WHERE businessType='WHPP' AND shipmentCode=? ORDER BY eventTime DESC,id DESC LIMIT 1").get(sampleBill)||null;
    console.log(`SAMPLE ${sampleBill}: ${JSON.stringify({...(sample||{}),latestScan:scan,latestEvent:event})}`);
  }

  console.log(`RESULT: ${total===0?'READY':'BLOCKED'}`);
  process.exitCode=total===0?0:10;
}finally{db.close();}
