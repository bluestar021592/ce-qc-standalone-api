import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const login=fs.readFileSync(new URL('../public/local-login.html',import.meta.url),'utf8');
const cleanup=fs.readFileSync(new URL('./CE_QC_NoBackup_Cleanup.mjs',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const stable=fs.readFileSync(new URL('../public/v581-stable-shell-owner.js',import.meta.url),'utf8');
const response=fs.readFileSync(new URL('../src/v581StableShellResponsePatch.js',import.meta.url),'utf8');

assert.doesNotMatch(index,/installV575CoordinateOwner/,'V581 must retire the layered V575 capture owner from static HTML');
assert.doesNotMatch(index,/v580-visible-shell-recovery\.js/,'V581 must retire the layered V580 recovery script from static HTML');
assert.match(index,/v581-stable-shell-owner\.js\?v=20260926-v591-1/,'static shell must carry V581 as fallback');
assert.match(index,/<a class="side-link active" data-page="home"[^>]*href="\/?\?auth=v581"/,'HOME must be a native hard link');
assert.match(index,/<a class="side-link" data-page="ce"[^>]*href="\/ce\?auth=v581"/,'CE must be a native hard link');
assert.match(index,/<a class="side-link" data-page="import"[^>]*href="\/import\?auth=v581"/,'import must be a native hard link');
assert.match(stable,/single stable shell owner/i);
assert.doesNotMatch(stable,/subtree:true/,'stable-shell observer must never watch the whole dashboard subtree');
assert.match(stable,/shell-structure-mutation/,'bounded structural repair must remain available');
assert.match(stable,/data-v581-active/,'V581 must deterministically own visible route page');
assert.match(stable,/renderFallbackHomeIfStillEmpty/,'V581 must retry HOME render if the page container is still blank');
assert.match(stable,/removeEmptyLargeBlockers/,'V581 must retire large stale pointer blockers without reviving V575');
assert.match(stable,/ce-qc-v591-sidebar-frame/,'V591 must create an isolated srcdoc sidebar iframe');
assert.match(stable,/frame\.srcdoc=markup/,'V591 must not depend on an authenticated child-document request');
assert.match(stable,/target="_top"/,'V591 isolated links must navigate the top document natively');
assert.match(stable,/WHPP本土看板/,'V591 isolated sidebar must keep WHPP first-class');
assert.doesNotMatch(stable,/sidebar-v590\.html/,'V591 primary path must retire the external V590 sidebar document dependency');
assert.match(response,/stripInlineV575/,'final response pass must remove V575 if any older wrapper re-injects it');
assert.match(response,/v580-visible-shell-recovery\.js/,'final response pass must remove V580 if any older wrapper re-injects it');
assert.match(response,/const appTag=/,'V582 response pass must locate app.js as the bootstrap boundary');
assert.match(response,/V581_TAG\+'\\n'\+match/,'V582 response pass must inject the stable owner before app.js');
assert.match(response,/X-CE-QC-V581-Shell/);

const assetAt=server.indexOf('const v575PublicAssetStatic');
const authAt=server.indexOf('app.use(accessIdentity)');
assert.ok(assetAt>0&&assetAt<authAt,'browser JS/CSS/image fast lane must remain before accessIdentity');
assert.match(server,/\['\/ce', '\/ceaf', '\/tbkh', '\/ali1688', '\/whpp'/,'server routes must include /whpp');
assert.match(server,/X-Frame-Options', 'DENY'/,'all other authenticated HTML must retain frame denial');
assert.match(server,/app\.get\('\/api\/client-diag'/,'server must keep bounded client diagnostics');

assert.match(app,/'\/whpp':'whpp'/,'base route parser must understand WHPP');
assert.match(app,/\['ce', 'ceaf', 'tbkh', 'ali1688', 'whpp', 'shopeecn', 'shopeevn'/,'base navigatePage must admit WHPP');
assert.match(app,/page === 'whpp'/,'WHPP hydration must explicitly hand off to its owner');
assert.match(app,/__CE_QC_V90_INSTANT_WHPP_NAV__/,'base runtime must preserve the dedicated WHPP renderer');
assert.match(app,/\['whpp', 'WHPP本土'/,'production homepage must include WHPP as a first-class business card');
assert.match(app,/state\.dashboard\?\.metrics\?\.total/,'WHPP home/range count must read unified WHPP metrics total');

assert.match(login,/\?auth=v581&t=/,'post-login URL must visibly identify V581');
assert.match(cleanup,/2026-09-26-v588-no-backup-storage-cleanup-v1/);
assert.match(cleanup,/\[CE-QC\]\[V573\]\[STORAGE\] cleanup complete:/);
assert.match(cleanup,/driveLine\('C',drivesBefore\.C,drivesAfter\.C\)/);
assert.match(cleanup,/driveLine\('D',drivesBefore\.D,drivesAfter\.D\)/);
assert.match(cleanup,/compactSqliteStorage/);
assert.match(start,/\[CE-QC\]\[V591\] Srcdoc-isolated sidebar \+ legacy C backup purge \+ diff-aware updater gate are installed\./);

console.log('[V591] srcdoc-isolated sidebar + WHPP + legacy C backup purge + diff-aware updater smoke passed');
