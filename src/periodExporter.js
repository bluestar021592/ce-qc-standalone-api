import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

import { getRuntimeConfig } from './db.js';
import { listCompletedUnifiedSnapshots } from './unifiedImportStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUSINESSES = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];
const TEMPLATE_DIR = path.resolve(__dirname, '../_codex_v9_20260805/QC监管APP开发4_CODEX执行包_v9_真实日报_自动日期_跨日复核_周月报_580最终总包/07_固定Excel导出模板');
const DETAIL_SHEETS = [
  ['07_Pending1+单号', row => pending(row) >= 1], ['08_Pending2+单号', row => pending(row) >= 2], ['09_Pending3+单号', row => pending(row) >= 3],
  ['10_OC1+单号', row => oc(row) >= 1], ['11_OC2+单号', row => oc(row) >= 2], ['12_OC3+单号', row => oc(row) >= 3],
  ['13_入库无扫描单号', row => yes(row.入库无扫描节点)], ['14_仓库自提单号', row => row.specialState === 'SELF_PICKUP'],
  ['15_CECN滞留单号', row => row.specialState === 'CECN_RETENTION'], ['16_CEZT滞留单号', row => row.specialState === 'CEZT_RETENTION'],
  ['17_580滞留单号', row => row.specialState === 'CCSL580_RETENTION']
];

export async function exportPeriodReports({ periodType = 'daily', date, businessType = 'ALL' }) {
  const range = periodRange(periodType, date);
  const snapshots = listCompletedUnifiedSnapshots(range.from, range.to);
  if (!snapshots.length) throw new Error(`${range.from} 至 ${range.to} 没有 VALID + COMPLETED 日快照，不能导出。`);
  const types = businessType === 'ALL' ? BUSINESSES : [normalizeBusiness(businessType)];
  const outputDir = getRuntimeConfig().exportsDir;
  await fs.mkdir(outputDir, { recursive: true });
  const files = [];
  for (const type of types) {
    const file = await createBusinessWorkbook({ type, periodType, range, snapshots, outputDir });
    files.push(file);
  }
  if (types.length === 1) return { file: files[0], files, range, snapshots: snapshots.map(item => item.snapshotId) };
  const zipFile = path.join(outputDir, `CE_QC_${periodType}_${range.key}_五业务_${stamp()}.zip`);
  await zipFiles(files, zipFile);
  return { file: zipFile, files, range, snapshots: snapshots.map(item => item.snapshotId) };
}

async function createBusinessWorkbook({ type, periodType, range, snapshots, outputDir }) {
  const template = path.join(TEMPLATE_DIR, `${type}_商务蓝白浅框线版_指标独立明细跳转.xlsx`);
  const zip = await JSZip.loadAsync(await fs.readFile(template));
  const rows = snapshots.flatMap(snapshot => (snapshot.payload.finalRows || []).filter(row => row.businessType === type).map(row => ({ ...row, reportDate: row.reportDate || snapshot.reportDate, snapshotId: snapshot.snapshotId })));
  const unique = uniquePeriodRows(rows);
  const dashboard = dashboardMetrics(unique, range, type);
  await patchSheetData(zip, 'xl/worksheets/sheet1.xml', dashboardXml(dashboard, range, type));
  await patchSheetData(zip, 'xl/worksheets/sheet2.xml', analysisXml(snapshots, type));
  await patchSheetData(zip, 'xl/worksheets/sheet3.xml', detailXml(unique, '核心数据'));
  await patchSheetData(zip, 'xl/worksheets/sheet4.xml', detailXml(unique.filter(row => pending(row) >= 1), 'Pending'));
  await patchSheetData(zip, 'xl/worksheets/sheet5.xml', detailXml(unique.filter(row => oc(row) >= 1), 'OC'));
  await patchSheetData(zip, 'xl/worksheets/sheet6.xml', detailXml(unique.filter(row => yes(row.入库无扫描节点)), '入库无扫描'));
  for (let index = 0; index < DETAIL_SHEETS.length - 1; index += 1) {
    const [, predicate] = DETAIL_SHEETS[index];
    await patchSheetData(zip, `xl/worksheets/sheet${index + 8}.xml`, detailXml(unique.filter(predicate), DETAIL_SHEETS[index][0]));
  }
  await add580Sheet(zip, unique.filter(DETAIL_SHEETS.at(-1)[1]));
  await patchSheetData(zip, 'xl/worksheets/sheet7.xml', consistencyXml(unique, snapshots, type, range));
  const file = path.join(outputDir, `${type}_${periodType}_${range.key}_${stamp()}.xlsx`);
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return file;
}

