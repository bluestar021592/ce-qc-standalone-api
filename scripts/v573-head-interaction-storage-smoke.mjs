import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const login=fs.readFileSync(new URL('../public/local-login.html',import.meta.url),'utf8');
const cleanup=fs.readFileSync(new URL('./CE_QC_NoBackup_Cleanup.mjs',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');

const headEnd=index.indexOf('</head>');
const inlineAt=index.indexOf('2026-09-21-v575-coordinate-nav-owner-v1');
assert.ok(inlineAt>0 && inlineAt<headEnd,'V575 coordinate interaction owner must be embedded in <head> before every external asset');
assert.doesNotMatch(index,/v569-final-interaction-owner\.js/,'V575 must be the sole shipped window-level interaction owner; the retired V570 owner must not compete');

assert.match(index,/global\.addEventListener\('pointerdown',onPointerDown,true\)/,'V575 pointerdown capture must own sidebar navigation before stale handlers');
assert.match(index,/global\.addEventListener\('click',onClick,true\)/,'click capture must stay armed at window level');
assert.match(index,/actionByCoordinates/,'V575 must recover intended controls from pointer coordinates even when the event target is an overlay');
assert.match(index,/elementsFromPoint/,'V575 must inspect the actual top hit stack to retire stale blockers');
assert.doesNotMatch(index,/location\.assign\(target\)/,'V575 must never start a full-page navigation while app.js is still loading');
assert.match(index,/replayWhenReady/,'V575 must replay the local route into app.js instead of reloading the document');
assert.match(index,/whpp:'\/whpp'/,'WHPP must remain a first-class no-reload route');
assert.match(index,/data-page="whpp"[^>]*WHPP|data-page="whpp"/,'static sidebar must contain WHPP before app.js or V318 runs');
assert.match(index,/fetch\('\/api\/client-diag\?'/,'V575 owner must publish bounded client diagnostics without touching business data');
const inlineMatch=index.match(/<script>\s*\(function installV575CoordinateOwner[\s\S]*?<\/script>/);
assert.ok(inlineMatch,'V575 coordinate owner script block must exist');
const inlineSource=inlineMatch[0].replace(/^<script>\s*/,'').replace(/<\/script>$/,'');
new Function(inlineSource);

const assetAt=server.indexOf('const v575PublicAssetStatic');
const authAt=server.indexOf('app.use(accessIdentity)');
assert.ok(assetAt>0&&assetAt<authAt,'V574 static JS/CSS/image fast lane must be registered before accessIdentity');
assert.match(server,/\['\/ce', '\/ceaf', '\/tbkh', '\/ali1688', '\/whpp'/,'server SPA routes must include /whpp');
assert.match(server,/app\.get\('\/api\/client-diag'/,'server must expose read-only V575 client diagnostics');
assert.match(server,/\[CE-QC\]\[V575_CLIENT\]/,'server client diagnostics must be labeled V575');

assert.match(app,/'\/whpp':'whpp'/,'base route parser must understand WHPP');
assert.match(app,/\['ce', 'ceaf', 'tbkh', 'ali1688', 'whpp', 'shopeecn', 'shopeevn'/,'base navigatePage must admit WHPP instead of collapsing it to HOME');
assert.match(app,/page === 'whpp'/,'WHPP hydration must explicitly hand off to its lazy owner');
assert.match(app,/__CE_QC_V90_INSTANT_WHPP_NAV__/,'base runtime must preserve the dedicated WHPP rendering owner');

assert.match(login,/\?auth=v575&t=/,'post-login URL must visibly identify the V575 coordinate shell, so stale installs are obvious');
assert.match(cleanup,/2026-09-21-v573-dual-drive-storage-proof-v1/);
assert.match(cleanup,/\[CE-QC\]\[V573\]\[STORAGE\] cleanup complete:/,'startup must print a human-readable deletion result');
assert.match(cleanup,/driveLine\('C',drivesBefore\.C,drivesAfter\.C\)/,'C free-space before/after must be printed');
assert.match(cleanup,/driveLine\('D',drivesBefore\.D,drivesAfter\.D\)/,'D free-space before/after must be printed');
assert.match(cleanup,/PROJECT_CACHE/);
assert.match(cleanup,/PROJECT_TMP/);
assert.match(cleanup,/NODE_MODULE_CACHE/);
assert.match(cleanup,/BUSINESS_DATA_PRESENT/,'live business DB must remain fail-safe and not be silently deleted');
assert.match(cleanup,/VACUUM/,'an explicitly emptied DB must still return SQLite disk space');
assert.match(start,/\[CE-QC\]\[V575\] Coordinate click recovery \+ WHPP home card \+ C\/D storage proof runtime is installed\./);

assert.match(app,/\['whpp', 'WHPP本土'/,'production homepage must include WHPP as a first-class business card');
assert.match(app,/state\.dashboard\?\.metrics\?\.total/,'WHPP home/range count must read unified WHPP metrics total');
console.log('[V573/V575] coordinate click recovery + WHPP homepage + visible C/D storage proof smoke passed');
