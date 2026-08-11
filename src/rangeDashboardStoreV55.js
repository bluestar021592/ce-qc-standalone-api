import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV36 } from './rangeDashboardStoreV36.js';
import { classifyFinalRoutingDestination, ROUTING_DESTINATIONS } from './routingDestinationV48.js';

const PATCH_ID = '2026-08-11-v55-dashboard-reconciliation-v1';
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

export function loadRangeDashboard(fromDate, toDate) {
  const range = loadRangeDashboardV36(fromDate, toDate);
  const facts = queryFacts(range.fromDate, range.toDate);

  for (const type of CCSL_TYPES) patchCcslState(range.states?.[type], facts.filter(row => row.businessType === type));
  patchCcslState(range.aggregates?.CCSL, facts.filter(row => CCSL_TYPES.has(row.businessType)));

  for (const type of SHOPEE_TYPES) patchShopeeState(range.states?.[type], facts.filter(row => row.businessType === type));
  patchShopeeState(range.aggregates?.SHOPEE, facts.filter(row => SHOPEE_TYPES.has(row.businessType)));

  return {
    ...range,
    queryMode: `${range.queryMode || 'SQL'}+DASHBOARD_RECONCILIATION_V55`,
    reconciliationRuleVersion: PATCH_ID
  };
}

export function loadMetricDetail({ businessType='CCSL', fromDate='', toDate='', tab='allData', page=1, pageSize=200 }={}) {
  const type = String(businessType || 'CCSL').trim().toUpperCase();
  const facts = queryFacts(fromDate, toDate);
  const scoped = type === 'CCSL'
    ? facts.filter(row => CCSL_TYPES.has(row.businessType))
    : type === 'SHOPEE'
      ? facts.filter(row => SHOPEE_TYPES.has(row.businessType))
      : facts.filter(row => row.businessType === type);
  const rows = rowsForTab(scoped, tab);
  const safePage = Math.max(1, Number(page || 1) || 1);
  const safeSize = Math.max(1, Math.min(500, Number(pageSize || 200) || 200));
  const start = (safePage - 1) * safeSize;
  return { ok:true, patchId:PATCH_ID, businessType:type, fromDate, toDate, tab, page:safePage, pageSize:safeSize, total:rows.length, rows:rows.slice(start,start+safeSize) };
}

