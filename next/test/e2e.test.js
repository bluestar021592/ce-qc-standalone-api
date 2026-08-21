import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import XLSX from 'xlsx';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(url,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){try{const r=await fetch(url,{cache:'no-store'});if(r.status<500)return r;}catch{}await sleep(120);}throw new Error(`timeout waiting ${url}`);}
async function json(url,options={}){const r=await fetch(url,{cache:'no-store',...options});const text=await r.text();let p={};try{p=text?JSON.parse(text):{};}catch{p={raw:text}}return{r,p,text};}
function start(root,temp,port){return spawn(process.execPath,['next/server.js'],{cwd:root,env:{...process.env,CE_QC_NEXT_DATA_DIR:temp,CE_QC_LEGACY_DB_FILE:path.join(temp,'missing.db'),CE_QC_NEXT_PORT:String(port),CE_QC_NEXT_HOST:'127.0.0.1',NODE_ENV:'test'},stdio:['ignore','pipe','pipe'],windowsHide:true});}
async function stop(child){if(!child?.pid)return;try{child.kill('SIGTERM');}catch{}for(let i=0;i<50&&!child.killed;i++)await sleep(50);}

async function login(base,username,password){const result=await json(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(result.r.status,200,result.text);const setCookie=result.r.headers.get('set-cookie')||'';const cookie=setCookie.split(';')[0];assert.match(cookie,/ce_qc_next_session=/);return cookie;}

function makeWorkbook(file){const rows=[['运单号','收件人','客户名称','区域','日报日期'],['CC100001','普通客户','','金边','2026-08-21'],['CE100001','普通客户','','外省','2026-08-21'],['TBKH100001','普通客户','','外省','2026-08-21'],['CCAF100001','普通客户','CCAF','金边','2026-08-21'],['CC100002','SHOPEECN','','金边','2026-08-21'],['CC100003','SHOPEEVN','','外省','2026-08-21'],['CC100004','ALI1688','','外省','2026-08-21']];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'日报');XLSX.writeFile(wb,file);}

test('QC Next survives empty start -> direct login -> seven-business import -> WHPP -> restart persistence',{timeout:90000},async()=>{
  const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-next-e2e-')),port=5587,base=`http://127.0.0.1:${port}`,username='nextadmin',password='Next-Admin-2026!';let child;
  try{
    child=start(root,temp,port);await wait(`${base}/api/health`);
    let h=await json(`${base}/api/health`);assert.equal(h.p.ready,true);assert.equal(h.p.dataRequiredForLogin,false);assert.deepEqual(h.p.businesses,['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
    let boot=await json(`${base}/api/auth/bootstrap`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password,displayName:'Next Admin'})});assert.equal(boot.r.status,200,boot.text);
    let cookie=await login(base,username,password);
    let boards=await json(`${base}/api/boards`,{headers:{cookie}});assert.equal(boards.r.status,200,boards.text);assert.equal(boards.p.boards.WHPP.total,0);
    const xlsx=path.join(temp,'daily.xlsx');makeWorkbook(xlsx);const form=new FormData();form.append('file',new Blob([fs.readFileSync(xlsx)]), '日报_2026-08-21.xlsx');
    let imported=await json(`${base}/api/import/daily`,{method:'POST',headers:{cookie},body:form});assert.equal(imported.r.status,200,imported.text);assert.equal(imported.p.total,7);assert.equal(imported.p.classificationCounts.WHPP,1);
    boards=await json(`${base}/api/boards?date=2026-08-21`,{headers:{cookie}});assert.equal(boards.r.status,200,boards.text);for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])assert.equal(boards.p.boards[type].total,1,type);
    await stop(child);await sleep(500);child=start(root,temp,port);await wait(`${base}/api/health`);cookie=await login(base,username,password);boards=await json(`${base}/api/boards?date=2026-08-21`,{headers:{cookie}});assert.equal(boards.p.boards.WHPP.total,1);assert.equal(Object.values(boards.p.boards).reduce((sum,row)=>sum+row.total,0),7);
  }finally{await stop(child);fs.rmSync(temp,{recursive:true,force:true});}
});
