import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const backupSource=fs.readFileSync(path.join(root,'src','backup.js'),'utf8');
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');
const shellSource=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');
const runtimeSource=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');

assert.match(backupSource,/V502_MULTI_DRIVE_BACKUP_CLEANUP_ID='2026-10-03-v626-auto-cd-backup-storage-v1'/,'V626 automatic C/D backup storage marker missing');
assert.match(backupSource,/DATA_BACKUPS_CONFIGURED/,'configured backup root must remain a managed candidate');
assert.match(backupSource,/DATA_BACKUPS_AUTO_D/,'D-drive automatic CE backup root must be a managed candidate when available');
assert.match(backupSource,/automaticBackupStorageStatus/,'automatic backup storage selection must inspect candidates');
assert.match(backupSource,/chooseAutomaticBackupRoot/,'manual database backup must use automatic storage selection');
assert.match(backupSource,/const storage = chooseAutomaticBackupRoot\(cfg\)/,'createDatabaseBackup must select the C/D target automatically');
assert.match(backupSource,/freeBytes/,'automatic storage selection must use real free-space evidence');
assert.match(backupSource,/autoManagement:\s*true/,'storage summary must declare automatic management');
assert.match(backupSource,/selectedDrive/,'storage summary must expose the selected drive');
assert.match(backupSource,/selectedDirectory/,'storage summary must expose the selected backup directory');

assert.match(backupSource,/LOCALAPPDATA[\s\S]*CE_QC_LAUNCHER[\s\S]*backups[\s\S]*pre_update/,'managed launcher pre-update root must remain protected/visible');
assert.match(backupSource,/newestVerifiedSafetyBackup/,'explicit delete-all backup cleanup must retain the latest verified safety backup by default');
assert.match(backupSource,/\['ok','quick-ok'\]/,'safety retention must require a verified integrity marker');
assert.match(backupSource,/protectFormalDatabase[\s\S]*dbFile[\s\S]*-wal[\s\S]*-shm/,'formal SQLite database, WAL and SHM must remain protected');
assert.match(serverSource,/deleteAllBackups\(req\.user\?\.username \|\| req\.user\?\.email \|\| ''\)/,'existing explicit ADMIN delete-all-backups endpoint must remain centralized');
assert.doesNotMatch(backupSource,/readdirSync\(['"]C:\\\\['"]|readdirSync\(['"]D:\\\\['"]/,'storage management must never scan arbitrary drive roots');

assert.match(shellSource,/data-data-tab="clear"/,'data-management must expose direct business-data clearing');
assert.match(shellSource,/data-data-tab="backup"/,'data-management must expose backup as an independent action');
assert.match(shellSource,/data-data-tab="storage"/,'data-management must expose storage status');
assert.doesNotMatch(shellSource,/data-data-tab="migration"|data-data-tab="sync"/,'data-management must not display fake migration/sync tabs');
assert.match(runtimeSource,/\/api\/admin\/data-purge\/direct/,'clear action must use direct no-backup business-data purge');
assert.match(runtimeSource,/\/api\/admin\/backup-now/,'backup must remain an independent optional action');
assert.match(runtimeSource,/backupStorage/,'storage UI must consume server C/D storage status');
assert.match(runtimeSource,/v626DatabaseDrive/,'storage UI must show the current database drive');
assert.match(runtimeSource,/v626BackupDrive/,'storage UI must show the automatically selected backup drive');

console.log('[V626] automatic C/D storage smoke passed · direct business-data clear independent from backup · backups use writable/free-space selection · existing backups preserved unless explicitly deleted · formal DB/WAL/SHM protected');
