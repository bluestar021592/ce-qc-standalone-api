import fs from 'node:fs';
import assert from 'node:assert/strict';

const store=fs.readFileSync('src/businessStore.js','utf8');

assert.match(store,/function persistedBusinessPodFlag\(row = \{\}\)/,'canonical SQLite POD persistence helper missing');
assert.match(store,/state==='POD'/,'SQLite POD persistence must accept canonical POD state');
assert.match(store,/String\(row\.orderStatus \|\| ''\)\.trim\(\)==='85'/,'SQLite POD persistence must accept orderStatus 85');
assert.match(store,/row\.是否POD==='是'/,'SQLite POD persistence must retain explicit POD marker');
assert.match(store,/mirrorRows\(db, 'business_scan_results',[\s\S]*persistedBusinessPodFlag\(row\)/,'scan-result persistence must use canonical POD flag');
assert.match(store,/finalStmt\.run\(type, billOf\(row\), date, persistedBusinessPodFlag\(row\)/,'final-row persistence must use canonical POD flag');
assert.doesNotMatch(store,/Number\(row\.是否POD === '是'\)/,'lossy explicit-marker-only POD persistence must be retired');
console.log('[V675] dashboard-equivalent POD truth persists to scan/final SQLite rows');
