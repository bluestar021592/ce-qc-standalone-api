import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cold=fs.readFileSync('src/v46ColdStartIndexPatch.js','utf8');
const patch=fs.readFileSync('src/v252SettingsRecoveryPatch.js','utf8');
const client=fs.readFileSync('public/v252-settings-recovery.js','utf8');

test('V252 is loaded after V251 and mounts its settings recovery after authenticated access',()=>{
  const v251=cold.indexOf("import './v251CookieFirstLoginPatch.js';");
  const v252=cold.indexOf("import './v252SettingsRecoveryPatch.js';");
  assert.ok(v251>=0&&v252>v251);
  assert.match(patch,/const result=previousUse\.apply\(this,args\)/);
  assert.match(patch,/if\(access&&!mounted\)\{mounted=true;previousUse\.call\(this,v252SettingsRecovery\);\}/);
});

test('V252 settings shell reads authenticated user and CE token without dashboard bootstrap',()=>{
  assert.match(patch,/SHELL='\/api\/v252\/settings-shell'/);
  assert.match(patch,/user:publicFastUser\(req\.user\)/);
  assert.match(patch,/ceAuth:summarizeToken\(token\)/);
  assert.doesNotMatch(patch,/loadRangeDashboard|loadLightweightAggregateState|business_final_rows|unified_import_rows/);
});

test('V252 CE connector fast path is local authenticated, bounded by CE client and not blocked by internal dashboard role middleware',()=>{
  assert.match(patch,/CE_LOGIN='\/api\/v252\/ce-login'/);
  assert.match(patch,/if\(!localLike\(req\)\|\|!req\.user\?\.username\)/);
  assert.match(patch,/client\.login\(\{tenantId,username,password,grant_type:'password',scope:'all',type:'account'\}\)/);
  assert.match(patch,/normalizeLoginToken\(raw,\{tenantId,username\}\)/);
  assert.match(patch,/await saveToken\(token\)/);
  assert.doesNotMatch(patch,/requireRole\(['"]ADMIN['"]\)/);
});

test('V253 browser settings survives SPA navigation and dashboard rerenders instead of only activating on initial /settings load',()=>{
  assert.match(client,/2026-08-21-v253-settings-spa-activation-v1/);
  assert.match(client,/\/api\/v252\/settings-shell/);
  assert.match(client,/\/api\/v252\/ce-login/);
  assert.match(client,/data-v253-settings-ready/);
  assert.match(client,/for\(const name of \['pushState','replaceState'\]\)/);
  assert.match(client,/global\.addEventListener\('popstate'/);
  assert.match(client,/function settingsVisible\(\)/);
  assert.match(client,/if\(settingsVisible\(\)&&lastShell&&!\$\('#networkAccessCards \[data-v253-settings-ready=/);
  assert.doesNotMatch(client,/if\(location\.pathname!==['"]\/settings['"]\)return/);
  assert.match(client,/button\.removeAttribute\('onclick'\)/);
  assert.match(client,/CE API 登录成功/);
  assert.match(client,/最长等待12秒/);
});

test('V253 injects a cache-busted recovery client into real index sendFile responses',()=>{
  assert.match(patch,/res\.sendFile=function v252SendFile/);
  assert.match(patch,/path\.basename\(String\(file\|\|''\)\)==='index\.html'/);
  assert.match(patch,/v252-settings-recovery\.js\?v=20260821-v253-1/);
  assert.match(patch,/2026-08-21-v253-settings-spa-activation-v1/);
});
