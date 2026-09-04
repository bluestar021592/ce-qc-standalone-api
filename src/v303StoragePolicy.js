import { applyStoragePolicy, STORAGE_POLICY_ID } from './storagePolicy.js';

export const V303_STORAGE_POLICY_ID='2026-08-25-v303-cd-split-storage-v1';

// Compatibility shim only. Path ownership now belongs to src/storagePolicy.js so
// bootstrap, db.js and workers cannot each invent a different C/D layout.
const layout=applyStoragePolicy();
console.log('[CE-QC][V303_STORAGE_POLICY_COMPAT]',JSON.stringify({
  legacyId:V303_STORAGE_POLICY_ID,
  corePolicyId:STORAGE_POLICY_ID,
  runtimeRoot:layout.runtimeRoot,
  dataRoot:layout.dataRoot,
  database:layout.dbFile,
  exportsDir:layout.exportsDir,
  importsDir:layout.importsDir,
  backupsDir:layout.backupsDir,
  logsDir:layout.logsDir,
  evidenceArchiveDir:layout.evidenceArchiveDir,
  role:'COMPATIBILITY_SHIM_NO_PATH_OWNERSHIP'
}));
