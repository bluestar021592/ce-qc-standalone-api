// V788: locate real, ALREADY GENERATED WHPP exports without file writes.
// Support one 7/1–7/2 export OR two individually exported daily workbooks.
// The caller must independently verify all rows against isolated source/TMS.
import fs from 'node:fs';
import path from 'node:path';

const DATES=Object.freeze(['2026-07-01','2026-07-02']);
const COMBINED_NAMES=Object.freeze(['custom','weekly','daily','monthly'].map(period=>
  `WHPP_${period}_每日数据看板（2026-07-01 至 2026-07-02）.xlsx`));
const DAILY_NAMES=Object.freeze(DATES.map(day=>
  `WHPP_daily_每日数据看板（${day} 至 ${day}）.xlsx`));

function existingSafeFile(root,name){
  const file=path.join(root,name);
  let stat;
  try{stat=fs.lstatSync(file)}catch(error){
    return error?.code==='ENOENT'?{status:'NOT_FOUND'}:
      {status:'UNAVAILABLE',reason:'EXPORT_FILE_UNREADABLE'};
  }
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||stat.size>75*1024*1024)
    return {status:'UNAVAILABLE',reason:'EXPORT_FILE_UNSAFE'};
  // The XLSX reader checks inode, size, ctime and actual path again after
  // parsing, so discovery cannot silently accept a file replacement.
  return {status:'FOUND',file};
}

export function findV788ExistingWhppExport(exportsDir){
  const root=String(exportsDir||'');
  if(!path.isAbsolute(root))return {status:'UNAVAILABLE',reason:'EXPORT_ROOT_NOT_ABSOLUTE'};
  let dirStat;
  try{dirStat=fs.lstatSync(root)}catch(error){
    return error?.code==='ENOENT'?
      {status:'NOT_FOUND',reason:'EXPORT_DIRECTORY_MISSING'}:
      {status:'UNAVAILABLE',reason:'EXPORT_DIRECTORY_UNREADABLE'};
  }
  if(!dirStat.isDirectory()||dirStat.isSymbolicLink())
    return {status:'UNAVAILABLE',reason:'EXPORT_DIRECTORY_UNSAFE'};
  try{
    // Refuse junctions or other redirects of the configured export folder.
    if(path.normalize(fs.realpathSync.native(root)).toLowerCase()!==
        path.normalize(path.resolve(root)).toLowerCase())
      return {status:'UNAVAILABLE',reason:'EXPORT_DIRECTORY_REDIRECTED'};
    for(const name of COMBINED_NAMES){
      const item=existingSafeFile(root,name);
      if(item.status==='UNAVAILABLE')return item;
      if(item.status==='FOUND')return {
        status:'FOUND',kind:'COMBINED',file:item.file,
        workbookEntries:[{file:item.file,expectedDates:[...DATES]}]
      };
    }
    // Existing files might have been exported separately for each source
    // date. Require BOTH daily files; one alone cannot prove all 346 tickets.
    const items=DAILY_NAMES.map(name=>existingSafeFile(root,name));
    const unsafe=items.find(x=>x.status==='UNAVAILABLE');
    if(unsafe)return unsafe;
    if(items.every(x=>x.status==='FOUND'))return {
      status:'FOUND',kind:'TWO_DAILY',
      workbookEntries:items.map((item,i)=>({file:item.file,expectedDates:[DATES[i]]}))
    };
    return {status:'NOT_FOUND',reason:items.some(x=>x.status==='FOUND')?
      'DAILY_PAIR_INCOMPLETE':'EXACT_WHPP_EXPORT_NOT_FOUND'};
  }catch{return {status:'UNAVAILABLE',reason:'EXPORT_DIRECTORY_UNREADABLE'}}
}
