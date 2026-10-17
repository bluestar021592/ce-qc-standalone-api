// V788: locate an ALREADY-EXPORTED two-day WHPP workbook. No file writes,
// directory-wide traversal, arbitrary path parameters or production DB access.
// The caller must verify its contents against isolated source/TMS evidence.
import fs from 'node:fs';
import path from 'node:path';

const EXACT_NAMES=Object.freeze(['custom','weekly','daily','monthly'].map(period=>
  `WHPP_${period}_每日数据看板（2026-07-01 至 2026-07-02）.xlsx`));
export function findV788ExistingWhppExport(exportsDir){
  const root=String(exportsDir||'');
  if(!path.isAbsolute(root))return {status:'UNAVAILABLE',reason:'EXPORT_ROOT_NOT_ABSOLUTE'};
  let dirStat;
  try{dirStat=fs.lstatSync(root)}catch{return {status:'NOT_FOUND',reason:'EXPORT_DIRECTORY_MISSING'}}
  if(!dirStat.isDirectory()||dirStat.isSymbolicLink())
    return {status:'UNAVAILABLE',reason:'EXPORT_DIRECTORY_UNSAFE'};
  try{
    // No symlink/junction redirection of the configured export directory.
    if(path.normalize(fs.realpathSync.native(root)).toLowerCase()!==path.normalize(path.resolve(root)).toLowerCase())
      return {status:'UNAVAILABLE',reason:'EXPORT_DIRECTORY_REDIRECTED'};
    for(const name of EXACT_NAMES){
      const file=path.join(root,name);
      let st;
      try{st=fs.lstatSync(file)}catch(error){
        if(error?.code==='ENOENT')continue;
        return {status:'UNAVAILABLE',reason:'EXPORT_FILE_UNREADABLE'};
      }
      if(!st.isFile()||st.isSymbolicLink()||st.size<=0||st.size>75*1024*1024)
        return {status:'UNAVAILABLE',reason:'EXPORT_FILE_UNSAFE'};
      return {status:'FOUND',file};
    }
  }catch{return {status:'UNAVAILABLE',reason:'EXPORT_DIRECTORY_UNREADABLE'}}
  return {status:'NOT_FOUND',reason:'EXACT_WHPP_TWO_DAY_EXPORT_NOT_FOUND'};
}
