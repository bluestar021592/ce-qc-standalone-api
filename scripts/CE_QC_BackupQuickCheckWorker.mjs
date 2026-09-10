import { DatabaseSync } from 'node:sqlite';

function decodePayload(raw=''){
  try{return JSON.parse(Buffer.from(String(raw||''),'base64url').toString('utf8'));}
  catch{return {};}
}

const payload=decodePayload(process.argv[2]||'');
const filePath=String(payload.filePath||'').trim();
if(!filePath){
  process.stdout.write(`${JSON.stringify({ok:false,error:'V503_BACKUP_PATH_REQUIRED'})}\n`);
  process.exit(2);
}

let db=null;
try{
  db=new DatabaseSync(filePath,{readOnly:true,timeout:10000});
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=10000');
  const quick=String(db.prepare('PRAGMA quick_check(1)').get()?.quick_check||'');
  if(quick!=='ok')throw new Error(`V503_BACKUP_QUICK_CHECK_FAILED:${quick||'empty'}`);
  process.stdout.write(`${JSON.stringify({ok:true,integrity:'quick-ok',quickCheck:'ok',worker:'V503'})}\n`);
}catch(error){
  process.stdout.write(`${JSON.stringify({ok:false,error:error?.message||String(error),worker:'V503'})}\n`);
  process.exitCode=3;
}finally{
  try{db?.close();}catch{}
}