async function patchSheetData(zip, name, sheetData) {
  const entry = zip.file(name);
  if (!entry) return;
  const xml = await entry.async('string');
  const dimension = sheetData.match(/<row r="(\d+)"[^>]*>[^]*$/)?.[1] || '1';
  zip.file(name, xml.replace(/<x:sheetData>[^]*?<\/x:sheetData>/, `<x:sheetData>${sheetData}</x:sheetData>`).replace(/<x:mergeCells>[^]*?<\/x:mergeCells>/, '').replace(/<x:dimension ref="[^"]+"\s*\/>/, `<x:dimension ref="A1:K${dimension}" />`));
}

function add580Sheet(zip, rows) {
  const source = zip.file('xl/worksheets/sheet17.xml');
  if (!source) return;
  const promise = source.async('string').then(xml => {
    zip.file('xl/worksheets/sheet18.xml', xml.replace(/<x:sheetData>[^]*?<\/x:sheetData>/, `<x:sheetData>${detailXml(rows, '580滞留')}</x:sheetData>`));
  });
  const workbook = zip.file('xl/workbook.xml');
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  const contentTypes = zip.file('[Content_Types].xml');
  return Promise.all([
    promise,
    workbook.async('string').then(xml => zip.file('xl/workbook.xml', xml.replace('</x:sheets>', '<x:sheet name="17_580滞留单号" sheetId="18" r:id="rId18" /></x:sheets>'))),
    rels.async('string').then(xml => zip.file('xl/_rels/workbook.xml.rels', xml.replace('</Relationships>', '<Relationship Id="rId18" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet18.xml" /></Relationships>'))),
    contentTypes.async('string').then(xml => zip.file('[Content_Types].xml', xml.replace('</Types>', '<Override PartName="/xl/worksheets/sheet18.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>')))
  ]);
}

function dashboardXml(metrics, range, type) {
  const specs = [
    ['今日总单','all','03_明细_核心数据'],['PP单量','pp','03_明细_核心数据'],['PV单量','pv','03_明细_核心数据'],['今日POD','pod','03_明细_核心数据'],['POD率','podRate','03_明细_核心数据'],
    ['首次妥投率','firstRate','03_明细_核心数据'],['Pending1+','pending1','07_Pending1+单号'],['Pending2+','pending2','08_Pending2+单号'],['Pending3+','pending3','09_Pending3+单号'],
    ['OC1+','oc1','10_OC1+单号'],['OC2+','oc2','11_OC2+单号'],['OC3+','oc3','12_OC3+单号'],['入库无扫描','inbound','13_入库无扫描单号'],
    ['仓库自提件','selfPickup','14_仓库自提单号'],['CECN滞留包裹','cecn','15_CECN滞留单号'],['CEZT滞留包裹','cezt','16_CEZT滞留单号'],['580滞留包裹','retention580','17_580滞留单号']
  ];
  const rows = [xmlRow(1, ['日期','板块','项目','数值（点击查看）','状态','近7天走势','说明'])];
  specs.forEach(([label,key,target], index) => rows.push(xmlFormulaRow(index + 2, [range.to, type, label], `HYPERLINK("#'${target}'!A1","${formatMetric(metrics[key], key)}")`, ['—', metrics.trends[key] || '—', `来源：${metrics.snapshotCount}个COMPLETED日快照`] )));
  return rows.join('');
}

function analysisXml(snapshots, type) {
  const rows = [xmlRow(1, ['日期','业务','总单','PP','PV','POD','POD率','Pending1+','Pending2+','Pending3+','OC1+','OC2+','OC3+','自提','CECN','CEZT','580'])];
  snapshots.forEach((snapshot, index) => {
    const data = uniquePeriodRows((snapshot.payload.finalRows || []).filter(row => row.businessType === type));
    const m = dashboardMetrics(data, { from: snapshot.reportDate, to: snapshot.reportDate }, type);
    rows.push(xmlRow(index + 2, [snapshot.reportDate,type,m.all,m.pp,m.pv,m.pod,m.podRate,m.pending1,m.pending2,m.pending3,m.oc1,m.oc2,m.oc3,m.selfPickup,m.cecn,m.cezt,m.retention580]));
  });
  return rows.join('');
}

function detailXml(rows, label) {
  const out = [xmlRow(1, ['序号','运单号','日期','业务','PP/PV','当前分类','Pending次数','OC天数','POD状态','API状态','Snapshot ID'])];
  rows.forEach((row, index) => out.push(xmlRow(index + 2, [index + 1,bill(row),row.reportDate || '',row.businessType || '',row.regionCode || row.regionType || '',row.primaryCategory || row.主分类 || row.异常分类 || label,pending(row),oc(row),pod(row) ? 'POD' : '未POD',row.API状态 || row.apiStatus || '',row.snapshotId || ''])));
  out.push(xmlFormulaRow(out.length + 1, ['返回总看板'], 'HYPERLINK("#\'01_总看板\'!A1","返回总看板")', []));
  return out.join('');
}

function consistencyXml(rows, snapshots, type, range) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(rows.map(row => [bill(row), row.reportDate, row.primaryCategory || row.主分类 || '']).sort())).digest('hex');
  return [xmlRow(1,['检查项目','结果','业务','周期','来源快照数','数据哈希']),xmlRow(2,['VALID+COMPLETED快照','一致',type,`${range.from}~${range.to}`,snapshots.length,hash]),xmlFormulaRow(3,['返回总看板'],'HYPERLINK("#\'01_总看板\'!A1","返回总看板")',[])].join('');
}

