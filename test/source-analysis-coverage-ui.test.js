import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('public/app.js', 'utf8');

test('range business cards prefer immutable source totals', () => {
  assert.match(app, /const sourceTotal = state\.sourceTotal \?\? state\.dashboard\?\.sourceTotal \?\? state\.dailyParseSummary\?\.sourceTotal;/);
  assert.match(app, /if \(sourceTotal !== undefined && sourceTotal !== null\) return Number\(sourceTotal \|\| 0\);/);
  assert.match(app, /const periodSourceTotal = \['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'\]\.reduce/);
  assert.match(app, /dashboardPeriodMode \? periodSourceTotal : total/);
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
