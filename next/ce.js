import axios from 'axios';
import { getSystemDb, nowIso } from './db.js';

const BASE=process.env.CE_BASE_URL||'https://otwms.cambodianexpress.com';
const ORIGIN=new URL(BASE).origin;
const TOKEN_KEY='ce_api_token';

export function loadCeToken(){const row=getSystemDb().prepare('SELECT valueJson FROM settings WHERE key=? LIMIT 1').get(TOKEN_KEY);try{return row?JSON.parse(row.valueJson):null;}catch{return null;}}
export function saveCeToken(token){getSystemDb().prepare('INSERT INTO settings(key,valueJson,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt').run(TOKEN_KEY,JSON.stringify(token),nowIso());}
export function ceStatus(){const t=loadCeToken();return{loggedIn:Boolean(t?.access_token),account:t?.username||t?.account||'',tenantId:t?.tenantId||'000000',expiresAt:t?.expires_at?new Date(t.expires_at).toISOString():'',expired:Boolean(t?.expires_at&&Number(t.expires_at)<=Date.now())};}

export class NextCeClient{
  constructor(){this.http=axios.create({baseURL:BASE,timeout:Number(process.env.CE_QC_NEXT_CE_TIMEOUT_MS||15000),headers:{Accept:'application/json, text/plain, */*','User-Agent':'Mozilla/5.0'}});}
  loginHeaders(tenantId='000000'){const h={'Language':'zh','Tenant-Id':tenantId,'Origin':ORIGIN,'Referer':`${ORIGIN}/`,'Content-Type':'application/json;charset=UTF-8'};const auth=String(process.env.CE_AUTHORIZATION||'').trim();if(auth)h.Authorization=/^Basic\s/i.test(auth)?auth:`Basic ${auth}`;return h;}
  async login({tenantId='000000',username,password}){const res=await this.http.post('/api/blade-auth/oauth/token',undefined,{params:{tenantId,username,password,grant_type:'password',scope:'all',type:'account'},headers:this.loginHeaders(tenantId)});const src=res.data?.data?.access_token?res.data.data:res.data;if(!src?.access_token)throw new Error('CE登录响应中未找到 access_token');const expiresIn=Number(src.expires_in||src.expiresIn||0);const token={access_token:String(src.access_token),refresh_token:String(src.refresh_token||''),token_type:String(src.token_type||'bearer'),expires_in:expiresIn,expires_at:expiresIn?Date.now()+expiresIn*1000:0,tenantId:String(tenantId),username:String(username)};saveCeToken(token);return token;}
  headers(){const t=loadCeToken();if(!t?.access_token)throw new Error('请先在系统设置登录CE API。');const bearer=`bearer ${t.access_token}`;return{'Content-Type':'application/json;charset=UTF-8','Accept':'application/json, text/plain, */*','Language':'zh','Tenant-Id':t.tenantId||'000000','Origin':ORIGIN,'Referer':`${ORIGIN}/`,'Blade-Auth':bearer,'x-access-token':t.access_token,...(t.refresh_token?{'x-refresh-token':t.refresh_token}:{})};}
  async confirmQuery(codes){const list=unique(codes);if(!list.length)return[];const res=await this.http.post('/api/otwms/order/confirm-query',{shipmentCodes:list},{headers:this.headers()});return Array.isArray(res.data?.data)?res.data.data:[];}
  async trackQuery(codes){const list=unique(codes);if(!list.length)return[];const res=await this.http.post('/api/tms-shipment-event/query',list,{headers:this.headers()});return Array.isArray(res.data?.data)?res.data.data:[];}
  async shipmentTrack(codes){const list=unique(codes);if(!list.length)return[];const res=await this.http.post('/api/tms-shipment/track',list,{headers:this.headers()});return Array.isArray(res.data?.data)?res.data.data:[];}
}

function unique(values){return[...new Set((values||[]).map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))];}
