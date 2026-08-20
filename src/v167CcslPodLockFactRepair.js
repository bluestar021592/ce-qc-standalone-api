import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getDb, nowIso } from './db.js';

const PATCH_ID = '2026-08-19-v214-ccsl-pod-lock-worker-v1';
const CCSL_TYPES = ['CE', 'CEAF', 'TBKH', 'ALI1688'];
const WORKER_DELAY_MS = Math.max(30_000, Number(process.env.CE_QC_V167_REPAIR_DELAY_MS || 120_000));
let scheduledWorker = null;
let repairChild = null;

function latestCompletedBatch(db) {
  return db.prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND UPPER(COALESCE(s.status,''))='COMPLETED'
    WHERE UPPER(COALESCE(b.status,'VALID'))='VALID'
    ORDER BY b.reportDate DESC,b.createdAt DESC,b.batchId DESC
    LIMIT 1
  `).get() || null;
}

function membersWithPodLock(db, batch) {
  if (!batch) return [];
  const marks = CCSL_TYPES.map(() => '?').join(',');
  return db.prepare(`
    SELECT DISTINCT u.businessType,u.shipmentCode,p.source,p.podTime,p.evidenceType,p.evidenceText
    FROM unified_import_rows u
    INNER JOIN pod_locks p ON p.shipmentCode=u.shipmentCode
    WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN (${marks})
    ORDER BY u.businessType,u.shipmentCode
  `).all(batch.snapshotId, batch.reportDate, ...CCSL_TYPES);
}

function existingFact(db, reportDate, shipmentCode) {
  return db.prepare('SELECT shipmentCode,isPod,category,primaryCategory FROM final_rows WHERE reportDate=? AND shipmentCode=? LIMIT 1')
    .get(reportDate, shipmentCode) || null;
}

function upsertPodFact(db, batch, row, now) {
  const raw = JSON.stringify({
    shipmentCode: row.shipmentCode,
    运单号: row.shipmentCode,
    reportDate: batch.reportDate,
    businessType: row.businessType,
    是否POD: '是',
    POD状态: 'POD',
    currentState: 'POD',
    primaryCategory: 'POD闭环',
    主分类: 'POD闭环',
    异常分类: 'POD闭环',
    matchedRule: 'POD_LOCK_FACT_REPAIR_V167',
    命中规则: 'POD_LOCK_FACT_REPAIR_V167',
    QC判断: '历史POD锁已闭环，今日无需重复请求CE接口',
    API状态: 'POD_LOCK',
    查询状态: 'skipped_pod_lock',
    podLockSource: row.source || '',
    podTime: row.podTime || '',
    evidenceType: row.evidenceType || '',
    evidenceText: row.evidenceText || '',
    repairedBy: PATCH_ID
  });
  db.prepare(`
    INSERT INTO final_rows(
      shipmentCode,reportDate,sourceType,isPod,category,qcConclusion,lastEvent,lastEventTime,lastEventCode,lastEventDesc,
      lastEventTargetNode,lastEventActionType,matchedRule,matchedShopCode,matchedShopName,primaryCategory,tagsJson,
      pendingDays,ocDays,cycleCountDays,assignDays,deliveringDays,trackNodeCount,eventCourier,pickupShop,deliveryShop,
      productCode,customerName,rawSummary,rawJson,createdAt,updatedAt
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(shipmentCode,reportDate) DO UPDATE SET
      isPod=1,
      category='POD闭环',
      qcConclusion='历史POD锁已闭环，今日无需重复请求CE接口',
      matchedRule='POD_LOCK_FACT_REPAIR_V167',
      primaryCategory='POD闭环',
      tagsJson='["POD_LOCK"]',
      updatedAt=excluded.updatedAt
  `).run(
    row.shipmentCode,batch.reportDate,'今日PNH',1,'POD闭环','历史POD锁已闭环，今日无需重复请求CE接口','',row.podTime || '',
    'POD_LOCK','历史POD锁','', '', 'POD_LOCK_FACT_REPAIR_V167','','','POD闭环','["POD_LOCK"]',
    0,0,0,0,0,0,'','','','','','POD锁事实修复',raw,now,now
  );
}

function isMainWebEntry() {
  const entry = String(process.argv[1] || '').replaceAll('\\', '/').split('/').pop().toLowerCase();
  return entry === 'bootstrap.js' || entry === 'server.js';
}

function launchRepairWorker() {
  scheduledWorker = null;
  if (repairChild) return;
  const file = fileURLToPath(new URL('./v167CcslPodLockFactRepairWorker.js', import.meta.url));
  try {
    repairChild = spawn(process.execPath, [file], {
      cwd: process.cwd(),
      env: { ...process.env, CE_QC_V167_REPAIR_WORKER: '1' },
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    console.log(`[CE-QC][V214_STARTUP] CCSL POD-lock repair isolated worker starting pid=${repairChild.pid || '-'} after ${WORKER_DELAY_MS}ms delay`);
    repairChild.once('error', error => {
      console.error('[CE-QC][V214_STARTUP] CCSL POD-lock repair worker spawn failed:', error?.stack || error);
      repairChild = null;
    });
    repairChild.once('exit', (code, signal) => {
      console.log(`[CE-QC][V214_STARTUP] CCSL POD-lock repair worker exited code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}`);
      repairChild = null;
    });
  } catch (error) {
    repairChild = null;
    console.error('[CE-QC][V214_STARTUP] CCSL POD-lock repair worker start failed:', error?.stack || error);
  }
}

function scheduleRepairWorker() {
  if (scheduledWorker || repairChild) return { ok: true, deferred: true, reason: 'ALREADY_SCHEDULED_OR_RUNNING', patchId: PATCH_ID };
  scheduledWorker = setTimeout(launchRepairWorker, WORKER_DELAY_MS);
  scheduledWorker.unref?.();
  console.log(`[CE-QC][V214_STARTUP] CCSL POD-lock repair deferred ${WORKER_DELAY_MS}ms and will run outside the 5177 web process`);
  return { ok: true, deferred: true, workerDelayMs: WORKER_DELAY_MS, patchId: PATCH_ID };
}

export function repairLatestCcslPodLockFacts(database = null) {
  // bootstrap.js historically called this synchronously immediately after server.listen().
  // On a 20+ GiB SQLite file that could monopolize the 5177 event loop exactly while the
  // browser was trying to enter after authentication. Main web entries now only schedule
  // a child worker; the actual repair still uses the exact same durable transaction below.
  if (!database && String(process.env.CE_QC_V167_REPAIR_WORKER || '') !== '1' && isMainWebEntry()) {
    return scheduleRepairWorker();
  }

  const db = database || getDb();
  const batch = latestCompletedBatch(db);
  if (!batch) return { ok: true, repaired: 0, updated: 0, reason: 'NO_COMPLETED_UNIFIED_BATCH' };

  const locked = membersWithPodLock(db, batch);
  if (!locked.length) return { ok: true, reportDate: batch.reportDate, repaired: 0, updated: 0, totalPodLocks: 0 };

  let inserted = 0;
  let updated = 0;
  const byBusiness = Object.fromEntries(CCSL_TYPES.map(type => [type, { locked: 0, inserted: 0, updated: 0 }]));
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of locked) {
      const type = String(row.businessType || '').toUpperCase();
      if (!byBusiness[type]) continue;
      byBusiness[type].locked += 1;
      const before = existingFact(db, batch.reportDate, row.shipmentCode);
      upsertPodFact(db, batch, row, now);
      if (!before) {
        inserted += 1;
        byBusiness[type].inserted += 1;
      } else if (Number(before.isPod || 0) !== 1 || String(before.primaryCategory || before.category || '') !== 'POD闭环') {
        updated += 1;
        byBusiness[type].updated += 1;
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  return {
    ok: true,
    patchId: PATCH_ID,
    reportDate: batch.reportDate,
    snapshotId: batch.snapshotId,
    totalPodLocks: locked.length,
    repaired: inserted,
    updated,
    byBusiness
  };
}

export const V167_CCSL_POD_LOCK_FACT_REPAIR_ID = PATCH_ID;
