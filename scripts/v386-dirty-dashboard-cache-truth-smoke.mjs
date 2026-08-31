import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { invalidateV386DirtyDashboardCaches, V386_DIRTY_DASHBOARD_CACHE_TRUTH_ID } from '../src/rangeDashboardStore.js';

execFileSync(process.execPath, ['--check', 'src/rangeDashboardStore.js'], { stdio: 'pipe' });
assert.match(V386_DIRTY_DASHBOARD_CACHE_TRUTH_ID, /v386-dirty-date-never-serves-stale-cache-v1/);

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE dashboard_daily_cache(
    reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,
    snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,
    PRIMARY KEY(reportDate,businessType,regionCode)
  );
  CREATE TABLE dashboard_cache_dates(
    reportDate TEXT PRIMARY KEY,snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL
  );
  CREATE TABLE dashboard_cache_dirty(reportDate TEXT PRIMARY KEY,reason TEXT NOT NULL DEFAULT '',dirtyAt TEXT NOT NULL);
  CREATE TABLE final_rows(shipmentCode TEXT PRIMARY KEY,reportDate TEXT,isPod INTEGER);
`);
const insertRow = db.prepare(`INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)`);
const insertDate = db.prepare(`INSERT INTO dashboard_cache_dates(reportDate,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?)`);
for (const date of ['2026-08-25','2026-08-26']) {
  insertRow.run(date,'CE','',JSON.stringify({total:3440,pod:0}),`SNAP-${date}`,'COMPLETED','OLD','old');
  insertDate.run(date,`SNAP-${date}`,'COMPLETED','OLD','old');
}
db.prepare('INSERT INTO dashboard_cache_dirty(reportDate,reason,dirtyAt) VALUES(?,?,?)').run('2026-08-25','CCSL_RUN_COMPLETED','now');
db.prepare('INSERT INTO final_rows(shipmentCode,reportDate,isPod) VALUES(?,?,?)').run('CC-REAL-POD','2026-08-25',1);

const first = invalidateV386DirtyDashboardCaches('', db);
assert.deepEqual(first.dates, ['2026-08-25']);
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dashboard_daily_cache WHERE reportDate=?').get('2026-08-25').c, 0, 'dirty date must not retain stale POD=0 derived rows');
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dashboard_cache_dates WHERE reportDate=?').get('2026-08-25').c, 0, 'dirty date must not retain a completed cache marker');
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dashboard_cache_dirty WHERE reportDate=?').get('2026-08-25').c, 1, 'dirty marker must remain for the normal rebuild worker');
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM final_rows WHERE reportDate=?').get('2026-08-25').c, 1, 'business facts must never be deleted');
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dashboard_daily_cache WHERE reportDate=?').get('2026-08-26').c, 1, 'clean dates must remain cached');

// Explicit dirty invalidation covers the normal markDashboardCacheDirty wrapper path.
db.prepare('INSERT INTO dashboard_cache_dirty(reportDate,reason,dirtyAt) VALUES(?,?,?)').run('2026-08-26','SHOPEE_RUN_COMPLETED','later');
const second = invalidateV386DirtyDashboardCaches('2026-08-26', db);
assert.deepEqual(second.dates, ['2026-08-26']);
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dashboard_daily_cache').get().c, 0);
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dashboard_cache_dates').get().c, 0);
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM dashboard_cache_dirty').get().c, 2);

db.close();

const source = fs.readFileSync('src/rangeDashboardStore.js','utf8');
assert.match(source,/markDashboardCacheDirtyLegacy\(reportDate, reason\)[\s\S]*invalidateV386DirtyDashboardCaches\(reportDate\)/,'every future dirty mark must immediately invalidate derived rows');
assert.match(source,/getDashboardCacheStatus\(\)[\s\S]*invalidateV386DirtyDashboardCaches\(\)/,'startup health must repair already-dirty stale cache dates');
assert.doesNotMatch(source,/DELETE FROM (?:final_rows|business_final_rows|unified_import_rows|scan_results|track_events|business_scan_results|business_track_events)/,'V386 must only delete derived dashboard cache rows');

console.log('[V386] dirty dashboard-cache truth smoke passed · dirty 08-25 cannot serve stale POD=0 cache · clean 08-26 remains cached until dirty · business facts untouched · dirty marker retained for normal rebuild');
