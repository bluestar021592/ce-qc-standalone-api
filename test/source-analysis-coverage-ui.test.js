import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('public/app.js', 'utf8');

test('range business cards prefer immutable source totals across all seven businesses', () => {
  assert.match(app, /const sourceTotal = state\.sourceTotal \?\? state\.dashboard\?\.sourceTotal \?\? state\.dailyParseSummary\?\.sourceTotal;/);
  assert.match(app, /if \(sourceTotal !== undefined && sourceTotal !== null\) return Number\(sourceTotal \|\| 0\);/);
  assert.match(app, /if \(String\(type\)\.toUpperCase\(\) === 'WHPP'\)/);
  assert.match(app, /state\.total\s*\|\| state\.metrics\?\.total\s*\|\| state\.dashboard\?\.metrics\?\.total/);
  for (const business of ["['ce', 'CE'","['ceaf', 'CEAF空运'","['tbkh', 'TBKH'","['ali1688', 'ALI1688'","['whpp', 'WHPP本土'","['shopeecn', 'SHOPEE CN'","['shopeevn', 'SHOPEE VN'"]) {
    assert.ok(app.includes(business), `missing seven-business homepage row: ${business}`);
  }
  assert.match(app, /const derivedBusinessTotal = businessRows\.reduce\(\(sum, row\) => sum \+ Number\(row\[2\] \|\| 0\), 0\);/);
  assert.match(app, /const businessCards = \[\s*\['total', '总览', totalBusinessValue, 'blue'\],\s*\.\.\.businessRows\s*\];/s);
});

test('Shopee period cards use source totals instead of completed-analysis totals', () => {
  assert.match(app, /dashboardPeriodMode \? rangeBusinessCount\('SHOPEECN'\)/);
  assert.match(app, /dashboardPeriodMode \? rangeBusinessCount\('SHOPEEVN'\)/);
});

test('unfinished range analysis is visible and never silently presented as complete', () => {
  assert.match(app, /function rangeAnalysisCoverage\(\)/);
  assert.match(app, /function renderAnalysisCoverageNotice\(\)/);
  assert.match(app, /数据分析未全部完成/);
  assert.match(app, /源日报 ' \+ coverage\.sourceTotal \+ ' 票/);
  assert.match(app, /已分析 ' \+ coverage\.analyzedTotal \+ ' 票/);
  assert.match(app, /待分析 ' \+ coverage\.analysisPending \+ ' 票/);
  assert.match(app, /renderAnalysisCoverageNotice\(\);/);
});

test('analysis coverage notice exists only for range modes', () => {
  assert.match(app, /if \(!dashboardPeriodMode\) return null;/);
  assert.match(app, /if \(!coverage \|\| coverage\.sourceTotal <= 0 \|\| coverage\.analysisComplete\)/);
});
