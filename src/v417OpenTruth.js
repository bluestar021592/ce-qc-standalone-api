export const V417_OPEN_RUNTIME_TRUTH_ID='2026-09-02-v417-current-and-historical-open-reconciliation-v1';

const HARD_TERMINALS=new Set([
  'POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CANCELLED',
  'CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION',
  'SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION'
]);
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;

function placeholders(values){return values.map(()=>'?').join(',');}
function hardValues(){return [...HARD_TERMINALS];}
function currentTotal(counts={}){return TYPES.reduce((sum,type)=>sum+n(counts[type]),0);}
function nonWhppTotal(counts={}){return TYPES.filter(type=>type!=='WHPP').reduce((sum,type)=>sum+n(counts[type]),0);}

function currentNonWhppHardClosed(db,batch){
  const snapshotId=text(batch?.snapshotId),date=text(batch?.reportDate);
  if(!snapshotId||!date)return{ok:false,count:0,reason:'CURRENT_SCOPE_MISSING'};
  const terminals=hardValues(),marks=placeholders(terminals);
  try{
    const count=n(db.prepare(`SELECT COUNT(DISTINCT u.shipmentCode) count
      FROM unified_import_rows u
      LEFT JOIN shipment_current_state s ON s.shipmentCode=u.shipmentCode
      LEFT JOIN carryover_open_items c ON c.shipmentCode=u.shipmentCode
      WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType<>'WHPP'
        AND (
          UPPER(COALESCE(s.state,'')) IN (${marks})
          OR (UPPER(COALESCE(c.status,''))='CLOSED' AND UPPER(COALESCE(c.closeReason,'')) IN (${marks}))
        )`).get(snapshotId,date,...terminals,...terminals)?.count);
    return{ok:true,count,reason:'CURRENT_NON_WHPP_HARD_TERMINALS'};
  }catch(error){return{ok:false,count:0,reason:`CURRENT_NON_WHPP_TERMINAL_READ_FAILED:${text(error?.message||error)}`};}
}

function currentWhppHardClosed(db,date){
  const reportDate=text(date);
  if(!reportDate)return{ok:false,count:0,reason:'WHPP_DATE_MISSING'};
  const terminals=hardValues(),marks=placeholders(terminals);
  try{
    const count=n(db.prepare(`SELECT COUNT(DISTINCT d.shipmentCode) count
      FROM business_daily_parse_rows d
      LEFT JOIN business_pod_locks p
        ON p.businessType='WHPP' AND p.shipmentCode=d.shipmentCode
      LEFT JOIN business_final_rows f
        ON f.businessType='WHPP' AND f.shipmentCode=d.shipmentCode AND f.reportDate=d.reportDate
      WHERE d.businessType='WHPP' AND d.reportDate=? AND TRIM(COALESCE(d.shipmentCode,''))<>''
        AND (
          p.shipmentCode IS NOT NULL
          OR COALESCE(f.isPod,0)=1
          OR UPPER(COALESCE(f.primaryCategory,'')) IN (${marks})
        )`).get(reportDate,...terminals)?.count);
    return{ok:true,count,reason:'CURRENT_WHPP_HARD_TERMINALS'};
  }catch(error){return{ok:false,count:0,reason:`CURRENT_WHPP_TERMINAL_READ_FAILED:${text(error?.message||error)}`};}
}

function historicalNonterminalCount(db,date){
  const reportDate=text(date);
  if(!reportDate)return{ok:false,count:0,reason:'HISTORICAL_DATE_MISSING'};
  const terminals=hardValues(),marks=placeholders(terminals);
  try{
    const count=n(db.prepare(`SELECT COUNT(DISTINCT c.shipmentCode) count
      FROM carryover_open_items c
      LEFT JOIN shipment_current_state s ON s.shipmentCode=c.shipmentCode
      WHERE c.sourceReportDate<? AND UPPER(COALESCE(c.status,'')) IN ('OPEN','CLOSED')
        AND NOT (
          UPPER(COALESCE(s.state,'')) IN (${marks})
          OR (UPPER(COALESCE(c.status,''))='CLOSED' AND UPPER(COALESCE(c.closeReason,'')) IN (${marks}))
        )`).get(reportDate,...terminals,...terminals)?.count);
    return{ok:true,count,reason:'HISTORICAL_NONTERMINAL_RECONCILIATION'};
  }catch(error){return{ok:false,count:0,reason:`HISTORICAL_OPEN_READ_FAILED:${text(error?.message||error)}`};}
}

export function reconcileV417Carryover(db,{batch=null,counts={},baseCarry={}}={}){
  const total=currentTotal(counts),nonWhpp=nonWhppTotal(counts),whpp=n(counts.WHPP);
  const persistedToday=n(baseCarry.todayOpen),persistedHistorical=n(baseCarry.historicalOpen);
  if(!db||!batch?.reportDate||total<=0){
    return{
      ...baseCarry,
      todayOpen:persistedToday,
      historicalOpen:persistedHistorical,
      currentOpen:persistedToday+persistedHistorical,
      historicalSeparate:true,
      runtimeTruth:'TODAY_OPEN_PLUS_HISTORICAL_OPEN',
      v417OpenTruthId:V417_OPEN_RUNTIME_TRUTH_ID,
      v417Reconciled:false
    };
  }

  const nonWhppClosed=currentNonWhppHardClosed(db,batch);
  const whppClosed=currentWhppHardClosed(db,batch.reportDate);
  const historical=historicalNonterminalCount(db,batch.reportDate);

  const conservativeToday=Math.max(0,nonWhpp-Math.min(nonWhpp,n(nonWhppClosed.count)))
    +Math.max(0,whpp-Math.min(whpp,n(whppClosed.count)));
  const todayOpen=Math.max(persistedToday,conservativeToday);
  const historicalOpen=Math.max(persistedHistorical,historical.ok?n(historical.count):persistedHistorical);

  return{
    ...baseCarry,
    todayOpen,
    historicalOpen,
    currentOpen:todayOpen+historicalOpen,
    historicalSeparate:true,
    runtimeTruth:'V417_BUSINESS_CLOSURE_RECONCILED_OPEN',
    v417OpenTruthId:V417_OPEN_RUNTIME_TRUTH_ID,
    v417Reconciled:true,
    persistedTodayOpen:persistedToday,
    persistedHistoricalOpen:persistedHistorical,
    conservativeCurrentOpen:conservativeToday,
    hardTerminalClosedNonWhpp:Math.min(nonWhpp,n(nonWhppClosed.count)),
    hardTerminalClosedWhpp:Math.min(whpp,n(whppClosed.count)),
    terminalReadOk:Boolean(nonWhppClosed.ok&&whppClosed.ok),
    terminalReadReasons:[nonWhppClosed.reason,whppClosed.reason],
    historicalReconciledOpen:historical.ok?n(historical.count):persistedHistorical,
    historicalReadOk:Boolean(historical.ok),
    historicalReadReason:historical.reason,
    processingCompleteDoesNotCloseOpen:true
  };
}

export const V417_HARD_TERMINALS=Object.freeze([...HARD_TERMINALS]);
