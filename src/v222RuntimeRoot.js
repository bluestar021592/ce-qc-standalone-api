// V222 cycle-free runtime root.
// CEClient imports authStore first, then this module. That guarantees token storage
// is fully initialized before runtime patches import it, while still installing the
// login, localhost CE access and bootstrap recovery hooks before server.js creates
// and registers its Express application middleware/routes.
import './v209LoginReliabilityPatch.js';
import './v220LocalOwnerAccessPatch.js';
import './v43BootstrapPerfPatch.js';
import './v221BootstrapRecoveryPatch.js';

export const V222_RUNTIME_ROOT_VERSION = '2026-08-19-v222-cycle-free-runtime-root-v1';
