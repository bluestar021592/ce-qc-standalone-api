import assert from 'node:assert/strict';
import fs from 'node:fs';

const cleanup=fs.readFileSync(new URL('../tools/CE_QC_Dedicated_Drive_Cleanup.ps1',import.meta.url),'utf8');
const launcher=fs.readFileSync(new URL('../tools/CE_QC_Managed_Launcher.ps1',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');

assert.match(cleanup,/2026-09-22-v578-dedicated-drive-cleanup-v1/);
for(const required of [
  'CE_QC_LAUNCHER\\backups',
  'CE_QC_LAUNCHER\\temp',
  'npm-cache',
  'Microsoft\\Edge\\User Data\\Default\\Cache',
  'Microsoft\\Edge\\User Data\\Default\\Code Cache',
  'D3DSCache',
  'CrashDumps',
  'D:\\CE_QC_TEST_TEMP',
  'D:\\CE_QC_RUNTIME_TEMP',
  'D:\\CE_QC_NPM_CACHE'
]) assert.ok(cleanup.includes(required), 'missing safe cleanup root: '+required);

assert.match(cleanup,/Clear-RecycleBin -DriveLetter C/);
assert.match(cleanup,/Clear-RecycleBin -DriveLetter D/);
assert.match(cleanup,/MinAgeHours = 0/);
assert.match(cleanup,/Remove-CeTarget \$env:TEMP 24/);
assert.match(cleanup,/Remove-CeTarget \(Join-Path \$env:WINDIR 'Temp'\) 72/);

for(const forbidden of ['Downloads','Desktop','Documents','Program Files','ProgramData\\','Windows\\System32','Users\\']) {
  assert.equal(cleanup.includes("Remove-CeTarget "+forbidden),false,'must not blindly delete protected/user content: '+forbidden);
}

assert.match(launcher,/D:\\CE_QC_TEST_TEMP\\worktrees/,'candidate Git worktree must move to D');
assert.match(launcher,/D:\\CE_QC_NPM_CACHE/,'npm cache must move to D');
assert.match(launcher,/Candidate worktree\/test scratch\/npm cache use D:/);

assert.match(start,/CE_QC_Dedicated_Drive_Cleanup\.ps1/,'startup must invoke dedicated cleanup');
assert.match(start,/\[CE-QC\]\[V578\] Dedicated C\/D storage cleanup/);
assert.match(start,/D:\\CE_QC_NPM_CACHE/);

console.log('[V578] dedicated-drive cleanup smoke passed · C clears safe CE/user/browser caches + recycle bin · D owns update/runtime/npm scratch · no Documents/Downloads/system directories are blindly deleted');
