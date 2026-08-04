import fs from 'fs';
import path from 'path';
import { DEFAULT_SHOP_CP_CODES } from './shopCodeDefaults.js';
import { seedLatestShopWhitelist } from './shopWhitelist.js';

const SCHEMA_VERSION = 15;
const REQUIRED_TABLES = [
  'pod_locks',
  'carry_bills',
  'daily_reports',
  'scan_results',
  'track_events',
  'final_rows',
  'history_summary',
  'run_checkpoints',
  'shop_cp_codes',
  'business_states',
  'business_daily_reports',
  'business_daily_parse_rows',
  'business_pod_locks',
  'business_carry_bills',
  'business_scan_results',
  'business_shipment_tracks',
  'business_track_events',
  'business_exception_items',
  'business_api_batches',
  'business_final_rows',
  'business_history_summary',
  'business_run_locks',
  'business_run_checkpoints',
  'business_export_snapshots',
  'business_recipient_conflicts',
  'shop_whitelist_versions',
  'shop_whitelist_entries',
  'shop_whitelist_aliases',
  'user_roles',
  'users',
  'user_sessions',
  'audit_logs',
  'notifications'
];
const PERSISTED_TABLES = [...REQUIRED_TABLES, 'app_state', 'daily_parse_rows', 'export_records', 'business_export_records'];

