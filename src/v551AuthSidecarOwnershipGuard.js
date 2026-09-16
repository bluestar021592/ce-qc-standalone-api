export const V551_AUTH_SIDECAR_SINGLE_OWNER_ID='2026-09-16-v551-export-child-no-auth-sidecar-v1';

// The isolated V473 export process imports accessControl only to validate the
// existing 5177-issued/local-auth session. It must never become another V431
// sidecar supervisor. accessControl already treats CE_QC_LOCAL_AUTH_CHILD=1 as
// a no-spawn signal, and every export worker inherits this process environment.
process.env.CE_QC_LOCAL_AUTH_CHILD='1';

console.info('[CE-QC][V551_AUTH_SINGLE_OWNER_GUARD]',V551_AUTH_SIDECAR_SINGLE_OWNER_ID,'5178/export workers cannot spawn V431; 5177 remains the sole local-auth sidecar owner.');
