const fs=require('fs');
const {spawnSync}=require('node:child_process');

const run=(args,timeout=480000)=>{
  const result=spawnSync(process.execPath,args,{encoding:'utf8',env:process.env,timeout,windowsHide:true});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`V246 command failed: node ${args.join(' ')} exit=${result.status}`);
};
const must=(source,token)=>{if(!source.includes(token))throw new Error(`V246 contract missing: ${token}`);};
const core=fs.readFileSync('src/v246CoreAvailabilityPatch.js','utf8');
const whppAuthority=fs.readFileSync('src/v248WhppAuthorityPatch.js','utf8');
const sidecar=fs.readFileSync('src/v213AuthSidecar.js','utf8');
const directLogin=fs.readFileSync('src/v249LoginReliabilityPatch.js','utf8');
const cookieFirst=fs.readFileSync('src/v251CookieFirstLoginPatch.js','utf8');
const settingsRecovery=fs.readFileSync('src/v252SettingsRecoveryPatch.js','utf8');
const settingsClient=fs.readFileSync('public/v252-settings-recovery.js','utf8');
const client=fs.readFileSync('public/v246-core-usability.js','utf8');
const cold=fs.readFileSync('src/v46ColdStartIndexPatch.js','utf8');
const localTruth=fs.readFileSync('scripts/v225-local-db-truth-smoke.mjs','utf8');
const dataAudit=fs.readFileSync('scripts/v238-local-production-readonly-gate.mjs','utf8');
const purge=fs.readFileSync('src/dataPurge.js','utf8');
const restartE2E=fs.readFileSync('scripts/v234-restart-persistence-e2e.mjs','utf8');

must(cold,"import './v246CoreAvailabilityPatch.js';");
must(cold,"import './v248WhppAuthorityPatch.js';");
must(cold,"import './v249LoginReliabilityPatch.js';");
must(cold,"import './v251CookieFirstLoginPatch.js';");
must(cold,"import './v252SettingsRecoveryPatch.js';");
must(core,"const ready=Boolean(services?.ready)");
must(core,"dataState:'NOT_REQUIRED_FOR_STARTUP'");
must(core,"dataBlocking:false");
must(core,"AUTH_PROXY_PATH='/api/v246/internal-auth/login'");
must(core,"signForChannel(sidecarPayload,channel)");
must(core,'CE API登录超过10秒未响应');
must(whppAuthority,"ROUTE='/api/v132/whpp-fast-summary'");
must(whppAuthority,'V248-AFTER-ACCESS-BEFORE-LEGACY');
must(whppAuthority,'const result=previousUse.apply(this,args)');
must(whppAuthority,'previousUse.call(this,v248WhppAuthority)');
must(whppAuthority,'2026-08-20-v246-whpp-stable-refresh-v1');
must(sidecar,"V249_AUTH_PATH_VERSION='2026-08-20-v249-direct-sidecar-auth-v1'");
must(sidecar,'persistent read-only auth DB');
must(sidecar,"authMode:'V249_DIRECT_AUTH_SIDECAR'");
must(directLogin,'账号校验由独立认证进程处理，不再受看板数据库任务阻塞');
must(directLogin,"/api/v213/local-auth/login");
must(cookieFirst,"V251_COOKIE_FIRST_LOGIN_VERSION='2026-08-21-v251-cookie-first-login-v1'");
must(cookieFirst,'账号已验证，浏览器会话已建立，正在进入系统');
must(cookieFirst,"location.replace('/?v251='+Date.now())");
must(cookieFirst,"/api/v246/internal-auth/login");
must(cookieFirst,"/api/v223/fast-auth/accept");
must(settingsRecovery,"SHELL='/api/v252/settings-shell'");
must(settingsRecovery,"CE_LOGIN='/api/v252/ce-login'");
must(settingsRecovery,'settings/CE connector no longer wait for dashboard bootstrap');
must(settingsClient,'系统设置已就绪 · 看板数据后台加载，不影响设置');
must(settingsClient,"/api/v252/ce-login");
must(client,'正在登录CE系统');
must(client,'/api/v132/whpp-fast-summary');
must(localTruth,'business data is diagnostic-only and may be reimported');
must(dataAudit,'WARNING_REIMPORT_ALLOWED');
must(dataAudit,'DatabaseSync(dbFile,{readOnly:true})');
must(purge,"retainedScope:['数据库结构和迁移','用户、角色与系统设置'");
must(restartE2E,'V246-DATA-DIAGNOSTIC-ONLY');
must(restartE2E,'V246-CORE-SERVICES-FIRST');
must(restartE2E,'/api/v246/internal-auth/login');
must(restartE2E,'V246_SAME_ORIGIN_AUTH_PROXY');

