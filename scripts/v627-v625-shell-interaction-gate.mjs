import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','v625-shell.css'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

const requiredRoutes=['/','/ce','/ceaf','/tbkh','/ali1688','/whpp','/shopeecn','/shopeevn','/import','/tracking','/exceptions','/reports','/settings','/logs','/data-management'];
for(const route of requiredRoutes){
  const href=route==='/'?'href="/?auth=v625"':`href="${route}?auth=v625"`;
  assert.ok(html.includes(href),`missing native navigation anchor: ${route}`);
}

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const dupes=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
assert.deepEqual(dupes,[],'duplicate DOM ids can break click/data binding: '+dupes.join(', '));

assert.doesNotMatch(js,/\bpreventDefault\s*\(/,'V625/V626 runtime must not globally cancel native navigation/clicks');
assert.doesNotMatch(css,/pointer-events\s*:\s*none/i,'V625/V626 shell must not disable pointer input');
assert.doesNotMatch(html+js,/v569-final-interaction-owner|v573-head-interaction-bridge|v580-visible-shell-recovery/i,'retired interaction-owner assets must not be mounted by the new shell');
assert.match(server,/V602_RETIRED_INTERACTION_ASSET[\s\S]*no-op/,'server must keep retired interaction assets inert');

const bindings=[
  ['v625ImportButton','doImport'],
  ['v625RunStart',"runTask('start')"],
  ['v625RunResume',"runTask('resume')"],
  ['v758WhppReadOnlyDiagnostic','runV758WhppReadOnlyDiagnostic'],
  ['v761FamilyRecoveryDiagnostic','v761DiagnoseFamilyRecovery'],
  ['v758ReloadUsers','loadSettingsUsers'],
  ['v626RefreshOpenPod','refreshOpenPodNow'],
  ['v626ImportRefreshOpen','refreshOpenPodNow'],
  ['v625TrackSearch','queryTrack'],
  ['v625ExceptionSearch','loadExceptions'],
  ['v625GenerateReport','generateReport'],
  ['v625BackupNow','backupNow'],
  ['v626BackupNowTop','backupNow'],
  ['v626ClearAllData','clearAllBusinessData']
];
for(const [id,handler] of bindings){
  assert.ok(html.includes(`id="${id}"`),`missing clickable control: ${id}`);
  assert.ok(js.includes(`byId('${id}')`) && js.includes(handler),`missing runtime binding: ${id} -> ${handler}`);
}

for(const tab of ['clear','backup','storage']){
  assert.ok(html.includes(`data-data-tab="${tab}"`),`missing data-management tab: ${tab}`);
}
assert.match(js,/qa\('#v626DataTabs \[data-data-tab\]'\)[\s\S]*addEventListener\('click'/,'data-management tabs must bind click handlers');

const apiContracts=[
  '/api/admin/data-purge/direct',
  '/api/admin/data-purge/direct/status',
  '/api/admin/backup-now',
  '/api/backups'
];
for(const endpoint of apiContracts){
  assert.ok(js.includes(endpoint),`front-end missing API contract: ${endpoint}`);
  assert.ok(server.includes(endpoint.split('?')[0]),`server missing API route: ${endpoint}`);
}

for(const id of ['v626ReturnWHPP','v626ReturnRateWHPP','v626ReturnSHOPEECN','v626ReturnRateSHOPEECN','v626ReturnSHOPEEVN','v626ReturnRateSHOPEEVN']){
  assert.ok(html.includes(`id="${id}"`),`missing return metric UI: ${id}`);
}
assert.match(js,/for\(const type of \['WHPP','SHOPEECN','SHOPEEVN'\]\)[\s\S]*setText\('v626Return'\+type[\s\S]*setText\('v626ReturnRate'\+type/,'return metrics must bind WHPP/CN/VN through the shared runtime loop');

for(const id of ['v626ProcessReportDate','v626ProcessFile','v626StageParse','v626StageClassify','v626StageScan','v626StageTrack','v626StageDone','v626ProcessBar','v626LiveLog']){
  assert.ok(html.includes(`id="${id}"`),`missing live processing UI: ${id}`);
  assert.ok(js.includes(id),`missing live processing runtime binding: ${id}`);
}

assert.match(html,/WHPP本土看板/,'WHPP must remain visible in native navigation');
assert.match(html,/data-card="WHPP"/,'WHPP must remain visible in home overview');
assert.match(js,/refreshOpenPodNow[\s\S]*\/api\//,'unfinished POD refresh must invoke live API work');
assert.match(js,/json\('\/api\/selected-date-truth\?reportDate='\+encodeURIComponent\(date\),20000\)/,'WHPP diagnostic must use same-origin authenticated read-only endpoint');
assert.match(js,/terminalEvidenceCoverage/,'WHPP diagnostic must show actual scan and final evidence coverage');
assert.match(js,/status===401\?'登录会话失效/,'account management must distinguish session expiry from permission failure');
assert.match(js,/status===403\?'当前会话没有管理员权限/,'account management must distinguish actual role failure');
assert.doesNotMatch(js,/需要管理员权限或读取失败/,'generic account error must be removed');
assert.match(html,/id="v758WhppDiagnosticResult"/,'WHPP diagnostic must render on the already-authenticated import page');
assert.match(js,/let settingsUsers=\[\];/,'account-list state must be defined before loadSettingsUsers writes it');
assert.match(js,/settingsUsers=Array\.isArray\(r\.rows\)\?r\.rows:\[\]/,'successful admin read must keep an array of users');
assert.match(server,/app\.get\('\/api\/whpp\/completion-proof'/,'lightweight WHPP completion read must have its own protected same-origin endpoint');
assert.match(server,/snapshotId:String\(batch\.snapshotId\),whppCompletion:persistentWhppCompletionTruth\(getDb\(\),reportDate\)/,'completion proof must be pinned to real selected-date immutable snapshot');
assert.match(js,/json\('\/api\/whpp\/completion-proof\?reportDate='/,'WHPP selected-date proof must use the lightweight protected endpoint');
assert.match(js,/WHPP完成状态核验中，请勿重复扫描/,'unavailable WHPP progress must not encourage duplicate scanning');



assert.match(server,/app\.get\('\/api\/family-recovery-proof'/,'safe read-only CCSL+SHOPEE recovery proof must be same-origin and protected');
assert.match(server,/group\.currentDate!==date/,'family first start must not run for a different daily-report date');
assert.match(server,/!lock\?\.runId&&scanCount===0&&finalCount===0&&trackCount===0/,'first start requires no run, no scan, no final and no archived trajectory');
assert.match(server,/evidenceReadable/,'read-error must fail closed instead of admitting new scan');
assert.match(js,/response\?\.snapshotId\|\|'?'/,'recovery proof must bind immutable snapshot context');
assert.match(html,/id="v761FamilyRecoveryResult"/,'CCSL/SHOPEE read-only diagnosis must be visible in authenticated import view');

console.log('[V761/V759/V627] fixed account-list declaration, lightweight selected-date WHPP proof, and fail-safe progress UI · shell interaction passed · same-origin WHPP diagnostic wired · admin user errors reveal HTTP status · navigation and data-management unchanged');
