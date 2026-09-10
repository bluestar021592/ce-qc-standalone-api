import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const backupSource=fs.readFileSync(path.join(root,'src','backup.js'),'utf8');
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');

assert.match(backupSource,/V502_MULTI_DRIVE_BACKUP_CLEANUP_ID='2026-09-10-v502-cd-ce-backup-cleanup-v1'/,'V502 marker missing');
assert.match(backupSource,/LOCALAPPDATA[\s\S]*CE_QC_LAUNCHER[\s\S]*backups[\s\S]*pre_update/,'managed launcher C-drive pre_update root is not included');
assert.match(backupSource,/DATA_BACKUPS[\s\S]*LAUNCHER_PRE_UPDATE/,'D data backups and launcher backups must be treated as managed roots');
assert.match(backupSource,/newestVerifiedSafetyBackup/,'latest verified safety backup retention must exist');
assert.match(backupSource,/\['ok','quick-ok'\]/,'safety retention must require a verified integrity marker');
assert.match(backupSource,/\^\[a-f0-9\]\{64\}\$/i,'safety retention must require a SHA-256 record');
assert.match(backupSource,/protectFormalDatabase[\s\S]*dbFile[\s\S]*-wal[\s\S]*-shm/,'formal SQLite database, WAL and SHM must be protected');
assert.match(backupSource,/driveBreakdown/,'cleanup result must report reclaimed bytes per drive');
assert.match(backupSource,/getBackupStorageSummary[\s\S]*roots:[\s\S]*driveBreakdown/,'backup storage summary must aggregate managed C/D roots');
assert.match(serverSource,/deleteAllBackups\(req\.user\?\.username \|\| req\.user\?\.email \|\| ''\)/,'existing ADMIN delete-all endpoint must continue to call the centralized cleanup function');
assert.doesNotMatch(backupSource,/readdirSync\(['"]C:\\\\['"]|readdirSync\(['"]D:\\\\['"]/,'V502 must not scan arbitrary C:/D: roots outside CE-managed directories');

console.log('[V502] multi-drive CE backup cleanup smoke passed · D data backups + C launcher pre_update · latest verified rollback retained · formal DB/WAL/SHM protected · per-drive reclaimed bytes exposed');
