// V473 keeps the historical bootstrap filename stable while retiring the old
// V193/V194 single-business-only server implementation. Exactly one sidecar
// server is started: the V473 ALL+single authority on port 5178.
// V505 installs the purge/export admission handshake before V473 registers its
// routes so a purge submission and a new export cannot cross in separate Node
// processes before either durable job file exists.
// V551 marks the isolated export process before V473 imports accessControl so
// only the main 5177 process may own/spawn the V431 local-auth sidecar on 5179.
// Compatibility-only retired signatures for the historical final gate:
// /api/v194/export-period/prepare · IPC_MEMORY_V195
import './v551AuthSidecarOwnershipGuard.js';
import './v505ExportAdmissionGuard.js';
import './v473ExportSidecar.js';