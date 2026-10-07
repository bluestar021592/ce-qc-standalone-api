import { getDb } from './db.js';
import { persistentSelectedDatePodBills } from './selectedDatePersistentTruth.js';
import { extractDailyReportSigningEvidence, dailyReportProvesPod } from './dailyReportSigningTiming.js';

export const V745_WHPP_TIMING_SOURCE_DIAG='2026-10-07-v745-whpp-daily-source-diagnostic-v1';

function text(value){return String(value??'').trim();}
function safeJson(value){try{return JSON.parse(value||'{}')}catch{return{}}}
function rawOf(row={}){
  const parsed=safeJson(row.rowJson);
  return parsed?.raw&&typeof parsed.raw==='object'?parsed.raw:parsed;
}
function looksTimingKey(key=''){
  return /(time|date|status|pod|delivery|deliver|booking|sign|签收|派件|下单|状态|妥投)/i.test(String(key||''));
}
function fieldGroup(raw={}){
  const out={};
  for(const [key,value] of Object.entries(raw||{})){
    if(!looksTimingKey(key)||!text(value))continue;
    out[key]=text(value).slice(0,120);
  }
  return out;
}
function candidate(raw={},keys=[]){
  for(const key of keys){if(text(raw?.[key]))return {key,value:text(raw[key])}}
  return {key:'',value:''};
}

export function diagnoseWhppDailyTimingSources(reportDate='',limit=8){
  const date=text(reportDate).slice(0,10),db=getDb();
  const bills=persistentSelectedDatePodBills(db,'WHPP',date);
  const values=[...new Set(bills.map(x=>text(x).toUpperCase()).filter(Boolean))];
  const observationsByBill=new Map();
  const keyStats=new Map();
  let observationRows=0,terminalRows=0,orderTimeRows=0,deliveryTimeRows=0,validRows=0,validBills=0;

  for(let i=0;i<values.length;i+=300){
    const chunk=values.slice(i,i+300),marks=chunk.map(()=>'?').join(',');
    let rows=[];
    try{
      rows=db.prepare(`SELECT UPPER(TRIM(u.shipmentCode)) shipmentCode,u.reportDate,u.createdAt,u.rowJson,u.regionCode
        FROM unified_import_rows u
        JOIN unified_import_batches b ON b.batchId=u.batchId AND b.status='VALID'
        WHERE u.reportDate>=? AND UPPER(TRIM(u.businessType))='WHPP'
          AND UPPER(TRIM(u.shipmentCode)) IN (${marks})
        ORDER BY UPPER(TRIM(u.shipmentCode)),u.reportDate DESC,u.createdAt DESC,u.rowid DESC`)
        .all(date,...chunk);
    }catch{}
    for(const row of rows){
      observationRows++;
      const bill=text(row.shipmentCode).toUpperCase();
      const raw=rawOf(row);
      const terminal=dailyReportProvesPod(raw);
      const order=candidate(raw,['下单时间','下单日期','订单时间','订单日期','orderTime','orderDate','bookingDate']);
      const delivery=candidate(raw,['派件时间','签收时间','POD时间','podTime','deliveryTime','deliveryDate','deliveredAt','deliveryCompletedAt']);
      const evidence=extractDailyReportSigningEvidence(raw);
      if(terminal)terminalRows++;
      if(order.value)orderTimeRows++;
      if(delivery.value)deliveryTimeRows++;
      if(evidence?.ok)validRows++;
      for(const [key,value] of Object.entries(fieldGroup(raw))){
        const item=keyStats.get(key)||{key,count:0,samples:[]};
        item.count++;
        if(item.samples.length<4&&!item.samples.includes(value))item.samples.push(value);
        keyStats.set(key,item);
      }
      if(!observationsByBill.has(bill))observationsByBill.set(bill,[]);
      const list=observationsByBill.get(bill);
      if(list.length<5)list.push({
        reportDate:text(row.reportDate),regionCode:text(row.regionCode),terminal,
        orderTime:order.value,orderTimeField:order.key,
        deliveryTime:delivery.value,deliveryTimeField:delivery.key,
        evidenceOk:Boolean(evidence?.ok),evidenceReason:text(evidence?.reason),
        timingFields:fieldGroup(raw)
      });
    }
  }

  for(const bill of values){
    const rows=observationsByBill.get(bill)||[];
    if(rows.some(row=>row.evidenceOk))validBills++;
  }
  const topFields=[...keyStats.values()].sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key)).slice(0,30);
  const samples=values.slice(0,Math.max(1,Math.min(Number(limit||8),20))).map(bill=>({shipmentCode:bill,observations:observationsByBill.get(bill)||[]}));
  return{
    ok:true,id:V745_WHPP_TIMING_SOURCE_DIAG,reportDate:date,
    podMembers:values.length,observationRows,terminalRows,orderTimeRows,deliveryTimeRows,validRows,validBills,
    missingBills:Math.max(0,values.length-validBills),topTimingFields:topFields,samples
  };
}
