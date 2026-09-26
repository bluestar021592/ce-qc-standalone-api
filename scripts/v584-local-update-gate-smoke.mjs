import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const launcher=fs.readFileSync(new URL('../tools/CE_QC_Managed_Launcher.ps1',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('./v584-local-candidate-gate.mjs',import.meta.url),'utf8');
const censusUrl=new URL('../tools/CE_QC_C_Drive_Deep_Census.ps1',import.meta.url);
const census=fs.readFileSync(censusUrl,'utf8');

assert.equal(pkg.scripts['test:golive'],'node scripts/v584-local-candidate-gate.mjs','installed V580 launcher must execute the bounded V584 candidate gate');
assert.equal(pkg.scripts['test:ci'],'npm run test:golive-full','CI must retain the full soak suite');
assert.match(pkg.scripts['test:golive-full'],/v505-purge-postcommit-precleanup-gate\.test\.js/,'full CI must retain the slow post-COMMIT safety regression');
assert.doesNotMatch(gate,/v505-purge-postcommit-precleanup-gate\.test\.js/,'desktop update gate must not depend on the slow detached PREPARE soak');
assert.match(gate,/v587-production-browser-retry\.mjs'\]\,300_000/,'desktop update gate must give the transient-only real Edge retry wrapper a bounded five-minute task window');
const browserRetry=fs.readFileSync(new URL('./v587-production-browser-retry.mjs',import.meta.url),'utf8');
assert.match(browserRetry,/v581-production-shell-browser-smoke\.mjs/,'retry wrapper must execute the real production Edge smoke');
assert.match(browserRetry,/non-transient browser assertion failed/,'real assertion failures must never be retried into a false pass');
assert.match(gate,/const \[kind,args,taskTimeoutMs=TIMEOUT_MS\]=TASKS\[i\]/,'all other desktop candidate tasks must keep the default bounded timeout');
assert.match(gate,/timeout:taskTimeoutMs/,'per-task timeout override must be explicit and local to the browser retry task');
assert.match(gate,/unified-import-v7\.test\.js/,'desktop update gate must retain seven-business import protection');
assert.match(gate,/v512-whpp-source-membership-guard\.test\.js/,'desktop update gate must retain WHPP exact membership protection');
assert.match(launcher,/@\('run','test:golive'\)/,'existing managed launcher contract must continue to call test:golive so old installs can consume the new bounded gate');
assert.match(start,/\[CE-QC\]\[V588\] Native sidebar hit surface \+ legacy C backup purge \+ deep C-drive census are installed\./);
assert.match(start,/CE_QC_C_Drive_Deep_Census\.ps1/,'startup must launch the deep C-drive census only after the app is ready');
assert.match(start,/c_drive_deep_census_latest\.log/,'startup must publish a stable deep-census log path');
assert.match(census,/deep read-only census/i);
assert.match(census,/LOCALAPPDATA/,'deep census must attribute LocalAppData by first-level owner');
assert.match(census,/WINDOWS/,'deep census must attribute Windows top-level directories');
assert.match(census,/VSS_SHADOW_STORAGE/,'deep census must inspect restore-point/shadow-storage allocation');
assert.match(census,/DISM_COMPONENT_STORE/,'deep census must inspect Windows component-store usage');
assert.match(census,/VIRTUAL_DISK=/,'deep census must surface large WSL/Docker/VM virtual disks');
assert.doesNotMatch(census,/Clear-RecycleBin|Format-|Remove-CeTarget|dism\.exe[^\n]*\/StartComponentCleanup/i,'deep census must never perform cleanup/deletion operations');
if(os.platform()==='win32'){
  const psPath=fileURLToPath(censusUrl).replace(/'/g,"''");
  const command="$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+psPath+"',[ref]$t,[ref]$e)|Out-Null;if($e.Count -gt 0){$e|ForEach-Object{$_.Message};exit 1}";
  const parsed=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-Command',command],{encoding:'utf8'});
  assert.equal(parsed.status,0,'PowerShell parser rejected deep C-drive census: '+(parsed.stdout||'')+(parsed.stderr||''));
}

console.log('[V588] local updater gate + legacy C backup purge + deep read-only C-drive attribution smoke passed');
