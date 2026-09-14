import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { assertWhppSourceMembershipRange, reconcileWhppSourceMembership, V512_WHPP_SOURCE_MEMBERSHIP_GUARD_ID } from '../src/v512WhppSourceMembershipGuard.js';

function fakeDb({ batches = {}, sources = {}, processed = {}, reports = {} } = {}) {
  return {
    prepare(sql) {
      if (sql.includes('FROM unified_import_batches')) return { get: reportDate => batches[reportDate] || null };
      if (sql.includes('FROM unified_import_rows')) return { all: snapshotId => (sources[snapshotId] || []).map(shipmentCode => ({ shipmentCode })) };
      if (sql.includes('FROM business_daily_parse_rows')) return { all: reportDate => (processed[reportDate] || []).map(shipmentCode => ({ shipmentCode })) };
      if (sql.includes('FROM business_daily_reports')) return { get: reportDate => Object.hasOwn(reports, reportDate) ? { totalCount: reports[reportDate], rowid: 1 } : null };
      throw new Error(`unexpected test SQL: ${sql}`);
    }
  };
}

test('WHPP source membership passes only when source, processed members and reported count agree exactly',()=>{
  const result=reconcileWhppSourceMembership({
    sourceBills:['CE100001','CE100002','CE100003'],
    processedBills:['CE100003','CE100001','CE100002'],
    reportedCount:3,
    reportPresent:true
  });
  assert.equal(result.id,V512_WHPP_SOURCE_MEMBERSHIP_GUARD_ID);
  assert.equal(result.passed,true);
  assert.equal(result.sourceUnique,3);
  assert.equal(result.processedUnique,3);
  assert.deepEqual(result.missingFromProcessed,[]);
  assert.deepEqual(result.unexpectedProcessed,[]);
});

test('WHPP loss fails even when downstream reported count was reduced to the same wrong total',()=>{
  const result=reconcileWhppSourceMembership({
    sourceBills:['CE200001','CE200002','CE200003'],
    processedBills:['CE200001','CE200002'],
    reportedCount:2,
    reportPresent:true
  });
  assert.equal(result.passed,false);
  assert.equal(result.sourceUnique,3);
  assert.equal(result.processedUnique,2);
  assert.equal(result.reportMatchesSource,false);
  assert.deepEqual(result.missingFromProcessed,['CE200003']);
});

test('same-count WHPP member substitution fails instead of hiding cross-board attribution',()=>{
  const result=reconcileWhppSourceMembership({
    sourceBills:['CE300001','CE300002'],
    processedBills:['CE300001','CE399999'],
    reportedCount:2,
    reportPresent:true
  });
  assert.equal(result.passed,false);
  assert.equal(result.sourceUnique,result.processedUnique);
  assert.deepEqual(result.missingFromProcessed,['CE300002']);
  assert.deepEqual(result.unexpectedProcessed,['CE399999']);
});

test('duplicate WHPP processing rows fail conservation even when unique membership is correct',()=>{
  const result=reconcileWhppSourceMembership({
    sourceBills:['CE400001','CE400002'],
    processedBills:['CE400001','CE400001','CE400002'],
    reportedCount:2,
    reportPresent:true
  });
  assert.equal(result.passed,false);
  assert.equal(result.processedUnique,2);
  assert.equal(result.processedDuplicateRows,1);
});

test('legacy-only WHPP date without VALID unified source remains export-compatible',()=>{
  const result=assertWhppSourceMembershipRange({
    fromDate:'2026-07-01',toDate:'2026-07-01',db:fakeDb({ processed:{'2026-07-01':['CELEGACY001']}, reports:{'2026-07-01':1} })
  });
  assert.equal(result.ok,true);
  assert.equal(result.requestedDays,1);
  assert.equal(result.daysChecked,0);
  assert.equal(result.authoritativeDays,0);
  assert.equal(result.legacySkippedDays,1);
  assert.equal(result.days[0].reason,'NO_VALID_UNIFIED_SOURCE_LEGACY_COMPAT');
  assert.equal(result.days[0].passed,true);
  assert.equal(result.days[0].enforced,false);
});

