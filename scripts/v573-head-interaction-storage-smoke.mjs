import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const login=fs.readFileSync(new URL('../public/local-login.html',import.meta.url),'utf8');
const cleanup=fs.readFileSync(new URL('./CE_QC_NoBackup_Cleanup.mjs',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');

const headEnd=index.indexOf('</head>');
const inlineAt=index.indexOf('2026-09-21-v574-inline-no-reload-owner-v1');
const legacyOwnerAt=index.indexOf('/v569-final-interaction-owner.js?v=20260921-v570-1');
assert.ok(inlineAt>0 && inlineAt<headEnd,'V574 inline interaction owner must be embedded in <head> before every external asset');
assert.ok(legacyOwnerAt>headEnd,'V570 compatibility owner must remain delivered after the inline owner');

assert.match(index,/global\.addEventListener\('pointerdown',onPointerDown,true\)/,'pointerdown capture must own sidebar navigation before stale handlers');
assert.match(index,/global\.addEventListener\('click',onClick,true\)/,'click capture must stay armed at window level');
assert.match(index,/elementsFromPoint/,'V574 must use real hit-test geometry to neutralize blockers');
assert.doesNotMatch(index,/location\.assign\(target\)/,'V574 must never start a full-page navigation while app.js is still loading');
assert.match(index,/replayWhenReady/,'V574 must replay the local route into app.js instead of reloading the document');
assert.match(index,/whpp:'\/whpp'/,'WHPP must remain a first-class no-reload route');

assert.match(app,/'\/whpp':'whpp'/,'base route parser must understand WHPP');
assert.match(app,/\['ce', 'ceaf', 'tbkh', 'ali1688', 'whpp', 'shopeecn', 'shopeevn'/,'base navigatePage must admit WHPP instead of collapsing it to HOME');
assert.match(app,/page === 'whpp'/,'WHPP hydration must explicitly hand off to its lazy owner');
assert.match(app,/__CE_QC_V90_INSTANT_WHPP_NAV__/,'base runtime must preserve the dedicated WHPP rendering owner');

assert.match(login,/\?auth=v574&t=/,'post-login URL must visibly identify the V574 no-reload shell, so stale installs are obvious');
assert.match(cleanup,/2026-09-21-v573-dual-drive-storage-proof-v1/);
assert.match(cleanup,/\[CE-QC\]\[V573\]\[STORAGE\] cleanup complete:/,'startup must print a human-readable deletion result');
assert.match(cleanup,/driveLine\('C',drivesBefore\.C,drivesAfter\.C\)/,'C free-space before/after must be printed');
assert.match(cleanup,/driveLine\('D',drivesBefore\.D,drivesAfter\.D\)/,'D free-space before/after must be printed');
assert.match(cleanup,/PROJECT_CACHE/);
assert.match(cleanup,/PROJECT_TMP/);
assert.match(cleanup,/NODE_MODULE_CACHE/);
assert.match(cleanup,/BUSINESS_DATA_PRESENT/,'live business DB must remain fail-safe and not be silently deleted');
assert.match(cleanup,/VACUUM/,'an explicitly emptied DB must still return SQLite disk space');
assert.match(start,/\[CE-QC\]\[V573\] Click recovery \+ C\/D storage proof runtime is installed\./);

console.log('[V573/V574] inline no-reload click recovery + WHPP route + visible C/D storage proof smoke passed');
