import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../public/v573-head-interaction-bridge.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const login=fs.readFileSync(new URL('../public/local-login.html',import.meta.url),'utf8');
const cleanup=fs.readFileSync(new URL('./CE_QC_NoBackup_Cleanup.mjs',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');

const headEnd=index.indexOf('</head>');
const bridgeAt=index.indexOf('/v573-head-interaction-bridge.js?v=20260921-v573-1');
const legacyOwnerAt=index.indexOf('/v569-final-interaction-owner.js?v=20260921-v570-1');
assert.ok(bridgeAt>0 && bridgeAt<headEnd,'V573 interaction bridge must be delivered in <head> before runtime response injectors can register click blockers');
assert.ok(legacyOwnerAt>headEnd,'V570 compatibility owner must remain delivered after the new head-first owner');

assert.match(bridge,/2026-09-21-v573-head-first-interaction-bridge-v1/);
assert.match(bridge,/elementsFromPoint/,'real hit-test geometry must be used, not target-only click routing');
assert.match(bridge,/global\.addEventListener\('pointerup',handle,true\)/,'pointerup capture fallback must be armed at window level');
assert.match(bridge,/global\.addEventListener\('mouseup',handle,true\)/,'mouseup capture fallback must be armed at window level');
assert.match(bridge,/global\.addEventListener\('click',handle,true\)/,'click capture owner must be armed at window level');
assert.match(bridge,/node\.style\?\.setProperty\?\.\('pointer-events','none','important'\)/,'large stale blockers must be neutralizable without page reload');
assert.match(bridge,/global\.location\.assign\(target\)/,'sidebar navigation must have a hard route fallback when SPA handlers are broken');
assert.match(bridge,/whpp:'\/whpp'/,'WHPP must be a first-class hard route in the emergency bridge');

assert.match(app,/'\/whpp':'whpp'/,'base route parser must understand WHPP');
assert.match(app,/\['ce', 'ceaf', 'tbkh', 'ali1688', 'whpp', 'shopeecn', 'shopeevn'/,'base navigatePage must admit WHPP instead of collapsing it to HOME');
assert.match(app,/page === 'whpp'/,'WHPP hydration must explicitly hand off to its lazy owner');
assert.match(app,/__CE_QC_V90_INSTANT_WHPP_NAV__/,'base runtime must preserve the dedicated WHPP rendering owner');

assert.match(login,/\?auth=v573&t=/,'post-login URL must visibly identify the V573 shell, so stale installs are obvious');
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

console.log('[V573] head-first click recovery + WHPP route + visible C/D storage proof smoke passed');
