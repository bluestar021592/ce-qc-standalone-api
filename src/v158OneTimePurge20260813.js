import fs from 'fs';
import path from 'path';
import { getDb, getRuntimeConfig, nowIso } from './db.js';

const TARGET_DATE = '2026-08-13';
const MARKER_KEY = 'v158_one_time_purge_20260813_done';
const PATCH_ID = '2026-08-16-v158-one-time-purge-20260813-v1';

function qid(value) {
  return `"${String(value || '').replaceAll('"', '""')}"`;
}

function tableColumns(db, table) {
  try { return db.prepare(`PRAGMA table_info(${qid(table)})`).all().map(row => String(row.name || '')); }
  catch { return []; }
}

function tableCountForDate(db, table, date) {
  try { return Number(db.prepare(`SELECT COUNT(*) count FROM ${qid(table)} WHERE reportDate=?`).get(date)?.count || 0); }
  catch { return 0; }
}

function collectMembers(db, date) {
  const set = new Set();
  const sources = [
    ['unified_import_rows', 'shipmentCode'],
    ['daily_parse_rows', 'shipmentCode'],
    ['business_daily_parse_rows', 'shipmentCode'],
    ['shipment_daily_snapshots', 'shipmentCode'],
    ['final_rows', 'shipmentCode'],
    ['business_final_rows', 'shipmentCode']
  ];
  for (const [table, column] of sources) {
    try {
      for (const row of db.prepare(`SELECT DISTINCT ${qid(column)} shipmentCode FROM ${qid(table)} WHERE reportDate=?`).all(date)) {
        const code = String(row.shipmentCode || '').trim().toUpperCase();
        if (code) set.add(code);
      }
    } catch {}
  }
  return [...set];
}

function currentStateMatchesTarget(db, date) {
  try {
    const row = db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get();
    if (!row?.valueJson) return false;
    const state = JSON.parse(row.valueJson);
    return String(state?.reportDate || '') === date;
  } catch { return false; }
}

function clearBusinessStateRows(db, date) {
  let cleared = 0;
  try {
    for (const row of db.prepare('SELECT businessType,valueJson FROM business_states').all()) {
      let state = null;
      try { state = JSON.parse(row.valueJson || '{}'); } catch {}
      if (String(state?.reportDate || '') !== date) continue;
      db.prepare('DELETE FROM business_states WHERE businessType=?').run(row.businessType);
      cleared += 1;
    }
  } catch {}
  return cleared;
}

