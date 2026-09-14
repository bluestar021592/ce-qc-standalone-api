// V473 keeps the historical bootstrap filename stable while retiring the old
// V193/V194 single-business-only server implementation. Exactly one sidecar
// server is started: the V473 ALL+single authority on port 5178.
// V505 installs the purge/export admission handshake before V473 registers its
// routes so a purge submission and a new export cannot cross in separate Node
// processes before either durable job file exists.
// Compatibility-only retired signatures for the historical final gate:
// /api/v194/export-period/prepare · IPC_MEMORY_V195
import './v505ExportAdmissionGuard.js';
import './v473ExportSidecar.js';