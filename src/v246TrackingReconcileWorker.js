import { getDb, closeDb } from './db.js';
import { ensureV246TrackingSchema, reconcileV246TrackingLedger } from './v246TrackingLedgerCore.js';

export const V448_V246_RECONCILE_WORKER_ID = '2026-09-07-v448-isolated-v246-ledger-reconcile-v1';

let started = false;

function reply(payload, code = 0) {
  if (typeof process.send === 'function') {
    process.send(payload, () => {
      try { closeDb(); } catch {}
      process.exit(code);
    });
    return;
  }
  try { process.stdout.write(`${JSON.stringify(payload)}\n`); } catch {}
  try { closeDb(); } catch {}
  process.exit(code);
}

process.on('message', message => {
  if (started) return;
  started = true;
  try {
    const selection = message?.selection || {};
    const reason = String(message?.reason || 'V448_ISOLATED_RECONCILE');
    const db = getDb();
    ensureV246TrackingSchema(db);
    const result = reconcileV246TrackingLedger(selection, { db, reason });
    reply({ ok:true, worker:V448_V246_RECONCILE_WORKER_ID, result }, 0);
  } catch (error) {
    reply({ ok:false, worker:V448_V246_RECONCILE_WORKER_ID, error:error?.message || String(error) }, 1);
  }
});

process.on('disconnect', () => {
  if (!started) {
    try { closeDb(); } catch {}
    process.exit(0);
  }
});
