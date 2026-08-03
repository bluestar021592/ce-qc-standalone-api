import { mergeHistorySummary } from './longBackup.js';

export function mergeBackupModule(state = {}, imported = {}, options = {}) {
  const businessType = String(options.businessType || state.businessType || 'CCSL').toUpperCase();
  const normalize = value => String(value || '').trim().toUpperCase();
  const unique = values => [...new Set((values || []).map(normalize).filter(Boolean))];
  const currentPods = unique(state.podLocks);
  const importedPods = unique(imported.podLocks);
  const podLocks = unique([...currentPods, ...importedPods]);
  const podSet = new Set(podLocks);
  const currentCarry = unique(state.nextCarryBills?.length ? state.nextCarryBills : state.carryBills);
  const importedCarry = unique(imported.carryBills);
  const carryBills = unique([...currentCarry, ...importedCarry]).filter(bill => !podSet.has(bill));

  state.businessType = businessType;
  state.podLocks = podLocks;
  state.carryBills = carryBills;
  state.nextCarryBills = carryBills;
  if (businessType === 'SHOPEE') {
    const metadata = new Map([...(state.priorCarryRows || []), ...(imported.carryRows || [])]
      .map(row => [normalize(row?.shipmentCode || row?.运单号), row])
      .filter(([bill]) => bill && carryBills.includes(bill)));
    state.priorCarryRows = [...metadata.values()];
  }
  state.historySummary = mergeHistorySummary(state.historySummary || [], imported.historySummary || []);
  state.backupImportedAt = new Date(options.importedAt || Date.now()).toISOString();
  state.backupSummary = {
    businessType,
    podLocks: importedPods.length,
    carry: importedCarry.filter(bill => !podSet.has(bill)).length,
    filteredPod: importedCarry.filter(bill => podSet.has(bill)).length,
    excluded: Number(imported.summary?.excluded || 0),
    history: (imported.historySummary || []).length,
    mode: 'light'
  };
  return state.backupSummary;
}
