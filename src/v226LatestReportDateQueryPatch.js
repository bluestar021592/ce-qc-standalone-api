import { DatabaseSync } from 'node:sqlite';

export const V226_LATEST_REPORT_DATE_QUERY_VERSION='2026-08-19-v226-latest-report-date-first-v1';
const INSTALLED=Symbol.for('ce-qc.v226-latest-report-date-query-installed');
const ORIGINAL=Symbol.for('ce-qc.v226-latest-report-date-original-prepare');

function rewriteLatestValidUnifiedQuery(sql=''){
  const source=String(sql||'');
  if(!/FROM\s+unified_import_batches\b/i.test(source))return source;
  if(!/\bstatus\s*=\s*['"]VALID['"]/i.test(source))return source;
  if(/\breportDate\s*=\s*\?/i.test(source)||/ORDER\s+BY\s+[^;]*\breportDate\b/i.test(source))return source;
  if(!/ORDER\s+BY\s+(?:b\.)?createdAt\s+DESC\s+LIMIT\s+1/i.test(source))return source;
  return source.replace(/ORDER\s+BY\s+((?:b\.)?)createdAt\s+DESC\s+LIMIT\s+1/i,'ORDER BY $1reportDate DESC, $1createdAt DESC LIMIT 1');
}

if(!DatabaseSync.prototype[INSTALLED]){
  const original=DatabaseSync.prototype.prepare;
  Object.defineProperty(DatabaseSync.prototype,ORIGINAL,{value:original});
  Object.defineProperty(DatabaseSync.prototype,INSTALLED,{value:true});
  DatabaseSync.prototype.prepare=function v226LatestReportDatePrepare(sql,...args){
    return original.call(this,rewriteLatestValidUnifiedQuery(sql),...args);
  };
}

console.log('[CE-QC][V226] latest VALID unified import is selected by reportDate DESC then createdAt DESC; later reimports of older days cannot push the dashboard backwards.');

export const __test={rewriteLatestValidUnifiedQuery};
