import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from '../src/db.js';

const cfg=getRuntimeConfig();
const dbFile=cfg.dbFile;
if(!fs.existsSync(dbFile)){
  console.log('[SYSTEM DB SPACE AUDIT]',JSON.stringify({ok:false,reason:'DB_NOT_FOUND',dbFile}));
  process.exit(0);
}
const db=new DatabaseSync(dbFile,{readOnly:true});
try{db.exec('PRAGMA query_only=ON');}catch{}
const scalar=sql=>{try{return db.prepare(sql).get()||{};}catch{return{};}};
const pageSize=Number(scalar('PRAGMA page_size').page_size||0);
const pageCount=Number(scalar('PRAGMA page_count').page_count||0);
const freePages=Number(scalar('PRAGMA freelist_count').freelist_count||0);
const schemaRows=(()=>{try{return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();}catch{return[];}})();
let dbstatAvailable=false;let objects=[];
try{
  db.prepare('SELECT name,SUM(pgsize) bytes,COUNT(*) pages FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 1').all();
  dbstatAvailable=true;
  const rows=db.prepare('SELECT name,SUM(pgsize) bytes,COUNT(*) pages FROM dbstat GROUP BY name ORDER BY bytes DESC').all();
  const schemaByName=new Map(schemaRows.map(row=>[row.name,row]));
  objects=rows.map(row=>{
    const schema=schemaByName.get(row.name)||{};
    return{name:row.name,type:schema.type||'internal',table:schema.tbl_name||'',bytes:Number(row.bytes||0),pages:Number(row.pages||0)};
  });
}catch{}
const tableRows=[];
for(const row of schemaRows.filter(row=>row.type==='table')){
  let count=null;
  try{count=Number(db.prepare(`SELECT COUNT(*) count FROM "${String(row.name).replaceAll('"','""')}"`).get()?.count||0);}catch{}
  const own=objects.find(item=>item.name===row.name);
  const indexBytes=objects.filter(item=>item.type==='index'&&item.table===row.name).reduce((sum,item)=>sum+item.bytes,0);
  tableRows.push({name:row.name,rows:count,dataBytes:Number(own?.bytes||0),indexBytes,totalBytes:Number(own?.bytes||0)+indexBytes});
}
tableRows.sort((a,b)=>b.totalBytes-a.totalBytes);
const dbStat=fs.statSync(dbFile);
const walFile=`${dbFile}-wal`,shmFile=`${dbFile}-shm`;
const report={
  ok:true,id:'system-db-space-audit-v1',createdAt:new Date().toISOString(),dbFile,
  files:{databaseBytes:Number(dbStat.size||0),walBytes:fs.existsSync(walFile)?Number(fs.statSync(walFile).size||0):0,shmBytes:fs.existsSync(shmFile)?Number(fs.statSync(shmFile).size||0):0},
  pages:{pageSize,pageCount,freePages,allocatedBytes:pageSize*pageCount,freeBytes:pageSize*freePages,freePercent:pageCount?Number((freePages/pageCount*100).toFixed(2)):0},
  dbstatAvailable,
  topObjects:objects.slice(0,40),
  topTables:tableRows.slice(0,40),
  note:'READ_ONLY_QUERY_ONLY; no VACUUM, DELETE, checkpoint, schema change or business-data mutation'
};
const outDir=path.join(cfg.logsDir,'space-audit');fs.mkdirSync(outDir,{recursive:true});
const outFile=path.join(outDir,'db_space_latest.json');fs.writeFileSync(outFile,JSON.stringify(report,null,2));
console.log('[SYSTEM DB SPACE AUDIT]',JSON.stringify({...report,outFile,topObjects:report.topObjects.slice(0,12),topTables:report.topTables.slice(0,12)}));
try{db.close();}catch{}