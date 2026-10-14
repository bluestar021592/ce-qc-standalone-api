export function trustedWhppPodTime(lock,date){
  const source=String(lock?.source||'').trim().toLowerCase();
  if(!['whpp_strict_track_event','whpp_saved_scan_pod_time','whpp_saved_final_pod_time','whpp_shipment_status_60_explicit_pod_time'].includes(source))
    return '';
  const text=String(lock?.podTime||'').trim();
  const m=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/.exec(text);
  if(!m)return '';
  const y=Number(m[1]),month=Number(m[2]),d=Number(m[3]);
  const parsed=new Date(Date.UTC(y,month-1,d));
  if(parsed.getUTCFullYear()!==y||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==d)return '';
  if(text.slice(0,10)<String(date||'').slice(0,10))return '';
  return text;
}
export function loadWhppTrustedPodTime(db,shipmentCode,reportDate){
  if(!db||!shipmentCode||!reportDate)return '';
  try{
    const row=db.prepare("SELECT podTime,source FROM business_pod_locks WHERE businessType='WHPP' AND shipmentCode=? LIMIT 1").get(String(shipmentCode).trim().toUpperCase());
    return trustedWhppPodTime(row,reportDate);
  }catch{return ''}
}

/**
 * A shipment-status 60 is evidence of POD, NOT by itself the time of POD.
 * Only explicitly named POD/delivery completion fields may provide a timestamp.
 * Generic API row update, scan, record creation or status refresh timestamps
 * are intentionally excluded. No inference from eventCode or orderStatus 85.
 */
export function explicitWhppTms60PodTime(row={},reportDate=''){
  if(String(row?.shipmentStatus??'').trim()!=='60')return '';
  const fields=[
    'podTime','POD时间','签收时间','podDateTime','podDate','deliveryTime',
    'deliveryCompletedAt','deliveredAt','deliveredTime',
    'signedTime','signedAt','signTime','signDateTime','actualDeliveryTime'
  ];
  for(const key of fields){
    const candidate=String(row?.[key]??'').trim();
    const valid=trustedWhppPodTime({
      podTime:candidate,source:'whpp_shipment_status_60_explicit_pod_time'
    },reportDate);
    if(valid)return valid;
  }
  return '';
}
