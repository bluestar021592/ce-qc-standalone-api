import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ensureV246TrackingSchema } from '../src/v246TrackingLedgerCore.js';
import { applyV419CanonicalExportLedgerTruth, V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID, V479_CANONICAL_LEDGER_READ_ID, V493_SCAN85_POD_DATE_RECOVERY_ID } from '../src/v419CanonicalExportLedgerTruth.js';

for(const file of ['src/v419CanonicalExportLedgerTruth.js','src/v225ExportReturnTruth.js','src/v84ExportJobWorker.js']){
  const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(checked.status,0,`${file} syntax failed: ${checked.stderr||checked.stdout}`);
}
const v419=fs.readFileSync('src/v419CanonicalExportLedgerTruth.js','utf8');
const v225=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const v84=fs.readFileSync('src/v84ExportJobWorker.js','utf8');
assert.match(v419,/2026-09-08-v479-primary-key-scalar-ledger-hydration-v1/);
assert.match(v419,/2026-09-09-v493-scan85-saved-terminal-pod-date-v2/);
assert.match(v419,/const LEDGER_CHUNK_SIZE=900/);
assert.match(v419,/FROM qc_tracking_ledger WHERE shipmentCode IN \(\$\{marks\}\)/);
assert.doesNotMatch(v419,/WHERE businessType=\? AND shipmentCode IN/,'V479 must not let SQLite choose the broad businessType index for each export chunk');
assert.doesNotMatch(v419,/signingDays,evidenceJson,currentStateJson,lastEventTime/,'V479 scalar hot query must not hydrate both large JSON columns for every ticket');
assert.match(v419,/jsonColumnByBill\(db,currentStateBills,'currentStateJson'\)/);
assert.match(v419,/strictMissingPodDateBills/,'V493 may read saved currentStateJson only for strict POD members whose canonical podDate is blank');
assert.match(v419,/shipmentCurrentStateJsonByBill/,'V493 must have a second local-only fallback to shipment_current_state for blank historical ledger JSON');
assert.match(v419,/jsonColumnByBill\(db,strictPodBills,'evidenceJson'\)/);
assert.match(v419,/text\(raw\.orderStatus\)!=='85'/,'V493 generic scan timestamps must be accepted only under proven scan orderStatus=85');
assert.doesNotMatch(v419,/lastCheckedAt\].*scan85SavedPodDate|scan85SavedPodDate[\s\S]{0,400}lastCheckedAt/,'V493 must never fabricate POD date from export/ledger check time');
assert.match(v419,/phase:'hydrateLedgerTruth'/,'V479 must use a dedicated post-sourceRows ledger phase');
assert.match(v225,/applyV419CanonicalExportLedgerTruth\(businessType,rows,\{db:getDb\(\),onProgress\}\)/,'V225 must forward child progress into V479 ledger hydration');
assert.match(v84,/if\(phase==='hydrateledgertruth'\)return 0\.58\+0\.12\*ratio/,'V84 must keep ledger hydration progress monotonic after sourceRows');
assert.match(v84,/正在按 shipmentCode 主键读取V246账本/,'V84 must expose exact V246 ledger progress instead of a generic 7% stall');
assert.equal(V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID,'2026-09-03-v419-canonical-export-ledger-truth-v2','canonical business truth id must remain stable');
assert.equal(V479_CANONICAL_LEDGER_READ_ID,'2026-09-08-v479-primary-key-scalar-ledger-hydration-v1');
assert.equal(V493_SCAN85_POD_DATE_RECOVERY_ID,'2026-09-09-v493-scan85-saved-terminal-pod-date-v2');

