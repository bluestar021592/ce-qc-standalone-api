// V788: a *current* special routing/retention fact is not unfinished
// delivery. Keep original ledger rows immutable; never infer a historical
// terminal state from an old classification if a later live state exists.
const ROUTED=new Set([
  'SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION',
  'CCSL580_RETENTION','CCSL580_DIVERSION',
  'CCSLCN_DIVERSION','CCSLZT_DIVERSION',
  'CECN','CEZT','CCSLCN','CCSLZT','CCSL580'
]);
const norm=value=>String(value??'').trim().toUpperCase().replace(/^(?:CE|CEL):/,'');
export function v788IsCurrentSpecialNonDelivery(record={}){
  // A direct RETURNING (80) must remain open, whatever an older label says.
  const shipmentStatus=String(record.shipmentStatus??record.shipmentTrack?.shipmentStatus??'').trim();
  if(shipmentStatus==='80')return false;
  // Prefer current validated state over a stale specialState/category field.
  const active=norm(record.currentState||record.scanNormalizedState);
  if(active){
    if(ROUTED.has(active))return true;
    if(active==='OTHER_NORMAL'||active==='SPECIAL_ROUTING')
      return ROUTED.has(norm(record.specialState));
    return false;
  }
  return ROUTED.has(norm(record.specialState));
}
export const V788_OPEN_SPECIAL_RULE_ID='2026-10-19-v788-open-pod-current-special-v1';