function queryFacts(fromDate, toDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fromDate||'')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(toDate||'')) || fromDate > toDate) return [];
  const rows = getDb().prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
        ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) AS rn
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1),
    valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
             WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
             ELSE 'UNKNOWN' END AS regionCode
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
    )
    SELECT v.reportDate,v.businessType,v.regionCode,v.shipmentCode,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.isPod,0) ELSE COALESCE(cf.isPod,0) END AS isPod,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.primaryCategory,'') ELSE COALESCE(cf.primaryCategory,'') END AS primaryCategory,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.latestEventDesc,'') ELSE COALESCE(cf.lastEventDesc,'') END AS lastEventDesc,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.latestEventTime,'') ELSE COALESCE(cf.lastEventTime,'') END AS lastEventTime,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.shopState,'') ELSE COALESCE(cf.shopState,'') END AS shopState,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.shopRetentionNaturalDays,0) ELSE COALESCE(cf.shopRetentionNaturalDays,0) END AS shopRetentionNaturalDays,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.rawJson,'{}') ELSE COALESCE(cf.rawJson,'{}') END AS rawJson
    FROM valid v
    LEFT JOIN final_rows cf ON v.businessType IN ('CE','CEAF','TBKH','ALI1688') AND cf.shipmentCode=v.shipmentCode AND cf.reportDate=v.reportDate
    LEFT JOIN business_final_rows sf ON v.businessType IN ('SHOPEECN','SHOPEEVN') AND sf.businessType='SHOPEE' AND sf.shipmentCode=v.shipmentCode AND sf.reportDate=v.reportDate
    ORDER BY v.reportDate,v.businessType,v.shipmentCode
  `).all(fromDate,toDate);
  return unique(rows.map(decorate));
}

function decorate(row={}) {
  const raw = safeJson(row.rawJson);
  const merged = {
    ...raw,...row,
    shipmentCode: row.shipmentCode || raw.shipmentCode || raw.运单号 || '',
    运单号: row.shipmentCode || raw.shipmentCode || raw.运单号 || '',
    businessType: row.businessType || raw.businessType || '',
    reportDate: row.reportDate || raw.reportDate || '',
    regionCode: region(row.regionCode || raw.regionCode || raw.区域),
    区域: region(row.regionCode || raw.regionCode || raw.区域),
    primaryCategory: row.primaryCategory || raw.primaryCategory || raw.主分类 || raw.异常分类 || '',
    当前分类: row.primaryCategory || raw.primaryCategory || raw.主分类 || raw.异常分类 || '',
    lastEventDesc: row.lastEventDesc || raw.lastEventDesc || raw.latestEventDesc || raw.最新节点 || raw.最后节点 || '',
    最新节点: row.lastEventDesc || raw.lastEventDesc || raw.latestEventDesc || raw.最新节点 || raw.最后节点 || '',
    lastEventTime: row.lastEventTime || raw.lastEventTime || raw.latestEventTime || raw.最新时间 || raw.最后节点时间 || '',
    最新时间: row.lastEventTime || raw.lastEventTime || raw.latestEventTime || raw.最新时间 || raw.最后节点时间 || '',
    shopState: row.shopState || raw.shopState || '',
    shopRetentionNaturalDays: num(row.shopRetentionNaturalDays || raw.shopRetentionNaturalDays),
    isPod: num(row.isPod || raw.isPod)
  };
  const route = classifyFinalRoutingDestination(merged);
  merged.routingDestination = route.destination || '';
  merged.finalRoutingNode = route.finalNode || '';
  merged.routingSourceField = route.sourceField || '';
  merged.POD状态 = isPod(merged) ? 'POD' : '未POD';
  merged.物理位置 = physicalLocation(merged);
  delete merged.rawJson;
  return merged;
}

function patchCcslState(state, rows) {
  if (!state?.dashboard) return;
  const details = ccslDetails(rows);
  const s = ccslSummary(rows, details);
  state.finalRows = rows;
  state.detailTabs = { ...(state.detailTabs || {}), ...details };
  state.v55Summary = s;
  state.dashboard = {
    ...(state.dashboard || {}),
    pnh:s.total,totalMonitored:s.total,todayPod:s.pod,podRate:s.podRate,returned:s.returned,
    abnormalCount:s.abnormal,v55Summary:s,
    categories:{ ...(state.dashboard.categories || {}), pendingTotal:s.pending1,ocTotal:s.oc1,ccslCnDiversion:s.ccslCnDiversion,ccslZtDiversion:s.ccslZtDiversion,ccsl580Retention:s.ccsl580Retention,phnomPenhShop:s.phnomPenhShop,provinceShop:s.provinceShop,provinceOpen:s.provinceOpen }
  };
  patchDashboardRows(state.detailTabs?.dashboard?.rows,s);
}

function patchShopeeState(state, rows) {
  if (!state?.dashboard) return;
  const details = shopeeDetails(rows);
  const s = shopeeSummary(rows);
  state.finalRows = rows;
  state.detailTabs = { ...(state.detailTabs || {}), ...details };
  if (state.dashboard.detailTabs) state.dashboard.detailTabs = { ...state.dashboard.detailTabs, ...details };
  if (state.dashboard.metrics) Object.assign(state.dashboard.metrics,s);
  state.v55Summary=s; state.dashboard.v55Summary=s;
  const groups=state.dashboard.recipientGroups||{};
  for(const [g,type] of [['ALL',''],['CN','SHOPEECN'],['VN','SHOPEEVN']]){
    const subset=type?rows.filter(r=>r.businessType===type):rows;
    if(groups[g]?.metrics)Object.assign(groups[g].metrics,shopeeSummary(subset));
  }
}

function ccslDetails(rows) {
  const pod=rows.filter(isPod), returned=rows.filter(isReturned), open=rows.filter(isGenuineOpen), abnormal=open.filter(isActionableAbnormal);
  const cn=rows.filter(r=>!isTerminal(r)&&destination(r)===ROUTING_DESTINATIONS.CCSLCN);
  const zt=rows.filter(r=>!isTerminal(r)&&destination(r)===ROUTING_DESTINATIONS.CCSLZT);
  const r580=rows.filter(r=>!isTerminal(r)&&destination(r)===ROUTING_DESTINATIONS.CCSL580);
  return {
    allData:tab('全部数据',rows),podClosed:tab('签收件数',pod),accountingReturned:tab('已退回件',returned),accountingOpen:tab('当前未闭环',open),unresolved:tab('未闭环',open),ordinaryOpen:tab('未闭环',open),
    coreAbnormal:tab('遗留异常',abnormal),abnormal:tab('遗留异常',abnormal),severeAbnormal:tab('严重异常',abnormal.filter(isSevere)),
    pendingAll:tab('Pending1+',open.filter(r=>pendingDays(r)>=1)),pending2plus:tab('Pending2+',open.filter(r=>pendingDays(r)>=2)),pending3:tab('Pending3+',open.filter(r=>pendingDays(r)>=3)),pendingNonContinuous:tab('Pending不连续',open.filter(isPendingNonContinuous)),
    ocAll:tab('OC1+',open.filter(r=>ocDays(r)>=1)),oc2plus:tab('OC2+',open.filter(r=>ocDays(r)>=2)),oc3:tab('OC3+',open.filter(r=>ocDays(r)>=3)),
    cycle2:tab('盘点2天+',open.filter(r=>cycleDays(r)>=2)),cycle2plus:tab('盘点2天+',open.filter(r=>cycleDays(r)>=2)),inboundNoScan:tab('入库无扫描',open.filter(isInboundNoScan)),workOrderAbnormal:tab('工单未处理',open.filter(isWorkOrder)),
    provinceOpen:tab('外省未完结POD件',rows.filter(isProvinceOpen)),selfPickup:tab('仓库自提件',rows.filter(r=>!isTerminal(r)&&isSelfPickup(r))),
    cecnRetention:tab('CCSLCN分流',cn),ccslCnDiversion:tab('CCSLCN分流',cn),ceztRetention:tab('CCSLZT分流',zt),ccslZtDiversion:tab('CCSLZT分流',zt),ccsl580Retention:tab('580滞留包裹',r580),ccsl580Diversion:tab('580滞留包裹',r580),
    phnomPenhShop:tab('金边门店',rows.filter(isPhnomPenhShop)),provinceShop:tab('外省门店',rows.filter(isProvinceShop)),
    shopTransit:tab('门店途中',open.filter(r=>r.shopState==='SHOP_TRANSFER_IN_PROGRESS')),shopArrived:tab('门店入库',open.filter(r=>r.shopState==='SHOP_ARRIVED_CURRENT')),shopStuck:tab('门店滞留',open.filter(r=>r.shopState==='SHOP_ARRIVED_CURRENT'&&num(r.shopRetentionNaturalDays)>=2)),
    accountingDifference:tab('对账差异',[])
  };
}

function shopeeDetails(rows) {
  const open=rows.filter(isGenuineOpen);
  return {
    all:tab('全部数据',rows),pod:tab('今日POD',rows.filter(isPod)),returned:tab('已退回件',rows.filter(isReturned)),unresolved:tab('当前未闭环',open),abnormal:tab('当前异常',open.filter(isActionableAbnormal)),
    pending1:tab('Pending1+',open.filter(r=>pendingDays(r)>=1)),pending2:tab('Pending2+',open.filter(r=>pendingDays(r)>=2)),pending3:tab('Pending3+',open.filter(r=>pendingDays(r)>=3)),pendingNonContinuous:tab('Pending不连续',open.filter(isPendingNonContinuous)),
    oc1:tab('OC1+',open.filter(r=>ocDays(r)>=1)),oc2:tab('OC2+',open.filter(r=>ocDays(r)>=2)),oc3:tab('OC3+',open.filter(r=>ocDays(r)>=3)),cycle2:tab('盘点2天+',open.filter(r=>cycleDays(r)>=2)),inboundNoScan:tab('入库无扫描',open.filter(isInboundNoScan)),
    deliveryStay:tab('派送中',open.filter(r=>deliveryDays(r)>0||/派送中/.test(category(r)))),returnRequired:tab('退回待处理',open.filter(r=>r.退回待处理==='是'||/三次Pending后/.test(category(r)))),
    provinceOpen:tab('外省未完结POD件',rows.filter(isProvinceOpen)),phnomPenhShop:tab('金边门店',rows.filter(isPhnomPenhShop)),provinceShop:tab('外省门店',rows.filter(isProvinceShop))
  };
}

function ccslSummary(rows,d=ccslDetails(rows)) {
  const total=rows.length,pod=d.podClosed.total,returned=d.accountingReturned.total,open=d.accountingOpen.total;
  const normal=d.ccslCnDiversion.total+d.ccslZtDiversion.total+d.ccsl580Retention.total+d.phnomPenhShop.total+d.selfPickup.total;
  return { total,pod,podRate:rate(pod,total),returned,returnRate:rate(returned,total),open,unresolved:open,abnormal:d.coreAbnormal.total,accountingDifference:Math.max(0,total-pod-returned-normal-open),
    pending1:d.pendingAll.total,pending2:d.pending2plus.total,pending3:d.pending3.total,pendingNonContinuous:d.pendingNonContinuous.total,oc1:d.ocAll.total,oc2:d.oc2plus.total,oc3:d.oc3.total,cycle2:d.cycle2.total,inboundNoScan:d.inboundNoScan.total,workOrder:d.workOrderAbnormal.total,
    provinceOpen:d.provinceOpen.total,ccslCnDiversion:d.ccslCnDiversion.total,ccslZtDiversion:d.ccslZtDiversion.total,ccsl580Retention:d.ccsl580Retention.total,phnomPenhShop:d.phnomPenhShop.total,provinceShop:d.provinceShop.total,selfPickup:d.selfPickup.total,normalDestination:normal,accounted:pod+returned+normal+open };
}

function shopeeSummary(rows) {
  const total=rows.length,pod=rows.filter(isPod).length,returned=rows.filter(isReturned).length,open=rows.filter(isGenuineOpen);
  return { total,pod,podRate:rate(pod,total),returned,returnRate:rate(returned,total),unresolved:open.length,pending1:open.filter(r=>pendingDays(r)>=1).length,pending2:open.filter(r=>pendingDays(r)>=2).length,pending3plus:open.filter(r=>pendingDays(r)>=3).length,oc1:open.filter(r=>ocDays(r)>=1).length,oc2:open.filter(r=>ocDays(r)>=2).length,oc3plus:open.filter(r=>ocDays(r)>=3).length,cycle2plus:open.filter(r=>cycleDays(r)>=2).length,inboundNoScan:open.filter(isInboundNoScan).length,accountingDifference:0 };
}

function rowsForTab(rows,rawTab) {
  const key=String(rawTab||'');
  const c=ccslDetails(rows),s=shopeeDetails(rows);
  const aliases={allData:'allData',all:'all',podClosed:'podClosed',pod:'pod',accountingReturned:'accountingReturned',returned:'returned',accountingOpen:'accountingOpen',unresolved:'unresolved',cecnRetention:'cecnRetention',ceztRetention:'ceztRetention',ccsl580Diversion:'ccsl580Retention'};
  return (c[aliases[key]||key]||s[aliases[key]||key])?.rows||[];
}

function patchDashboardRows(rows,s) {
  if(!Array.isArray(rows))return;
  const value={
    '今日PNH':s.total,'今日件数':s.total,'今日POD':s.pod,'首投POD率':s.podRate,'Pending1+':s.pending1,'Pending2+':s.pending2,'Pending3+':s.pending3,'Pending不连续':s.pendingNonContinuous,
    'OC1+':s.oc1,'OC2+':s.oc2,'OC3+':s.oc3,'盘点2天+':s.cycle2,'入库无扫描节点':s.inboundNoScan,'工单未处理':s.workOrder,'外省未完结POD件':s.provinceOpen,'仓库自提件':s.selfPickup,
    'CCSLCN分流':s.ccslCnDiversion,'CCSLZT分流':s.ccslZtDiversion,'580滞留包裹':s.ccsl580Retention,'金边门店':s.phnomPenhShop,'外省门店':s.provinceShop,'未闭环':s.open,'当前未闭环':s.open
  };
  for(const row of rows){
    let name=String(row?.项目||row?.metricKey||'');
    if(name==='CECN滞留包裹')name='CCSLCN分流'; if(name==='CEZT滞留包裹')name='CCSLZT分流'; if(['CCSL580分流','CCSL580滞留包裹'].includes(name))name='580滞留包裹';
    if(Object.hasOwn(value,name)){row.项目=name;row.metricKey=name;row.数值=value[name];row.数值原值=num(value[name]);}
  }
  upsert(rows,'CCSLCN分流',s.ccslCnDiversion,'ccslCnDiversion');upsert(rows,'CCSLZT分流',s.ccslZtDiversion,'ccslZtDiversion');upsert(rows,'580滞留包裹',s.ccsl580Retention,'ccsl580Retention');upsert(rows,'金边门店',s.phnomPenhShop,'phnomPenhShop');upsert(rows,'外省门店',s.provinceShop,'provinceShop');upsert(rows,'外省未完结POD件',s.provinceOpen,'provinceOpen');
  const seen=new Set(); for(let i=rows.length-1;i>=0;i--){const k=String(rows[i]?.项目||rows[i]?.metricKey||'');if(seen.has(k))rows.splice(i,1);else seen.add(k);}
}
function upsert(rows,label,value,tabName){let r=rows.find(x=>String(x?.项目||x?.metricKey||'')===label);if(!r){r={日期:rows[0]?.日期||'',项目:label,metricKey:label};rows.push(r);}Object.assign(r,{项目:label,metricKey:label,数值:num(value),数值原值:num(value),明细Tab:tabName,状态:num(value)>0?'需跟进':'正常'});}

function isGenuineOpen(r){return !isTerminal(r)&&!destination(r)&&!isSelfPickup(r)&&!isPhnomPenhShop(r);}
function isProvinceOpen(r){return isGenuineOpen(r)&&physicalLocation(r)!=='PHNOM_PENH'&&(region(r.regionCode||r.区域)==='PV'||physicalLocation(r)==='PROVINCE');}
function isPhnomPenhShop(r){return !isTerminal(r)&&!destination(r)&&isActiveShop(r)&&physicalLocation(r)==='PHNOM_PENH';}
function isProvinceShop(r){return !isTerminal(r)&&!destination(r)&&((isActiveShop(r)&&physicalLocation(r)==='PROVINCE')||explicitProvinceShop(r));}
function explicitProvinceShop(r){return /\bSHV(?:\s*SHOP)?\b|SIHANOUK|PREAH\s*SIHANOUK|西港|CCSL[_:\s-]*PV[_:\s-]*CENS|(?:^|[^A-Z0-9])PV\d{3}(?!\d)/i.test(locationText(r));}
function physicalLocation(r){const t=locationText(r).toUpperCase();if(/\bSHV(?:\s*SHOP)?\b|SIHANOUK|PREAH\s*SIHANOUK|西港|CCSL[_:\s-]*PV[_:\s-]*CENS|(?:^|[^A-Z0-9])PV\d{3}(?!\d)/.test(t))return'PROVINCE';if(/PHNOM\s*PENH|金边|CCSL[_:\s-]*PP|(?:^|[^A-Z0-9])PNH\d{3}(?!\d)/.test(t))return'PHNOM_PENH';if(isActiveShop(r)){const x=region(r.regionCode||r.区域);if(x==='PP')return'PHNOM_PENH';if(x==='PV')return'PROVINCE';}return'UNKNOWN';}
function locationText(r={}){return[r.latestEffectiveTargetNodeCode,r.latestEffectiveTargetNode,r.latestTargetNodeCode,r.latestTargetNode,r.latestNodeCode,r.latestNode,r.最后节点编码,r.最后节点,r.lastEventDesc,r.latestEventDesc,r.最新节点,r.targetShopCode,r.currentShopCode,r.shopName,r.eventShop,r.locationCode,r.place,r.shopState].filter(Boolean).join(' ');}
function destination(r){return classifyFinalRoutingDestination(r).destination||'';}
function isActiveShop(r){return['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(r.shopState||r.storeFlowState||''));}
function isTerminal(r){return isPod(r)||isReturned(r)||isCancelled(r);}
function isPod(r){return num(r.isPod)===1||r.是否POD==='是'||r.POD状态==='POD'||state(r)==='POD'||String(r.orderStatus??r.scanOrderStatus??'')==='85';}
function isReturned(r){return r.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(state(r))||String(r.orderStatus??r.scanOrderStatus??'')==='100'||category(r)==='退回';}
function isCancelled(r){return r.订单取消==='是'||r.取消状态==='已取消'||state(r)==='ORDER_CANCELLED'||String(r.orderStatus??r.scanOrderStatus??'')==='10';}
function isSelfPickup(r){return String(r.specialState||'').toUpperCase()==='SELF_PICKUP'||/^(?:仓库自提|自提)$/.test(category(r));}
function isActionableAbnormal(r){if(!isGenuineOpen(r))return false;if(isProvinceOpen(r)||pendingDays(r)>0||ocDays(r)>0||cycleDays(r)>0||deliveryDays(r)>0||isInboundNoScan(r)||isWorkOrder(r)||isPendingNonContinuous(r))return true;const c=category(r);return Boolean(c&&!/^(?:正常流转|PICKUP_SUCCESS|派送中|待派送|正常)$/.test(c));}
function isSevere(r){return /SEVERE|CRITICAL|严重/.test(`${category(r)} ${r.severity||r.严重等级||''}`)||Math.max(pendingDays(r),ocDays(r),cycleDays(r),num(r.节点未更新天数))>=3;}
function isPendingNonContinuous(r){return r.Pending不连续==='是'||/不连续/.test(String(r.pendingContinuity||r.pendingFactDateContinuity||r.Pending事实连续性||r.Pending连续性||''));}
function isInboundNoScan(r){return r.入库无扫描节点==='是'||/入库无扫描/.test(category(r));}
function isWorkOrder(r){return/工单/.test(category(r));}
function pendingDays(r){return num(r.pendingDistinctDayCount??r.Pending当前次数??r.Pending次数??r.pendingDays);}
function ocDays(r){return num(r.OC天数??r.ocDays);}
function cycleDays(r){return num(r.盘点天数??r.cycleCountDays);}
function deliveryDays(r){return num(r.派送中停留天数??r.deliveringDays??r.deliveryDays);}
function category(r){return String(r.primaryCategory||r.当前分类||r.主分类||r.异常分类||'').trim();}
function state(r){return String(r.persistedCurrentState||r.currentState||r.state||r.scanNormalizedState||'').trim().toUpperCase();}
function region(v){const x=String(v||'').trim().toUpperCase();return x==='PP'?'PP':x==='PV'?'PV':'UNKNOWN';}
function safeJson(v){try{return v&&typeof v==='object'?v:JSON.parse(String(v||'{}'));}catch{return{};}}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0;}
function rate(v,t){return num(t)?Number((num(v)*100/num(t)).toFixed(2)):0;}
function unique(rows){const m=new Map();for(const r of rows||[]){const k=`${r.reportDate||''}|${r.businessType||''}|${String(r.shipmentCode||r.运单号||'').toUpperCase()}`;if(r.shipmentCode||r.运单号)m.set(k,r);}return[...m.values()];}
function tab(label,rows){const values=unique(rows);return{label,rows:values,total:values.length};}

export const RANGE_DASHBOARD_V55_PATCH_ID = PATCH_ID;
