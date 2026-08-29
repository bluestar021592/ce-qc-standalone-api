import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
const { loadV351UnifiedWhppMembership } = await import('../src/v351WhppUnifiedDashboardBridgePatch.js');
const { buildV352WhppVisibleDashboard } = await import('../src/v352WhppVisibleTruthOwnerPatch.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-whpp-visible-'));
const dbPath = path.join(temp, 'visible.db');
const reportDate = '2026-08-14';
let db;
try {
  db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE unified_import_batches(
      batchId TEXT PRIMARY KEY,
      snapshotId TEXT,
      reportDate TEXT,
      sourceName TEXT,
      status TEXT,
      createdAt TEXT
    );
    CREATE TABLE unified_import_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId TEXT,
      snapshotId TEXT,
      reportDate TEXT,
      businessType TEXT,
      shipmentCode TEXT,
      regionCode TEXT,
      rowJson TEXT
    );
    CREATE TABLE business_daily_reports(
      businessType TEXT,
      reportDate TEXT,
      sourceFile TEXT,
      totalCount INTEGER,
      summaryJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY(businessType,reportDate)
    );
    CREATE TABLE business_daily_parse_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      shipmentCode TEXT,
      rowJson TEXT
    );
    CREATE TABLE business_history_summary(
      businessType TEXT,
      reportDate TEXT,
      summaryJson TEXT,
      PRIMARY KEY(businessType,reportDate)
    );
    CREATE TABLE business_scan_results(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      shipmentCode TEXT,
      rawJson TEXT
    );
    CREATE TABLE business_final_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      shipmentCode TEXT,
      isPod INTEGER,
      primaryCategory TEXT,
      apiStatus TEXT,
      carryStatus TEXT,
      latestEventTime TEXT,
      latestEventDesc TEXT,
      latestNode TEXT,
      rawJson TEXT
    );
  `);
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,status,createdAt) VALUES(?,?,?,?,?,?)`)
    .run('B-LATEST', 'S-LATEST', reportDate, 'later-sibling-import.xlsx', 'VALID', '2026-08-14T23:59:00Z');
  db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES('WHPP',?,?,?,?,?,?)`)
    .run(reportDate, 'WHPP.xlsx', 236, JSON.stringify({ total: 236 }), '2026-08-14T10:00:00Z', '2026-08-14T10:00:00Z');
  db.prepare(`INSERT INTO business_history_summary(businessType,reportDate,summaryJson) VALUES('WHPP',?,?)`)
    .run(reportDate, JSON.stringify({ total: 236 }));
  const insert = db.prepare(`INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,rowJson) VALUES('WHPP',?,?,?)`);
  for (let i = 1; i <= 236; i += 1) {
    const code = `CE260814${String(i).padStart(6, '0')}`;
    const regionCode = i <= 118 ? 'PP' : 'PV';
    insert.run(reportDate, code, JSON.stringify({ shipmentCode: code, 运单号: code, businessType: 'WHPP', reportDate, regionCode }));
  }

  const canonical = loadV351UnifiedWhppMembership(reportDate, db);
  assert.equal(canonical.batchPresent, true, 'latest unified sibling batch should be present');
  assert.equal(canonical.present, true, 'zero WHPP in latest unified may fall back to the complete preserved standard cohort');
  assert.equal(canonical.rows.length, 236);
  assert.equal(canonical.membershipSource, 'WHPP_STANDARD_DAILY_ROWS');
  let dashboard = buildV352WhppVisibleDashboard({ reportDate, membershipRows: canonical.rows, finalRows: [] });
  assert.equal(Number(dashboard.metrics?.total || 0), 236);
  assert.equal(Number(dashboard.regions?.PP?.total || 0), 118);
  assert.equal(Number(dashboard.regions?.PV?.total || 0), 118);

  // Production damage shape: both the VALID unified batch and normalized WHPP
  // membership can be absent, while exact completed history/final facts remain.
  db.exec(`DELETE FROM unified_import_batches; DELETE FROM business_daily_reports; DELETE FROM business_daily_parse_rows;`);
  const insertFact = db.prepare(`INSERT INTO business_final_rows(
    businessType,reportDate,shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson
  ) VALUES('WHPP',?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 1; i <= 236; i += 1) {
    const code = `CE260814${String(i).padStart(6, '0')}`;
    const regionCode = i <= 139 ? 'PP' : 'PV';
    insertFact.run(reportDate, code, 0, 'OPEN', '', '', '', '', '', JSON.stringify({ shipmentCode: code, 运单号: code, regionCode }));
  }
  const noBatch = loadV351UnifiedWhppMembership(reportDate, db);
  assert.equal(noBatch.batchPresent, false, 'damage fixture intentionally has no VALID unified batch');
  assert.equal(noBatch.present, true, 'missing unified batch may recover only exact preserved WHPP facts when the standard header is absent');
  assert.equal(noBatch.membershipSource, 'WHPP_FINAL_FACTS_MATCH_HISTORY_TOTAL');
  assert.equal(noBatch.rows.length, 236, 'exact final-fact cohort must recover all 236 WHPP members');
  dashboard = buildV352WhppVisibleDashboard({ reportDate, membershipRows: noBatch.rows, finalRows: [] });
  assert.equal(Number(dashboard.metrics?.total || 0), 236);
  assert.equal(Number(dashboard.regions?.PP?.total || 0), 139);
  assert.equal(Number(dashboard.regions?.PV?.total || 0), 97);
  assert.equal(Number(dashboard.regions?.UNKNOWN?.total || 0), 0);

  const homeSource = fs.readFileSync(new URL('../src/v253DashboardFastPath.js', import.meta.url), 'utf8');
  assert.match(homeSource, /SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP'/, 'home must read the direct WHPP daily header first');
  assert.match(homeSource, /if\(expected===actual\)/, 'home must require exact standard header/member equality');
  assert.match(homeSource, /WHPP_STANDARD_DAILY_ZERO/, 'home must keep exact standard zero authoritative');
  assert.match(homeSource, /error\.code='WHPP_STANDARD_DAILY_INCOMPLETE'/, 'home must explicitly reject a partial standard cohort instead of publishing a numeric fallback');
  assert.match(homeSource, /else\{[\s\S]*loadV351UnifiedWhppMembership\(date,db\)/, 'home may call V351 only when the standard daily header is absent');
  assert.match(homeSource, /removedFromWhpp:0/);
  assert.ok(!homeSource.includes('Math.max(0,raw-overlap)'), 'home WHPP must not subtract CEAF overlap from visible WHPP total');

  console.log('[WHPP_VISIBLE_TRUTH_SMOKE] PASS standard WHPP is primary · exact zero stays zero · incomplete standard throws explicit WHPP_STANDARD_DAILY_INCOMPLETE · V351 only recovers missing-header history · production PP139 PV97 · home never subtracts CEAF overlap');
} finally {
  try { db?.close(); } catch {}
  fs.rmSync(temp, { recursive: true, force: true });
}