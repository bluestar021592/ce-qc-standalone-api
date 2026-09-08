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
assert.doesNotMatch(source,/UPPER\s*\(\s*TRIM\s*\([^)]*shipmentCode/i,'V474 hot export hydration must keep shipmentCode bare/indexable');
assert.doesNotMatch(source,/UPPER\s*\(\s*TRIM\s*\([^)]*businessType/i,'V474 hot export hydration must keep businessType bare/indexable');
assert.match(source,/FROM final_rows WHERE shipmentCode IN/);
assert.match(source,/FROM business_final_rows WHERE businessType=\? AND shipmentCode IN/);
assert.match(source,/FROM shipment_current_state WHERE shipmentCode IN/);
assert.match(source,/WHERE snapshotId=\? AND businessType=\?/);
assert.match(source,/phase:'hydrateFinalRows'/);
assert.match(source,/phase:'hydrateCurrentTruth'/);
assert.match(source,/phase:'membershipRows'/);

assert.match(child,/2026-09-08-v474-indexed-business-export-progress-v1/);
assert.match(child,/progressFile=resultFile\?`\$\{resultFile\}\.progress\.json`/);
assert.match(child,/onProgress:payload=>writeProgress/);
assert.match(child,/phase:'done'/);

assert.match(parent,/2026-09-08-v474-one-business-one-workbook-indexed-progress-v1/);
assert.match(parent,/readChildProgress\(progressFile\)/);
assert.match(parent,/childPhase:String\(childState\.phase/);
assert.match(parent,/hydratefinalrows/);
assert.match(parent,/hydratecurrenttruth/);
assert.match(parent,/phase==='writing'/);
assert.match(parent,/CE_QC_EXPORT_WORKER_MODE:'SINGLE_BUSINESS_DIRECT'/,'heavy per-business child must use export-worker SQLite pragmas');

const db=new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE final_rows(shipmentCode TEXT,reportDate TEXT,x TEXT,PRIMARY KEY(shipmentCode,reportDate));
  CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,recipient_group TEXT,x TEXT,PRIMARY KEY(businessType,shipmentCode,reportDate));
  CREATE TABLE shipment_current_state(shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,state TEXT);
  CREATE TABLE unified_import_rows(snapshotId TEXT,businessType TEXT,shipmentCode TEXT,rowJson TEXT,PRIMARY KEY(snapshotId,shipmentCode));
  CREATE INDEX idx_unified_rows_snapshot ON unified_import_rows(snapshotId,businessType,shipmentCode);
`);
function plan(sql,args=[]){return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row=>String(row.detail||'')).join(' | ');}
function mustSearch(label,sql,args,table){const detail=plan(sql,args);assert.match(detail,new RegExp(`SEARCH ${table.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`),`${label} must SEARCH indexed ${table}: ${detail}`);assert.doesNotMatch(detail,new RegExp(`SCAN ${table.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`),`${label} must not SCAN ${table}: ${detail}`);}
mustSearch('CE final hydration','SELECT * FROM final_rows WHERE shipmentCode IN (?,?) ORDER BY reportDate',['CE1','CE2'],'final_rows');
mustSearch('business final hydration','SELECT * FROM business_final_rows WHERE businessType=? AND shipmentCode IN (?,?) ORDER BY reportDate',['CEAF','A1','A2'],'business_final_rows');
mustSearch('current-state hydration','SELECT * FROM shipment_current_state WHERE shipmentCode IN (?,?)',['CE1','CE2'],'shipment_current_state');
mustSearch('daily membership hydration','SELECT * FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY shipmentCode',['SNAP','CE'],'unified_import_rows');
db.close();

console.log('[V474] indexed historical export hydration smoke passed · final_rows/business_final_rows/current_state/unified rows use SEARCH plans · UPPER/TRIM index killers forbidden · child phase progress is surfaced to parent Job · business child uses isolated export SQLite pragmas');
