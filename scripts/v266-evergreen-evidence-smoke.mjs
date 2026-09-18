import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=await fsp.mkdtemp(path.join(os.tmpdir(),'ce-qc-v266-'));
process.env.NODE_ENV='test';
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'ce_qc_monitor.db');
const source=fs.readFileSync('src/v266EvergreenEvidenceArchive.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const bootstrap=fs.readFileSync('bootstrap.js','utf8');
const runtime=fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js','utf8');
const storageSource=fs.readFileSync('src/v254StorageHealthPatch.js','utf8');
const coverageSource=fs.readFileSync('src/v284MembershipEvidenceCoverage.js','utf8');
const priorityRefreshSource=fs.readFileSync('src/v284PriorityUnprovenRefresh.js','utf8');
const retiredV286Source=fs.readFileSync('src/v286V253TrendTruthBridge.js','utf8');
const retiredV288Source=fs.readFileSync('src/v288StaticAssetPreAuthPatch.js','utf8');
const fastOwnerSource=fs.readFileSync('public/v253-dashboard-fast-owner.js','utf8');
const genericTrendSource=fs.readFileSync('public/v263-generic-trend-hydrator.js','utf8');
const backupSource=fs.readFileSync('scripts/CE_QC_PreUpdate_Backup.mjs','utf8');
const mod=await import(`../src/v266EvergreenEvidenceArchive.js?smoke=${Date.now()}`);
const v283=await import(`../src/v283LegacyDecoratedHashReplay.js?smoke=${Date.now()}`);
const v283Retry=await import(`../src/v283LegacyDecoratedHashReplayRetry.js?smoke=${Date.now()}`);
const paths=mod.getV266EvidenceArchivePaths();
assert.equal(mod.V266_MIN_RETENTION_DAYS,366,'evergreen evidence must retain at least one full year plus leap-day margin');
assert.match(mod.V266_RETENTION_POLICY,/NO_AUTOMATIC_ARCHIVE_DELETE/,'archive must never be automatically purged by a normal upgrade');
assert.match(source,/CEClient\.prototype\.postJson/,'every successful operational CE postJson response must enter raw evidence archiving');
assert.match(source,/gzipAsync/,'CE raw evidence must be compressed outside the main SQLite database');
assert.match(source,/PRESERVE_BEFORE_TEMP_DELETE/,'uploaded source must be archived before multer temp deletion');
assert.match(source,/source_uploads/,'source upload archive must be separate from derived database state');
assert.match(source,/ce_api/,'CE raw evidence archive must be independently replayable');
assert.doesNotMatch(source,/rmSync\(|fsPromises\.rm\(|rmdir\(/,'V266 must not contain any archive purge implementation');

const legacySha='8abc5f1b423f7dfab2d910f3de79067cae0a06cb683103a9d6c3df462f0b34c8';
assert.equal(v283.canonicalLegacyFileHash(`${legacySha}:2026-08-13-v77-ceaf-whpp-source-authority`),legacySha,'V283 must strip only the legacy authority suffix and retain the exact leading SHA-256');
assert.equal(v283.canonicalLegacyFileHash(legacySha),legacySha,'V283 must preserve an already canonical SHA-256');
assert.equal(v283.canonicalLegacyFileHash(`prefix:${legacySha}`),'','V283 must reject hashes that do not begin with the exact SHA-256');

// Recovery safe mode is deliberately runtime-only: it preserves the V283/V284
// code and persisted database state, but automatic startup replay/audit/refresh
// must yield until the local UI is reachable again.
assert.match(bootstrap,/CE_QC_RECOVERY_SAFE_MODE\s*=\s*'1'/,'recovery startup must explicitly prioritize UI availability');
assert.match(bootstrap,/CE_QC_DISABLE_V246_TRACKING\s*=\s*'1'/,'automatic V246/V252/V264 tracking schedulers must stay off in recovery mode');
assert.match(bootstrap,/CE_QC_DISABLE_V262_STRICT_BACKFILL\s*=\s*'1'/,'automatic V262 evidence backfill must stay off in recovery mode');
assert.match(bootstrap,/CE_QC_DISABLE_STARTUP_STORAGE_SCAN\s*=\s*'1'/,'startup storage scan must stay off in recovery mode');
assert.match(activation,/CE_QC_RECOVERY_SAFE_MODE/,'V147 must honor recovery safe mode');
assert.match(activation,/await import\('\.\/v283LegacyDecoratedHashReplay\.js'\)/,'V283 replay implementation must remain available outside recovery safe mode');
assert.match(activation,/await import\('\.\/v283LegacyDecoratedHashReplayRetry\.js'\)/,'V283 retry implementation must remain available outside recovery safe mode');
assert.match(activation,/await import\('\.\/v284DailyMembershipAudit\.js'\)/,'V284 audit implementation must remain available outside recovery safe mode');
assert.match(activation,/await import\('\.\/v284PriorityUnprovenRefresh\.js'\)/,'V284 priority repair implementation must remain available outside recovery safe mode');
assert.match(storageSource,/CE_QC_DISABLE_STARTUP_STORAGE_SCAN/,'V254 must skip the automatic recursive disk scan in recovery safe mode');
assert.match(storageSource,/export function readV254StorageHealth\(\)/,'manual/read-only storage health must remain available');

// Emergency recovery rule: restore the exact 88439846 first-paint/browser shell
// while preserving current stored-data truth. V286/V288 experimental Express
// hooks may remain inspectable in the repository but must not execute.
assert.match(runtime,/import '\.\/v253DashboardFastPath\.js';/,'known-good V253 backend fastpath must remain in normal startup');
assert.doesNotMatch(runtime,/^\s*import '\.\/v286V253TrendTruthBridge\.js';/m,'retired V286 Express route-hook module must not execute in normal startup');
assert.doesNotMatch(runtime,/^\s*import '\.\/v288StaticAssetPreAuthPatch\.js';/m,'retired V288 express.use experiment must not execute in normal startup');
assert.match(runtime,/2026-08-23-v266-evergreen-evidence-runtime-v1/,'runtime must match the last confirmed 88439846 first-paint structure');
assert.match(retiredV286Source,/global Express route hook retired/,'V286 file must remain a no-op historical marker if inspected directly');
assert.doesNotMatch(retiredV286Source,/express\.application\.get\s*=/,'retired V286 must never restore the global Express route hook');
assert.match(retiredV288Source,/SAFE_ASSET_RE/,'retired V288 implementation remains inspectable but is not startup-active');
assert.match(fastOwnerSource,/\/api\/v319\/trends/,'recovered browser owner must preserve the stable shell while reading the V319 saved-cache path');
assert.match(genericTrendSource,/\/api\/v319\/trends/,'generic trend hydrator must preserve the stable shell while reading the V319 saved-cache path');
assert.doesNotMatch(genericTrendSource,/\/api\/v253\/trends\?businessType=/,'generic page opening must not auto-enter V253 computation');
assert.match(v283Retry.V283_LEGACY_HASH_RETRY_ID,/v283-post-evidence-seed-retry-v1/,'V283 retry module must remain available for later controlled use');
await import(`./v283-legacy-hash-replay-smoke.mjs?nested=${Date.now()}`);

for(const file of [
  'bootstrap.js',
  'src/v147TrackTimeoutConfig.js',
  'src/v254StorageHealthPatch.js',
  'src/v284DailyMembershipTruth.js',
  'src/v284MembershipEvidenceCoverage.js',
  'src/v284DailyMembershipAudit.js',
  'src/v284PriorityUnprovenRefresh.js',
  'src/v286V253TrendTruthBridge.js',
  'src/v288StaticAssetPreAuthPatch.js',
  'src/v206InteractiveFirstRuntimePatch.js',
  'src/v273DashboardTruthReadPatch.js',
  'src/v244ShopeeTrendRuntimePatch.js',
  'src/rangeDashboardStoreV284.js',
  'scripts/CE_QC_PreUpdate_Backup.mjs',
  'scripts/v284-daily-membership-smoke.mjs',
  'scripts/v284-evidence-coverage-smoke.mjs',
  'scripts/v285-preupdate-backup-freeze-smoke.mjs'
]) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
assert.match(coverageSource,/WHPP/,'V286 proven coverage code remains preserved in repository while automatic startup work is paused');
assert.match(coverageSource,/wf\.shipmentCode/,'WHPP final-row evidence code must remain preserved');
assert.match(coverageSource,/PARTITION BY reportDate,businessType ORDER BY createdAt DESC,batchId DESC/,'V286 evidence coverage must use per-date+per-business latest VALID membership');
assert.match(coverageSource,/WHPP keeps its full dedicated daily membership without CEAF subtraction/,'WHPP evidence coverage must preserve the full independent WHPP cohort');
const coverageWhppStart=coverageSource.indexOf("SELECT DISTINCT p.reportDate,'WHPP' businessType");
const coverageWhppEnd=coverageSource.indexOf('SELECT v.reportDate,v.businessType',coverageWhppStart);
assert.ok(coverageWhppStart>=0&&coverageWhppEnd>coverageWhppStart,'V286 WHPP evidence union must remain present');
const coverageWhppUnion=coverageSource.slice(coverageWhppStart,coverageWhppEnd);
assert.doesNotMatch(coverageWhppUnion,/CEAF|NOT EXISTS/,'V286 WHPP evidence membership must not subtract CEAF overlap');
assert.match(coverageSource,/lastCheckedAt/,'checked lifecycle state must remain part of proven-evidence ownership');
assert.match(priorityRefreshSource,/MAX_TARGETS=100/,'priority evidence repair must remain hard-limited to 100 shipments when re-enabled');
assert.match(priorityRefreshSource,/FOREGROUND_PROCESSING_ACTIVE/,'priority evidence repair must yield to active production processing');
assert.match(priorityRefreshSource,/processCarryFamilyForRefresh/,'priority evidence repair implementation must remain preserved');
assert.match(priorityRefreshSource,/\['WHPP',open\.filter/,'WHPP bounded repair path must remain preserved');
assert.match(priorityRefreshSource,/if\(targets\.length>MAX_TARGETS\)/,'large evidence gaps must remain bounded');
assert.match(backupSource,/BEGIN IMMEDIATE/,'V285 high-risk pre-update backup must freeze SQLite writers before copying the production DB');
assert.match(backupSource,/SOURCE_CHANGED_DURING_WRITE_FREEZE/,'V285 must still reject a source fingerprint change even while the write freeze is held');
assert.match(backupSource,/backupQuickCheck:'ok'/,'V285 must retain structural verification of the frozen backup');
assert.match(backupSource,/sha256WithProgress/,'V285 must retain full SHA-256 verification of the frozen backup');
await import(`./v284-daily-membership-smoke.mjs?nested=${Date.now()}`);
await import(`./v284-evidence-coverage-smoke.mjs?nested=${Date.now()}`);
await import(`./v285-preupdate-backup-freeze-smoke.mjs?nested=${Date.now()}`);

await fsp.mkdir(paths.importsRoot,{recursive:true});
const temp=path.join(paths.importsRoot,'multer-temp-source');
await fsp.writeFile(temp,Buffer.from([0x50,0x4b,0x03,0x04,0x56,0x32,0x36,0x36]));
await fsp.unlink(temp);
assert.equal(fs.existsSync(temp),false,'normal temp deletion should still complete after source preservation');
const months=fs.existsSync(paths.sourceRoot)?await fsp.readdir(paths.sourceRoot):[];
assert.ok(months.length>=1,'source archive month folder must be created');
const files=await fsp.readdir(path.join(paths.sourceRoot,months[0]));
const metaName=files.find(name=>name.endsWith('.meta.json'));
const sourceName=files.find(name=>name.endsWith('.xlsx'));
assert.ok(metaName&&sourceName,'source content and immutable metadata must both survive temp deletion');
const meta=JSON.parse(await fsp.readFile(path.join(paths.sourceRoot,months[0],metaName),'utf8'));
assert.equal(meta.kind,'SOURCE_UPLOAD');
assert.equal(meta.sha256,path.basename(sourceName,'.xlsx'));
assert.ok(new Date(meta.retainUntil).getTime()-new Date(meta.capturedAt).getTime()>=366*24*60*60*1000,'retention horizon must be >=366 days');
assert.match(meta.policy,/NO_AUTOMATIC_ARCHIVE_DELETE/);

await fsp.rm(root,{recursive:true,force:true});
console.log('[RECOVERY-SAFE/V266/V283/V284/V285/V286] 88439846 browser shell + automatic startup maintenance paused + per-business/independent-WHPP stored data truth preserved + frozen backup gate passed');