export function migrateDatabase(db, cfg) {
  const existingVersion = readSchemaVersion(db);
  if (existingVersion >= SCHEMA_VERSION) {
    verifyDatabase(db);
    writeMeta(db, 'last_startup_at', new Date().toISOString());
    return { fromVersion: existingVersion, toVersion: SCHEMA_VERSION, migrated: false, backupPath: '' };
  }

  const needsBackup = hasBusinessData(db);
  const backupPath = needsBackup ? backupDbFile(db, cfg) : '';
  if (needsBackup && !backupPath) throw new Error('数据库升级前备份失败，已停止升级。');

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      valueJson TEXT NOT NULL,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS pod_locks (
      shipmentCode TEXT PRIMARY KEY,
      source TEXT,
      podTime TEXT,
      evidenceType TEXT,
      evidenceText TEXT,
      lastSeenReportDate TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS carry_bills (
      shipmentCode TEXT,
      reportDate TEXT,
      sourceDate TEXT,
      sourceType TEXT,
      status TEXT,
      reason TEXT,
      lastCategory TEXT,
      lastEventTime TEXT,
      lastCheckedDate TEXT,
      primaryCategory TEXT,
      tagsJson TEXT,
      lastEventDesc TEXT,
      matchedShopCode TEXT,
      lastRunId TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (shipmentCode, reportDate)
    );

    CREATE TABLE IF NOT EXISTS daily_reports (
      reportDate TEXT PRIMARY KEY,
      sourceFile TEXT,
      fileHash TEXT,
      pnhCount INTEGER,
      nonPnhCount INTEGER,
      excludedCount INTEGER,
      duplicateCount INTEGER,
      totalUniqueCount INTEGER,
      totalAppearCount INTEGER,
      summaryJson TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_parse_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reportDate TEXT,
      sheetName TEXT,
      rowNumber INTEGER,
      shipmentCode TEXT,
      result TEXT,
      reason TEXT,
      rawText TEXT,
      rowJson TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS scan_results (
      shipmentCode TEXT,
      reportDate TEXT,
      sourceType TEXT,
      orderStatus TEXT,
      isPod INTEGER,
      scanCategory TEXT,
      pickupShop TEXT,
      deliveryShop TEXT,
      productCode TEXT,
      customerName TEXT,
      rawSummary TEXT,
      rawJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (shipmentCode, reportDate)
    );

    CREATE TABLE IF NOT EXISTS track_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipmentCode TEXT,
      reportDate TEXT,
      eventCode TEXT,
      trackingEventCode TEXT,
      trackingEventDesc TEXT,
      trackingEventDescZh TEXT,
      trackingEventDescKm TEXT,
      eventTime TEXT,
      operator TEXT,
      eventCourier TEXT,
      place TEXT,
      rawJson TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS final_rows (
      shipmentCode TEXT,
      reportDate TEXT,
      sourceType TEXT,
      isPod INTEGER,
      category TEXT,
      qcConclusion TEXT,
      lastEvent TEXT,
      lastEventTime TEXT,
      lastEventCode TEXT,
      lastEventDesc TEXT,
      lastEventTargetNode TEXT,
      lastEventActionType TEXT,
      matchedRule TEXT,
      matchedShopCode TEXT,
      matchedShopName TEXT,
      primaryCategory TEXT,
      tagsJson TEXT,
      pendingDays INTEGER,
      ocDays INTEGER,
      cycleCountDays INTEGER,
      assignDays INTEGER,
      deliveringDays INTEGER,
      trackNodeCount INTEGER,
      eventCourier TEXT,
      pickupShop TEXT,
      deliveryShop TEXT,
      productCode TEXT,
      customerName TEXT,
      rawSummary TEXT,
      rawJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (shipmentCode, reportDate)
    );

    CREATE TABLE IF NOT EXISTS run_checkpoints (
      runId TEXT,
      reportDate TEXT,
      stage TEXT,
      batchIndex INTEGER,
      totalBatches INTEGER,
      status TEXT,
      payloadJson TEXT,
      errorMessage TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS run_locks (
      reportDate TEXT PRIMARY KEY,
      runId TEXT,
      status TEXT,
      currentStage TEXT,
      batchIndex INTEGER DEFAULT 0,
      totalBatches INTEGER DEFAULT 0,
      errorMessage TEXT,
      lockedBy TEXT,
      lockedAt TEXT,
      completedAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS history_summary (
      reportDate TEXT PRIMARY KEY,
      summaryJson TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS export_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reportDate TEXT,
      exportType TEXT,
      fileName TEXT,
      fileHash TEXT,
      rowCount INTEGER,
      summaryJson TEXT,
      consistencyJson TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backupType TEXT,
      fileName TEXT,
      filePath TEXT,
      fileHash TEXT,
      reason TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS export_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshotId TEXT,
      reportDate TEXT,
      runId TEXT,
      snapshotType TEXT,
      payloadJson TEXT,
      metricsJson TEXT,
      detailCountsJson TEXT,
      dataHashesJson TEXT,
      consistencyJson TEXT,
      generatedAt TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS shop_cp_codes (
      shopCode TEXT PRIMARY KEY,
      shopName TEXT,
      sourceFile TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS migration_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fromVersion INTEGER,
      toVersion INTEGER,
      status TEXT,
      backupPath TEXT,
      message TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS business_states (
      businessType TEXT PRIMARY KEY,
      valueJson TEXT NOT NULL,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS business_daily_reports (
      businessType TEXT,
      reportDate TEXT,
      sourceFile TEXT,
      totalCount INTEGER,
      summaryJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, reportDate)
    );

    CREATE TABLE IF NOT EXISTS business_daily_parse_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      shipmentCode TEXT,
      sheetName TEXT,
      rowNumber INTEGER,
      source_row_number INTEGER,
      recipient_raw TEXT,
      recipient_normalized TEXT,
      recipient_group TEXT DEFAULT 'OTHER',
      recipient_group_reason TEXT,
      rawText TEXT,
      rowJson TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS business_pod_locks (
      businessType TEXT,
      shipmentCode TEXT,
      podTime TEXT,
      source TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, shipmentCode)
    );

    CREATE TABLE IF NOT EXISTS business_carry_bills (
      businessType TEXT,
      shipmentCode TEXT,
      reportDate TEXT,
      sourceDate TEXT,
      status TEXT,
      primaryCategory TEXT,
      tagsJson TEXT,
      lastEventTime TEXT,
      lastEventDesc TEXT,
      lastCheckedDate TEXT,
      lastRunId TEXT,
      retryStatus TEXT,
      reason TEXT,
      recipient_raw TEXT,
      recipient_normalized TEXT,
      recipient_group TEXT DEFAULT 'OTHER',
      recipient_group_reason TEXT,
      source_row_number INTEGER,
      rawJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, shipmentCode, reportDate)
    );

    CREATE TABLE IF NOT EXISTS business_scan_results (
      businessType TEXT,
      shipmentCode TEXT,
      reportDate TEXT,
      isPod INTEGER,
      orderStatus TEXT,
      recipient_raw TEXT,
      recipient_normalized TEXT,
      recipient_group TEXT DEFAULT 'OTHER',
      recipient_group_reason TEXT,
      source_row_number INTEGER,
      rawJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, shipmentCode, reportDate)
    );

    CREATE TABLE IF NOT EXISTS business_shipment_tracks (
      businessType TEXT,
      shipmentCode TEXT,
      reportDate TEXT,
      shipmentStatus TEXT,
      statusText TEXT,
      apiStatus TEXT,
      rawJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, shipmentCode, reportDate)
    );

    CREATE TABLE IF NOT EXISTS business_track_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      shipmentCode TEXT,
      reportDate TEXT,
      eventTime TEXT,
      eventCode TEXT,
      rawJson TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS business_exception_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      shipmentCode TEXT,
      reportDate TEXT,
      exceptionType TEXT,
      exceptionDesc TEXT,
      reportTime TEXT,
      statusCode TEXT,
      fileId TEXT,
      rawJson TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS business_api_batches (
      businessType TEXT,
      reportDate TEXT,
      runId TEXT,
      apiName TEXT,
      batchKey TEXT,
      shipmentCodesJson TEXT,
      status TEXT,
      attemptCount INTEGER DEFAULT 0,
      resultCount INTEGER DEFAULT 0,
      errorMessage TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, reportDate, runId, apiName, batchKey)
    );

    CREATE TABLE IF NOT EXISTS business_final_rows (
      businessType TEXT,
      shipmentCode TEXT,
      reportDate TEXT,
      isPod INTEGER,
      primaryCategory TEXT,
      apiStatus TEXT,
      carryStatus TEXT,
      latestEventTime TEXT,
      latestEventDesc TEXT,
      latestNode TEXT,
      recipient_raw TEXT,
      recipient_normalized TEXT,
      recipient_group TEXT DEFAULT 'OTHER',
      recipient_group_reason TEXT,
      source_row_number INTEGER,
      rawJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, shipmentCode, reportDate)
    );

    CREATE TABLE IF NOT EXISTS business_history_summary (
      businessType TEXT,
      reportDate TEXT,
      summaryJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, reportDate)
    );

    CREATE TABLE IF NOT EXISTS business_run_locks (
      businessType TEXT,
      reportDate TEXT,
      runId TEXT,
      status TEXT,
      currentStage TEXT,
      batchIndex INTEGER DEFAULT 0,
      totalBatches INTEGER DEFAULT 0,
      errorMessage TEXT,
      lockedBy TEXT,
      lockedAt TEXT,
      completedAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (businessType, reportDate)
    );

    CREATE TABLE IF NOT EXISTS business_run_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      runId TEXT,
      reportDate TEXT,
      stage TEXT,
      batchIndex INTEGER,
      totalBatches INTEGER,
      status TEXT,
      payloadJson TEXT,
      errorMessage TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS business_export_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshotId TEXT UNIQUE,
      businessType TEXT,
      reportDate TEXT,
      runId TEXT,
      payloadJson TEXT,
      generatedAt TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS business_export_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      snapshotId TEXT,
      exportType TEXT,
      fileName TEXT,
      rowCount INTEGER,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS business_recipient_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      shipmentCode TEXT,
      groupsJson TEXT,
      rowsJson TEXT,
      status TEXT DEFAULT 'unresolved',
      createdAt TEXT,
      updatedAt TEXT,
      UNIQUE (businessType, reportDate, shipmentCode)
    );

    CREATE TABLE IF NOT EXISTS shop_whitelist_versions (
      version TEXT PRIMARY KEY,
      sourceFile TEXT,
      sourceSha256 TEXT,
      fileSha256 TEXT,
      active INTEGER DEFAULT 0,
      storeCount INTEGER DEFAULT 0,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS shop_whitelist_entries (
      version TEXT,
      shopCode TEXT,
      shopName TEXT,
      prefix TEXT,
      classificationEnabled INTEGER DEFAULT 1,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY (version, shopCode)
    );

    CREATE TABLE IF NOT EXISTS shop_whitelist_aliases (
      version TEXT,
      shopCode TEXT,
      alias TEXT,
      createdAt TEXT,
      PRIMARY KEY (version, shopCode, alias)
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      email TEXT PRIMARY KEY,
      displayName TEXT,
      department TEXT DEFAULT '质控部',
      role TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      createdAt TEXT,
      updatedAt TEXT,
      lastLoginAt TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      displayName TEXT NOT NULL,
      departmentCompany TEXT DEFAULT '',
      email TEXT UNIQUE,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'VIEWER',
      businessScope TEXT NOT NULL DEFAULT 'ALL',
      enabled INTEGER NOT NULL DEFAULT 1,
      expiresAt TEXT,
      mustChangePassword INTEGER NOT NULL DEFAULT 1,
      failedLoginCount INTEGER NOT NULL DEFAULT 0,
      lockedUntil TEXT,
      lastLoginAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      sessionHash TEXT NOT NULL UNIQUE,
      accessChannel TEXT NOT NULL,
      cloudflareEmail TEXT,
      ipAddress TEXT,
      userAgent TEXT,
      expiresAt TEXT NOT NULL,
      revokedAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userEmail TEXT,
      userRole TEXT,
      action TEXT,
      businessType TEXT,
      reportDate TEXT,
      runId TEXT,
      detailJson TEXT,
      ipAddress TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userEmail TEXT,
      title TEXT,
      body TEXT,
      readAt TEXT,
      createdAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_daily_parse_report ON daily_parse_rows(reportDate);
    CREATE INDEX IF NOT EXISTS idx_daily_parse_bill ON daily_parse_rows(shipmentCode);
    CREATE INDEX IF NOT EXISTS idx_daily_parse_report_bill ON daily_parse_rows(reportDate, shipmentCode);
    CREATE INDEX IF NOT EXISTS idx_track_events_report ON track_events(reportDate);
    CREATE INDEX IF NOT EXISTS idx_track_events_bill ON track_events(shipmentCode);
    CREATE INDEX IF NOT EXISTS idx_track_events_time ON track_events(eventTime);
    CREATE INDEX IF NOT EXISTS idx_track_events_report_bill_time ON track_events(reportDate, shipmentCode, eventTime);
    CREATE INDEX IF NOT EXISTS idx_run_checkpoints_report ON run_checkpoints(reportDate);
    CREATE INDEX IF NOT EXISTS idx_run_checkpoints_run ON run_checkpoints(runId);
    CREATE INDEX IF NOT EXISTS idx_run_checkpoints_stage_status ON run_checkpoints(stage, status);
    CREATE INDEX IF NOT EXISTS idx_shop_cp_codes_name ON shop_cp_codes(shopName);
    CREATE INDEX IF NOT EXISTS idx_business_daily_rows ON business_daily_parse_rows(businessType, reportDate, shipmentCode);
    CREATE INDEX IF NOT EXISTS idx_business_carry_active ON business_carry_bills(businessType, status, shipmentCode);
    CREATE INDEX IF NOT EXISTS idx_business_track ON business_track_events(businessType, reportDate, shipmentCode, eventTime);
    CREATE INDEX IF NOT EXISTS idx_business_shipment_track ON business_shipment_tracks(businessType, reportDate, shipmentCode);
    CREATE INDEX IF NOT EXISTS idx_business_exception ON business_exception_items(businessType, reportDate, shipmentCode, reportTime);
    CREATE INDEX IF NOT EXISTS idx_business_api_batch ON business_api_batches(businessType, reportDate, runId, apiName, status);
    CREATE INDEX IF NOT EXISTS idx_business_checkpoint ON business_run_checkpoints(businessType, reportDate, runId, status);
    CREATE INDEX IF NOT EXISTS idx_business_snapshot ON business_export_snapshots(businessType, reportDate, runId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_shop_whitelist_active ON shop_whitelist_versions(active, version);
    CREATE INDEX IF NOT EXISTS idx_shop_whitelist_entry ON shop_whitelist_entries(version, shopCode, classificationEnabled);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(createdAt, userEmail, action);
    CREATE INDEX IF NOT EXISTS idx_users_enabled ON users(enabled, username);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON user_sessions(userId, expiresAt, revokedAt);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(userEmail, readAt, createdAt);
  `);

    ensureColumn(db, 'export_snapshots', 'snapshotId', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'runId', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'metricsJson', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'detailCountsJson', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'dataHashesJson', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'consistencyJson', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'generatedAt', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'status', "TEXT DEFAULT 'LEGACY_UNVERIFIED'");
    ensureColumn(db, 'export_snapshots', 'reconciliationStatus', "TEXT DEFAULT 'UNVERIFIED'");
    ensureColumn(db, 'export_snapshots', 'invalidReason', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'whitelistVersion', 'TEXT');
    ensureColumn(db, 'export_snapshots', 'whitelistSha256', 'TEXT');
    ensureColumn(db, 'final_rows', 'lastEventCode', 'TEXT');
    ensureColumn(db, 'final_rows', 'lastEventDesc', 'TEXT');
    ensureColumn(db, 'final_rows', 'lastEventTargetNode', 'TEXT');
    ensureColumn(db, 'final_rows', 'lastEventActionType', 'TEXT');
    ensureColumn(db, 'final_rows', 'matchedRule', 'TEXT');
    ensureColumn(db, 'final_rows', 'matchedShopCode', 'TEXT');
    ensureColumn(db, 'final_rows', 'matchedShopName', 'TEXT');
    ensureColumn(db, 'final_rows', 'primaryCategory', 'TEXT');
    ensureColumn(db, 'final_rows', 'tagsJson', 'TEXT');
    ensureColumn(db, 'run_locks', 'currentStage', 'TEXT');
    ensureColumn(db, 'run_locks', 'batchIndex', 'INTEGER DEFAULT 0');
    ensureColumn(db, 'run_locks', 'totalBatches', 'INTEGER DEFAULT 0');
    ensureColumn(db, 'run_locks', 'errorMessage', 'TEXT');
    ensureColumn(db, 'run_locks', 'completedAt', 'TEXT');
    ensureColumn(db, 'carry_bills', 'lastCheckedDate', 'TEXT');
    ensureColumn(db, 'carry_bills', 'primaryCategory', 'TEXT');
    ensureColumn(db, 'carry_bills', 'tagsJson', 'TEXT');
    ensureColumn(db, 'carry_bills', 'lastEventDesc', 'TEXT');
    ensureColumn(db, 'carry_bills', 'matchedShopCode', 'TEXT');
    ensureColumn(db, 'carry_bills', 'lastRunId', 'TEXT');
    for (const table of ['final_rows', 'carry_bills']) {
      ensureColumn(db, table, 'targetShopCode', 'TEXT');
      ensureColumn(db, table, 'currentShopCode', 'TEXT');
      ensureColumn(db, table, 'shopName', 'TEXT');
      ensureColumn(db, table, 'shopCycleId', 'TEXT');
      ensureColumn(db, table, 'shopTransferStartedAt', 'TEXT');
      ensureColumn(db, table, 'shopArrivedAt', 'TEXT');
      ensureColumn(db, table, 'shopPendingAt', 'TEXT');
      ensureColumn(db, table, 'shopRetentionNaturalDays', 'INTEGER DEFAULT 0');
      ensureColumn(db, table, 'shopState', 'TEXT');
      ensureColumn(db, table, 'shopStateReason', 'TEXT');
      ensureColumn(db, table, 'whitelistVersion', 'TEXT');
    }
    ensureColumn(db, 'scan_results', 'needsTrackQuery', 'INTEGER DEFAULT 0');
    ensureColumn(db, 'scan_results', 'skipTrackReason', 'TEXT');
    ensureColumn(db, 'scan_results', 'scanBucket', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'source_row_number', 'INTEGER');
    ensureColumn(db, 'business_daily_parse_rows', 'recipient_raw', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'recipient_normalized', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'recipient_group', "TEXT DEFAULT 'OTHER'");
    ensureColumn(db, 'business_daily_parse_rows', 'recipient_group_reason', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'source_mode', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'source_sheet', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'header_row_number', 'INTEGER');
    ensureColumn(db, 'business_daily_parse_rows', 'import_disposition', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'region_code', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'region_type', 'TEXT');
    ensureColumn(db, 'business_daily_parse_rows', 'order_time', 'TEXT');
    ensureColumn(db, 'business_daily_reports', 'sourceMode', 'TEXT');
    ensureColumn(db, 'business_daily_reports', 'headerRowNumber', 'INTEGER');
    ensureColumn(db, 'business_daily_reports', 'fileFormat', 'TEXT');
    ensureColumn(db, 'business_scan_results', 'needsTrackQuery', 'INTEGER DEFAULT 0');
    ensureColumn(db, 'business_scan_results', 'skipTrackReason', 'TEXT');
    ensureColumn(db, 'business_scan_results', 'scanBucket', 'TEXT');
    for (const table of ['business_carry_bills', 'business_scan_results', 'business_final_rows']) {
      ensureColumn(db, table, 'recipient_raw', 'TEXT');
      ensureColumn(db, table, 'recipient_normalized', 'TEXT');
      ensureColumn(db, table, 'recipient_group', "TEXT DEFAULT 'OTHER'");
      ensureColumn(db, table, 'recipient_group_reason', 'TEXT');
      ensureColumn(db, table, 'source_row_number', 'INTEGER');
    }
    for (const table of ['business_carry_bills', 'business_final_rows']) {
      ensureColumn(db, table, 'currentMainCategory', 'TEXT');
      ensureColumn(db, table, 'auxiliaryFlagsJson', 'TEXT');
      ensureColumn(db, table, 'targetShopCode', 'TEXT');
      ensureColumn(db, table, 'currentShopCode', 'TEXT');
      ensureColumn(db, table, 'shopName', 'TEXT');
      ensureColumn(db, table, 'shopCycleId', 'TEXT');
      ensureColumn(db, table, 'shopTransferStartedAt', 'TEXT');
      ensureColumn(db, table, 'shopArrivedAt', 'TEXT');
      ensureColumn(db, table, 'shopLastEventAt', 'TEXT');
      ensureColumn(db, table, 'shopPendingAt', 'TEXT');
      ensureColumn(db, table, 'shopPendingReason', 'TEXT');
      ensureColumn(db, table, 'shopRetentionNaturalDays', 'INTEGER DEFAULT 0');
      ensureColumn(db, table, 'shopState', 'TEXT');
      ensureColumn(db, table, 'shopStateReason', 'TEXT');
      ensureColumn(db, table, 'whitelistVersion', 'TEXT');
      ensureColumn(db, table, 'firstAttemptAt', 'TEXT');
      ensureColumn(db, table, 'currentAttemptNo', 'INTEGER DEFAULT 0');
      ensureColumn(db, table, 'podAttemptNo', 'INTEGER DEFAULT 0');
      ensureColumn(db, table, 'attemptStatus', 'TEXT');
      ensureColumn(db, table, 'attemptConfidence', 'TEXT');
      ensureColumn(db, table, 'attemptUnknownReason', 'TEXT');
      ensureColumn(db, table, 'attemptHistoryJson', 'TEXT');
      ensureColumn(db, table, 'attemptCalculatedAt', 'TEXT');
    }
    ensureColumn(db, 'business_export_snapshots', 'status', "TEXT DEFAULT 'LEGACY_UNVERIFIED'");
    ensureColumn(db, 'business_export_snapshots', 'reconciliationStatus', "TEXT DEFAULT 'UNVERIFIED'");
    ensureColumn(db, 'business_export_snapshots', 'invalidReason', 'TEXT');
    ensureColumn(db, 'business_export_snapshots', 'whitelistVersion', 'TEXT');
    ensureColumn(db, 'business_export_snapshots', 'whitelistSha256', 'TEXT');
    ensureColumn(db, 'business_export_snapshots', 'payloadHash', 'TEXT');
    ensureColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
    ensureColumn(db, 'users', 'deletedAt', 'TEXT');
    ensureColumn(db, 'users', 'deletedBy', 'INTEGER');
    ensureColumn(db, 'business_api_batches', 'payloadHash', 'TEXT');
    ensureColumn(db, 'business_api_batches', 'shipmentCount', 'INTEGER DEFAULT 0');
    ensureColumn(db, 'business_api_batches', 'firstShipmentCode', 'TEXT');
    ensureColumn(db, 'business_api_batches', 'lastShipmentCode', 'TEXT');
    ensureColumn(db, 'business_api_batches', 'heartbeatAt', 'TEXT');
    ensureColumn(db, 'business_api_batches', 'startedAt', 'TEXT');
    ensureColumn(db, 'business_api_batches', 'completedAt', 'TEXT');
    ensureColumn(db, 'backup_records', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
    ensureColumn(db, 'backup_records', 'deletedAt', 'TEXT');
    ensureColumn(db, 'backup_records', 'deletedBy', 'TEXT');
    db.exec("UPDATE business_daily_parse_rows SET recipient_group='OTHER' WHERE recipient_group IS NULL OR TRIM(recipient_group)=''");
    db.exec("UPDATE business_carry_bills SET recipient_group='OTHER' WHERE recipient_group IS NULL OR TRIM(recipient_group)=''");
    db.exec("UPDATE business_scan_results SET recipient_group='OTHER' WHERE recipient_group IS NULL OR TRIM(recipient_group)=''");
    db.exec("UPDATE business_final_rows SET recipient_group='OTHER' WHERE recipient_group IS NULL OR TRIM(recipient_group)=''");
    db.exec('CREATE INDEX IF NOT EXISTS idx_business_daily_recipient_group ON business_daily_parse_rows(businessType, reportDate, recipient_group)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_business_daily_bill_recipient_group ON business_daily_parse_rows(businessType, reportDate, shipmentCode, recipient_group)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_business_final_recipient_group ON business_final_rows(businessType, reportDate, recipient_group)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_business_conflict_status ON business_recipient_conflicts(businessType, reportDate, status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_business_snapshot_valid ON business_export_snapshots(businessType, reportDate, status, reconciliationStatus, createdAt)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_export_snapshots_snapshot_id ON export_snapshots(snapshotId)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_export_snapshots_report ON export_snapshots(reportDate, createdAt)');

    seedDefaultShopCodes(db);
    const whitelist = seedLatestShopWhitelist(db);

    writeMeta(db, 'db_schema_version', String(SCHEMA_VERSION));
    writeMeta(db, 'app_version', '0.9.0');
    writeMeta(db, 'shop_whitelist_version', whitelist.version);
    writeMeta(db, 'shop_whitelist_sha256', whitelist.sourceSha256);
    writeMeta(db, 'last_startup_at', new Date().toISOString());
    writeMeta(db, 'last_migration_status', 'success');
    writeMeta(db, 'last_migration_backup', backupPath);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    verifyDatabase(db);
    db.prepare(`
      INSERT INTO migration_log(fromVersion, toVersion, status, backupPath, message, createdAt)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(existingVersion, SCHEMA_VERSION, 'success', backupPath, 'migration completed', new Date().toISOString());
    db.exec('COMMIT');
    return { fromVersion: existingVersion, toVersion: SCHEMA_VERSION, migrated: true, backupPath };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    const backupText = backupPath ? `，升级前备份：${backupPath}` : '';
    throw new Error(`数据库升级失败，已回滚${backupText}。原因：${error.message}`);
  }
}

function ensureColumn(db, table, column, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function seedDefaultShopCodes(db) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO shop_cp_codes(shopCode, shopName, sourceFile, createdAt, updatedAt)
    VALUES(?, ?, 'default', ?, ?)
    ON CONFLICT(shopCode) DO UPDATE SET updatedAt=excluded.updatedAt
  `);
  for (const code of DEFAULT_SHOP_CP_CODES) {
    stmt.run(code, code, now, now);
  }
}

function readSchemaVersion(db) {
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'").get();
    if (exists) {
      const row = db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get();
      if (row?.value) return Number(row.value || 0);
    }
    return Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
  } catch {
    return 0;
  }
}

function writeMeta(db, key, value) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_meta(key, value, updatedAt)
    VALUES(?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt
  `).run(key, value, now);
}

function backupDbFile(db, cfg) {
  if (!fs.existsSync(cfg.dbFile)) return '';
  fs.mkdirSync(cfg.backupsDir, { recursive: true });
  db.exec('PRAGMA wal_checkpoint(FULL)');
  const stamp = migrationStamp(new Date());
  const file = path.join(cfg.backupsDir, `backup_before_migration_${stamp}.db`);
  fs.copyFileSync(cfg.dbFile, file);
  return file;
}

function hasBusinessData(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const table of PERSISTED_TABLES) {
    if (!tables.includes(table)) continue;
    try {
      if (Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0) > 0) return true;
    } catch {}
  }
  return false;
}

function verifyDatabase(db) {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  const integrityValue = String(integrity?.integrity_check || Object.values(integrity || {})[0] || '');
  if (integrityValue.toLowerCase() !== 'ok') throw new Error(`integrity_check=${integrityValue || 'unknown'}`);
  const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const missing = REQUIRED_TABLES.filter(table => !existing.has(table));
  if (missing.length) throw new Error(`缺少关键表：${missing.join(', ')}`);
}

function migrationStamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
