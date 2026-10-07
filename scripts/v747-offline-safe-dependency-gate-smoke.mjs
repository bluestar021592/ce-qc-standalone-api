import assert from 'node:assert/strict';
import fs from 'node:fs';

const launcher=fs.readFileSync('tools/CE_QC_Managed_Launcher.ps1','utf8');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));

assert.match(launcher,/package-lock\.json/,'updater must still treat lockfile changes as dependency changes');
assert.match(launcher,/currentDependencyMetadata/,'updater must compare actual dependency metadata instead of any package.json script change');
assert.match(launcher,/candidateDependencyMetadata/,'candidate dependency metadata comparison missing');
assert.match(launcher,/dependencyGraphChanged/,'dependency graph decision missing');
assert.match(launcher,/Dependency graph unchanged; reusing installed node_modules/,'dependency-neutral candidates must reuse installed modules');
assert.match(launcher,/npm ci transient failure exit=/,'real dependency installs must retry one transient npm failure');
assert.match(launcher,/Invoke-Exe \$script:NpmExe \$npmArgs -AllowFailure/,'npm retry must observe the real exit code');
assert.doesNotMatch(launcher,/diff','--name-only',\$CurrentCommit,\$RemoteCommit,'--','package\.json','package-lock\.json'/,'script-only package.json changes must not force npm ci');

assert.equal(pkg.scripts['test:golive'],'node scripts/v584-local-candidate-gate.mjs');
assert.doesNotMatch(pkg.scripts['test:golive-full'],/v745-whpp-timing-source-diagnostics-smoke|v746-whpp-canonical-daily-timing-smoke|v747-/,
  'V747 release must keep package.json identical to installed V744 so the old updater can reuse node_modules');

console.log('[V747] updater is dependency-graph aware: V746 can install from V744 without npm network access; real dependency changes still use bounded npm ci retry');
