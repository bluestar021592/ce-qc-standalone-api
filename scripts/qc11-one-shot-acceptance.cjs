const fs=require('fs');
const {spawnSync}=require('child_process');

const read=p=>fs.readFileSync(p,'utf8');
const must=(src,token,label=token)=>{if(!src.includes(token))throw new Error(`QC11 missing ${label}`);};
const forbid=(src,token,label=token)=>{if(src.includes(token))throw new Error(`QC11 forbidden ${label}`);};
function run(args,timeout=240000){
  const result=spawnSync(process.execPath,args,{cwd:process.cwd(),env:process.env,stdio:'inherit',timeout});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`QC11 command failed (${result.status}): node ${args.join(' ')}`);
}

const access=read('src/accessControl.js');
const authPause=read('src/v41AuthPausePatch.js');
const cold=read('src/v46ColdStartIndexPatch.js');
const launcher=read('Start_CE_QC.ps1');
const app=read('public/app.js');
const whppShell=read('src/v44WhppUiPatch.js');
const integrityUi=read('public/v203-dashboard-integrity.js');
const packageJson=read('package.json');

must(access,'/api/internal-auth/bootstrap','direct internal bootstrap');
must(access,'/api/internal-auth/(?:bootstrap|login|logout|change-password)','direct internal auth paths');
must(access,'ce_internal_session','host session cookie');
must(access,'loginInternalUser','direct login verifier');
forbid(authPause,'v209LoginReliabilityPatch','V209 auth bridge import');
must(cold,"import './v227LocalHealthProbePatch.js'",'loopback health only');
for(const retired of ['v221BootstrapRecoveryPatch','v225AuthBootstrapGuardPatch','v232LiveDataHealthGatePatch','v209LoginReliabilityPatch','v213AuthSidecar'])forbid(cold,retired,retired);
must(launcher,'$HealthUrl = "$LocalUrl/api/health"','exact launcher health endpoint');
must(launcher,"$status -eq 200",'exact HTTP 200 health');
forbid(launcher,'$status -ge 200 -and $status -lt 500','old 200-499 readiness');

for(const token of ['首页总看板','CE看板','CEAF空运看板','TBKH看板','ALI1688看板','SHOPEE CN看板','SHOPEE VN看板','数据导入','轨迹查询','异常明细','报表导出','系统设置'])must(app,token,`UI ${token}`);
must(app,"let exportPeriodType = 'daily'",'export period selector');
must(app,'dashboardPeriodMode','day/week/month/custom dashboard range state');
must(app,'reportDateManualCorrection','report-date manual correction');
must(app,'renderHistoryOptions','uploaded report-date history');

must(whppShell,'WHPP','WHPP shell');
for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])must(integrityUi,`'${type}'`,`${type} integrity UI`);
must(integrityUi,'真实1/2/3派 POD','real attempt panel');
must(integrityUi,'只按真实派送周期计算，不再用“经过几天”猜1派/2派/3派','no elapsed-day attempt guessing');
must(integrityUi,'派次证据不足','unknown attempt evidence bucket');

must(packageJson,'scripts/qc11-one-shot-acceptance.cjs','final acceptance wiring');

const syntax=[
  'bootstrap.js','server.js','src/accessControl.js','src/v41AuthPausePatch.js','src/v46ColdStartIndexPatch.js','src/v227LocalHealthProbePatch.js',
  'src/shopeeAnalyzerV33.js','src/v191ShopeeTruth.js','src/v200Metrics.js','src/v200ReferenceWorkbook.js','src/v200TemplateDashboardExporter.js',
  'src/v202DeliveryTruth.js','src/v203DashboardIntegrityPatch.js','src/v205CanonicalTruth.js','src/v205ExportTruth.js','src/v205IntegrityAuditPatch.js',
  'src/v202CarryTrackingCenterPatch.js','src/v84AsyncExportPatch.js','src/v193ExportSidecar.js','src/v44WhppUiPatch.js',
  'public/v203-dashboard-integrity.js','public/v202-carry-tracking-center.js','public/v194-export-token-ui.js','scripts/v225-local-db-truth-smoke.mjs','scripts/qc11-golden-runtime-e2e.mjs'
];
for(const file of syntax)run(['--check',file],60000);

for(const script of [
  'scripts/v196-exceljs-streaming-view-smoke.cjs',
  'scripts/v197-parity-metrics-smoke.js',
  'scripts/v197-parity-workbook-smoke.js',
  'scripts/v198-strict-parity-smoke.js',
  'scripts/v198-all-business-owner-smoke.cjs',
  'scripts/v199-dashboard-metric-smoke.js',
  'scripts/v200-reference-template-smoke.js',
  'scripts/v200-reference-workbook-smoke.js',
  'scripts/v202-delivery-truth-smoke.js',
  'scripts/v205-canonical-integrity-smoke.cjs',
  'scripts/golive-runtime-gate.cjs'
])run([script],180000);

run(['--test','--test-reporter=tap',
  'test/v239-current-contract-reconciliation.test.js',
  'test/v191-shopee-cross-day-truth.test.js',
  'test/v9-special-nodes.test.js',
  'test/v30-scan-track-code-separation.test.js',
  'test/v30-general-track-codes.test.js',
  'test/v27-dashboard-interaction.test.js',
  'test/v92-whpp-terminal-authority.test.js',
  'test/v87-whpp-large-range-export.test.js',
  'test/v88-export-job-resume.test.js',
  'test/whpp-shop-metrics-parity.test.js'
],300000);

run(['scripts/qc11-golden-runtime-e2e.mjs'],120000);

console.log('CE_QC_QC11_GOLDEN_SHELL=PASS');
console.log('CE_QC_QC11_SEVEN_BUSINESS_WHPP=PASS');
console.log('CE_QC_QC11_REAL_ATTEMPT_TRUTH=PASS');
console.log('CE_QC_QC11_PENDING_SPECIAL_RULES=PASS');
console.log('CE_QC_QC11_EXPORT_PARITY=PASS');
console.log('CE_QC_QC11_DIRECT_LOGIN_RUNTIME=PASS');
console.log('CE_QC_QC11_ONE_SHOT_ACCEPTANCE=PASS');