function dashboardMetrics(rows, range) {
  const count = predicate => rows.filter(predicate).length;
  const all = rows.length;
  const podCount = count(pod);
  const metrics = {
    all, pp: count(row => region(row) === 'PP'), pv: count(row => region(row) === 'PV'), pod: podCount,
    podRate: all ? podCount / all : 0, firstRate: all ? podCount / all : 0,
    pending1: count(row => pending(row) >= 1), pending2: count(row => pending(row) >= 2), pending3: count(row => pending(row) >= 3),
    oc1: count(row => oc(row) >= 1), oc2: count(row => oc(row) >= 2), oc3: count(row => oc(row) >= 3), inbound: count(row => yes(row.入库无扫描节点)),
    selfPickup: count(row => row.specialState === 'SELF_PICKUP'), cecn: count(row => row.specialState === 'CECN_RETENTION'), cezt: count(row => row.specialState === 'CEZT_RETENTION'), retention580: count(row => row.specialState === 'CCSL580_RETENTION'),
    snapshotCount: new Set(rows.map(row => row.snapshotId)).size, trends: {}
  };
  return metrics;
}

export function periodRange(type, value) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(`${value}T12:00:00+07:00`) : new Date();
  const iso = item => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(item);
  if (type === 'weekly') { const day = (date.getDay() + 6) % 7; const from = new Date(date); from.setDate(date.getDate() - day); const to = new Date(from); to.setDate(from.getDate() + 6); return { from: iso(from), to: iso(to), key: `${iso(from)}_${iso(to)}` }; }
  if (type === 'monthly') { const from = new Date(date.getFullYear(), date.getMonth(), 1, 12); const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12); return { from: iso(from), to: iso(to), key: iso(from).slice(0, 7) }; }
  const day = iso(date); return { from: day, to: day, key: day };
}

function uniquePeriodRows(rows) { const map = new Map(); for (const row of rows) map.set(`${row.reportDate || ''}|${bill(row)}`, row); return [...map.values()]; }
function bill(row) { return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(); }
function pending(row) { return Number(row.Pending次数 || row.Pending当前次数 || 0); }
function oc(row) { return Number(row.OC天数 || 0); }
function pod(row) { return row.是否POD === '是' || String(row.orderStatus || '') === '85' || row.POD状态 === 'POD'; }
function region(row) { return String(row.regionCode || row.regionType || row.区域 || '').toUpperCase().startsWith('PV') ? 'PV' : 'PP'; }
function yes(value) { return value === '是' || value === true || Number(value) > 0; }
function normalizeBusiness(value) { const type = String(value || '').toUpperCase(); if (!BUSINESSES.includes(type)) throw new Error('不支持的业务板块'); return type; }
function formatMetric(value, key) { return /Rate$/.test(key) ? `${(Number(value || 0) * 100).toFixed(2)}%` : String(Math.round(Number(value || 0))); }
function stamp() { return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); }
function xmlRow(number, values) { return `<x:row r="${number}">${values.map((value,index) => cell(number,index + 1,value)).join('')}</x:row>`; }
function xmlFormulaRow(number, before, formula, after) { const values = [...before, null, ...after]; return `<x:row r="${number}" ht="${number === 1 ? 30 : 24}" customHeight="1">${values.map((value,index) => index === before.length ? `<x:c r="${column(index + 1)}${number}" s="746" t="str"><x:f>${escapeXml(formula)}</x:f><x:v></x:v></x:c>` : cell(number,index + 1,value)).join('')}</x:row>`; }
function cell(row,col,value) { const style = row === 1 ? (col === 1 ? 787 : 782) : 720; if (value === null || value === undefined) return `<x:c r="${column(col)}${row}" s="${style}"/>`; if (typeof value === 'number') return `<x:c r="${column(col)}${row}" s="${style}"><x:v>${value}</x:v></x:c>`; return `<x:c r="${column(col)}${row}" s="${style}" t="inlineStr"><x:is><x:t>${escapeXml(String(value))}</x:t></x:is></x:c>`; }
function column(number) { let out=''; while(number){number-=1;out=String.fromCharCode(65+(number%26))+out;number=Math.floor(number/26);} return out; }
function escapeXml(value) { return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
async function zipFiles(files, target) { await new Promise((resolve,reject) => { const output=createWriteStream(target); const archive=archiver('zip',{zlib:{level:9}}); output.on('close',resolve); archive.on('error',reject); archive.pipe(output); for(const file of files) archive.file(file,{name:path.basename(file)}); archive.finalize(); }); }
