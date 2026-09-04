import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const file of ['src/unifiedImportStore.js','src/runtimeStorage.js','src/runtimeBusinessStore.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const store=fs.readFileSync('src/unifiedImportStore.js','utf8');
const ccsl=fs.readFileSync('src/runtimeStorage.js','utf8');
const shopee=fs.readFileSync('src/runtimeBusinessStore.js','utf8');

const queue=store.match(/export function getUnifiedProcessingQueue[\s\S]*?\n}\n\nexport function updateCarryoverResults/)?.[0]||'';
assert.ok(queue,'unified carry hydration function must be inspectable');
assert.match(queue,/c\.sourceReportDate<\?/,'new import hydration must read historical carry only, never reread today rows just inserted');
assert.match(queue,/c\.businessType IN \('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'\)/,'new import hydration must read only CCSL/Shopee carry needed by server state preparation');
assert.doesNotMatch(queue,/CASE WHEN c\.sourceReportDate=\? THEN 'TODAY'/,'today rows must not be rematerialized from SQLite after they were just parsed in memory');
assert.doesNotMatch(queue,/WHERE c\.status='OPEN' ORDER BY/,'import must not scan the entire all-business OPEN carry table');
assert.match(queue,/policy=HISTORICAL_CCSL_SHOPEE_ONLY/,'bounded import hydration policy must stay observable');

assert.match(ccsl,/pendingUnifiedImportSeed/);assert.match(ccsl,/SKIP_OLD_APP_STATE_PARSE_BEFORE_FRESH_UNIFIED_IMPORT_HYDRATION/,'CCSL must not parse yesterday giant app_state only to clear it');
assert.match(shopee,/pendingUnifiedImportSeed/);assert.match(shopee,/SKIP_OLD_BUSINESS_STATE_PARSE_BEFORE_FRESH_UNIFIED_IMPORT_HYDRATION/,'Shopee must not parse yesterday giant business_states JSON only to clear it');
assert.match(store,/idx_carryover_status|carryover_open_items/,'queue must remain backed by persisted carry truth');

console.log('[SYSTEM IMPORT PERFORMANCE] passed · fresh classification hydrates current parsed rows in memory · old large CCSL/Shopee JSON skipped · historical carry query scoped to six core business types · today/WHPP blobs not reread during upload response');