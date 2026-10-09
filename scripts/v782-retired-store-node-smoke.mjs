import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v782-node-guard-'));
process.env.DATA_DIR=dir;
process.env.DB_FILE=path.join(dir,'track.sqlite');
const {detectShopInfo}=await import('../src/shopCodes.js');
const {analyzeShipment}=await import('../src/analyzer.js');
const {closeDb}=await import('../src/db.js');
try{
  const map=new Map([['CP000580','Phone Shop 580'],['CP990001','Current Shop 001']]);
  const aliases=new Map([['PHONE SHOP 580',{code:'CP000580',name:'Phone Shop 580'}],
    ['CURRENT SHOP 001',{code:'CP990001',name:'Current Shop 001'}]]);
  function inbound(target) {
    return {eventCode:'INBOUND',eventTime:'2026-08-08 10:00:00',
      trackingEventDescZh:'货物到达网点【'+target+'】'};
  }
  const short=detectShopInfo({events:[inbound('CE:580')],shopCodeMap:map,shopAliasMap:aliases});
  assert.equal(short.isShop,false,'CE:580 special node must never fuzzy match a longer 580 shop alias');
  const shorter=detectShopInfo({events:[inbound('Shop 580')],shopCodeMap:map,shopAliasMap:aliases});
  assert.equal(shorter.isShop,false,'a shortened node must not reverse match an arbitrary longer alias');
  const direct=detectShopInfo({events:[inbound('CP000580')],shopCodeMap:map,shopAliasMap:aliases});
  assert.equal(direct.isShop,true,'valid explicit CP code still matches normally');
  assert.equal(direct.shopCode,'CP000580');
  const name=detectShopInfo({events:[inbound('Phone Shop 580')],shopCodeMap:map,shopAliasMap:aliases});
  assert.equal(name.isShop,true,'full canonical shop name still matches');
  const verbose=detectShopInfo({events:[inbound('Phone Shop 580 （到达门店）')],shopCodeMap:map,shopAliasMap:aliases});
  assert.equal(verbose.isShop,true,'legitimate longer description can still contain the full shop name');
  const bill='CCV782580PENDING';
  const row=analyzeShipment({waybill:bill,scanRow:{shipmentCode:bill,orderStatus:'70'},reportDate:'2026-08-09',
    events:[
      {shipmentCode:bill,eventCode:'26',eventTime:'2026-08-08 10:00:00',trackingEventDescZh:'货物到达网点【CE:580】'},
      {shipmentCode:bill,eventCode:'150',eventTime:'2026-08-09 10:00:00',trackingEventDescZh:'最新Pending'}
    ]});
  assert.equal(row.currentState,'PENDING','historical CE:580 must not turn a later ordinary Pending into SHOP_PENDING');
  assert.notEqual(row.primaryCategory,'CCSL580_RETENTION','historical 580 must not override latest Pending');
  console.log('[V782 SHOP 580 GUARD] old 580 node and abbreviated alias excluded; valid CP/full-name arrivals retained; later Pending remains PENDING PASS');
}finally{
  try{closeDb()}catch{}
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
