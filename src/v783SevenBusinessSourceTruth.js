// V783: only the selected unified import owns its reported source total.
// WHPP daily-parse membership may be independent of that import. Never mark a
// 7-business display "balanced" merely because its own sum equals itself.
const TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']);
export function readSelectedDateBusinessSourceTruth(db,{reportDate='',snapshotId=''}={}){
  const day=String(reportDate||'').slice(0,10);
  const snapshot=String(snapshotId||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!snapshot)throw new Error('报告日期或快照缺失');
  const batch=db.prepare("SELECT batchId,summaryJson FROM unified_import_batches WHERE reportDate=? AND snapshotId=? AND status='VALID' LIMIT 1").get(day,snapshot);
  if(!batch)throw new Error('没有找到当前日期对应的有效日报快照');
  const counts=Object.fromEntries(TYPES.map(type=>[type,0]));
  const rows=db.prepare("SELECT businessType,COUNT(DISTINCT UPPER(TRIM(shipmentCode))) n FROM unified_import_rows WHERE batchId=? GROUP BY businessType").all(batch.batchId);
  for(const row of rows)if(Object.hasOwn(counts,row.businessType))counts[row.businessType]=Number(row.n||0);
  const sourceTotal=Number(JSON.parse(batch.summaryJson||'{}').validUniqueWaybills||0);
  const classifiedTotal=Object.values(counts).reduce((a,b)=>a+b,0);
  const standAlone=db.prepare(`SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) n FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''`).get(day);
  const whppSeparate=Number(standAlone?.n||0);
  const overlapRows=db.prepare(`SELECT u.businessType,COUNT(DISTINCT UPPER(TRIM(p.shipmentCode))) n
    FROM business_daily_parse_rows p
    JOIN unified_import_rows u ON UPPER(TRIM(u.shipmentCode))=UPPER(TRIM(p.shipmentCode))
      AND u.batchId=? AND u.reportDate=?
    WHERE p.businessType='WHPP' AND p.reportDate=? AND TRIM(COALESCE(p.shipmentCode,''))<>''
    GROUP BY u.businessType`).all(batch.batchId,day,day);
  const overlapByBusiness=Object.fromEntries(overlapRows.map(row=>[row.businessType,Number(row.n||0)]));
  const duplicateWithImport=Object.values(overlapByBusiness).reduce((a,b)=>a+b,0);
  const separateNotInImport=Math.max(0,whppSeparate-duplicateWithImport);
  const crossBusinessOverlap=Object.entries(overlapByBusiness)
    .filter(([type])=>type!=='WHPP').reduce((sum,[,n])=>sum+n,0);
  const sourceBalanced=classifiedTotal===sourceTotal;
  const status=!sourceBalanced?'SOURCE_IMPORT_MISMATCH'
    :crossBusinessOverlap?'WHPP_CROSS_BUSINESS_OVERLAP'
    :separateNotInImport?'WHPP_SEPARATE_SOURCE_ONLY'
    :'SOURCE_COUNTS_RECONCILED';
  return {
    ok:true,readOnly:true,reportDate:day,snapshotId:snapshot,
    source:{validUniqueWaybills:sourceTotal,classifiedTotal,balanced:sourceBalanced,counts},
    whppIndependent:{total:whppSeparate,alreadyInImport:duplicateWithImport,crossBusinessOverlap,
      overlapByBusiness,separateNotInImport,memberEvidencePreserved:true},
    display:{naiveSum:classifiedTotal+Math.max(0,whppSeparate-counts.WHPP),
      distinctUnion:sourceTotal+separateNotInImport,
      hasUnresolvedConflict:!sourceBalanced||crossBusinessOverlap>0},
    status
  };
}
