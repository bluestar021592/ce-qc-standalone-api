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
const client=fs.readFileSync('public/v246-core-usability.js','utf8');
const cold=fs.readFileSync('src/v46ColdStartIndexPatch.js','utf8');
const localTruth=fs.readFileSync('scripts/v225-local-db-truth-smoke.mjs','utf8');
const dataAudit=fs.readFileSync('scripts/v238-local-production-readonly-gate.mjs','utf8');
const purge=fs.readFileSync('src/dataPurge.js','utf8');

must(cold,"import './v246CoreAvailabilityPatch.js';");
must(core,"const ready=Boolean(services?.ready)");
must(core,"dataState:'NOT_REQUIRED_FOR_STARTUP'");
must(core,"dataBlocking:false");
must(core,"AUTH_PROXY_PATH='/api/v246/internal-auth/login'");
must(core,"signForChannel(sidecarPayload,channel)");
must(core,"this.get('/api/v132/whpp-fast-summary',v246WhppSummary)");
must(core,'CE API登录超过10秒未响应');
must(client,'正在登录CE系统');
must(client,'/api/v132/whpp-fast-summary');
must(localTruth,'business data is diagnostic-only and may be reimported');
must(dataAudit,'WARNING_REIMPORT_ALLOWED');
must(dataAudit,'DatabaseSync(dbFile,{readOnly:true})');
must(purge,"retainedScope:['数据库结构和迁移','用户、角色与系统设置'");

for(const file of [
  'bootstrap.js','server.js','src/v246CoreAvailabilityPatch.js','public/v246-core-usability.js',
  'src/v46ColdStartIndexPatch.js','scripts/v225-local-db-truth-smoke.mjs',
  'scripts/v233-seven-board-local-truth-smoke.mjs','scripts/v238-local-production-readonly-gate.mjs',
  'test/v246-system-first.test.js'
])run(['--check',file],120000);

run(['--test','test/v246-system-first.test.js'],120000);
run(['--test','test/v211-fast-auth.test.js'],120000);
run(['--test','test/v241-readonly-canonical-audit.test.js'],120000);
run(['scripts/v225-local-db-truth-smoke.mjs'],120000);
run(['scripts/v233-seven-board-local-truth-smoke.mjs'],120000);
run(['scripts/v234-restart-persistence-e2e.mjs'],300000);
run(['scripts/v235-final-functional-acceptance.cjs'],480000);
run(['scripts/v238-local-production-readonly-gate.mjs'],360000);

console.log('CE_QC_V246_CORE_STARTUP=PASS');
console.log('CE_QC_V246_INTERNAL_LOGIN=PASS');
console.log('CE_QC_V246_CE_API_LOGIN_FEEDBACK=PASS');
console.log('CE_QC_V246_WHPP_REFRESH=PASS');
console.log('CE_QC_V246_EMPTY_DATA_ALLOWED=PASS');
console.log('CE_QC_V246_FULL_FUNCTIONAL_REGRESSION=PASS');
console.log('CE_QC_V246_SYSTEM_FIRST_ACCEPTANCE=PASS');