const db=new DatabaseSync(':memory:');
try{
  ensureV246TrackingSchema(db);
  db.exec(`CREATE TABLE shipment_current_state (
    shipmentCode TEXT PRIMARY KEY,
    businessType TEXT NOT NULL DEFAULT '',
    reportDate TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    apiStatus TEXT NOT NULL DEFAULT '',
    lastEventTime TEXT NOT NULL DEFAULT '',
    stateJson TEXT NOT NULL DEFAULT '{}',
    updatedAt TEXT NOT NULL DEFAULT ''
  )`);
  const insert=db.prepare(`INSERT INTO qc_tracking_ledger(
    shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,
    trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,
    attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now='2026-09-08T10:00:00.000Z';
  insert.run('CE-POD-1','CE','2026-07-01','2026-09-01','','','TERMINAL','POD',now,'POD','POD',now,'2026-07-02',1,'V246_LEDGER',2,JSON.stringify({huge:'x'.repeat(5000)}),JSON.stringify({huge:'y'.repeat(5000)}),now,'',now,now);
  insert.run('CE-OPEN-1','CE','2026-07-01','2026-09-01','','','OPEN','', '', 'PENDING','Pending',now,'',0,'',null,JSON.stringify({huge:'z'.repeat(5000)}),JSON.stringify({pendingDistinctDayCount:2,primaryCategory:'Pending'}),now,'',now,now);
  insert.run('SPE-V493-1','SHOPEECN','2026-07-10','2026-09-01','','','TERMINAL','POD',now,'POD','POD','2026-07-13 18:00:00','',2,'V246_STRICT_TRACK:TEST',null,
    JSON.stringify({starts:[{time:'2026-07-12 08:30:00'}],failures:[{time:'2026-07-12 18:00:00'}]}),
    '{}',now,'',now,now);
  db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,state,apiStatus,lastEventTime,stateJson,updatedAt) VALUES(?,?,?,?,?,?,?,?)`)
    .run('SPE-V493-1','SHOPEECN','2026-07-10','POD','success','2026-07-13 18:00:00',JSON.stringify({orderStatus:'85',updateTime:'2026-07-13 16:45:00',currentState:'POD',POD时间:''}),now);

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

  const shopeeSql=[];
  const wrappedShopee={
    exec(sql){return db.exec(sql);},
    prepare(sql){
      shopeeSql.push(String(sql));
      const stmt=db.prepare(sql);
      return {all(...args){return stmt.all(...args);},get(...args){return stmt.get(...args);},run(...args){return stmt.run(...args);}};
    }
  };
  const shopeeRows=[{shipmentCode:'SPE-V493-1',pod:true,returned:false,pending:false,delivering:false,statusCode:'Y',statusDesc:'POD',podDate:'',podTime:'',attemptNo:0,signingDays:0,evidence:new Set()}];
  applyV419CanonicalExportLedgerTruth('SHOPEECN',shopeeRows,{db:wrappedShopee,onProgress:()=>{}});
  assert.equal(shopeeRows[0].pod,true);
  assert.equal(shopeeRows[0].podDate,'2026-07-13','scan orderStatus=85 updateTime must recover the real saved POD date without CE re-query');
  assert.equal(shopeeRows[0].attemptNo,2);
  assert.equal(shopeeRows[0].signingDays,2,'strict START 07-12 to recovered POD 07-13 must equal two inclusive natural days');
  assert.equal(shopeeRows[0].podSource,'V493_SCAN85_SAVED_TERMINAL_TIME');
  assert.equal(shopeeRows[0].v493Scan85PodDateRecoveryId,V493_SCAN85_POD_DATE_RECOVERY_ID);
  assert.ok(shopeeSql.some(sql=>/SELECT shipmentCode,currentStateJson AS jsonValue/.test(sql)),'strict POD with blank canonical podDate must first read saved ledger currentStateJson separately');
  assert.ok(shopeeSql.some(sql=>/SELECT shipmentCode,stateJson FROM shipment_current_state/.test(sql)),'blank ledger JSON must fall back to shipment_current_state locally');
  assert.ok(shopeeSql.some(sql=>/SELECT shipmentCode,evidenceJson AS jsonValue/.test(sql)),'strict POD must still read saved START evidence');
  const shopeeDiag=shopeeRows.v419CanonicalExportDiagnostics;
  assert.equal(shopeeDiag.scan85PodDateRows,1);
  assert.equal(shopeeDiag.terminalStateFallbackRows,1);
  assert.equal(shopeeDiag.strictEvidenceRows,1);
}finally{db.close();}

console.log('[V493/V479] canonical V246 export ledger smoke passed · shipmentCode PK SEARCH · strict blank-POD rows recover scan85 updateTime from ledger JSON then shipment_current_state fallback · no CE re-query · strict START→POD signing completes');