function writeManifest(manifest) {
  try {
    const cfg = getRuntimeConfig();
    fs.mkdirSync(cfg.logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(cfg.logsDir, `purge_${TARGET_DATE}_${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
    return file;
  } catch { return ''; }
}

export function purgeCorrupted20260813Once() {
  const db = getDb();
  const marker = db.prepare('SELECT value FROM app_meta WHERE key=?').get(MARKER_KEY)?.value;
  if (String(marker || '') === 'done') {
    console.log(`[CE-QC][V158] ${TARGET_DATE} purge already completed; skipped.`);
    return { ok: true, skipped: true, reason: 'ALREADY_DONE', patchId: PATCH_ID };
  }

  const latestBatch = db.prepare("SELECT batchId,snapshotId,createdAt FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(TARGET_DATE);
  if (!latestBatch) {
    console.log(`[CE-QC][V158] no VALID ${TARGET_DATE} unified import found; purge not armed.`);
    return { ok: true, skipped: true, reason: 'TARGET_NOT_PRESENT', patchId: PATCH_ID };
  }

  const latestMemberCount = Number(db.prepare('SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=?').get(latestBatch.batchId)?.count || 0);
  const stateMatches = currentStateMatchesTarget(db, TARGET_DATE);
  if (!stateMatches && latestMemberCount < 5000) {
    console.warn(`[CE-QC][V158] safety guard blocked purge: latestMemberCount=${latestMemberCount}, current state is not ${TARGET_DATE}.`);
    return { ok: false, skipped: true, reason: 'SAFETY_GUARD', patchId: PATCH_ID };
  }

  const members = collectMembers(db, TARGET_DATE);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name || '')).filter(Boolean);
  const datedTables = tables.filter(table => tableColumns(db, table).includes('reportDate'));
  const beforeCounts = Object.fromEntries(datedTables.map(table => [table, tableCountForDate(db, table, TARGET_DATE)]).filter(([, count]) => count > 0));
  const batchIds = [];
  const snapshotIds = [];
  try {
    for (const row of db.prepare('SELECT batchId,snapshotId FROM unified_import_batches WHERE reportDate=?').all(TARGET_DATE)) {
      if (row.batchId) batchIds.push(row.batchId);
      if (row.snapshotId) snapshotIds.push(row.snapshotId);
    }
  } catch {}

  const manifest = {
    patchId: PATCH_ID,
    targetDate: TARGET_DATE,
    startedAt: nowIso(),
    latestBatch,
    latestMemberCount,
    memberCount: members.length,
    batchIds,
    snapshotIds,
    beforeCounts,
    action: 'PURGE_EXACT_REPORT_DATE_AND_TARGET_MEMBER_RUNTIME_LOCKS'
  };

  const deleted = {};
  db.exec('BEGIN IMMEDIATE');
  try {
    // Delete every normalized/current/snapshot/export row that is explicitly owned by 2026-08-13.
    // Table names come from sqlite_master, never from user input.
    for (const table of datedTables) {
      const info = db.prepare(`DELETE FROM ${qid(table)} WHERE reportDate=?`).run(TARGET_DATE);
      const changes = Number(info?.changes || 0);
      if (changes) deleted[table] = changes;
    }

    // Unified carry rows use sourceReportDate instead of reportDate. Only rows born on 8/13 are removed;
    // older historical carry is deliberately preserved.
    try {
      const info = db.prepare('DELETE FROM carryover_open_items WHERE sourceReportDate=?').run(TARGET_DATE);
      if (Number(info?.changes || 0)) deleted.carryover_open_items_source = Number(info.changes || 0);
    } catch {}

    // Force a genuine re-scan of the re-uploaded 8/13 members. POD locks are global, so delete only locks
    // belonging to shipments that were members of the target day.
    const deleteCcslPod = db.prepare('DELETE FROM pod_locks WHERE shipmentCode=?');
    const deleteBusinessPod = db.prepare('DELETE FROM business_pod_locks WHERE shipmentCode=?');
    let ccslPodLocks = 0;
    let businessPodLocks = 0;
    for (const code of members) {
      ccslPodLocks += Number(deleteCcslPod.run(code)?.changes || 0);
      businessPodLocks += Number(deleteBusinessPod.run(code)?.changes || 0);
    }
    if (ccslPodLocks) deleted.pod_locks_target_members = ccslPodLocks;
    if (businessPodLocks) deleted.business_pod_locks_target_members = businessPodLocks;

    // Prevent the browser from rehydrating the stale 8/13 JSON state after the normalized rows are gone.
    db.prepare("INSERT INTO app_state(key,valueJson,updatedAt) VALUES('current','{}',?) ON CONFLICT(key) DO UPDATE SET valueJson='{}',updatedAt=excluded.updatedAt").run(nowIso());
    deleted.business_states = clearBusinessStateRows(db, TARGET_DATE);

    const previousDate = db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate || '';
    db.prepare("INSERT INTO app_meta(key,value,updatedAt) VALUES('last_processed_report_date',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt").run(previousDate, nowIso());
    db.prepare('INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt').run(MARKER_KEY, 'done', nowIso());

    db.exec('COMMIT');
    manifest.completedAt = nowIso();
    manifest.deleted = deleted;
    manifest.previousReportDate = previousDate;
    manifest.status = 'COMPLETED';
    const manifestFile = writeManifest(manifest);
    console.log(`[CE-QC][V158] PURGED ${TARGET_DATE}: members=${members.length}, datedTables=${Object.keys(deleted).length}, previous=${previousDate || 'none'}, manifest=${manifestFile || 'n/a'}`);
    return { ok: true, patchId: PATCH_ID, targetDate: TARGET_DATE, members: members.length, deleted, previousDate, manifestFile };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    manifest.failedAt = nowIso();
    manifest.status = 'FAILED_ROLLED_BACK';
    manifest.error = error?.message || String(error);
    writeManifest(manifest);
    console.error('[CE-QC][V158] purge failed and rolled back:', error?.stack || error);
    throw error;
  }
}

export const V158_ONE_TIME_PURGE_20260813_PATCH_ID = PATCH_ID;
