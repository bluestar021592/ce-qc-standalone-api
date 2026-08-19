const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const archive=read('src/v209RawImportArchivePatch.js');
const bridge=read('src/v146UnifiedImportDateBridgePatch.js');
const login=read('src/v209LoginReliabilityPatch.js');
const loginUi=read('public/v209-login-reliability.js');
const unifiedStore=read('src/unifiedImportStore.js');
const metrics=read('src/v200Metrics.js');
const exporter=read('src/v200TemplateDashboardExporter.js');
const ui=read('public/v209-source-archive-status.js');
const shell=read('src/v44WhppUiPatch.js');
const preUpdateBackup=read('scripts/CE_QC_PreUpdate_Backup.mjs');
function must(source,token){if(!source.includes(token))throw new Error(`V212 smoke missing ${token}`);}
function forbid(source,token){if(source.includes(token))throw new Error(`V212 smoke forbidden ${token}`);}
must(archive,'v209_import_source_archive');
must(archive,'SOURCE_ARCHIVE_HASH_MISMATCH');
must(archive,'sha256File(dest)');
must(archive,'recoverV209ArchiveManifestFromDisk');
must(archive,'Deliberately NOT added to BUSINESS_DATA_TABLES');
must(archive,'/api/v209/source-archive/status');
must(bridge,"import './v209RawImportArchivePatch.js'");
must(bridge,"import './v209LoginReliabilityPatch.js'");

// V212 local/LAN auth must never enter the operational getDb() path. It opens a
// short-lived query-only SQLite handle, gives up quickly on locks and signs a
// stateless session without user/session/audit writes.
must(login,'2026-08-19-v212-local-readonly-auth-v2');
must(login,'v212FastLocalAuth');
must(login,'ce_v212_fast_session');
must(login,'V212_ISOLATED_READONLY_LOCAL_AUTH');
must(login,'new DatabaseSync(file,{readOnly:true})');
must(login,'PRAGMA query_only=ON');
must(login,'PRAGMA busy_timeout=750');
must(login,'readAuthRowWithoutRuntimeDb');
must(login,"SELECT id,username,displayName,departmentCompany,email,passwordHash");
must(login,'bcrypt.compareSync');
must(login,'signFastPayload');
must(login,'verifyFastToken');
must(login,'if(req.ceQcFastUser)');
must(login,'previousUse.call(this,v212FastLocalAuth)');
must(login,'Never call getDb() from the local login path');
forbid(login,'import { getDb');
forbid(login,'getDb().prepare(');
forbid(login,"INSERT INTO user_sessions");
forbid(login,"UPDATE users SET failedLoginCount");
must(login,'登录接口5秒仍未返回');
must(login,'本机/LAN只读快速登录');
// Legacy static helper is intentionally not the owner of the self-contained V212
// login page, but must remain syntactically valid while older cached shells exist.
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
console.log('[V212] source archive, stable terminal locks, strict Shopee average, concurrent-write-safe backup and isolated read-only local/LAN auth smoke passed');
