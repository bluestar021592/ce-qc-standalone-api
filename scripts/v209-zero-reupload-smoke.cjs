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
function must(source,token){if(!source.includes(token))throw new Error(`V211 smoke missing ${token}`);}
function forbid(source,token){if(source.includes(token))throw new Error(`V211 smoke forbidden ${token}`);}
must(archive,'v209_import_source_archive');
must(archive,'SOURCE_ARCHIVE_HASH_MISMATCH');
must(archive,'sha256File(dest)');
must(archive,'recoverV209ArchiveManifestFromDisk');
must(archive,'Deliberately NOT added to BUSINESS_DATA_TABLES');
must(archive,'/api/v209/source-archive/status');
must(bridge,"import './v209RawImportArchivePatch.js'");
must(bridge,"import './v209LoginReliabilityPatch.js'");

// V211 local/LAN auth must answer without writing into the 20+ GiB QC database.
must(login,'2026-08-19-v211-local-fast-auth-v1');
must(login,'v211FastLocalAuth');
must(login,'ce_v211_fast_session');
must(login,'V211_STATELESS_LOCAL_FAST');
must(login,"SELECT id,username,displayName,departmentCompany,email,passwordHash");
must(login,'await bcrypt.compare');
must(login,'signFastPayload');
must(login,'verifyFastToken');
must(login,'if(req.ceQcFastUser)');
must(login,'previousUse.call(this,v211FastLocalAuth)');
must(login,'does NOT write users, audit_logs or user_sessions before');
forbid(login,"getDb().prepare('UPDATE users SET failedLoginCount");
forbid(login,"getDb().prepare('INSERT INTO user_sessions");
must(login,'登录接口15秒内没有响应');
must(login,'本机/LAN快速登录');
must(loginUi,'登录接口15秒内没有响应');

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
console.log('[V211] source archive, stable terminal locks, strict Shopee average, concurrent-write-safe backup and stateless local/LAN fast auth smoke passed');
