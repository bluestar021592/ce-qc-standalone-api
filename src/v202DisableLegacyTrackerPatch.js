// V201 counted distinct dispatch/assignment dates as attempts. V202 replaces that
// with real delivery cycles, so the legacy background writer must not keep
// producing a second conflicting attempt truth table. It remains opt-in only for
// emergency comparison by setting CE_QC_ENABLE_LEGACY_V201_TRACKER=1 before boot.
export const V202_DISABLE_LEGACY_TRACKER_VERSION='2026-08-18-v202-retire-v201-attempt-scheduler-v1';
if(String(process.env.CE_QC_ENABLE_LEGACY_V201_TRACKER||'')!=='1'){
  process.env.CE_QC_DISABLE_SHOPEE_DELIVERY_TRACKER='1';
}
