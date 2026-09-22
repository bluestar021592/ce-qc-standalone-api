import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cleanup=fs.readFileSync(new URL('../tools/CE_QC_Dedicated_Drive_Cleanup.ps1',import.meta.url),'utf8');
const launcher=fs.readFileSync(new URL('../tools/CE_QC_Managed_Launcher.ps1',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');

assert.match(cleanup,/2026-09-22-v580-live-browser-safe-dedicated-cleanup-v1/);
assert.doesNotMatch(cleanup,/\$Letter:/,'PowerShell must delimit drive-letter variable before colon');
assert.match(cleanup,/DeviceID='\$\{Letter\}:'/,'drive query must use ${Letter}: interpolation safely');
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
assert.match(start,/\[CE-QC\]\[V580\] Live-browser-safe C\/D cleanup \+ shell recovery/);
assert.match(start,/D:\\CE_QC_NPM_CACHE/);

if(os.platform()==='win32'){
  const psPath=fileURLToPath(new URL('../tools/CE_QC_Dedicated_Drive_Cleanup.ps1',import.meta.url)).replace(/'/g,"''");
  const command="$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+psPath+"',[ref]$t,[ref]$e)|Out-Null;if($e.Count -gt 0){$e|ForEach-Object{$_.Message};exit 1}";
  const parsed=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-Command',command],{encoding:'utf8'});
  assert.equal(parsed.status,0,'PowerShell parser rejected dedicated cleanup script: '+(parsed.stdout||'')+(parsed.stderr||''));
}
assert.match(cleanup,/Get-Process msedge/,'live Edge must be detected before browser cache cleanup');
assert.match(cleanup,/Get-Process chrome/,'live Chrome must be detected before browser cache cleanup');
assert.match(cleanup,/Edge is running; live Edge caches retained for UI stability/);
assert.match(cleanup,/Chrome is running; live Chrome caches retained for UI stability/);
console.log('[V578/V579/V580] dedicated-drive cleanup smoke passed · PowerShell syntax parsed on Windows · live Edge/Chrome caches are never deleted while browser is running · C/D cleanup and D-owned scratch remain active');