test('mixed range skips legacy-only dates but enforces authoritative VALID source dates',()=>{
  const result=assertWhppSourceMembershipRange({
    fromDate:'2026-07-01',toDate:'2026-07-02',
    db:fakeDb({
      batches:{'2026-07-02':{snapshotId:'S2',batchId:'B2',reportDate:'2026-07-02'}},
      sources:{S2:['CE500001','CE500002']},
      processed:{'2026-07-01':['CELEGACY001'],'2026-07-02':['CE500002','CE500001']},
      reports:{'2026-07-01':1,'2026-07-02':2}
    })
  });
  assert.equal(result.ok,true);
  assert.equal(result.requestedDays,2);
  assert.equal(result.daysChecked,1);
  assert.equal(result.authoritativeDays,1);
  assert.equal(result.legacySkippedDays,1);
  assert.equal(result.sourceWhppTotal,2);
  assert.equal(result.processedWhppTotal,2);
  assert.equal(result.days.find(item=>item.reportDate==='2026-07-02')?.passed,true);
});

test('authoritative zero-WHPP-member date blocks stale processed WHPP rows',()=>{
  assert.throws(
    ()=>assertWhppSourceMembershipRange({
      fromDate:'2026-07-03',toDate:'2026-07-03',
      db:fakeDb({
        batches:{'2026-07-03':{snapshotId:'S3',batchId:'B3',reportDate:'2026-07-03'}},
        sources:{S3:[]},
        processed:{'2026-07-03':['CESTALE001']},
        reports:{'2026-07-03':0}
      })
    }),
    error=>error?.code==='WHPP_SOURCE_MEMBERSHIP_CONSERVATION_FAILED'
      && error?.failures?.[0]?.sourceUnique===0
      && error?.failures?.[0]?.unexpectedProcessed?.includes('CESTALE001')
  );
});

test('canonical ALL and single-WHPP workers execute V512 before workbook generation',()=>{
  const allWorker=fs.readFileSync('src/v473AllBusinessExportWorker.js','utf8');
  const singleWorker=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
  assert.match(allWorker,/assertWhppSourceMembershipRange/);
  assert.match(allWorker,/historyPreflight:'PASSED'/);
  const allGate=allWorker.lastIndexOf('assertWhppSourceMembershipRange({');
  const allPassed=allWorker.lastIndexOf("historyPreflight:'PASSED'");
  assert.ok(allGate>=0&&allPassed>allGate,'ALL worker must execute WHPP membership guard before declaring preflight passed');
  assert.match(singleWorker,/assertWhppSourceMembershipRange/);
  assert.match(singleWorker,/type==='WHPP'/);
  assert.match(singleWorker,/whppSourceMembership/);
  const singleGate=singleWorker.lastIndexOf('assertWhppSourceMembershipRange({');
  const workbookCall=singleWorker.lastIndexOf('createV200ReferenceDashboardWorkbook({');
  assert.ok(singleGate>=0&&workbookCall>singleGate,'single WHPP worker must execute membership guard before the V200 workbook call');
});

test('go-live preflight syntax-checks and executes the V512 membership gate',()=>{
  const workflow=fs.readFileSync('.github/workflows/go-live-preflight.yml','utf8');
  assert.match(workflow,/node --check src\/v512WhppSourceMembershipGuard\.js/);
  assert.match(workflow,/node --check src\/v183SingleBusinessExportJobWorker\.js/);
  assert.match(workflow,/node --check test\/v512-whpp-source-membership-guard\.test\.js/);
  assert.match(workflow,/V512 WHPP source membership conservation/);
  assert.match(workflow,/node --test test\/v512-whpp-source-membership-guard\.test\.js/);
});
