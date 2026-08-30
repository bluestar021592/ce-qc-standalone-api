import { getDb } from './db.js';

export const V366_ATOMIC_UNIFIED_IMPORT_ID = '2026-08-30-v366-atomic-seven-business-import-v2';

const LOCK_KEY = Symbol.for('ce-qc.v366-atomic-unified-import-lock');

function txCommand(sql) {
  return String(sql || '')
    .trim()
    .replace(/;+\s*$/, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function isBegin(command) {
  return command === 'BEGIN'
    || command === 'BEGIN IMMEDIATE'
    || command === 'BEGIN EXCLUSIVE'
    || command === 'BEGIN DEFERRED';
}

function safeMessage(error) {
  return String(error?.message || error || 'unknown error').slice(0, 1000);
}

export async function runAtomicUnifiedImportV366(finalHandler, req, res, next) {
  return runAtomicUnifiedImportWithDbV366(finalHandler, req, res, next, getDb(), { useGlobalLock: true });
}

// Exported so the go-live gate can execute the exact production transaction
// algorithm against an in-memory node:sqlite DatabaseSync. Production always
// enters through runAtomicUnifiedImportV366 above and therefore uses the real
// singleton database plus the global single-import lock.
export async function runAtomicUnifiedImportWithDbV366(finalHandler, req, res, next, db, options = {}) {
  if (typeof finalHandler !== 'function') throw new TypeError('V366 requires the final unified-import handler.');
  if (!db || typeof db.exec !== 'function') throw new TypeError('V366 requires a SQLite database with exec().');
  const useGlobalLock = options.useGlobalLock !== false;
  if (useGlobalLock && globalThis[LOCK_KEY]) {
    return res.status(409).json({
      ok: false,
      code: 'UNIFIED_IMPORT_ALREADY_ACTIVE',
      error: '当前已有日报正在提交，请等待本次提交完成后再操作。',
      atomicImportId: V366_ATOMIC_UNIFIED_IMPORT_ID
    });
  }

  const hadOwnExec = Object.prototype.hasOwnProperty.call(db, 'exec');
  const previousOwnExec = hadOwnExec ? db.exec : null;
  const originalExec = db.exec.bind(db);
  const originalJson = res.json.bind(res);
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let outerActive = false;
  let nestedDepth = 0;
  let innerRollbackSeen = false;
  let buffered = null;
  let handlerResult;
  let handlerError = null;

  if (useGlobalLock) globalThis[LOCK_KEY] = token;

  const restoreExec = () => {
    try {
      if (hadOwnExec) db.exec = previousOwnExec;
      else delete db.exec;
    } catch {}
  };

  try {
    db.exec = function v366AtomicExec(sql, ...args) {
      const command = txCommand(sql);
      if (!outerActive) return originalExec(sql, ...args);
      if (isBegin(command)) {
        nestedDepth += 1;
        return db;
      }
      if (command === 'COMMIT') {
        if (nestedDepth > 0) nestedDepth -= 1;
        return db;
      }
      if (command === 'ROLLBACK') {
        if (nestedDepth > 0) nestedDepth -= 1;
        innerRollbackSeen = true;
        return db;
      }
      return originalExec(sql, ...args);
    };

    // V42 returns JSON from both success and failure branches. Buffer that JSON
    // until the outer SQLite transaction has definitely committed or rolled back,
    // so the browser can never observe a success before the seven-business state
    // is durable as one unit.
    res.json = function v366BufferedJson(payload) {
      buffered = { statusCode: Number(res.statusCode || 200), payload };
      return res;
    };

    originalExec('BEGIN IMMEDIATE');
    outerActive = true;

    try {
      handlerResult = await finalHandler.call(this, req, res, next);
    } catch (error) {
      handlerError = error;
    }

    const bufferedStatus = Number(buffered?.statusCode || res.statusCode || 200);
    const payload = buffered?.payload;
    const explicitFailure = payload?.ok === false;
    const explicitCommit = payload?.importCommitted === true;
    const nestingLeak = nestedDepth !== 0;
    const successfulImport = !handlerError
      && bufferedStatus < 400
      && !explicitFailure
      && explicitCommit
      && !innerRollbackSeen
      && !nestingLeak;

    if (successfulImport) {
      originalExec('COMMIT');
      outerActive = false;
      console.log(`[CE-QC][V366_ATOMIC_IMPORT_COMMIT] reportDate=${payload?.reportDate || ''} nestedDepth=${nestedDepth}`);
    } else {
      try { originalExec('ROLLBACK'); } catch {}
      outerActive = false;
      if (bufferedStatus < 400 && !handlerError) {
        const reason = nestingLeak
          ? `内部事务未闭合 nestedDepth=${nestedDepth}`
          : innerRollbackSeen
            ? '内部步骤曾请求ROLLBACK'
            : explicitCommit
              ? '提交确认不完整'
              : '后端未返回importCommitted=true';
        buffered = {
          statusCode: 500,
          payload: {
            ok: false,
            code: 'ATOMIC_IMPORT_COMMIT_BLOCKED',
            error: `日报未完整提交，已整体回滚：${reason}。上一份正式日报继续生效。`,
            atomicImportId: V366_ATOMIC_UNIFIED_IMPORT_ID
          }
        };
      }
      console.warn(`[CE-QC][V366_ATOMIC_IMPORT_ROLLBACK] status=${bufferedStatus} nestedDepth=${nestedDepth} innerRollback=${innerRollbackSeen ? 1 : 0} error=${safeMessage(handlerError)}`);
    }
  } catch (error) {
    handlerError = handlerError || error;
    if (outerActive) {
      try { originalExec('ROLLBACK'); } catch {}
      outerActive = false;
    }
  } finally {
    res.json = originalJson;
    restoreExec();
    if (useGlobalLock && globalThis[LOCK_KEY] === token) delete globalThis[LOCK_KEY];
  }

  if (handlerError) throw handlerError;
  if (buffered) {
    res.status(buffered.statusCode || 200);
    return originalJson(buffered.payload);
  }
  return handlerResult;
}
