import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('public/app.js', 'utf8');
const dashboard = fs.readFileSync('public/dashboard-v18.js', 'utf8');

test('CEAF has an independent navigation route and business identity', () => {
  assert.match(app, /\['ceaf','CEAF空运看板','package','\/ceaf'\]/);
  assert.match(app, /'\/ceaf':'ceaf'/);
  assert.match(app, /ceaf:'CEAF'/);
  assert.match(app, /ceaf: 'CEAF空运看板'/);
});

test('all six source businesses participate in UI snapshot selection and range dashboards', () => {
  assert.match(app, /const types = \['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'\];/);
  assert.match(app, /const ccslTypes = types\.slice\(0, 4\);\s*const shopeeTypes = types\.slice\(4\);/);
  assert.match(app, /\['ce', 'ceaf', 'tbkh', 'ali1688'\]\.includes\(currentPage\)/);
  assert.match(app, /const ccslPages = \['ce', 'ceaf', 'tbkh', 'ali1688'\];/);
});

test('unified import result and home cards expose CEAF count', () => {
  assert.match(app, /CEAF空运 \$\{result\.classificationCounts\.CEAF \|\| 0\}/);
  assert.match(app, /\['CEAF','ceaf'\]/);
  assert.match(app, /\['ceaf', 'CEAF空运', useSingleDayImportCounts \? Number\(importedCounts\.CEAF \|\| 0\) : rangeBusinessCount\('CEAF'\), 'blue'\]/);
  assert.match(app, /六业务分类/);
  assert.match(app, /正在启动六业务处理/);
});

test('CEAF export is allowed and CCSL home scope text includes air board', () => {
  assert.match(app, /\['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'\]\.includes\(type\)/);
  assert.match(dashboard, /CE \+ CEAF空运 \+ TBKH \+ ALI1688/);
});
