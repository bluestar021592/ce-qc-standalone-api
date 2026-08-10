// Final public facade.
// Preserve historical helper exports while routing current CE/CEAF/TBKH/ALI1688
// classification through the locked final trajectory-state safety wrapper.
export * from './analyzerLegacy.js';
export { analyzeShipment } from './analyzerFinal.js';
