import { getDb, nowIso } from './db.js';
import { V92_WHPP_TERMINAL_AUTHORITY_ID, repairWhppTerminalAuthority } from './v92WhppTerminalAuthority.js';

const META_KEY='v92_whpp_terminal_authority_last_run';
function safe(value){try{return JSON.parse(String(value||''))||{};}catch{return{};}}

export function repairWhppTerminalAuthorityOnce(db=getDb()){
  const meta=db.prepare('SELECT value FROM app_meta WHERE key=?').get(META_KEY);
  const previous=safe(meta?.value);
  if(previous.patchId===V92_WHPP_TERMINAL_AUTHORITY_ID){
    return{patchId:V92_WHPP_TERMINAL_AUTHORITY_ID,skipped:true,reason:'ALREADY_RECONCILED',scanned:Number(previous.scanned||0),repaired:Number(previous.repaired||0),affectedDates:previous.affectedDates||[]};
  }
  const result=repairWhppTerminalAuthority(db);
  if(!result.repaired){
    const now=nowIso();
    db.prepare('INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt')
      .run(META_KEY,JSON.stringify({...result,runAt:now}),now);
  }
  return result;
}
