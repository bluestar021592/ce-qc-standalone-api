import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v788-whpp-copy-'));
const database=path.join(dir,'ce_qc_monitor.db');
try{
  const db=new DatabaseSync(database);
  db.exec(`
    CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);
    CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,state TEXT);
    CREATE TABLE qc_tracking_ledger(shipmentCode TEXT,businessType TEXT,trackingStatus TEXT);
    CREATE TABLE business_shipment_tracks(shipmentCode TEXT,businessType TEXT,reportDate TEXT,shipmentStatus TEXT);
    CREATE TABLE business_pod_locks(shipmentCode TEXT,businessType TEXT,podTime TEXT);
  `);
  db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)')
    .run('WHPP','2026-07-01','CE0001');
  db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)')
    .run('WHPP','2026-07-01','CE0002');
  db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)')
    .run('WHPP','2026-07-01','CE0001');
  db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)')
    .run('SHOPEEVN','2026-07-01','VN0001');
  for(const [bill,state,term] of [['CE0001','POD','60'],['CE0002','RETURNED','81']]){
    db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?)').run(bill,'WHPP','2026-07-01',state);
    db.prepare('INSERT INTO qc_tracking_ledger VALUES(?,?,?)').run(bill,'WHPP','OPEN');
    db.prepare('INSERT INTO business_shipment_tracks VALUES(?,?,?,?)').run(bill,'WHPP','2026-07-01',term);
  }
  db.prepare('INSERT INTO business_pod_locks VALUES(?,?,?)').run('CE0001','WHPP','2026-07-03T09:00:00+07:00');
  // July 2 counterexamples: shipmentStatus 80 is still RETURNING, not RETURNED;
  // a broken-time lock is not a valid signing timestamp even with a POD label.
  for(const [bill,state,tms] of [['CE0003','RETURNED','80'],['CE0004','POD','81']]){
    db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)').run('WHPP','2026-07-02',bill);
    db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?)').run(bill,'WHPP','2026-07-02',state);
    db.prepare('INSERT INTO qc_tracking_ledger VALUES(?,?,?)').run(bill,'WHPP','OPEN');
    db.prepare('INSERT INTO business_shipment_tracks VALUES(?,?,?,?)').run(bill,'WHPP','2026-07-02',tms);
  }
  db.prepare('INSERT INTO business_pod_locks VALUES(?,?,?)').run('CE0004','WHPP','not-a-date');
  // SQL must not multiply one canonical bill when TMS has case-variant duplicates.
  db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)').run('WHPP','2026-07-03','CE0005');
  db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?)').run('CE0005','WHPP','2026-07-03','POD');
  db.prepare('INSERT INTO qc_tracking_ledger VALUES(?,?,?)').run('CE0005','WHPP','OPEN');
  db.prepare('INSERT INTO business_shipment_tracks VALUES(?,?,?,?)').run('CE0005','WHPP','2026-07-03','60');
  db.prepare('INSERT INTO business_shipment_tracks VALUES(?,?,?,?)').run('ce0005','WHPP','2026-07-03','60');
  db.close();
  const before=fs.statSync(database);
  const run=spawnSync(process.execPath,['scripts/v788-local-whpp-readonly-probe.mjs',database],
    {cwd:process.cwd(),encoding:'utf8',timeout:10000});
  assert.equal(run.status,10,'readonly probe must never grant publication with exit 0');
  assert.match(run.stdout,/来源2 \| 当前匹配2 \| POD标签1 \| 退回标签1/);
  assert.match(run.stdout,/旧OPEN终态2/);
  assert.match(run.stdout,/TMS60=1 \| TMS80=0 \| TMS81=1/);
  assert.match(run.stdout,/逐票POD匹配1 \| 逐票退回匹配1 \| 终态矛盾0/);
  assert.match(run.stdout,/日期格式候选1 \| 无效时间候选0/);
  assert.match(run.stdout,/2026-07-02 \| 来源2 \| 当前匹配2 \| POD标签1 \| 退回标签1/);
  assert.match(run.stdout,/终态矛盾2 \| 80误判已退回1/);
  assert.match(run.stdout,/日期格式候选0 \| 无效时间候选1/);
  assert.match(run.stdout,/POD时间锁候选1/);
  assert.match(run.stdout,/2026-07-03 \\| 来源1 \\| 当前匹配1 \\| POD标签1/);
  assert.match(run.stdout,/证据键冲突1 \\| 旧OPEN终态1 \\| TMS60=0/);
  assert.match(run.stdout,/逐票POD匹配0 \\| 逐票退回匹配0/);
  assert.match(run.stdout,/不是可信POD时间/);
  assert.doesNotMatch(run.stdout,/CE0001|CE0002|CE0003|CE0004|CE0005|VN0001/,'no private waybill output');
  const after=fs.statSync(database);
  assert.equal(after.size,before.size,'database size unchanged');
  assert.equal(after.mtimeMs,before.mtimeMs,'database bytes must not be modified');
  const missing=spawnSync(process.execPath,['scripts/v788-local-whpp-readonly-probe.mjs',path.join(dir,'not-found.db')],
    {cwd:process.cwd(),encoding:'utf8'});
  assert.equal(missing.status,10);
  assert.match(missing.stdout,/BLOCKED/);
  assert.equal(fs.existsSync(path.join(dir,'not-found.db')),false,'must not create missing DB');
  console.log('[V788 WHPP ISOLATED SQLITE] duplicate source excluded; exact POD/RETURN statuses, RETURNING80 conflict and invalid time are visible, no waybill output/no DB writes PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
