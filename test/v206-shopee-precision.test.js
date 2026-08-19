import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveV206ShopeeTimingEvidence, summarizeV206ShopeeTiming, v206NaturalDays } from '../src/v206ShopeePrecisionTruth.js';
import { statsOf } from '../src/v200Metrics.js';

function ev(code,time,source='TEST'){return {eventCode:code,eventTime:time,__v206Source:source};}

test('V206 natural days treats 3001 day as day 1',()=>{
  assert.equal(v206NaturalDays('2026-07-23 08:00:00','2026-07-23 18:00:00'),1);
  assert.equal(v206NaturalDays('2026-07-23 08:00:00','2026-07-27 00:13:58'),5);
});

test('V206 resolves exact 3001 to 4004 POD timing',()=>{
  const result=resolveV206ShopeeTimingEvidence([
    ev('3001','2026-07-23 08:00:00'),
    ev('4003','2026-07-24 09:00:00'),
    ev('150','2026-07-24 18:00:00'),
    ev('4004','2026-07-27 00:13:58')
  ],{pod:true});
  assert.equal(result.status,'OK');
  assert.equal(result.days,5);
  assert.equal(result.startAt,'2026-07-23 08:00:00');
  assert.equal(result.podAt,'2026-07-27 00:13:58');
});

test('V206 accepts CE trajectory code 80 as POD and never uses orderTime as timing start',()=>{
  const result=resolveV206ShopeeTimingEvidence([
    ev('3001','2026-08-01 12:00:00'),
    ev('80','2026-08-03 12:00:00')
  ],{pod:true,orderTime:'2026-07-20 00:00:00'});
  assert.equal(result.status,'OK');
  assert.equal(result.days,3);
  assert.equal(result.startAt,'2026-08-01 12:00:00');
});

test('V206 missing 3001 is excluded instead of guessed from order time',()=>{
  const result=resolveV206ShopeeTimingEvidence([
    ev('4004','2026-08-03 12:00:00')
  ],{pod:true,orderTime:'2026-08-01 00:00:00'});
  assert.equal(result.status,'MISSING_3001');
  assert.equal(result.days,0);
});

test('V206 rejects a POD timestamp before 3001',()=>{
  const result=resolveV206ShopeeTimingEvidence([
    ev('4004','2026-08-01 09:00:00'),
    ev('3001','2026-08-02 09:00:00')
  ],{pod:true});
  assert.equal(result.status,'INVALID_SEQUENCE');
  assert.equal(result.days,0);
});

test('V206 de-duplicates evidence and chooses earliest valid 3001 and POD after it',()=>{
  const result=resolveV206ShopeeTimingEvidence([
    ev('3001','2026-08-01 08:00:00','A'),
    ev('3001','2026-08-01 08:00:00','A'),
    ev('3001','2026-08-01 09:00:00','B'),
    ev('4004','2026-08-02 10:00:00','A'),
    ev('80','2026-08-02 12:00:00','B')
  ],{pod:true});
  assert.equal(result.status,'OK');
  assert.equal(result.startAt,'2026-08-01 08:00:00');
  assert.equal(result.podAt,'2026-08-02 10:00:00');
  assert.equal(result.days,2);
});

test('V206 region timing summary uses valid POD samples only and reports coverage',()=>{
  const rows=[
    {metricEligible:true,pod:true,area:'金边',timingEvidenceStatus:'OK',deliveryDays:2},
    {metricEligible:true,pod:true,area:'金边',timingEvidenceStatus:'OK',deliveryDays:4},
    {metricEligible:true,pod:true,area:'金边',timingEvidenceStatus:'MISSING_3001',deliveryDays:0},
    {metricEligible:true,pod:true,area:'外省',timingEvidenceStatus:'OK',deliveryDays:5},
    {metricEligible:false,pod:true,area:'外省',timingEvidenceStatus:'OK',deliveryDays:99}
  ];
  const summary=summarizeV206ShopeeTiming(rows);
  assert.equal(summary.pp.pod,3);
  assert.equal(summary.pp.samples,2);
  assert.equal(summary.pp.averageDays,3);
  assert.equal(summary.pp.coverageRate,66.67);
  assert.equal(summary.pp.missing3001,1);
  assert.equal(summary.pv.pod,1);
  assert.equal(summary.pv.samples,1);
  assert.equal(summary.pv.averageDays,5);
  assert.equal(summary.pv.coverageRate,100);
});

test('V209 export stats never fabricate Shopee timing from orderTime when 3001 evidence is missing',()=>{
  const rows=[
    {businessType:'SHOPEECN',metricEligible:true,firstReportDate:'2026-08-01',pod:true,area:'金边',attemptNo:1,timingEvidenceStatus:'MISSING_3001',deliveryDays:0,signNaturalDays:0,orderTime:'2026-08-01 08:00:00',podTime:'2026-08-03 18:00:00'},
    {businessType:'SHOPEECN',metricEligible:true,firstReportDate:'2026-08-01',pod:true,area:'金边',attemptNo:1,timingEvidenceStatus:'OK',deliveryDays:2,signNaturalDays:2,orderTime:'2026-07-20 08:00:00',podTime:'2026-08-02 18:00:00'}
  ];
  const stats=statsOf(rows,{from:'2026-08-01',to:'2026-08-01'}).overall;
  assert.equal(stats.pod,2);
  assert.deepEqual(stats.days,[2]);
  assert.deepEqual(stats.ppDays,[2]);
});
