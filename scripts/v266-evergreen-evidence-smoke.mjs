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
const coverageSource=fs.readFileSync('src/v284MembershipEvidenceCoverage.js','utf8');
const priorityRefreshSource=fs.readFileSync('src/v284PriorityUnprovenRefresh.js','utf8');
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
assert.match(source,/ce_api/,'CE API evidence archive must be independently replayable');
assert.doesNotMatch(source,/rmSync\(|fsPromises\.rm\(|rmdir\(/,'V266 must not contain any archive purge implementation');

const legacySha='8abc5f1b423f7dfab2d910f3de79067cae0a06cb683103a9d6c3df462f0b34c8';
assert.equal(v283.canonicalLegacyFileHash(`${legacySha}:2026-08-13-v77-ceaf-whpp-source-authority`),legacySha,'V283 must strip only the legacy authority suffix and retain the exact leading SHA-256');
assert.equal(v283.canonicalLegacyFileHash(legacySha),legacySha,'V283 must preserve an already canonical SHA-256');
assert.equal(v283.canonicalLegacyFileHash(`prefix:${legacySha}`),'','V283 must reject hashes that do not begin with the exact SHA-256');
assert.match(activation,/import '\.\/v283LegacyDecoratedHashReplay\.js';/,'V283 decorated-hash replay must be activated in the normal startup chain');
assert.match(activation,/import '\.\/v283LegacyDecoratedHashReplayRetry\.js';/,'V283 post-evidence-seed retry must be activated in the normal startup chain');
assert.match(activation,/import '\.\/v284DailyMembershipAudit\.js';/,'V284 real-db read-only audit must be activated after startup');
assert.match(activation,/import '\.\/v284PriorityUnprovenRefresh\.js';/,'V284 bounded unproven-member refresh must be activated after the read-only audit');
assert.match(v283Retry.V283_LEGACY_HASH_RETRY_ID,/v283-post-evidence-seed-retry-v1/,'V283 retry module must be the bounded post-evidence-seed retry');
await import(`./v283-legacy-hash-replay-smoke.mjs?nested=${Date.now()}`);

// V284 must be validated on every go-live candidate. The regression deliberately
// gives ledger rows a firstReportDate different from the daily report date; the
// requested day must still render from exact latest-VALID daily membership.
for(const file of [
  'src/v284DailyMembershipTruth.js',
  'src/v284MembershipEvidenceCoverage.js',
  'src/v284DailyMembershipAudit.js',
  'src/v284PriorityUnprovenRefresh.js',
  'src/v273DashboardTruthReadPatch.js',
  'src/v244ShopeeTrendRuntimePatch.js',
  'src/rangeDashboardStoreV284.js',
  'scripts/CE_QC_PreUpdate_Backup.mjs',
  'scripts/v284-daily-membership-smoke.mjs',
  'scripts/v284-evidence-coverage-smoke.mjs',
  'scripts/v285-preupdate-backup-freeze-smoke.mjs'
]) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
assert.match(coverageSource,/ledger admission alone is not analysis proof/,'V284 must explicitly distinguish ledger admission from proven analysis');
assert.match(coverageSource,/lastCheckedAt/,'checked lifecycle state must be part of proven-evidence ownership');
assert.match(priorityRefreshSource,/MAX_TARGETS=100/,'priority evidence repair must remain hard-limited to 100 shipments');
assert.match(priorityRefreshSource,/FOREGROUND_PROCESSING_ACTIVE/,'priority evidence repair must yield to active production processing');
assert.match(priorityRefreshSource,/processCarryFamilyForRefresh/,'priority evidence repair must reuse the existing production carry refresh pipeline');
assert.match(priorityRefreshSource,/if\(targets\.length>MAX_TARGETS\)/,'large evidence gaps must be skipped rather than causing an unbounded startup refresh');
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
console.log('[V266/V283/V284/V285] evergreen evidence + legacy SHA replay + daily membership + proven-evidence coverage + bounded targeted repair + frozen verified pre-update backup gate passed');
