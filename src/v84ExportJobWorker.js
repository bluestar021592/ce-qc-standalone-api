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
const UNIFIED_TYPES=Object.freeze(ALL_TYPES.filter(type=>type!=='WHPP'));
const CHILD_HEAP_MB=Math.max(1024,Number(process.env.EXPORT_BUSINESS_HEAP_MB||1536));
const CONCURRENCY=Math.max(1,Math.min(2,Number(process.env.EXPORT_WORKER_CONCURRENCY||1)));
const CHILD_TIMEOUT_MS=Math.max(180_000,Number(process.env.EXPORT_BUSINESS_TIMEOUT_MS||900_000));
const HEARTBEAT_MS=Math.max(5_000,Math.min(60_000,Number(process.env.EXPORT_HEARTBEAT_MS||15_000)));
const EXPORT_PLAN_VERSION='2026-09-08-v474-one-business-one-workbook-indexed-progress-v1';

const jobFile=path.resolve(String(process.argv[2]||''));
if(!jobFile||!fs.existsSync(jobFile))process.exit(2);

function cancellationError(){const error=new Error('EXPORT_JOB_CANCELLED');error.code='EXPORT_JOB_CANCELLED';return error;}
function readJob(){return JSON.parse(fs.readFileSync(jobFile,'utf8'));}
function writeJob(patch){
  const current=readJob();
  const nextStatus=String(patch?.status||'').toUpperCase();
  if(current.cancelRequested&&!['FAILED','CANCELLED'].includes(nextStatus))throw cancellationError();
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
function placeholders(size){return Array.from({length:size},()=>'?').join(',');}

function completedBusinessCounts(range,requestedTypes=ALL_TYPES){
  const counts=Object.fromEntries(ALL_TYPES.map(type=>[type,0]));
  const requested=new Set((requestedTypes||ALL_TYPES).map(type=>String(type||'').toUpperCase()));
  const unifiedWanted=UNIFIED_TYPES.filter(type=>requested.has(type));
  if(unifiedWanted.length){
    const marks=placeholders(unifiedWanted.length);
    const rows=getDb().prepare(`
      SELECT u.businessType,COUNT(*) AS count
      FROM unified_import_rows u
      INNER JOIN unified_import_batches b ON b.snapshotId=u.snapshotId
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.status='VALID' AND s.status='COMPLETED'
        AND b.reportDate BETWEEN ? AND ? AND u.businessType IN (${marks})
      GROUP BY u.businessType
    `).all(range.from,range.to,...unifiedWanted);
    for(const row of rows)if(Object.hasOwn(counts,row.businessType))counts[row.businessType]=Number(row.count||0);
  }
  if(requested.has('WHPP'))counts.WHPP=countCompletedWhppRows(range.from,range.to);
  return counts;
}

function terminateChild(child){
  if(!child)return;
  try{child.kill('SIGTERM');}catch{}
  if(process.platform==='win32'&&Number(child.pid)>0){
    try{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.unref?.();}catch{}
  }
}
function readChildProgress(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function childFraction(state={}){
  const phase=String(state.phase||'').toLowerCase();
  const completed=Math.max(0,Number(state.completed||0)),total=Math.max(0,Number(state.total||0));
  const ratio=total>0?Math.max(0,Math.min(1,completed/total)):0;
  if(phase==='starting')return 0.02;
  if(phase==='membershiprows')return 0.10;
  if(phase==='hydratefinalrows')return 0.10+0.28*ratio;
  if(phase==='hydratecurrenttruth')return 0.38+0.18*ratio;
  if(phase==='sourcerows')return 0.58;
  if(phase==='returnattemptsigningtruth')return 0.70;
  if(phase==='writing')return 0.72+0.26*ratio;
  if(phase==='done')return 1;
  return 0.03;
}
function childMessage(type,range,state,elapsedSec){
  const phase=String(state?.phase||'').toLowerCase(),completed=Number(state?.completed||0),total=Number(state?.total||0),entries=Number(state?.entries||0);
  if(phase==='membershiprows')return `${type} 已锁定 ${entries.toLocaleString()} 个历史运单成员；准备索引读取最终状态`;
  if(phase==='hydratefinalrows')return `${type} 正在索引读取历史最终状态 ${completed.toLocaleString()}/${Math.max(total,completed).toLocaleString()}`;
  if(phase==='hydratecurrenttruth')return `${type} 正在索引叠加当前持久化状态 ${completed.toLocaleString()}/${Math.max(total,completed).toLocaleString()}`;
  if(phase==='sourcerows')return `${type} 历史成员/最终状态读取完成，共 ${entries.toLocaleString()} 个唯一运单；正在做证据对账`;
  if(phase==='returnattemptsigningtruth')return `${type} 状态/派次/签收证据对账完成；准备生成Excel`;
  if(phase==='writing')return `${type} 正在写Excel：${state.sheet||'明细'}（${completed}/${Math.max(total,completed)}张明细sheet）`;
  if(phase==='done')return `${type} 完整Excel已生成`;
  return `正在生成 ${type} 完整表格 · ${range.from} 至 ${range.to} · 已运行${elapsedSec}秒`;
}
function overallChildProgress(taskIndex,taskCount,state){
  const segment=90/Math.max(1,taskCount),fraction=childFraction(state);
  return Math.max(2,Math.min(92,Math.floor(taskIndex*segment+fraction*segment)));
}

function spawnCompleteBusiness({type,range,periodType,taskIndex=0,taskCount=1}){
  return new Promise((resolve,reject)=>{
    const resultFile=`${jobFile}.${type}.${Date.now()}.complete.result.json`;
    const progressFile=`${resultFile}.progress.json`;
    try{fs.rmSync(resultFile,{force:true});fs.rmSync(progressFile,{force:true});}catch{}
    const startedAt=Date.now();let settled=false;
    const child=spawn(process.execPath,[`--max-old-space-size=${CHILD_HEAP_MB}`,businessWorker,resultFile,type,range.from,range.to,periodType,'1','1'],{
      cwd:getRuntimeConfig().projectRoot,
      env:{...process.env,CE_QC_EXPORT_WORKER_MODE:'SINGLE_BUSINESS_DIRECT'},
      windowsHide:true,stdio:'ignore'
    });
    const cleanup=()=>{clearInterval(heartbeat);clearTimeout(timeout);try{fs.rmSync(resultFile,{force:true});fs.rmSync(progressFile,{force:true});}catch{}};
    const finish=(error,result)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve(result||{files:[]});};
    const heartbeat=setInterval(()=>{
      try{
        const childState=readChildProgress(progressFile)||{};
        const elapsedSec=Math.max(1,Math.floor((Date.now()-startedAt)/1000));
        writeJob({
          status:'RUNNING',heartbeatAt:new Date().toISOString(),
          progress:overallChildProgress(taskIndex,taskCount,childState),
          currentBusiness:type,currentPart:1,businessParts:1,
          childPhase:String(childState.phase||'starting'),childCompleted:Number(childState.completed||0),childTotal:Number(childState.total||0),childEntries:Number(childState.entries||0),
          message:childMessage(type,range,childState,elapsedSec)
        });
      }catch(error){terminateChild(child);finish(error);}
    },HEARTBEAT_MS);heartbeat.unref?.();
    const timeout=setTimeout(()=>{
      terminateChild(child);const error=new Error(`${type} 完整表格生成超过${Math.ceil(CHILD_TIMEOUT_MS/60000)}分钟，已停止该业务，避免拖死主系统。`);error.code='EXPORT_BUSINESS_TIMEOUT';finish(error);
    },CHILD_TIMEOUT_MS);timeout.unref?.();
    child.once('error',error=>{error.code=error.code||'EXPORT_CHILD_FAILED';finish(error);});
    child.once('close',code=>{
      if(settled)return;
      let result=null;if(fs.existsSync(resultFile)){try{result=JSON.parse(fs.readFileSync(resultFile,'utf8'));}catch{}}
      if(code!==0||!result?.ok){const error=new Error(`${type} 完整表格导出失败：${result?.error||`child exit ${code}`}`);error.code='EXPORT_CHILD_FAILED';return finish(error);}
      finish(null,result);
    });
  });
}

async function createManagementSummary(range,businessSummaries={}){
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
  sheet.getRow(1).eachCell(cell=>{cell.font={name:'Microsoft YaHei',bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF195A8D'}};});
  totalRow.font={name:'Microsoft YaHei',bold:true,color:{argb:'FF18324F'}};sheet.views=[{state:'frozen',ySplit:1}];
  const metric=workbook.addWorksheet('业务区间指标');
  metric.columns=[{header:'业务',key:'business',width:18},{header:'唯一票数',key:'total',width:14},{header:'已POD',key:'pod',width:14},{header:'POD派件完成率',key:'podRate',width:18},{header:'平均派件天数',key:'averageDeliveryDays',width:18},{header:'有效天数样本',key:'validSamples',width:16},{header:'金边PP',key:'pp',width:14},{header:'外省PV',key:'pv',width:14}];
  metric.getRow(1).eachCell(cell=>{cell.font={name:'Microsoft YaHei',bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF195A8D'}};});
  for(const type of ALL_TYPES){const s=businessSummaries[type];if(!s)continue;metric.addRow({business:type,total:s.total??'',pod:s.pod??'',podRate:s.podRate===undefined?'':`${s.podRate}%`,averageDeliveryDays:s.averageDeliveryDays??'',validSamples:s.validDeliveryDaySamples??'',pp:s.pp??'',pv:s.pv??''});}
  const file=path.join(getRuntimeConfig().exportsDir,`CE_QC_管理汇总_${range.key}.xlsx`);await workbook.xlsx.writeFile(file);return file;
}
async function zipFiles(files,zipFile){
  await new Promise((resolve,reject)=>{const output=fs.createWriteStream(zipFile);const archive=archiver('zip',{zlib:{level:1}});output.on('close',resolve);output.on('error',reject);archive.on('error',reject);archive.pipe(output);for(const file of files)archive.file(file,{name:path.basename(file)});archive.finalize();});
}
async function runTasks(tasks,periodType){
  const results=new Array(tasks.length);let cursor=0,completed=0;
  async function runner(){
    while(true){
      const index=cursor++;if(index>=tasks.length)return;
      const task=tasks[index];
      writeJob({status:'RUNNING',heartbeatAt:new Date().toISOString(),progress:Math.max(2,Math.floor(completed*90/Math.max(1,tasks.length))),currentBusiness:task.type,currentPart:1,businessParts:1,message:`正在生成 ${task.type} 完整表格（${completed+1}/${tasks.length}）`});
      results[index]=await spawnCompleteBusiness({...task,periodType,taskIndex:index,taskCount:tasks.length});
      completed+=1;
      writeJob({status:'RUNNING',heartbeatAt:new Date().toISOString(),progress:Math.max(2,Math.floor(completed*90/Math.max(1,tasks.length))),message:`已完成 ${completed}/${tasks.length} 个业务完整表格；不再输出日期分片`,childPhase:'done',childCompleted:1,childTotal:1});
    }
  }
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,tasks.length)},()=>runner()));
  return results;
}

async function main(){
  const job=readJob();const range=rangeOf(job.payload||{});const requested=String(job.payload?.businessType||'ALL').toUpperCase();
  const types=requested==='ALL'?[...ALL_TYPES]:ALL_TYPES.includes(requested)?[requested]:[];
  if(!types.length)throw new Error(`不支持的业务板块：${requested}`);
  writeJob({status:'RUNNING',heartbeatAt:new Date().toISOString(),progress:1,range,message:`正在准备 ${range.from} 至 ${range.to} 的${requested==='ALL'?'7业务':'单业务'}完整表格`,exportPlanVersion:EXPORT_PLAN_VERSION,workerPid:process.pid,outputContract:'ONE_WORKBOOK_PER_BUSINESS'});
  const counts=completedBusinessCounts(range,types);
  const tasks=types.filter(type=>Number(counts[type]||0)>0).map(type=>({type,range}));
  if(!tasks.length)throw new Error(`${range.from} 至 ${range.to} 没有当前有效且已完成的数据。`);
  const results=await runTasks(tasks,job.payload?.periodType||'custom');
  const files=[];const summaries={};
  for(let i=0;i<results.length;i+=1){files.push(...(results[i]?.files||[]));if(results[i]?.summary)summaries[tasks[i].type]=results[i].summary;}
  if(requested==='ALL'){
    writeJob({status:'RUNNING',heartbeatAt:new Date().toISOString(),progress:93,message:'正在生成管理汇总表'});
    const managementFile=await createManagementSummary(range,summaries);if(managementFile)files.unshift(managementFile);
  }
  let finalFile=files[0]||'';
  if(files.length>1){writeJob({status:'RUNNING',heartbeatAt:new Date().toISOString(),progress:97,message:'正在打包完整业务表格'});finalFile=path.join(getRuntimeConfig().exportsDir,`CE_QC_${range.key}_${requested}_完整报表.zip`);await zipFiles(files,finalFile);}
  const allFiles=[...new Set([...files,finalFile].filter(Boolean))];
  writeJob({status:'COMPLETED',heartbeatAt:new Date().toISOString(),progress:100,message:`导出完成：${range.from} 至 ${range.to}；每个业务仅1个完整Excel`,files:allFiles.map(file=>({name:path.basename(file),url:`/api/export-file?name=${encodeURIComponent(path.basename(file))}`,completeWorkbook:true})),completedAt:new Date().toISOString(),currentBusiness:'',currentPart:0,businessParts:0,workerConcurrency:Math.min(CONCURRENCY,tasks.length),exportPlanVersion:EXPORT_PLAN_VERSION,outputContract:'ONE_WORKBOOK_PER_BUSINESS'});
}

try{await main();}catch(error){
  try{const cancelled=error?.code==='EXPORT_JOB_CANCELLED';writeJob({status:'FAILED',message:cancelled?'后台导出任务已被失联恢复机制释放，可重新发起导出。':(error?.message||String(error)),error:error?.stack||String(error),failedAt:new Date().toISOString(),heartbeatAt:new Date().toISOString(),errorCode:error?.code||'EXPORT_JOB_FAILED'});}catch{}
  process.exitCode=1;
}finally{try{closeDb();}catch{}}
