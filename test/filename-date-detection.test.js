import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('unified import exposes filename date detection control', () => {
  assert.match(htmlSource, /id="detectFilenameDateButton"/);
  assert.match(htmlSource, /onclick="detectReportDateFromFilename\(\)"/);
});

test('filename date detection participates in the import override path', () => {
  assert.match(appSource, /function parseReportDateFromFilename\(fileName\)/);
  assert.match(appSource, /function detectReportDateFromFilename\(\)/);
  assert.match(appSource, /reportDateManualCorrection = true;/);
  assert.match(appSource, /body\.append\('reportDate', document\.getElementById\('reportDate'\)\.value \|\| ''\)/);
});
