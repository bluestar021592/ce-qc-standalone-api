import { recoverHistoricalGroupedEvidence } from './historicalMemberEvidence.js';

process.on('message',async message=>{
  if(message?.type!=='START')return;
  try{
    const result=await recoverHistoricalGroupedEvidence({reportDate:message.reportDate||'',groups:message.groups||{}});
    const serialized={};
    for(const [type,value] of Object.entries(result||{})){
      serialized[type]={
        ...value,
        podBills:[...(value.podBills||[])],
        podEvidenceByBill:[...(value.podEvidenceByBill||new Map()).entries()],
        eventsByBill:[...(value.eventsByBill||new Map()).entries()]
      };
    }
    process.send?.({type:'DONE',result:serialized});
  }catch(error){
    process.send?.({type:'ERROR',error:error?.stack||error?.message||String(error)});
  }
});
