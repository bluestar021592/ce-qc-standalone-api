// V788: independent readback of a REAL, already generated WHPP XLSX file.
// This library never exports a workbook, queries TMS, or writes a business DB.
// Caller must supply independently opened READ-ONLY isolated source & proof DBs.
// Only aggregate counts are returned; shipment IDs and personal data never leave.
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import {v788ReadSourceMembershipSignature,verifyV788PersistedSidecar}
  from './v788-whpp-tms-evidence-sidecar.mjs';

const DATES=Object.freeze({'2026-07-01':190,'2026-07-02':156});
const SHEETS=Object.freeze(['全部明细','POD明细','退回明细']);
const normalize=x=>String(x??'').trim().toUpperCase();
const valueText=x=>{
  if(x instanceof Date)return x.toISOString().slice(0,10);
  if(x&&typeof x==='object')return String(x.text??x.result??'');
  return String(x??'');
};
function readSheet(book,name){
  const sheet=book.getWorksheet(name);
  if(!sheet)throw Error('V788_WHPP_XLSX_REQUIRED_SHEET_MISSING');
  // ExcelJS may preserve merged cells/hyperlinks or template label aliases
  // in the header. Validation is based on the ACTUAL dated waybill cells in
  // A/B and the independent 346-member source, not a decorative title.
  // A shifted/unrecognized detail schema necessarily fails exact membership.
  const seen=new Map(),statuses=new Map();
  let duplicate=0,incomplete=0,unexpectedDates=0;
  sheet.eachRow((row,i)=>{
    if(i===1)return;
    const day=valueText(row.getCell(1).value).slice(0,10);
    const code=normalize(valueText(row.getCell(2).value));
    if(!day&&!code)return;
    if(!day||!code){incomplete++;return}
    if(!Object.hasOwn(DATES,day)){unexpectedDates++;return}
    const key=day+'|'+code;
    if(seen.has(key))duplicate++;
    else {
      seen.set(key,1);
      statuses.set(key,normalize(valueText(row.getCell(4).value)));
    }
  });
  return {keys:new Set(seen.keys()),statuses,duplicate,incomplete,unexpectedDates};
}
const diff=(expected,actual)=>({
  missing:[...expected].filter(key=>!actual.has(key)).length,
  extra:[...actual].filter(key=>!expected.has(key)).length
});
export async function readV788ExistingWhppXlsx({sourceDb,proofDb,workbookPath}={}){
  if(!sourceDb||!proofDb||!workbookPath)throw Error('V788_READBACK_INPUT_REQUIRED');
  const before=fs.lstatSync(workbookPath);
  if(!before.isFile()||before.isSymbolicLink()||before.size<=0||before.size>75*1024*1024)
    throw Error('V788_XLSX_NOT_SAFE_REGULAR_FILE');
  if(!String(workbookPath).toLowerCase().endsWith('.xlsx'))
    throw Error('V788_XLSX_FILE_EXTENSION_REQUIRED');
  const expectedSignature=v788ReadSourceMembershipSignature(sourceDb);
  const proof=verifyV788PersistedSidecar(proofDb,expectedSignature);
  // The independent proof is required for signed/returned sheet verification.
  // Source membership may be accurate even when statuses are still untrusted.
  const src=new Map();
  const rows=sourceDb.prepare("SELECT reportDate,UPPER(TRIM(shipmentCode)) code FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate IN ('2026-07-01','2026-07-02') ORDER BY reportDate,code").all();
  for(const r of rows){
    const key=r.reportDate+'|'+normalize(r.code);
    if(src.has(key))throw Error('V788_DUPLICATE_WHPP_SOURCE_MEMBER');
    src.set(key,true);
  }
  const book=new ExcelJS.Workbook();
  await book.xlsx.readFile(workbookPath);
  const actual=Object.fromEntries(SHEETS.map(name=>[name,readSheet(book,name)]));
  const all=actual['全部明细'],pod=actual['POD明细'],returned=actual['退回明细'];
  const srcSet=new Set(src.keys());
  const membership=diff(srcSet,all.keys);
  const issues={
    missingMembers:membership.missing,extraMembers:membership.extra,
    duplicateRows:SHEETS.reduce((n,name)=>n+actual[name].duplicate,0),
    incompleteRows:SHEETS.reduce((n,name)=>n+actual[name].incomplete,0),
    unexpectedDateRows:SHEETS.reduce((n,name)=>n+actual[name].unexpectedDates,0),
    invalidTerminalSheetMembers:0,terminalMarkerMismatch:0,
    missingPodMembers:null,extraPodMembers:null,
    missingReturnedMembers:null,extraReturnedMembers:null
  };
  if(proof.verified){
    const terminal=proofDb.prepare('SELECT reportDate,shipmentCode,shipmentStatus FROM v788_tms_evidence').all();
    const podSet=new Set(),returnSet=new Set();
    for(const r of terminal){
      const key=r.reportDate+'|'+normalize(r.shipmentCode);
      if(r.shipmentStatus==='60')podSet.add(key);
      else if(r.shipmentStatus==='81')returnSet.add(key);
    }
    const podDiff=diff(podSet,pod.keys),returnDiff=diff(returnSet,returned.keys);
    issues.missingPodMembers=podDiff.missing;issues.extraPodMembers=podDiff.extra;
    issues.missingReturnedMembers=returnDiff.missing;issues.extraReturnedMembers=returnDiff.extra;
    for(const [key,value] of all.statuses){
      if((podSet.has(key)&&value!=='Y')||(returnSet.has(key)&&value!=='R'))
        issues.terminalMarkerMismatch++;
    }
    for(const [key,value] of pod.statuses){
      if(podSet.has(key)&&value!=='Y')issues.terminalMarkerMismatch++;
    }
    for(const [key,value] of returned.statuses){
      if(returnSet.has(key)&&value!=='R')issues.terminalMarkerMismatch++;
    }
    for(const key of pod.keys)if(!srcSet.has(key))issues.invalidTerminalSheetMembers++;
    for(const key of returned.keys)if(!srcSet.has(key))issues.invalidTerminalSheetMembers++;
  }
  const after=fs.statSync(workbookPath);
  const fileStable=before.size===after.size&&before.mtimeMs===after.mtimeMs;
  const foundProblems=Object.values(issues).some(x=>x!==null&&x!==0);
  const status=!fileStable?'FILE_CHANGED_DURING_READBACK':
    foundProblems?'BLOCKED':
      proof.verified?'XLSX_CONTENT_VERIFIED':'MEMBERSHIP_ONLY_NEEDS_TMS';
  return {
    version:'V788_WHPP_REAL_XLSX_READBACK_V1',status,
    sourceMembers:srcSet.size,readbackRows:all.keys.size,
    readbackPodRows:pod.keys.size,readbackReturnedRows:returned.keys.size,
    independentlyVerifiedTms:proof.verified===true,
    xlsxUnchangedDuringReadback:fileStable,
    sourceDatabaseModified:false,formalExcelExportAccepted:false,
    allSevenBusinessExportAccepted:false,issues,
    note:'只读验收现有WHPP Excel的逐票成员与TMS状态。状态文件通过不代表历史账本已闭环、签收时间齐全或七业务综合导出通过。'
  };
}
