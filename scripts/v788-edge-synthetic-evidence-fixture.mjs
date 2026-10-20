// CI-ONLY V788 source+sidecar fixture on disposable GitHub Windows runner.
// Never callable on end-user desktop or production. All waybills are fake.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initV788Sidecar,stageV788Batch,inspectV788Sidecar,v788SourceSignature}
  from './v788-whpp-tms-evidence-sidecar.mjs';
const DIR='D:\\CE_QC_V788_验收副本';
const source=path.win32.join(DIR,'ce_qc_monitor.db');
const ledgerFile=path.win32.join(DIR,'V788_WHPP_TMS_逐票证据.sqlite');
const report=path.win32.join(DIR,'V788_WHPP_TMS_逐票证据验收.json');
const sentinel=path.win32.join(DIR,'V788_CI_ONLY_SYNTHETIC_EVIDENCE.txt');
function guard(){
  assert.equal(process.platform,'win32','Windows required');
  assert.equal(process.env.GITHUB_ACTIONS,'true','GitHub CI runner only');
  assert.equal(process.env.NODE_ENV,'test','isolated test mode only');
  assert.ok(fs.existsSync('scripts/v788-real-admin-edge-pilot.mjs'),'pilot checkout required');
}
export function createV788SyntheticEvidence(){
  guard();
  if(fs.existsSync(DIR))throw Error('V788_CI_FIXTURE_PREEXISTING_D_FOLDER_REFUSED');
  fs.mkdirSync(DIR,{recursive:false});
  fs.writeFileSync(sentinel,'SYNTHETIC TEST ONLY -- ephemeral GitHub runner\n');
  const src=new DatabaseSync(source);
  const ledger=new DatabaseSync(ledgerFile);
  try{
    src.exec('CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT)');
    const ins=src.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?)");
    const sources=[
      {date:'2026-07-01',codes:Array.from({length:190},(_,i)=>'CI_FAKE_J'+String(i).padStart(4,'0')),states:new Map()},
      {date:'2026-07-02',codes:Array.from({length:156},(_,i)=>'CI_FAKE_K'+String(i).padStart(4,'0')),states:new Map()}
    ];
    for(const day of sources)for(const code of day.codes)ins.run(day.date,code);
    const signature=v788SourceSignature(sources);
    initV788Sidecar(ledger,signature);
    for(const day of sources){
      const pod=day.date==='2026-07-01'?166:124;
      for(let index=0;index<Math.ceil(day.codes.length/50);index++){
        const codes=day.codes.slice(index*50,(index+1)*50);
        stageV788Batch(ledger,{date:day.date,index,codes,
          rows:codes.map(code=>({
            shipmentCode:code,shipmentStatus:day.codes.indexOf(code)<pod?'60':'81'
          }))});
      }
    }
    const coverage=inspectV788Sidecar(ledger,sources);
    assert.equal(coverage.complete,true);
    assert.equal(coverage.persistedMembers,346);
    assert.equal(coverage.statuses.s60,290);
    assert.equal(coverage.statuses.s81,56);
    fs.writeFileSync(report,JSON.stringify({
      version:'V788_SYNTHETIC_WINDOWS_BROWSER_FIXTURE',
      status:'346_TMS_ROWS_STAGED_NOT_BUSINESS_ACCEPTED',
      sourceMembers:346,sourceSignature:signature,
      isolatedCopyUnchanged:true,coverage
    },null,2));
  }finally{ledger.close();src.close()}
  return {source,ledgerFile,report};
}
export function deleteV788SyntheticEvidence(){
  guard();
  if(!fs.existsSync(sentinel))throw Error('V788_CI_FIXTURE_SENTINEL_MISSING_REFUSE_CLEANUP');
  for(const f of [source,source+'-shm',source+'-wal',ledgerFile,ledgerFile+'-shm',ledgerFile+'-wal',report,sentinel]){
    if(fs.existsSync(f))fs.unlinkSync(f);
  }
  if(fs.readdirSync(DIR).length)throw Error('V788_CI_FIXTURE_UNEXPECTED_FILES_REFUSE_FOLDER_DELETE');
  fs.rmdirSync(DIR);
}
