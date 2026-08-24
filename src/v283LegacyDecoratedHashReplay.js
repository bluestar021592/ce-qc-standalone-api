import path from 'node:path';
import { getDb, getRuntimeConfig } from './db.js';
import {
  findV281ArchivedSourceByHash,
  readV281SparseWaybillCensus,
  parseV281ArchivedSparse,
  assessV281Replay,
  saveV281HistoricalImport
} from './v281ArchivedHistoricalReparse.js';

export const V283_LEGACY_DECORATED_HASH_REPLAY_ID = '2026-08-24-v283-legacy-decorated-filehash-archive-replay-v1';
export const V283_PRIORITY_REPORT_DATE = '2026-08-17';

export function canonicalLegacyFileHash(value) {
  const text = String(value || '').trim().toLowerCase();
  const match = text.match(/^([a-f0-9]{64})(?::|$)/);
  return match ? match[1] : '';
}

function latestValidBatch(db, reportDate) {
  return db.prepare("SELECT batchId,fileHash,createdAt FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate) || null;
}

function batchBills(db, batchId) {
  return db.prepare("SELECT UPPER(TRIM(shipmentCode)) shipmentCode FROM unified_import_rows WHERE batchId=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode")
    .all(batchId).map(row => String(row.shipmentCode || ''));
}

function recoverInterruptedV283(db, reportDate) {
  const pending = db.prepare("SELECT batchId,reportDate,status FROM unified_import_batches WHERE reportDate=? AND status LIKE 'V283_REPARSE_PENDING:%'").all(reportDate);
  for (const row of pending) {
    const replacement = db.prepare("SELECT batchId FROM unified_import_batches WHERE reportDate=? AND status='VALID' AND batchId<>? ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate, row.batchId);
    if (replacement?.batchId) db.prepare('UPDATE unified_import_batches SET status=? WHERE batchId=?').run(`SUPERSEDED_V283:${replacement.batchId}`, row.batchId);
    else db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=?").run(row.batchId);
  }
}

export async function replayV283LegacyDecoratedHash(reportDate = V283_PRIORITY_REPORT_DATE, options = {}) {
  const db = options.db || getDb();
  const logger = options.logger || console;
  const sourceRoot = options.sourceRoot || path.join(getRuntimeConfig().dataDir, 'evidence_archive', 'source_uploads');
  const startedAt = Date.now();

  recoverInterruptedV283(db, reportDate);
  const batch = latestValidBatch(db, reportDate);
  if (!batch?.batchId || !batch?.fileHash) {
    const result = { ok: false, skipped: true, reason: 'NO_VALID_BATCH_WITH_FILE_HASH', reportDate };
    logger.info?.('[CE-QC][V283_LEGACY_HASH_REPLAY]', JSON.stringify(result));
    return result;
  }

  const storedFileHash = String(batch.fileHash || '').trim();
  const canonicalFileHash = canonicalLegacyFileHash(storedFileHash);
  if (!canonicalFileHash) {
    const result = { ok: false, skipped: true, reason: 'NO_CANONICAL_SHA256_PREFIX', reportDate, batchId: batch.batchId, storedFileHash };
    logger.warn?.('[CE-QC][V283_LEGACY_HASH_REPLAY]', JSON.stringify(result));
    return result;
  }
  if (storedFileHash.toLowerCase() === canonicalFileHash) {
    const result = { ok: true, skipped: true, reason: 'FILE_HASH_ALREADY_CANONICAL', reportDate, batchId: batch.batchId, canonicalFileHash };
    logger.info?.('[CE-QC][V283_LEGACY_HASH_REPLAY]', JSON.stringify(result));
    return result;
  }

  const previousBills = batchBills(db, batch.batchId);
  const archivePath = await findV281ArchivedSourceByHash(sourceRoot, canonicalFileHash);
  if (!archivePath) {
    const result = {
      ok: false,
      skipped: true,
      reason: 'CANONICAL_ARCHIVED_SOURCE_NOT_FOUND',
      reportDate,
      batchId: batch.batchId,
      storedFileHash,
      canonicalFileHash,
      previousCount: previousBills.length
    };
    logger.info?.('[CE-QC][V283_LEGACY_HASH_REPLAY]', JSON.stringify(result));
    return result;
  }

  const censusStarted = Date.now();
  const census = readV281SparseWaybillCensus(archivePath);
  const censusMs = Date.now() - censusStarted;
  const parseStarted = Date.now();
  const parsed = parseV281ArchivedSparse(archivePath, reportDate);
  const parseMs = Date.now() - parseStarted;
  const assessment = assessV281Replay({ reportDate, fileHash: canonicalFileHash, previousBills, parsed, census });

  logger.info?.('[CE-QC][V283_LEGACY_HASH_REPLAY_CHECK]', JSON.stringify({
    reportDate,
    batchId: batch.batchId,
    storedFileHash,
    canonicalFileHash,
    archivePath,
    censusMs,
    parseMs,
    ...assessment,
    sheets: census.sheets
  }));

  if (!assessment.ok) {
    return {
      ok: false,
      skipped: true,
      reason: 'SAFETY_CHECK_FAILED',
      reportDate,
      batchId: batch.batchId,
      storedFileHash,
      canonicalFileHash,
      censusMs,
      parseMs,
      ...assessment
    };
  }

  if (assessment.difference <= 0) {
    try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    const result = {
      ok: true,
      skipped: true,
      reason: 'NO_RECOVERED_ROWS',
      reportDate,
      batchId: batch.batchId,
      storedFileHash,
      canonicalFileHash,
      trendsRefreshed: true,
      censusMs,
      parseMs,
      ...assessment
    };
    logger.info?.('[CE-QC][V283_LEGACY_HASH_REPLAY]', JSON.stringify(result));
    return result;
  }

  const pending = `V283_REPARSE_PENDING:${batch.batchId}`;
  const changed = db.prepare("UPDATE unified_import_batches SET status=? WHERE batchId=? AND status='VALID'").run(pending, batch.batchId).changes;
  if (!changed) {
    const result = { ok: false, skipped: true, reason: 'BATCH_STATUS_CHANGED', reportDate, batchId: batch.batchId };
    logger.warn?.('[CE-QC][V283_LEGACY_HASH_REPLAY]', JSON.stringify(result));
    return result;
  }

  let saved = null;
  try {
    const saveStarted = Date.now();
    saved = saveV281HistoricalImport(parsed, `V283_LEGACY_HASH_ARCHIVE_REPLAY_${reportDate}_${path.basename(archivePath)}`, db);
    const saveMs = Date.now() - saveStarted;
    const newCount = Number(db.prepare('SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=?').get(saved.batchId)?.count || 0);
    const savedHash = canonicalLegacyFileHash(saved?.fileHash || '');
    if (!saved?.batchId || String(saved.reportDate || '') !== reportDate || savedHash !== canonicalFileHash || newCount !== assessment.parsedCount) {
      throw new Error(`V283 post-save verification failed: newCount=${newCount}, expected=${assessment.parsedCount}, savedHash=${savedHash}`);
    }
    const superseded = db.prepare('UPDATE unified_import_batches SET status=? WHERE batchId=? AND status=?')
      .run(`SUPERSEDED_V283:${saved.batchId}`, batch.batchId, pending).changes;
    if (!superseded) throw new Error('V283 could not finalize old decorated-hash batch status');
    try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    const result = {
      ok: true,
      repaired: true,
      reportDate,
      oldBatchId: batch.batchId,
      newBatchId: saved.batchId,
      storedFileHash,
      canonicalFileHash,
      previousCount: assessment.previousCount,
      newCount,
      recovered: newCount - assessment.previousCount,
      sourceDiagnosticCount: assessment.sourceDiagnosticCount,
      ignoredOffColumnCount: assessment.ignoredOffColumnCount,
      currentStatePreserved: true,
      censusMs,
      parseMs,
      saveMs,
      durationMs: Date.now() - startedAt
    };
    logger.info?.('[CE-QC][V283_LEGACY_HASH_REPLAY_REPAIRED]', JSON.stringify(result));
    return result;
  } catch (error) {
    if (saved?.batchId) {
      try {
        db.prepare("UPDATE unified_import_batches SET status=? WHERE batchId=? AND status='VALID'")
          .run(`INVALID_V283_FAILED:${batch.batchId}`, saved.batchId);
      } catch {}
    }
    try { db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=? AND status=?").run(batch.batchId, pending); } catch {}
    const result = {
      ok: false,
      repaired: false,
      reason: 'REPLAY_SAVE_FAILED',
      reportDate,
      batchId: batch.batchId,
      rejectedNewBatchId: saved?.batchId || '',
      storedFileHash,
      canonicalFileHash,
      error: error?.message || String(error),
      durationMs: Date.now() - startedAt
    };
    logger.error?.('[CE-QC][V283_LEGACY_HASH_REPLAY_FAILED]', JSON.stringify(result));
    return result;
  }
}

function scheduleV283Replay() {
  if (process.env.NODE_ENV === 'test' || process.env.CI) return;
  const timer = setTimeout(() => {
    void replayV283LegacyDecoratedHash(V283_PRIORITY_REPORT_DATE).catch(error => {
      console.error('[CE-QC][V283_LEGACY_HASH_REPLAY_FATAL]', JSON.stringify({ reportDate: V283_PRIORITY_REPORT_DATE, error: error?.message || String(error) }));
    });
  }, 12_000);
  timer.unref?.();
}

scheduleV283Replay();
console.info('[CE-QC][V283_LEGACY_HASH_REPLAY]', V283_LEGACY_DECORATED_HASH_REPLAY_ID, `priority=${V283_PRIORITY_REPORT_DATE}`, 'legacy decorated fileHash is canonicalized to its leading SHA-256 for exact archive lookup and safety comparison; historical-only writer preserves current/carry state.');
