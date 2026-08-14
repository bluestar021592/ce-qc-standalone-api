import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
import { getDb, getRuntimeConfig, closeDb } from './db.js';
import { countCompletedWhppRows, whppDailyCounts } from './v87WhppExportStore.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const businessWorker=path.join(__dirname,'v84ExportBusinessWorker.js');
const ALL_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const LARGE_BUSINESS_THRESHOLD=Math.max(20000,Number(process.env.EXPORT_SPLIT_THRESHOLD||70000));
const PART_DAYS=Math.max(1,Math.min(14,Number(process.env.EXPORT_PART_DAYS||7)));
const CHILD_HEAP_MB=Math.max(1024,Number(process.env.EXPORT_BUSINESS_HEAP_MB||2048));
const CONCURRENCY=Math.max(1,Math.min(3,Number(process.env.EXPORT_WORKER_CONCURRENCY||2)));

const jobFile=path.resolve(String(process.argv[2]||''));
if(!jobFile||!fs.existsSync(jobFile))process.exit(2);

function readJob(){return JSON.parse(fs.readFileSync(jobFile,'utf8'));}
function writeJob(patch){
  const current=readJob();
  const next={...current,...patch,updatedAt:new Date().toISOString()};
  const temp=`${jobFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(next,null,2),'utf8');
  fs.renameSync(temp,jobFile);
  return next;
}
function dateKey(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):'';}
function formatCambodia(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function validateRange(from,to){
  if(!dateKey(from)||!dateKey(to)||from>to)throw new Error('导出日期范围无效。');
  const days=Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;
  if(days>180)throw new Error('单次日期范围最多180天。');
  return {from,to,key:`${from}_${to}`};
}
function rangeOf(payload={}){
  if(payload.periodType==='custom')return validateRange(payload.fromDate,payload.toDate);
  const base=dateKey(payload.date)?new Date(`${payload.date}T12:00:00+07:00`):new Date();
  if(payload.periodType==='weekly'){
    const day=(base.getDay()+6)%7;const from=new Date(base);from.setDate(base.getDate()-day);const to=new Date(from);to.setDate(from.getDate()+6);
    return validateRange(formatCambodia(from),formatCambodia(to));
  }
  if(payload.periodType==='monthly'){
    const from=new Date(base.getFullYear(),base.getMonth(),1,12);const to=new Date(base.getFullYear(),base.getMonth()+1,0,12);
    return validateRange(formatCambodia(from),formatCambodia(to));
  }
  const day=formatCambodia(base);return {from:day,to:day,key:day};
}
function addDays(value,days){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function splitRange(range,partDays=PART_DAYS){
  const result=[];let from=range.from;
  while(from<=range.to){const tentative=addDays(from,partDays-1);const to=tentative<range.to?tentative:range.to;result.push({from,to,key:`${from}_${to}`});from=addDays(to,1);}
  return result;
}
function completedBusinessCount(type,range){
  if(type==='WHPP')return countCompletedWhppRows(range.from,range.to);
  return Number(getDb().prepare(`SELECT COUNT(*) AS count FROM unified_import_rows u INNER JOIN unified_import_batches b ON b.snapshotId=u.snapshotId INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ? AND u.businessType=?`).get(range.from,range.to,type)?.count||0);
}

function spawnBusinessPart({type,range,periodType,partIndex,partCount}){
  return new Promise((resolve,reject)=>{
    const resultFile=`${jobFile}.${type}.${partIndex}.${Date.now()}.result.json`;
    try{fs.rmSync(resultFile,{force:true});}catch{}
    const child=spawn(process.execPath,[`--max-old-space-size=${CHILD_HEAP_MB}`,businessWorker,resultFile,type,range.from,range.to,periodType,String(partIndex),String(partCount)],{
      cwd:getRuntimeConfig().projectRoot,env:process.env,windowsHide:true,stdio:'ignore'
    });
    child.once('error',reject);
    child.once('close',code=>{
      let result=null;
      if(fs.existsSync(resultFile)){
        try{result=JSON.parse(fs.readFileSync(resultFile,'utf8'));}catch{}
        try{fs.rmSync(resultFile,{force:true});}catch{}
      }
      if(code!==0||!result?.ok)return reject(new Error(`${type} ${range.from}~${range.to} 导出失败：${result?.error||`child exit ${code}`}`));
      resolve(result.files||[]);
    });
  });
}

async function createManagementSummary(range){
  const db=getDb();
  const rows=db.prepare(`SELECT b.reportDate,u.businessType,COUNT(*) AS count FROM unified_import_batches b INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId INNER JOIN unified_import_rows u ON u.snapshotId=b.snapshotId WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ? GROUP BY b.reportDate,u.businessType ORDER BY b.reportDate,u.businessType`).all(range.from,range.to).map(row=>({...row,count:Number(row.count||0)}));
  rows.push(...whppDailyCounts(range.from,range.to));
  const byDate=new Map();
  for(const row of rows){if(!byDate.has(row.reportDate))byDate.set(row.reportDate,Object.fromEntries(ALL_TYPES.map(type=>[type,0])));byDate.get(row.reportDate)[row.businessType]=Number(row.count||0);}
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('总管理汇总');
  sheet.columns=[{header:'日期',key:'date',width:14},...ALL_TYPES.map(type=>({header:type,key:type,width:14})),{header:'总票数',key:'total',width:16}];
  for(const [date,counts] of [...byDate.entries()].sort(([a],[b])=>a.localeCompare(b))){const values=Object.fromEntries(ALL_TYPES.map(type=>[type,Number(counts[type]||0)]));sheet.addRow({date,...values,total:ALL_TYPES.reduce((sum,type)=>sum+values[type],0)});}
  const totalRow=sheet.addRow({date:`${range.from} ~ ${range.to}`});
  for(let column=2;column<=ALL_TYPES.length+2;column+=1){const letter=sheet.getColumn(column).letter;totalRow.getCell(column).value={formula:`SUM(${letter}2:${letter}${Math.max(2,totalRow.number-1)})`};}
  sheet.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF195A8D'}};});
  totalRow.font={bold:true,color:{argb:'FF18324F'}};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:`${sheet.getColumn(ALL_TYPES.length+2).letter}${Math.max(2,sheet.rowCount)}`};
  const file=path.join(getRuntimeConfig().exportsDir,`CE_QC_管理汇总_${range.key}.xlsx`);await workbook.xlsx.writeFile(file);return file;
}
async function zipFiles(files,zipFile){
  await new Promise((resolve,reject)=>{const output=fs.createWriteStream(zipFile);const archive=archiver('zip',{zlib:{level:1}});output.on('close',resolve);output.on('error',reject);archive.on('error',reject);archive.pipe(output);for(const file of files)archive.file(file,{name:path.basename(file)});archive.finalize();});
}

async function runTasks(tasks,jobPayload){
  const results=new Array(tasks.length);let cursor=0;let completed=0;
  async function runner(){
    while(true){
      const index=cursor++;if(index>=tasks.length)return;
      const task=tasks[index];
      writeJob({status:'RUNNING',progress:Math.max(2,Math.floor(completed*90/Math.max(1,tasks.length))),currentBusiness:task.type,currentPart:task.partIndex,businessParts:task.partCount,message:`并行生成中：${task.type} ${task.range.from} 至 ${task.range.to}（${task.partIndex}/${task.partCount}）`});
      results[index]=await spawnBusinessPart({...task,periodType:jobPayload.periodType||'custom'});
      completed+=1;
      writeJob({status:'RUNNING',progress:Math.max(2,Math.floor(completed*90/Math.max(1,tasks.length))),message:`已完成 ${completed}/${tasks.length} 个业务分片；最多${Math.min(CONCURRENCY,tasks.length)}个并行`});
    }
  }
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,tasks.length)},()=>runner()));
  return results.flat();
}

async function main(){
  const job=readJob();const range=rangeOf(job.payload||{});const requested=String(job.payload?.businessType||'ALL').toUpperCase();
  const types=requested==='ALL'?[...ALL_TYPES]:ALL_TYPES.includes(requested)?[requested]:[];
  if(!types.length)throw new Error(`不支持的业务板块：${requested}`);
  writeJob({status:'RUNNING',progress:1,range,message:`正在准备 ${range.from} 至 ${range.to} 的${requested==='ALL'?'7业务':'单业务'}后台导出`});
  const tasks=[];
  for(const type of types){const count=completedBusinessCount(type,range);if(!count)continue;const parts=count>LARGE_BUSINESS_THRESHOLD?splitRange(range):[range];for(let i=0;i<parts.length;i+=1)tasks.push({type,range:parts[i],partIndex:i+1,partCount:parts.length});}
  if(!tasks.length)throw new Error(`${range.from} 至 ${range.to} 没有当前有效且已完成的数据。`);
  const files=await runTasks(tasks,job.payload||{});
  let managementFile='';
  if(requested==='ALL'){writeJob({status:'RUNNING',progress:93,message:'正在生成7业务轻量管理汇总'});managementFile=await createManagementSummary(range);files.unshift(managementFile);}
  let finalFile=files[0]||'';
  if(files.length>1){writeJob({status:'RUNNING',progress:96,message:'正在快速打包全部报表文件'});finalFile=path.join(getRuntimeConfig().exportsDir,`CE_QC_${range.key}_${requested}_后台导出.zip`);await zipFiles(files,finalFile);}
  const allFiles=[...new Set([...files,finalFile].filter(Boolean))].sort((a,b)=>path.basename(a).localeCompare(path.basename(b),'zh-CN'));
  writeJob({status:'COMPLETED',progress:100,message:`导出完成：${range.from} 至 ${range.to}`,files:allFiles.map(file=>({name:path.basename(file),url:`/api/export-file?name=${encodeURIComponent(path.basename(file))}`})),completedAt:new Date().toISOString(),currentBusiness:'',currentPart:0,businessParts:0,workerConcurrency:Math.min(CONCURRENCY,tasks.length)});
}

try{await main();}catch(error){try{writeJob({status:'FAILED',message:error?.message||String(error),error:error?.stack||String(error),failedAt:new Date().toISOString()});}catch{}process.exitCode=1;}finally{try{closeDb();}catch{}}
