import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const pipeline = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
const whpp = fs.readFileSync(new URL('../src/whppPipeline.js', import.meta.url), 'utf8');

function must(source, re, label) {
  const match = source.match(re);
  assert.ok(match, `missing production source contract: ${label}`);
  return match[0];
}

function clean(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().toUpperCase())
    .filter(Boolean))];
}

function executePool(statements, state, cleanName) {
  const context = { state: structuredClone(state), result: null };
  context[cleanName] = clean;
  vm.createContext(context);
  vm.runInContext(`${statements}\nresult = scanPool;`, context, { timeout: 1000 });
  return Array.from(context.result || []);
}

function executeWhppPool(statements, state) {
  const context = { state: structuredClone(state), cleanCodes: clean, result: null };
  vm.createContext(context);
  vm.runInContext(`${statements}\nresult = activeScanBills;`, context, { timeout: 1000 });
  return Array.from(context.result || []);
}

function batchSizes(values, size) {
  const sizes = [];
  for (let offset = 0; offset < values.length; offset += size) sizes.push(values.slice(offset, offset + size).length);
  return sizes;
}

assert.match(pipeline, /const ORDER_BATCH_SIZE = Number\(process\.env\.ORDER_BATCH_SIZE \|\| 350\);/, 'CCSL/SHOPEE scan owner must default to 350');
assert.match(whpp, /const CONFIRM_BATCH_SIZE = 350;/, 'WHPP independent scan owner must stay at 350');
assert.match(whpp, /trackConcurrency:\s*4/, 'WHPP independent trajectory owner must stay x4');

const ccslStatements = [
  must(pipeline, /const today = cleanBills\(state\.pnhBills \|\| \[\]\);/, 'CCSL today membership'),
  must(pipeline, /const carry = cleanBills\(state\.carryBills \|\| state\.nextCarryBills \|\| \[\]\);/, 'CCSL carry membership'),
  must(pipeline, /const podLocks = new Set\(cleanBills\(state\.podLocks \|\| \[\]\)\);/, 'CCSL POD locks'),
  must(pipeline, /const scanPool = cleanBills\(\[\.\.\.today, \.\.\.carry\]\)\.filter\(wb => !podLocks\.has\(wb\)\);/, 'CCSL rebuilt scanPool')
].join('\n');

const shopeeStart = pipeline.indexOf('async function runShopeePipeline');
assert.ok(shopeeStart > 0, 'SHOPEE production pipeline entry must exist');
const shopeeSource = pipeline.slice(shopeeStart);
const shopeeStatements = [
  must(shopeeSource, /const today = cleanAnyBills\(state\.pnhBills \|\| \[\]\);/, 'SHOPEE today membership'),
  must(shopeeSource, /const carry = cleanAnyBills\(state\.carryBills \|\| state\.nextCarryBills \|\| \[\]\);/, 'SHOPEE carry membership'),
  must(shopeeSource, /const podLocks = new Set\(cleanAnyBills\(state\.podLocks \|\| \[\]\)\);/, 'SHOPEE POD locks'),
  must(shopeeSource, /const scanPool = cleanAnyBills\(\[\.\.\.today, \.\.\.carry\]\)\.filter\(bill => !podLocks\.has\(bill\)\);/, 'SHOPEE rebuilt scanPool')
].join('\n');

const whppStatements = [
  must(whpp, /const today = cleanCodes\(state\.pnhBills \|\| \[\]\);/, 'WHPP today membership'),
  must(whpp, /const carry = cleanCodes\(state\.carryBills \|\| state\.nextCarryBills \|\| \[\]\);/, 'WHPP carry membership'),
  must(whpp, /const allBills = cleanCodes\(\[\.\.\.today, \.\.\.carry\]\);/, 'WHPP rebuilt allBills'),
  must(whpp, /const podLocks = new Set\(cleanCodes\(state\.podLocks \|\| \[\]\)\);/, 'WHPP POD locks'),
  must(whpp, /const lockedPodBills = new Set\(allBills\.filter\(bill => podLocks\.has\(bill\)\)\);/, 'WHPP locked POD members'),
  must(whpp, /const activeScanBills = allBills\.filter\(bill => !lockedPodBills\.has\(bill\)\);/, 'WHPP open scanPool source')
].join('\n');
assert.match(whpp, /state\.scanPool = activeScanBills;/, 'WHPP must publish only non-POD-locked members as scanPool');

const today = Array.from({ length: 700 }, (_, i) => `CE260816${String(i + 1).padStart(6, '0')}`);
const carry = ['CE260815999998', 'CE260815999999'];
const staleState = {
  pnhBills: today,
  carryBills: carry,
  nextCarryBills: [],
  podLocks: [],
  scanPool: []
};

const ccslPool = executePool(ccslStatements, staleState, 'cleanBills');
assert.equal(ccslPool.length, 702, 'CCSL must ignore the empty saved scanPool and rebuild 700 today + 2 carry');
assert.deepEqual(batchSizes(ccslPool, 350), [350, 350, 2], 'CCSL rebuilt pool must preserve 350-ticket boundaries');

const shopeePool = executePool(shopeeStatements, staleState, 'cleanAnyBills');
assert.equal(shopeePool.length, 702, 'SHOPEE must ignore the empty saved scanPool and rebuild 700 today + 2 carry');
assert.deepEqual(batchSizes(shopeePool, 350), [350, 350, 2], 'SHOPEE rebuilt pool must preserve 350-ticket boundaries');

const whppPool = executeWhppPool(whppStatements, staleState);
assert.equal(whppPool.length, 702, 'WHPP must ignore the empty saved scanPool and rebuild 700 today + 2 carry when there are no POD locks');
assert.deepEqual(batchSizes(whppPool, 350), [350, 350, 2], 'WHPP rebuilt open pool must preserve 350-ticket boundaries');

const withPodLock = { ...staleState, podLocks: [today[0]] };
assert.equal(executePool(ccslStatements, withPodLock, 'cleanBills').length, 701, 'CCSL must remove historical POD locks from the rebuilt scanPool');
assert.equal(executePool(shopeeStatements, withPodLock, 'cleanAnyBills').length, 701, 'SHOPEE must remove historical POD locks from the rebuilt scanPool');
assert.equal(executeWhppPool(whppStatements, withPodLock).length, 701, 'WHPP must remove historical POD locks from the rebuilt scanPool and keep them terminal');

console.log('[V371] production-source scanPool runtime smoke passed · actual CCSL/SHOPEE/WHPP source statements rebuild empty saved pools from committed membership · 702 => 350+350+2 without locks · all three owners exclude historical POD locks · WHPP independent owner remains 350 scan / track x4');
