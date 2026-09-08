// V473 keeps the historical bootstrap filename stable while retiring the old
// V193/V194 single-business-only server implementation. Exactly one sidecar
// server is started: the V473 ALL+single authority on port 5178.
// Compatibility-only retired signatures for the historical final gate:
// /api/v194/export-period/prepare · IPC_MEMORY_V195
import './v473ExportSidecar.js';
