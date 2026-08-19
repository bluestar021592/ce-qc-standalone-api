const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const archive=read('src/v209RawImportArchivePatch.js');
const bridge=read('src/v146UnifiedImportDateBridgePatch.js');
const login=read('src/v209LoginReliabilityPatch.js');
const authSidecar=read('src/v213AuthSidecar.js');
const loginUi=read('public/v209-login-reliability.js');
const unifiedStore=read('src/unifiedImportStore.js');
const metrics=read('src/v200Metrics.js');
const exporter=read('src/v200TemplateDashboardExporter.js');
const ui=read('public/v209-source-archive-status.js');
const shell=read('src/v44WhppUiPatch.js');
const preUpdateBackup=read('scripts/CE_QC_PreUpdate_Backup.mjs');
function must(source,token){if(!source.includes(token))throw new Error(`V213 smoke missing ${token}`);}
function forbid(source,token){if(source.includes(token))throw new Error(`V213 smoke forbidden ${token}`);}
must(archive,'v209_import_source_archive');
must(archive,'SOURCE_ARCHIVE_HASH_MISMATCH');
must(archive,'sha256File(dest)');
must(archive,'recoverV209ArchiveManifestFromDisk');
must(archive,'Deliberately NOT added to BUSINESS_DATA_TABLES');
must(archive,'/api/v209/source-archive/status');
must(bridge,"import './v209RawImportArchivePatch.js'");
must(bridge,"import './v209LoginReliabilityPatch.js'");

// V213 moves login off the busy 5177 process entirely. The browser talks to a
// dedicated 5179 process, which reads users through short-lived read-only SQLite,
// signs a stateless cookie, and lets 5177 verify that cookie without touching auth DB tables.
must(login,'2026-08-19-v213-auth-sidecar-login-v1');
must(login,'CE_QC_AUTH_SIDECAR_PORT||5179');
must(login,'v213AuthSidecar.js');
must(login,'V213_USE_AUTH_SIDECAR');
must(login,'ce_v213_fast_session');
must(login,'/api/v213/auth-ping');
must(login,'/api/v213/local-auth/login');
must(login,'if(req.ceQcFastUser)');
must(login,'previousUse.call(this,v213FastIdentity)');
must(authSidecar,'2026-08-19-v213-auth-sidecar-v1');
must(authSidecar,'new DatabaseSync(file,{readOnly:true})');
must(authSidecar,'PRAGMA query_only=ON');
must(authSidecar,'PRAGMA busy_timeout=500');
must(authSidecar,'V213_AUTH_SIDECAR_LOGIN_START');
must(authSidecar,'V213_AUTH_SIDECAR_LOGIN_OK');
must(authSidecar,"'/api/v213/local-auth/login'");
forbid(authSidecar,'import { getDb');
forbid(authSidecar,'getDb().prepare(');
forbid(authSidecar,'INSERT INTO user_sessions');
forbid(authSidecar,'UPDATE users SET failedLoginCount');
// Legacy static helper remains only for cached old pages; the current self-contained page
// never uses it as the authoritative login path.
must(loginUi,"fetch('/api/internal-auth/login'");

// A SQLite online backup remains a valid point-in-time snapshot even when live data changes.
must(preUpdateBackup,'online-backup+concurrent-source-change+backup-quick-check+sha256');
must(preUpdateBackup,'exact fingerprint reuse is disabled for this backup');
must(preUpdateBackup,'const sourceStableDuringBackup=sameFingerprint');
forbid(preUpdateBackup,"throw new Error('SOURCE_CHANGED_DURING_UPDATE_BACKUP')");

must(unifiedStore,"'ORDER_CANCELLED'");
must(unifiedStore,"'SELF_PICKUP'");
must(unifiedStore,"'CECN_RETENTION'");
must(unifiedStore,"'CEZT_RETENTION'");
must(unifiedStore,"'CCSL580_RETENTION'");
must(unifiedStore,"cancelled ? 'ORDER_CANCELLED'");
must(unifiedStore,'const closed = pod || returned || cancelled || specialClosed || normal');
must(metrics,'isShopeePrecisionRow');
must(metrics,"timingEvidenceStatus || '').toUpperCase() !== 'OK'");
must(exporter,'FULL_COVERAGE_ONLY');
must(exporter,'averageOfficial');
must(exporter,'ppAverageOfficial');
must(exporter,'pvAverageOfficial');
must(exporter,'_V209.xlsx');
must(ui,'原始日报永久归档 / 可重建保障');
must(ui,'SHA-256');
must(shell,'/v209-source-archive-status.js?v=20260819-v209-1');
console.log('[V213] source archive, stable terminal locks, strict Shopee average, concurrent-write-safe backup and independent 5179 local/LAN auth sidecar smoke passed');
