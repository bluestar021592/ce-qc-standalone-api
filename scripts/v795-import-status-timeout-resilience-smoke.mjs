import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const a=shell.indexOf('async function loadImport(){');
const b=shell.indexOf('function dateSourceText(data={})',a);
assert.ok(a>=0&&b>a,'import handler exists in current public shell');
const source=shell.slice(a,b);
assert.match(source,/\/api\/import\/unified-latest\?compact=1/,
  'latest imported date and member counts must avoid expensive carryover summary');
const server=fs.readFileSync('server.js','utf8');
const store=fs.readFileSync('src/unifiedImportStore.js','utf8');
assert.match(server,/getLatestUnifiedImport\(\{ includeCarryover: req\.query\.compact !== '1' \}\)/);
assert.match(store,/export function getLatestUnifiedImport\(\{ includeCarryover = true \} = \{\}\)/);
assert.match(source,/Promise\.allSettled\(/,
  'one read-only API timeout must not discard a successful independent import read');
assert.doesNotMatch(source,/Promise\.all\(\[json\('\/api\/import\/unified-latest'/,
  'historical import retrieval must never fail as a coupled Promise.all');
assert.match(source,/if\(tbody&&historyOk\)/,
  'never overwrite visible history when the history endpoint failed');
assert.match(source,/有历史日报·状态待核验/);
assert.match(source,/读取超时·历史状态待核验/);
assert.match(source,/void refreshLiveProgress\(\)\.catch\(\(\)=>\{\}\)/);

const stored={reportDate:'2026-07-12',snapshotId:'SNAP-V795-EXACT',
  classificationCounts:{WHPP:103},snapshotStatus:'IMPORTED'};
const history={rows:[{reportDate:'2026-07-12',snapshotId:'SNAP-V795-EXACT',
  snapshotStatus:'IMPORTED',sourceName:'综合日报',summary:{validUniqueWaybills:13886}}]};
async function scenario({latest,historyResponse}){
  const status={},calls=[],notes=[];
  const rows={children:[],innerHTML:'',
    replaceChildren(){this.children=[]},
    appendChild(child){this.children.push(child)}};
  const ctx={
    Promise,json:async path=>{
      if(path.startsWith('/api/import/unified-latest')){
        if(latest instanceof Error)throw latest;
        return latest;
      }
      if(path.startsWith('/api/unified-history')){
        if(historyResponse instanceof Error)throw historyResponse;
        return historyResponse;
      }
      throw new Error('unexpected endpoint '+path);
    },
    v626LatestImport:null,
    rememberV755ImportCounts:()=>{},
    renderImport:(v)=>{calls.push('renderImport');ctx.v626LatestImport=v;status.v625ImportState='已导入'},
    byId:id=>id==='v625ImportHistory'?rows:null,
    dateTime:v=>v||'—',
    document:{createElement:()=>({children:[],appendChild(x){this.children.push(x)}})},
    setText:(id,value)=>{status[id]=value},
    note:(_id,msg,level)=>notes.push({msg,level}),
    refreshImportCanonicalClassification:async()=>{calls.push('classification')},
    v759VerifyWhppCompletionOnce:async()=>{calls.push('whpp')},
    refreshLiveProgress:async()=>{calls.push('progress')},
    loadOpenPod:async()=>{calls.push('openpod')}
  };
  const load=vm.runInNewContext('('+source.replace(/^async function loadImport/,'async function')+')',ctx);
  await load();
  return {status,notes,rows,calls,latest:ctx.v626LatestImport};
}
const success={ok:true,import:stored};
const savedHistory={ok:true,...history};
let result=await scenario({latest:success,historyResponse:new Error('history timeout')});
assert.equal(result.status.v625ImportState,'已导入');
assert.ok(result.calls.includes('renderImport'));
assert.match(result.notes[0].msg,/历史列表读取超时/);
assert.equal(result.rows.children.length,0);
result=await scenario({latest:new Error('latest timeout'),historyResponse:savedHistory});
assert.equal(result.status.v625ImportState,'有历史日报·状态待核验');
assert.equal(result.status.v626DetectedReportDate,'2026-07-12');
assert.ok(!result.calls.includes('renderImport'),
  'history-only result cannot masquerade as a verified latest import');
result=await scenario({latest:new Error('latest timeout'),historyResponse:new Error('history timeout')});
assert.equal(result.status.v625ImportState,'读取超时·历史状态待核验');
assert.ok(result.calls.includes('progress'),
  'refresh independent progress even if import metadata requests timed out');
result=await scenario({latest:success,historyResponse:savedHistory});
assert.equal(result.status.v625ImportState,'已导入');
assert.equal(result.latest.snapshotStatus,'IMPORTED');
assert.equal(result.rows.children.length,1);
assert.equal(result.notes[0].level,'success');
console.log('[V795] 4 isolated import-read scenarios passed: latest timeout/history timeout/both/everything');