for(const file of [
  'bootstrap.js','server.js','src/v213AuthSidecar.js','src/v246CoreAvailabilityPatch.js','src/v248WhppAuthorityPatch.js','src/v249LoginReliabilityPatch.js','src/v251CookieFirstLoginPatch.js','src/v252SettingsRecoveryPatch.js','public/v246-core-usability.js','public/v252-settings-recovery.js',
  'src/v46ColdStartIndexPatch.js','scripts/v225-local-db-truth-smoke.mjs','scripts/v233-seven-board-local-truth-smoke.mjs',
  'scripts/v234-restart-persistence-e2e.mjs','scripts/v238-local-production-readonly-gate.mjs','scripts/v249-direct-auth-e2e.mjs',
  'test/v237-startup-triplet-health.test.js','test/v246-system-first.test.js','test/v249-direct-auth.test.js','test/v251-cookie-first-login.test.js','test/v252-settings-recovery.test.js'
])run(['--check',file],120000);

run(['--test','test/v252-settings-recovery.test.js'],120000);
run(['--test','test/v251-cookie-first-login.test.js'],120000);
run(['--test','test/v249-direct-auth.test.js'],120000);
run(['--test','test/v246-system-first.test.js'],120000);
run(['--test','test/v211-fast-auth.test.js'],120000);
run(['--test','test/v237-startup-triplet-health.test.js'],120000);
run(['--test','test/v241-readonly-canonical-audit.test.js'],120000);
run(['scripts/v249-direct-auth-e2e.mjs'],180000);
run(['scripts/v225-local-db-truth-smoke.mjs'],120000);
run(['scripts/v233-seven-board-local-truth-smoke.mjs'],120000);
run(['scripts/v234-restart-persistence-e2e.mjs'],300000);
run(['scripts/v235-final-functional-acceptance.cjs'],480000);
run(['scripts/v238-local-production-readonly-gate.mjs'],360000);

console.log('CE_QC_V246_CORE_STARTUP=PASS');
console.log('CE_QC_V249_DIRECT_AUTH_SIDECAR=PASS');
console.log('CE_QC_V251_COOKIE_FIRST_LOGIN=PASS');
console.log('CE_QC_V251_NO_HANDOFF_PRIMARY_PATH=PASS');
console.log('CE_QC_V252_SETTINGS_FAST_PATH=PASS');
console.log('CE_QC_V252_CE_CONNECTOR_FAST_PATH=PASS');
console.log('CE_QC_V246_INTERNAL_LOGIN=PASS');
console.log('CE_QC_V246_CE_API_LOGIN_FEEDBACK=PASS');
console.log('CE_QC_V248_WHPP_ROUTE_AUTHORITY=PASS');
console.log('CE_QC_V246_WHPP_REFRESH=PASS');
console.log('CE_QC_V246_EMPTY_DATA_ALLOWED=PASS');
console.log('CE_QC_V247_RESTART_CONTRACT=PASS');
console.log('CE_QC_V246_FULL_FUNCTIONAL_REGRESSION=PASS');
console.log('CE_QC_V252_SYSTEM_FIRST_ACCEPTANCE=PASS');
