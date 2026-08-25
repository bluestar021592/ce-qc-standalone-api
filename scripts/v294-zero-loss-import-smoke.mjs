import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

process.env.NODE_ENV = 'test';
const {
  readV273SourceWaybillCensus,
  compareV273ParsedToCensus,
  compareV273Membership
} = await import('../src/v273ImportCompletenessGuard.js');

const file = path.join(os.tmpdir(), `ce-qc-v294-zero-loss-${process.pid}-${Date.now()}.xlsx`);
try {
  const ws = XLSX.utils.aoa_to_sheet([
    ['运单号', '备注'],
    ['CC1234567890', 'CE1234567890'],
    ['SPE1234567890', '普通备注']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '日报');
  XLSX.writeFile(wb, file);

  const census = readV273SourceWaybillCensus(file);
  assert.equal(census.count, 2, 'only the bound shipment column is authoritative');
  assert.equal(census.diagnosticCount, 3, 'off-column waybill-like text remains diagnostic');
  assert.equal(census.ignoredOffColumnCount, 1);

  const missingOne = compareV273ParsedToCensus(['CC1234567890'], census.bills, census.locations);
  assert.equal(missingOne.ok, false, 'one missing source shipment must fail closed');
  assert.equal(missingOne.missingCount, 1);
  assert.deepEqual(missingOne.missingBills, ['SPE1234567890']);

  const exact = compareV273ParsedToCensus(['CC1234567890', 'SPE1234567890'], census.bills, census.locations);
  assert.equal(exact.ok, true);
  assert.equal(exact.missingCount, 0);

  const replacedMember = compareV273Membership(['CC1234567890', 'SPE9999999999'], ['CC1234567890', 'SPE1234567890']);
  assert.equal(replacedMember.ok, false, 'same/higher count cannot replace an old member silently');
  assert.equal(replacedMember.missingPreviousCount, 1);

  const source = fs.readFileSync(new URL('../src/v273ImportCompletenessGuard.js', import.meta.url), 'utf8');
  assert.match(source, /V273_SOURCE_WAYBILL_CENSUS_MISMATCH/);
  assert.match(source, /V273_SAME_DATE_MEMBERSHIP_LOSS_BLOCKED/);
  assert.match(source, /已阻止入库，禁止静默漏单/);

  console.log('[V294] zero-loss import smoke passed · shipment-column census blocks even 1 missing bill; off-column references do not create false positives; same-date membership loss is blocked');
} finally {
  try { fs.rmSync(file, { force: true }); } catch {}
}
