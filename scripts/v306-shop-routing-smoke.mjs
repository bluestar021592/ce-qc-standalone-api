import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  BUILTIN_SHOP_WHITELIST_VERSION,
  BUILTIN_SHOP_WHITELIST_SOURCE_SHA256,
  BUILTIN_SHOP_ALIAS_COUNT,
  BUILTIN_SHOP_STORES
} from '../src/shopWhitelistBuiltin.js';
import {
  LATEST_SHOP_STORES,
  latestShopCodeMap,
  latestShopAliasMap,
  normalizeShopAlias
} from '../src/shopWhitelist.js';
import { detectShopInfo, SHOP_CODE_RUNTIME_VERSION } from '../src/shopCodes.js';

for (const file of ['src/shopWhitelistBuiltin.js','src/shopWhitelist.js','src/shopCodes.js','src/storeFlow.js','src/trajectoryFacts.js']) {
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

const SOURCE_SHA='6a6f634a2f12de7df7218b19d15c504e82088ecfb91c2d170e77a7eb66989e4c';
assert.equal(BUILTIN_SHOP_WHITELIST_SOURCE_SHA256,SOURCE_SHA,'V306 must remain bound to the user authoritative 95-store workbook');
assert.equal(BUILTIN_SHOP_STORES.length,95,'authoritative workbook must contain 95 store codes');
assert.equal(new Set(BUILTIN_SHOP_STORES.map(row=>row.shop_code)).size,95,'all 95 store codes must be unique');
assert.equal(BUILTIN_SHOP_ALIAS_COUNT,26,'all 26 alternate names from the authoritative workbook must be retained');
assert.match(BUILTIN_SHOP_WHITELIST_VERSION,/95-ALIASES/,'V306 alias-aware whitelist version must be active');
assert.match(SHOP_CODE_RUNTIME_VERSION,/v306-authoritative-code-name-alias/,'V306 runtime shop owner must be active');
assert.equal(LATEST_SHOP_STORES.length,95,'signed/builtin execution set must still expose all 95 stores');

const codeMap=latestShopCodeMap();
const aliasMap=latestShopAliasMap();
const aliasCode=name=>aliasMap.get(normalizeShopAlias(name))?.code||'';
assert.equal(aliasCode('Lucky 168 (oppo) phone shop'),'CP000540');
assert.equal(aliasCode('Borey New world Chhouk Va I'),'CP000586');
assert.equal(aliasCode('Phsa Champuvoan Co-shop'),'CP000583');
assert.equal(aliasCode('KSV-PT Shop'),'PNH033');
assert.equal(aliasCode('SHV-PT'),'PV042');

const byAlias=detectShopInfo({
  events:[{eventTime:'2026-08-25 10:00:00',trackingEventDescZh:'货物到达网点【Lucky 168 (oppo) phone shop】'}],
  shopCodeMap:codeMap,
  shopAliasMap:aliasMap
});
assert.equal(byAlias.isShop,true,'a name-only trajectory node from the authoritative workbook must resolve as a store');
assert.equal(byAlias.shopCode,'CP000540');
assert.equal(byAlias.shopName,codeMap.get('CP000540'));
assert.equal(byAlias.shopMatchSource,'NAME_ALIAS');
assert.equal(byAlias.shopStatus,'门店入库');

const byCode=detectShopInfo({
  events:[{eventTime:'2026-08-25 11:00:00',trackingEventDescZh:'货物到达网点【CP000583】'}],
  shopCodeMap:codeMap,
  shopAliasMap:aliasMap
});
assert.equal(byCode.isShop,true);
assert.equal(byCode.shopCode,'CP000583');
assert.equal(byCode.shopMatchSource,'CODE','structured code must remain stronger than display-name matching');

const storeFlow=fs.readFileSync(new URL('../src/storeFlow.js',import.meta.url),'utf8');
const trajectory=fs.readFileSync(new URL('../src/trajectoryFacts.js',import.meta.url),'utf8');
const shopeeV30=fs.readFileSync(new URL('../src/shopeeAnalyzerV30.js',import.meta.url),'utf8');
const analyzerV30=fs.readFileSync(new URL('../src/analyzerV30.js',import.meta.url),'utf8');
assert.match(storeFlow,/getShopAliasMap/,'all board store-flow analysis must have access to authoritative aliases');
assert.match(storeFlow,/detectShopInfo/,'store-flow analysis must resolve code-less authoritative store names');
assert.match(storeFlow,/AUTHORITATIVE_NAME_ALIAS_INBOUND/,'name-only inbound store evidence must remain auditable');
assert.match(storeFlow,/AUTHORITATIVE_NAME_ALIAS_OUTBOUND/,'name-only outbound store evidence must remain auditable');
assert.match(trajectory,/analyzeStoreFlow/,'shared trajectory facts must feed the common store-flow engine');
assert.match(trajectory,/detectShopInfo/,'shared trajectory facts must expose current store identity');
assert.match(shopeeV30,/buildTrajectoryFacts/,'SHOPEE CN\/VN must use the same trajectory fact layer');
assert.match(analyzerV30,/buildTrajectoryFacts/,'CE\/CEAF\/TBKH\/ALI1688 must use the same trajectory fact layer');

assert.doesNotMatch(storeFlow,/SHOPEECN|SHOPEEVN|TBKH|ALI1688|CEAF|businessType\s*=/,'store recognition must never reclassify a shipment into a business board');

execFileSync(process.execPath,['scripts/v307-exact-daily-home-smoke.cjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v308-dashboard-performance-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v309-ui-integrity-smoke.cjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v310-ui-smoke.cjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v311-shopee-recovery-smoke.cjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v314-shopee-throughput-smoke.mjs'],{stdio:'inherit'});
for (const file of ['src/trackBatching.js','src/v314ModuleRedirectPatch.js','src/v315OperationalDataRefreshPatch.js','src/v316BatchPolicyPreload.js','scripts/v316-ccsl-no-freeze-smoke.mjs','src/v317CcslRecoveryPolicy.js','src/v317CcslIncompleteRecoveryPatch.js','public/v317-ccsl-recovery-owner.js','scripts/v317-ccsl-restart-recovery-smoke.mjs','public/v318-single-sidebar-owner.js','scripts/v318-single-sidebar-smoke.cjs']) {
  execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
}
execFileSync(process.execPath,['scripts/v316-ccsl-no-freeze-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v317-ccsl-restart-recovery-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v318-single-sidebar-smoke.cjs'],{stdio:'inherit'});
console.log('[V306/V307/V308/V309/V310/V311/V314/V315/V316/V317/V318] authoritative routing + exact daily home + nonblocking dashboard + recovery + bounded throughput + CCSL hard no-freeze + restart recovery + single-sidebar integrity gates passed');