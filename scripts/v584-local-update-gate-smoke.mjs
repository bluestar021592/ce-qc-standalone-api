import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const launcher=fs.readFileSync(new URL('../tools/CE_QC_Managed_Launcher.ps1',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('./v584-local-candidate-gate.mjs',import.meta.url),'utf8');
const census=fs.readFileSync(new URL('../tools/CE_QC_C_Drive_Census.ps1',import.meta.url),'utf8');

assert.equal(pkg.scripts['test:golive'],'node scripts/v584-local-candidate-gate.mjs','installed V580 launcher must execute the bounded V584 candidate gate');
assert.equal(pkg.scripts['test:ci'],'npm run test:golive-full','CI must retain the full soak suite');
assert.match(pkg.scripts['test:golive-full'],/v505-purge-postcommit-precleanup-gate\.test\.js/,'full CI must retain the slow post-COMMIT safety regression');
assert.doesNotMatch(gate,/v505-purge-postcommit-precleanup-gate\.test\.js/,'desktop update gate must not depend on the slow detached PREPARE soak');
assert.match(gate,/v581-production-shell-browser-smoke\.mjs/,'desktop update gate must prove real Edge sidebar/home recovery');
assert.match(gate,/unified-import-v7\.test\.js/,'desktop update gate must retain seven-business import protection');
assert.match(gate,/v512-whpp-source-membership-guard\.test\.js/,'desktop update gate must retain WHPP exact membership protection');
assert.match(launcher,/@\('run','test:golive'\)/,'existing managed launcher contract must continue to call test:golive so old installs can consume the new bounded gate');
assert.match(start,/\[CE-QC\]\[V584\] Direct sidebar\/dashboard repair \+ bounded updater gate \+ safe C\/D cleanup are installed\./);
assert.match(start,/CE_QC_C_Drive_Census\.ps1/,'startup must launch C-drive census only after the app is ready');
assert.match(census,/bounded read-only census/i);
assert.doesNotMatch(census,/Remove-CeTarget|Clear-RecycleBin|Format-|Remove-Item\s+-LiteralPath\s+\$root/i,'census must remain read-only with respect to scanned roots');
assert.match(census,/Downloads/,'census may report Downloads size');
assert.match(census,/Documents/,'census may report Documents size');
assert.match(census,/Desktop/,'census may report Desktop size');

console.log('[V584] local updater gate + full CI split + read-only C-drive census smoke passed');
