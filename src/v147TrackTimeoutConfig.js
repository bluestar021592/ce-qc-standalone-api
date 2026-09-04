// Legacy import path retained temporarily so bootstrap.js and old smoke gates keep
// working while runtime startup ownership moves to the unversioned coordinator.
// All real behavior now lives in runtimePreload.js; do not add new policy here.
import './runtimePreload.js';
export * from './runtimePreload.js';
