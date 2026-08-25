import { BUSINESS_DATA_TABLES } from './store.js';

export const V294_CLEAN_REUPLOAD_INTEGRITY_ID = '2026-08-25-v294-clean-reupload-integrity-v1';
export const V294_CLEAN_SLATE_TABLES = Object.freeze(['qc_tracking_ledger','qc_tracking_audit']);

export function installV294CleanSlateTargets(targets = BUSINESS_DATA_TABLES) {
  for (const table of V294_CLEAN_SLATE_TABLES) {
    if (!targets.includes(table)) targets.push(table);
  }
  return targets;
}

export function assertV294CleanSlateTargets(targets = BUSINESS_DATA_TABLES) {
  const missing = V294_CLEAN_SLATE_TABLES.filter(table => !targets.includes(table));
  if (missing.length) throw new Error(`V294 full-clear target missing: ${missing.join(',')}`);
  return true;
}

installV294CleanSlateTargets();
assertV294CleanSlateTargets();

console.info('[CE-QC][V294_CLEAN_REUPLOAD_INTEGRITY]', V294_CLEAN_REUPLOAD_INTEGRITY_ID,
  'full business purge includes qc_tracking_ledger + qc_tracking_audit so a clean re-upload cannot inherit old POD/attempt/signing lifecycle truth.');
