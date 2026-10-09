import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v780-72-current-'));
process.env.DATA_DIR=dir;
process.env.DB_FILE=path.join(dir,'test.sqlite');
process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
process.env.CE_QC_NO_BACKUP_MODE='1';
const {getDb,closeDb}=await import('../src/db.js');
const {
 getShopCodeMap,getShopAliasMap,getShopCodeSummary,
 getCompleteShopActivationStatus,activateSavedCompleteShopList,detectShopInfo
}=await import('../src/shopCodes.js');
const {analyzeStoreFlow}=await import('../src/storeFlow.js');
const {executeDirectDataPurge,DIRECT_PURGE_PHRASE}=await import('../src/directDataPurge.js');

try{
  const db=getDb();
  const original=getShopCodeMap();
  assert.ok(original.has('CP000457'),'fixture must start with legacy 95-code baseline');
  const baselineCount=original.size;
  const src='shop CE code(1).xlsx',now=new Date().toISOString();
  const insert=db.prepare(`INSERT INTO shop_cp_codes(shopCode,shopName,sourceFile,createdAt,updatedAt)
    VALUES(?,?,?,?,?) ON CONFLICT(shopCode) DO UPDATE SET
    shopName=excluded.shopName,sourceFile=excluded.sourceFile,updatedAt=excluded.updatedAt`);
  db.exec('BEGIN IMMEDIATE');
  try{
    for(let i=1;i<=72;i++){
      const code='CP'+String(990000+i).padStart(6,'0');
      insert.run(code,'Current Shop '+String(i).padStart(3,'0'),src,now,now);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const candidate=getCompleteShopActivationStatus();
  assert.equal(candidate.candidateCount,72,'must identify exact saved 72-code workbook without uploading again');
  assert.equal(candidate.candidateSource,src);
  assert.equal(candidate.active,false,'legacy mode must not silently activate before explicit admin action');
  assert.equal(candidate.readyToActivate,true);
  assert.throws(()=>activateSavedCompleteShopList({expectedCount:73,sourceFile:src}),/COMPLETE_SHOP_LIST_NOT_72/);
  assert.throws(()=>activateSavedCompleteShopList({sourceFile:'different.xlsx'}),/COMPLETE_SHOP_SOURCE_CHANGED/);
  const activated=activateSavedCompleteShopList({sourceFile:src,expectedCount:72});
  assert.equal(activated.activeCount,72);
  assert.equal(activated.historyPreserved,true);
  const current=getShopCodeMap();
  assert.equal(current.size,72,'union with built-in 95 codes forbidden after activation');
  assert.equal(current.get('CP990001'),'Current Shop 001');
  assert.equal(current.has('CP000457'),false,'retired store CP must never appear as current');
  const alias=getShopAliasMap();
  assert.equal(alias.get('CURRENT SHOP 001')?.code,'CP990001','current canonical name must resolve');
  assert.equal(alias.has('VENG SRENG CO-SHOP'),false,'retired store aliases must never resolve');
  const event=(node)=>({eventCode:'INBOUND',eventTime:'2026-10-09 10:00:00',trackingEventDescZh:'到达门店【'+node+'】',eventShop:node});
  const live=analyzeStoreFlow({shipmentCode:'LIVE',events:[event('CP990001')],reportDate:'2026-10-09'});
  assert.equal(live.shopState,'SHOP_ARRIVED_CURRENT','current CP inbound is a valid store arrival');
  assert.equal(live.currentShopCode,'CP990001');
  assert.equal(analyzeStoreFlow({shipmentCode:'OLD',events:[event('CP000457')],reportDate:'2026-10-09'}).shopState,'',
    'old CP inbound must never count as current store arrival');
  assert.equal(analyzeStoreFlow({shipmentCode:'OLDNAME',events:[event('Veng Sreng Co-Shop')],reportDate:'2026-10-09'}).shopState,'',
    'old name-only inbound must never count as current store arrival');
  assert.equal(analyzeStoreFlow({shipmentCode:'NEWNAME',events:[event('Current Shop 001')],reportDate:'2026-10-09'}).currentShopCode,'CP990001',
    'current name-only inbound can match the approved canonical name');
  const old=detectShopInfo({events:[event('CP000457')]});
  assert.equal(old.isShop,false);
  assert.equal(old.unknownShopCode,'CP000457','legacy code remains explicit unmatched evidence');
  assert.equal(getShopCodeSummary().count,72);
  assert.equal(getShopCodeSummary().activeMode,'COMPLETE_72');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shop_active_code_set_history').get().n,1);
  assert.ok(db.prepare('SELECT 1 AS ok FROM shop_cp_codes WHERE shopCode=?').get('CP000457'),
    'historical whitelist remains stored for audit, not active classification');
  // A second scan of the SAME verified 72-code workbook must be repeatable.
  const repeat=activateSavedCompleteShopList({sourceFile:src,expectedCount:72});
  assert.equal(repeat.activeCount,72);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shop_active_code_set_history').get().n,2);
  const purged=await executeDirectDataPurge({phrase:DIRECT_PURGE_PHRASE,user:{username:'fixture-admin'}});
  assert.equal(purged.ok,true);
  assert.equal(getShopCodeMap().size,72,'72-code active configuration must survive business-data purge');
  assert.equal(getCompleteShopActivationStatus().active,true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shop_active_code_set_history').get().n,2,
    'historical whitelist activations must survive business purge');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shop_cp_codes WHERE sourceFile=?').get(src).n,72,
    'all approved code names persist across business purge');
  console.log('[V780 COMPLETE 72 CP] existing saved workbook 72 verified, explicit admin activation, old CP and old aliases excluded, live inbound and name-only inbound confirmed, past whitelist and history preserved through direct business purge PASS; legacyBaseline='+baselineCount);
}finally{
  try{closeDb()}catch{}
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
