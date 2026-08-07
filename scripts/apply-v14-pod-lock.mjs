import fs from 'node:fs';

function replaceExact(file, before, after) {
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one target, found ${count}`);
  text = text.replace(before, after);
  fs.writeFileSync(file, text, 'utf8');
}

replaceExact(
  'src/unifiedImportStore.js',
  "    const upsertCurrent = db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt) VALUES(?,?,?,?,?,'PENDING_SCAN','',?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,snapshotId=excluded.snapshotId,state='PENDING_SCAN',apiStatus='PENDING_SCAN',stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`);",
  "    const upsertCurrent = db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt) VALUES(?,?,?,?,?,'PENDING_SCAN','',?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,snapshotId=excluded.snapshotId,state=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.state ELSE 'PENDING_SCAN' END,apiStatus=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.apiStatus ELSE 'PENDING_SCAN' END,lastEventTime=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.lastEventTime ELSE '' END,stateJson=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.stateJson ELSE excluded.stateJson END,updatedAt=excluded.updatedAt`);"
);

replaceExact(
  'src/unifiedImportStore.js',
  "    const upsertCarry = db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'OPEN','PENDING_SCAN','',?,?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,status='OPEN',apiStatus='PENDING_SCAN',closeReason='',stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`);",
  "    const upsertCarry = db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'OPEN','PENDING_SCAN','',?,?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,status=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN 'CLOSED' ELSE 'OPEN' END,apiStatus=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.apiStatus ELSE 'PENDING_SCAN' END,closeReason=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.closeReason ELSE '' END,stateJson=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.stateJson ELSE excluded.stateJson END,updatedAt=excluded.updatedAt`);"
);

console.log('V14 POD/return terminal lock preservation applied.');
