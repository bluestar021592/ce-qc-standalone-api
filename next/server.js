import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware, authRoutes, publicUser, requireRole } from './auth.js';
import { getDataDb, getSystemDb, nextRuntime, nowIso } from './db.js';
import { NextCeClient, ceStatus } from './ce.js';
import { boardRows, boardSummary, businessSummary, BUSINESSES, clearBusinessData, importDaily, latestDate, listDates } from './store.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const projectRoot=path.resolve(__dirname,'..');
const cfg=nextRuntime();for(const dir of [cfg.importsDir,cfg.exportsDir,cfg.tokenDir])fs.mkdirSync(dir,{recursive:true});
const app=express();
const upload=multer({dest:cfg.importsDir,limits:{fileSize:100*1024*1024,files:1},fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname||'').toLowerCase();cb(['.xls','.xlsx'].includes(ext)?null:new Error('仅支持 .xls / .xlsx 日报'),['.xls','.xlsx'].includes(ext));}});

app.disable('x-powered-by');
app.use(express.json({limit:'5mb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');next();});
app.use('/assets',express.static(path.join(projectRoot,'public','assets'),{maxAge:0}));
app.get('/style.css',(req,res)=>res.sendFile(path.join(__dirname,'public','style.css')));
app.get('/login',(req,res)=>res.sendFile(path.join(__dirname,'public','login.html')));
app.get('/api/health',(req,res)=>{
  let systemDb=true,dataDb=true;try{getSystemDb().prepare('SELECT 1').get();}catch{systemDb=false;}try{getDataDb().prepare('SELECT 1').get();}catch{dataDb=false;}
  const ready=systemDb&&dataDb;res.status(ready?200:503).json({ok:ready,ready,version:'QC-NEXT-1.0',architecture:'CLEAN_REBUILD',systemDb,dataDb,dataRequiredForLogin:false,businesses:BUSINESSES,time:nowIso()});
});

app.use(authMiddleware);
authRoutes(app);

app.get('/api/system/status',(req,res)=>res.json({ok:true,version:'QC-NEXT-1.0',user:publicUser(req.user),latestReportDate:latestDate(),businesses:BUSINESSES,architecture:'CLEAN_REBUILD'}));
app.get('/api/dates',(req,res)=>res.json({ok:true,rows:listDates()}));
app.get('/api/boards',(req,res)=>res.json({ok:true,...boardSummary(String(req.query?.date||''))}));
app.get('/api/boards/:business',(req,res)=>{try{res.json({ok:true,board:businessSummary(req.params.business,String(req.query?.date||''))});}catch(error){res.status(400).json({ok:false,error:error.message});}});
app.get('/api/boards/:business/rows',(req,res)=>{try{res.json({ok:true,...boardRows(req.params.business,{reportDate:String(req.query?.date||''),state:String(req.query?.state||''),region:String(req.query?.region||''),q:String(req.query?.q||''),limit:Number(req.query?.limit||500)})});}catch(error){res.status(400).json({ok:false,error:error.message});}});

app.post('/api/import/daily',requireRole('OPERATOR'),upload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({ok:false,error:'请选择日报Excel。'});
  try{const result=importDaily(req.file.path,{originalName:req.file.originalname,reportDate:String(req.body?.reportDate||'')});getSystemDb().prepare('INSERT INTO audit_logs(userId,action,detailJson,createdAt) VALUES(?,?,?,?)').run(req.user.id,'DAILY_IMPORT',JSON.stringify({reportDate:result.reportDate,total:result.total,classificationCounts:result.classificationCounts}),nowIso());res.json(result);}catch(error){res.status(400).json({ok:false,code:error.code||'IMPORT_FAILED',error:error.message,sheetDiagnostics:error.sheetDiagnostics||[]});}finally{try{fs.unlinkSync(req.file.path);}catch{}}
});

app.post('/api/admin/clear-business-data',requireRole('ADMIN'),(req,res)=>{
  const phrase=String(req.body?.confirm||'');if(phrase!=='永久清除全部业务数据')return res.status(400).json({ok:false,error:'确认文字不正确。'});
  const result=clearBusinessData();getSystemDb().prepare('INSERT INTO audit_logs(userId,action,detailJson,createdAt) VALUES(?,?,?,?)').run(req.user.id,'BUSINESS_DATA_CLEARED',JSON.stringify({scope:'NEXT_DATA_ONLY'}),nowIso());res.json(result);
});

app.get('/api/ce/status',(req,res)=>res.json({ok:true,...ceStatus()}));
app.post('/api/ce/login',async(req,res)=>{
  const tenantId=String(req.body?.tenantId||'000000').trim()||'000000',username=String(req.body?.username||'').trim(),password=String(req.body?.password||'');
  if(!username||!password)return res.status(400).json({ok:false,error:'请输入CE账号和密码。'});
  try{
    const client=new NextCeClient();
    const token=await Promise.race([client.login({tenantId,username,password}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('CE API登录超过12秒未响应。')),12000))]);
    getSystemDb().prepare('INSERT INTO audit_logs(userId,action,detailJson,createdAt) VALUES(?,?,?,?)').run(req.user.id,'CE_API_LOGIN',JSON.stringify({username}),nowIso());
    res.json({ok:true,account:username,expiresAt:token.expires_at?new Date(token.expires_at).toISOString():''});
  }catch(error){res.status(/12秒/.test(error.message)?504:502).json({ok:false,error:error.message});}
});

app.use(express.static(path.join(__dirname,'public'),{index:false,maxAge:0}));
app.get(['/',...BUSINESSES.map(v=>`/board/${v.toLowerCase()}`),'/import','/settings','/tracking','/exceptions','/reports'],(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.use((error,req,res,next)=>{console.error('[QC-NEXT]',error);if(res.headersSent)return next(error);res.status(500).json({ok:false,error:error?.message||'系统错误'});});

const port=Number(process.env.CE_QC_NEXT_PORT||5187),host=process.env.CE_QC_NEXT_HOST||'0.0.0.0';
app.listen(port,host,()=>{console.log(`[QC-NEXT] CLEAN_REBUILD READY http://127.0.0.1:${port}`);console.log(`[QC-NEXT] system=${cfg.systemDbFile}`);console.log(`[QC-NEXT] data=${cfg.dataDbFile}`);console.log('[QC-NEXT] legacy business DB is not mutated.');});
