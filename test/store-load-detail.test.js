import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-load-detail-'));
process.env.DATA_DIR = tempDir;
process.env.DB_FILE = path.join(tempDir, 'detail-test.db');

const { getDb, closeDb } = await import('../src/db.js');
const { loadDetail } = await import('../src/store.js');

test.before(() => {
  const db = getDb();
  const insertScan = db.prepare('INSERT INTO scan_results(shipmentCode,reportDate,orderStatus,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?)');
  const insertFinal = db.prepare('INSERT INTO final_rows(shipmentCode,reportDate,category,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?)');
  const insertEvent = db.prepare('INSERT INTO track_events(shipmentCode,reportDate,eventCode,eventTime,rawJson,createdAt) VALUES(?,?,?,?,?,?)');
  const insertDaily = db.prepare('INSERT INTO daily_parse_rows(reportDate,sheetName,rowNumber,shipmentCode,result,rowJson,createdAt) VALUES(?,?,?,?,?,?,?)');
  for (const [date, status, category] of [['2026-08-04', '70', 'OLD'], ['2026-08-05', '85', 'LATEST']]) {
    const now = `${date}T10:00:00.000Z`;
    insertScan.run('TESTDETAIL001', date, status, JSON.stringify({ date, status }), now, now);
    insertFinal.run('TESTDETAIL001', date, category, JSON.stringify({ date, category }), now, now);
    insertEvent.run('TESTDETAIL001', date, category, `${date} 10:00:00`, JSON.stringify({ date, category }), now);
    insertDaily.run(date, 'Sheet1', 2, 'TESTDETAIL001', category, JSON.stringify({ date, category }), now);
  }
});

test.after(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('loadDetail without date returns the latest shipment record', () => {
  const detail = loadDetail({ reportDate: '', shipmentCode: 'testdetail001' });
  assert.equal(detail.shipmentCode, 'TESTDETAIL001');
  assert.equal(detail.scan.reportDate, '2026-08-05');
  assert.equal(detail.scan.orderStatus, '85');
  assert.equal(detail.finalRow.category, 'LATEST');
  assert.equal(detail.events[0].reportDate, '2026-08-05');
});

test('loadDetail with date only returns that reportDate', () => {
  const detail = loadDetail({ reportDate: '2026-08-04', shipmentCode: 'TESTDETAIL001' });
  assert.equal(detail.scan.reportDate, '2026-08-04');
  assert.equal(detail.finalRow.category, 'OLD');
  assert.ok(detail.events.every(row => row.reportDate === '2026-08-04'));
  assert.ok(detail.dailyRows.every(row => row.reportDate === '2026-08-04'));
});

test('loadDetail returns null and empty members for an unknown shipment', () => {
  const detail = loadDetail({ reportDate: '', shipmentCode: 'DOESNOTEXIST' });
  assert.equal(detail.scan, null);
  assert.equal(detail.finalRow, null);
  assert.deepEqual(detail.events, []);
  assert.deepEqual(detail.dailyRows, []);
  assert.equal(detail.podLock, null);
  assert.deepEqual(detail.carry, []);
});
