import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const read=file=>fs.readFileSync(file,'utf8');
for(const file of ['src/v320HistoricalExportRows.js','src/v84ExportBusinessWorker.js','src/v84ExportJobWorker.js']){
  const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(checked.status,0,`${file} syntax check failed: ${checked.stderr||checked.stdout}`);
}
const source=read('src/v320HistoricalExportRows.js');
const child=read('src/v84ExportBusinessWorker.js');
const parent=read('src/v84ExportJobWorker.js');

assert.match(source,/2026-09-08-v474-index-native-export-hydration-progress-v1/);
assert.match(source,/2026-09-08-v477-indexed-batch-driven-membership-selection-v1/);
assert.doesNotMatch(source,/UPPER\s*\(\s*TRIM\s*\([^)]*shipmentCode/i,'hot export hydration must keep shipmentCode bare/indexable');
assert.doesNotMatch(source,/UPPER\s*\(\s*TRIM\s*\([^)]*businessType/i,'hot export hydration must keep businessType bare/indexable');
assert.doesNotMatch(source,/JOIN\s+unified_import_rows\s+u[\s\S]{0,500}ROW_NUMBER\s*\(/i,'V477 membership planning must not join/window-sort the full member table');
assert.match(source,/FROM unified_import_batches b[\s\S]{0,500}EXISTS \([\s\S]{0,500}u\.snapshotId=b\.snapshotId AND u\.businessType=\?/i);
assert.match(source,/FROM final_rows WHERE shipmentCode IN/);
assert.match(source,/FROM business_final_rows WHERE businessType=\? AND shipmentCode IN/);
assert.match(source,/FROM shipment_current_state WHERE shipmentCode IN/);
assert.match(source,/WHERE snapshotId=\? AND businessType=\?/);
for(const phase of ['membershipPlan','membershipLoad','membershipRows','hydrateFinalRows','hydrateCurrentTruth'])assert.match(source,new RegExp(`phase:'${phase}'`));

assert.match(child,/2026-09-08-v474-indexed-business-export-progress-v1/);
assert.match(child,/progressFile=resultFile\?`\$\{resultFile\}\.progress\.json`/);
assert.match(child,/onProgress:payload=>writeProgress/);
assert.match(child,/phase:'done'/);

assert.match(parent,/2026-09-08-v477-batch-driven-membership-progress-v1/);
assert.match(parent,/readChildProgress\(progressFile\)/);
assert.match(parent,/childPhase:String\(childState\.phase/);
assert.match(parent,/membershipplan/);
assert.match(parent,/membershipload/);
assert.match(parent,/hydratefinalrows/);
assert.match(parent,/hydratecurrenttruth/);
assert.match(parent,/phase==='writing'/);
assert.match(parent,/CE_QC_EXPORT_WORKER_MODE:'SINGLE_BUSINESS_DIRECT'/,'heavy per-business child must use export-worker SQLite pragmas');

const db=new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE final_rows(shipmentCode TEXT,reportDate TEXT,x TEXT,PRIMARY KEY(shipmentCode,reportDate));
  CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,recipient_group TEXT,x TEXT,PRIMARY KEY(businessType,shipmentCode,reportDate));
  CREATE TABLE shipment_current_state(shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,state TEXT);
  CREATE TABLE unified_import_batches(reportDate TEXT,fileHash TEXT,status TEXT,snapshotId TEXT,createdAt TEXT,batchId TEXT);
  CREATE UNIQUE INDEX idx_unified_import_hash ON unified_import_batches(reportDate,fileHash,status);
  CREATE TABLE unified_import_rows(snapshotId TEXT,businessType TEXT,shipmentCode TEXT,reportDate TEXT,rowJson TEXT,PRIMARY KEY(snapshotId,shipmentCode));
  CREATE INDEX idx_unified_rows_snapshot ON unified_import_rows(snapshotId,businessType,shipmentCode);
`);
function plan(sql,args=[]){return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row=>String(row.detail||'')).join(' | ');}
function mustSearch(label,sql,args,table){const detail=plan(sql,args);assert.match(detail,new RegExp(`SEARCH ${table.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`),`${label} must SEARCH indexed ${table}: ${detail}`);assert.doesNotMatch(detail,new RegExp(`SCAN ${table.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`),`${label} must not SCAN ${table}: ${detail}`);}
mustSearch('CE final hydration','SELECT * FROM final_rows WHERE shipmentCode IN (?,?) ORDER BY reportDate',['CE1','CE2'],'final_rows');
mustSearch('business final hydration','SELECT * FROM business_final_rows WHERE businessType=? AND shipmentCode IN (?,?) ORDER BY reportDate',['CEAF','A1','A2'],'business_final_rows');
mustSearch('current-state hydration','SELECT * FROM shipment_current_state WHERE shipmentCode IN (?,?)',['CE1','CE2'],'shipment_current_state');
mustSearch('daily membership hydration','SELECT * FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY shipmentCode',['SNAP','CE'],'unified_import_rows');
const membershipPlanSql=`SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId
  FROM unified_import_batches b
  WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    AND EXISTS (
      SELECT 1 FROM unified_import_rows u
      WHERE u.snapshotId=b.snapshotId AND u.businessType=?
        AND u.reportDate=b.reportDate AND u.shipmentCode<>''
      LIMIT 1
    )
  ORDER BY b.reportDate ASC,b.createdAt DESC,b.batchId DESC`;
const membershipPlan=plan(membershipPlanSql,['2026-07-01','2026-09-01','CE']);
assert.match(membershipPlan,/SEARCH b USING INDEX idx_unified_import_hash/,'V477 batch candidates must use reportDate-leading batch index');
assert.match(membershipPlan,/SEARCH u USING INDEX idx_unified_rows_snapshot \(snapshotId=\? AND businessType=\?\)/,'V477 EXISTS probe must use snapshot/business covering index');
assert.doesNotMatch(membershipPlan,/SCAN u\b/,'V477 membership plan must not scan unified_import_rows');
db.close();

console.log('[V477/V474] indexed historical export smoke passed · membership snapshot planning is small-table batch-driven + indexed EXISTS · final/current hydration stays index-native · membershipPlan/load + child phase progress are surfaced');
