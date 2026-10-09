import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
const ui=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
const start=server.indexOf("  let qcCoverage=null;\n  if(qcActionMode){",server.indexOf("app.get('/api/tracking-workspace'"));
const end=server.indexOf('  const payload={ok:true,reportDate',start);
assert.ok(start>=0&&end>start,'QC coverage must be evaluated from exact date/snapshot source');
const run=new Function('getDb','qcActionMode','requestedBusinessType','snapshotId','reportDate','allRows','summary',
  server.slice(start,end)+'\nreturn qcCoverage;');
const db=new DatabaseSync(':memory:');
try {
  db.exec(`
    CREATE TABLE unified_import_rows(snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);
    CREATE TABLE business_daily_parse_rows(reportDate TEXT,businessType TEXT,shipmentCode TEXT);
    CREATE TABLE final_rows(reportDate TEXT,shipmentCode TEXT);
    CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);
  `);
  const snapshotId='SNAP-v784-fixture',reportDate='2026-07-01';
  const addSource=db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?)');
  addSource.run(snapshotId,reportDate,'CE','CE01072600001');
  addSource.run(snapshotId,reportDate,'CE','CE01072600002');
  const a=['CE01072600001','CE01072600002'].map(shipmentCode=>({businessType:'CE',shipmentCode}));
  const verify=(type,observed,actionCount=0)=>run(()=>db,true,type,snapshotId,reportDate,observed,{actionable:actionCount});
  // The old bug considered only allRows.length>0, erroneously publishing 0
  // even when 1/2 members had no real final evidence.
  let c=verify('CE',a);
  assert.equal(c.sourceMembers,2);
  assert.equal(c.evidenceRows,2);
  assert.equal(c.finalEvidenceRows,0);
  assert.equal(c.hasFinalEvidence,false);
  assert.equal(c.verifiedZero,false);
  db.prepare('INSERT INTO final_rows VALUES(?,?)').run(reportDate,'CE01072600001');
  c=verify('CE',a);
  assert.equal(c.missingFinalEvidence,1,'partial final cannot be treated as all verified');
  assert.equal(c.hasFinalEvidence,false);
  db.prepare('INSERT INTO final_rows VALUES(?,?)').run('2026-07-02','CE01072600002');
  c=verify('CE',a);
  assert.equal(c.missingFinalEvidence,1,'next-day final cannot counterfeit selected-day completion');
  db.prepare('INSERT INTO final_rows VALUES(?,?)').run(reportDate,'CE01072600002');
  c=verify('CE',a);
  assert.equal(c.missingFinalEvidence,0);
  assert.equal(c.hasFinalEvidence,true);
  assert.equal(c.verifiedZero,true,'only exact completed zero becomes a trustworthy zero');
  assert.equal(verify('CE',a,1).verifiedZero,false,'one open member never counts as verified zero');
  assert.equal(verify('CE',a.slice(0,1)).hasFinalEvidence,false,'hidden member cannot produce false zero');
  db.prepare("INSERT INTO business_daily_parse_rows VALUES(?,?,?)").run(reportDate,'WHPP','CE01072699999');
  db.prepare("INSERT INTO business_final_rows VALUES(?,?,?)").run('WHPP',reportDate,'CE01072699999');
  const w=verify('WHPP',[{businessType:'WHPP',shipmentCode:'CE01072699999'}]);
  assert.equal(w.sourceMembers,1,'WHPP separate-source member recognized');
  assert.equal(w.hasFinalEvidence,true);
  assert.equal(verify('CE',a).sourceMembers,2,'WHPP cannot leak into CE source scope');
  assert.match(ui,/if\(byId\('v625ExceptionDate'\)\)byId\('v625ExceptionDate'\)\.value=String\(r.reportDate\)\.slice\(0,10\)/,
    'resolved historical date must fill dedicated QC date instead of staying blank');
  assert.match(ui,/r\.qcCoverage&&!r\.qcCoverage\.hasFinalEvidence/,
    'incomplete evidence still blocks zero publication');
  assert.match(ui,/缺最终记录/, 'explicit missing-record reason should be visible, not 0');
  assert.match(ui,/已核对来源/, 'verified case shows actual source/final/member evidence');
  console.log('[V784 QC REAL ZERO] exact 7/1 source/final members, partial rows, next-day misbinding, non-zero open, separate WHPP and QC date auto-fill PASS');
}finally{db.close()}
