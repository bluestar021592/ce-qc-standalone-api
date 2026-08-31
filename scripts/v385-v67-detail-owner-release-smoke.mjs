import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const file='public/v138-ccsl-scan-progress.js';
execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const source=fs.readFileSync(file,'utf8');

assert.match(source,/2026-08-31-v385-release-stale-v67-detail-owner-v1/,'V385 detail-owner release revision must be active');
assert.match(source,/function releaseV67Owner\(node\)[\s\S]*delete node\.dataset\.v67UnifiedOwner[\s\S]*delete node\.dataset\.v67UnifiedReportDate/,'stale V67 DOM ownership markers must be removable');
assert.match(source,/if\(stage\?\.owner==='V67'\)\{[\s\S]*if\(stage\.active===true\)[\s\S]*releaseV67Owner\(node\);[\s\S]*return false/,'inactive V67 runner must release CCSL detail ownership immediately');
assert.match(source,/if\(node\.dataset\.v67UnifiedOwner==='1'\)releaseV67Owner\(node\);[\s\S]*return false/,'orphaned V67 ownership without a live runner must also be released');
assert.doesNotMatch(source,/if\(node\.dataset\.v67UnifiedOwner!=='1'\)return false;[\s\S]*return true/,'stale same-date dataset ownership must never permanently block canonical CCSL repaint');
assert.match(source,/setInterval\(enforceLastTruth,250\)/,'canonical CCSL detail repaint enforcement must remain active');
assert.match(source,/postJson\('\/api\/v317\/ccsl-recovery'/,'detail must continue reading canonical V317\/V384 truth');

execFileSync(process.execPath,['scripts/v386-dirty-dashboard-cache-truth-smoke.mjs'],{stdio:'inherit'});
console.log('[V386/V385] status + dashboard truth smoke passed · inactive V67 releases stale CCSL detail DOM · dirty current dates cannot keep serving stale derived POD/open metrics');
