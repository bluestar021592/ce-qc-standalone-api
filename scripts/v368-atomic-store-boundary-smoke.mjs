import assert from 'node:assert/strict';
import fs from 'node:fs';

const db = fs.readFileSync(new URL('../src/db.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const store = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const business = fs.readFileSync(new URL('../src/businessStore.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const whpp = fs.readFileSync(new URL('../src/whppStore.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const v42 = fs.readFileSync(new URL('../src/v42WhppPatch.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const v366 = fs.readFileSync(new URL('../src/v366AtomicUnifiedImport.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// The production web process must own one module-level DatabaseSync instance.
assert.match(db, /let db = null;/, 'db.js must retain one module-level SQLite singleton');
assert.match(db, /if \(!db\) \{[\s\S]*db = new DatabaseSync\(cfg\.dbFile\);/, 'getDb must create the singleton only when absent');
assert.match(db, /export function getDb\(\) \{[\s\S]*return db;[\s\S]*\}/, 'getDb must return the same singleton instance');
assert.doesNotMatch(store, /new DatabaseSync\(/, 'CCSL store must never open a second SQLite connection');
assert.doesNotMatch(business, /new DatabaseSync\(/, 'SHOPEE store must never open a second SQLite connection');
assert.doesNotMatch(whpp, /new DatabaseSync\(/, 'WHPP store must never open a second SQLite connection');

// Every nested persistence transaction used by the atomic daily-import path must
// remain expressed through db.exec so V366 can absorb BEGIN/COMMIT/ROLLBACK into
// its one outer transaction. Prepared transaction statements would bypass it.
assert.match(store, /function runTransaction\(fn\) \{[\s\S]*const db = getDb\(\);[\s\S]*db\.exec\('BEGIN IMMEDIATE'\);[\s\S]*db\.exec\('COMMIT'\);[\s\S]*db\.exec\('ROLLBACK'\);/, 'CCSL saveAppState transaction must remain V366-interceptable');
assert.match(business, /export function saveBusinessState\([\s\S]*const db = getDb\(\);[\s\S]*db\.exec\('BEGIN IMMEDIATE'\);[\s\S]*db\.exec\('COMMIT'\);[\s\S]*db\.exec\('ROLLBACK'\);/, 'SHOPEE saveBusinessState transaction must remain V366-interceptable');
assert.match(whpp, /export function saveWhppDailyImport\([\s\S]*const db = getDb\(\);[\s\S]*db\.exec\('BEGIN IMMEDIATE'\);[\s\S]*db\.exec\('COMMIT'\);[\s\S]*db\.exec\('ROLLBACK'\);/, 'WHPP daily transaction must remain V366-interceptable');
for (const [label, source] of [['CCSL', store], ['SHOPEE', business], ['WHPP', whpp]]) {
  assert.doesNotMatch(source, /prepare\(\s*['"`]\s*(?:BEGIN|COMMIT|ROLLBACK)\b/i, `${label} store must not bypass V366 with prepared transaction statements`);
}

// WHPP writes its compact current business_state after its legacy inner COMMIT.
// That is safe only because V366 swallows the inner COMMIT while outerActive=true.
const whppDailyStart = whpp.indexOf('export function saveWhppDailyImport');
const whppDailyEnd = whpp.indexOf('export function finalizeWhppState', whppDailyStart);
const whppDaily = whpp.slice(whppDailyStart, whppDailyEnd);
const whppInnerCommit = whppDaily.indexOf("db.exec('COMMIT')");
const whppStateWrite = whppDaily.indexOf('const state = saveWhppState(');
assert.ok(whppInnerCommit >= 0 && whppStateWrite > whppInnerCommit, 'fixture must prove WHPP current-state write occurs after the legacy inner COMMIT');
assert.match(v366, /if \(command === 'COMMIT'\) \{[\s\S]*if \(nestedDepth > 0\) nestedDepth -= 1;[\s\S]*return db;/, 'V366 must swallow inner COMMIT rather than durably committing WHPP early');
assert.match(v366, /originalExec\('COMMIT'\)/, 'V366 outer owner must retain the only durable COMMIT');

// The real daily importer must initialize all three state owners before activating
// the staged unified batch and before returning importCommitted=true.
const handler = v42.slice(v42.indexOf('async function handleUnifiedImportV42'));
const stageAt = handler.indexOf('stageUnifiedCoreImport(coreParsed');
const ccslAt = handler.indexOf('initializeCcslState(');
const shopeeAt = handler.indexOf('initializeShopeeState(');
const whppAt = handler.indexOf('saveWhppDailyImport({');
const activateAt = handler.indexOf('activateUnifiedCoreImport(staged)');
const verifyAt = handler.indexOf('verifyAtomicImportPersistence(');
const commitAckAt = handler.indexOf('importCommitted: true', verifyAt);
assert.ok(stageAt >= 0 && ccslAt > stageAt && shopeeAt > ccslAt && whppAt > shopeeAt, 'daily import must prepare CCSL → SHOPEE → WHPP inside one staged transaction');
assert.ok(activateAt > whppAt && verifyAt > activateAt && commitAckAt > verifyAt, 'VALID activation and persisted verification must precede importCommitted=true');

console.log('[V368] atomic store boundary smoke passed · one DatabaseSync singleton · CCSL/SHOPEE/WHPP nested transactions stay db.exec-interceptable · no prepared transaction bypass · WHPP post-inner-COMMIT state remains under V366 outer transaction · three states precede VALID/verification/ack');
