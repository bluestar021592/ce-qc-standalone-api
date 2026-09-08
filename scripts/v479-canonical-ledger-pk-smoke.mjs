import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ensureV246TrackingSchema } from '../src/v246TrackingLedgerCore.js';
import { applyV419CanonicalExportLedgerTruth, V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID, V479_CANONICAL_LEDGER_READ_ID } from '../src/v419CanonicalExportLedgerTruth.js';

for(const file of ['src/v419CanonicalExportLedgerTruth.js','src/v225ExportReturnTruth.js','src/v84ExportJobWorker.js']){
  const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(checked.status,0,`${file} syntax failed: ${checked.stderr||checked.stdout}`);
}
const v419=fs.readFileSync('src/v419CanonicalExportLedgerTruth.js','utf8');
const v225=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const v84=fs.readFileSync('src/v84ExportJobWorker.js','utf8');
assert.match(v419,/2026-09-08-v479-primary-key-scalar-ledger-hydration-v1/);
assert.match(v419,/const LEDGER_CHUNK_SIZE=900/);
assert.match(v419,/FROM qc_tracking_ledger WHERE shipmentCode IN \(\$\{marks\}\)/);
assert.doesNotMatch(v419,/WHERE businessType=\? AND shipmentCode IN/,'V479 must not let SQLite choose the broad businessType index for each export chunk');
assert.doesNotMatch(v419,/signingDays,evidenceJson,currentStateJson,lastEventTime/,'V479 scalar hot query must not hydrate both large JSON columns for every ticket');
assert.match(v419,/jsonColumnByBill\(db,openBills,'currentStateJson'\)/);
assert.match(v419,/jsonColumnByBill\(db,strictPodBills,'evidenceJson'\)/);
assert.match(v419,/phase:'hydrateLedgerTruth'/,'V479 must use a dedicated post-sourceRows ledger phase');
assert.match(v225,/applyV419CanonicalExportLedgerTruth\(businessType,rows,\{db:getDb\(\),onProgress\}\)/,'V225 must forward child progress into V479 ledger hydration');
assert.match(v84,/if\(phase==='hydrateledgertruth'\)return 0\.58\+0\.12\*ratio/,'V84 must keep ledger hydration progress monotonic after sourceRows');
assert.match(v84,/正在按 shipmentCode 主键读取V246账本/,'V84 must expose exact V246 ledger progress instead of a generic 7% stall');
assert.equal(V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID,'2026-09-03-v419-canonical-export-ledger-truth-v2','canonical business truth id must remain stable');
assert.equal(V479_CANONICAL_LEDGER_READ_ID,'2026-09-08-v479-primary-key-scalar-ledger-hydration-v1');

const db=new DatabaseSync(':memory:');
try{
  ensureV246TrackingSchema(db);
  const insert=db.prepare(`INSERT INTO qc_tracking_ledger(
    shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,
    trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,
    attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now='2026-09-08T10:00:00.000Z';
  insert.run('CE-POD-1','CE','2026-07-01','2026-09-01','','','TERMINAL','POD',now,'POD','POD',now,'2026-07-02',1,'V246_LEDGER',2,JSON.stringify({huge:'x'.repeat(5000)}),JSON.stringify({huge:'y'.repeat(5000)}),now,'',now,now);
  insert.run('CE-OPEN-1','CE','2026-07-01','2026-09-01','','','OPEN','', '', 'PENDING','Pending',now,'',0,'',null,JSON.stringify({huge:'z'.repeat(5000)}),JSON.stringify({pendingDistinctDayCount:2,primaryCategory:'Pending'}),now,'',now,now);

  const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT shipmentCode,businessType,trackingStatus,terminalReason,currentState,currentCategory,podDate,attemptNo,attemptSource,signingDays,lastEventTime,lastCheckedAt FROM qc_tracking_ledger WHERE shipmentCode IN (?,?,?)`).all('CE-POD-1','CE-OPEN-1','MISSING');
  const planText=plan.map(row=>String(row.detail||'')).join(' | ');
  assert.match(planText,/SEARCH qc_tracking_ledger USING INDEX .*shipmentCode/i,`V479 hot query must use shipmentCode PK: ${planText}`);
  assert.doesNotMatch(planText,/SCAN qc_tracking_ledger/i,`V479 hot query must not scan ledger: ${planText}`);

  const sqlLog=[];
  const wrapped={
    exec(sql){return db.exec(sql);},
    prepare(sql){
      sqlLog.push(String(sql));
      const stmt=db.prepare(sql);
      return {all(...args){return stmt.all(...args);},get(...args){return stmt.get(...args);},run(...args){return stmt.run(...args);}};
    }
  };
  const progress=[];
  const rows=[
    {shipmentCode:'CE-POD-1',pod:false,returned:false,pending:true,delivering:true,statusCode:'P',statusDesc:'old',evidence:new Set()},
    {shipmentCode:'CE-OPEN-1',pod:true,returned:false,pending:false,delivering:false,statusCode:'Y',statusDesc:'old',evidence:new Set()}
  ];
  applyV419CanonicalExportLedgerTruth('CE',rows,{db:wrapped,onProgress:item=>progress.push(item)});
  assert.equal(rows[0].pod,true);assert.equal(rows[0].statusDesc,'POD');assert.equal(rows[0].signingDays,2);assert.equal(rows[0].attemptNo,1);
  assert.equal(rows[1].pod,false);assert.equal(rows[1].pending,true);assert.equal(rows[1].statusDesc,'Pending');
  const hotSql=sqlLog.find(sql=>/SELECT shipmentCode,businessType,trackingStatus/.test(sql))||'';
  assert.match(hotSql,/WHERE shipmentCode IN/);assert.doesNotMatch(hotSql,/businessType=\?/);assert.doesNotMatch(hotSql,/evidenceJson|currentStateJson/);
  assert.ok(sqlLog.some(sql=>/SELECT shipmentCode,currentStateJson AS jsonValue/.test(sql)),'OPEN CE rows must hydrate currentStateJson separately');
  assert.ok(!sqlLog.some(sql=>/SELECT shipmentCode,evidenceJson AS jsonValue/.test(sql)),'CE export must not read strict evidenceJson');
  assert.ok(progress.length>=2,'V479 must emit bounded ledger progress');
  assert.ok(progress.every(item=>item.phase==='hydrateLedgerTruth'),'V479 ledger progress must stay in its dedicated phase');
  assert.equal(progress.at(-1).completed,2);assert.equal(progress.at(-1).total,2);
  const diag=rows.v419CanonicalExportDiagnostics;assert.equal(diag.primaryKeyOnly,true);assert.equal(diag.openJsonRows,1);assert.equal(diag.strictEvidenceRows,0);
}finally{db.close();}

console.log('[V479] canonical V246 export ledger smoke passed · shipmentCode PK SEARCH · scalar terminal reads · OPEN-only currentStateJson · strict-only evidenceJson · monotonic V246 progress preserved');
