const RETURN_TYPES=new Set(['WHPP','SHOPEECN','SHOPEEVN']);

export function buildCanonicalBusinessAccounting(state={},businessType=''){
  const type=String(businessType||state.viewBusinessType||state.businessType||'').toUpperCase();
  const source=uniqueRows(Array.isArray(state.finalRows)?state.finalRows:[]);
  const total=Number(state.pnhBills?.length||state.dailyParseRows?.length||source.length||0);
  const rowsByKind={total:source,pod:[],returned:[],pending:[],abnormal:[],otherNormal:[],delivery:[],unprocessed:[]};

  for(const row of source){
    if(rowIsPod(row)){rowsByKind.pod.push(row);continue}
    if(RETURN_TYPES.has(type)&&rowIsReturned(row)){rowsByKind.returned.push(row);continue}
    if(row.finalRowAvailable===false||isWaitingProcessing(row)){rowsByKind.unprocessed.push(row);continue}
    if(rowIsPending(row)){rowsByKind.pending.push(row);continue}
    if(rowIsAbnormal(row)){rowsByKind.abnormal.push(row);continue}
    if(rowIsOtherNormal(row)){rowsByKind.otherNormal.push(row);continue}
    if(rowIsDelivery(row)){rowsByKind.delivery.push(row);continue}
    rowsByKind.unprocessed.push(row);
  }

  const counts=Object.fromEntries(Object.entries(rowsByKind).map(([key,rows])=>[key,rows.length]));
  const accounted=['pod','returned','pending','abnormal','otherNormal','delivery','unprocessed'].reduce((sum,key)=>sum+counts[key],0);
  const difference=total-accounted;
  return {
    businessType:type,total,accounted,difference,balanced:difference===0,
    counts:{...counts,total},
    rowsByKind
  };
}

function uniqueRows(rows=[]){
  const map=new Map();
  for(const row of rows||[]){
    const code=billOf(row);
    if(code&&!map.has(code))map.set(code,row);
  }
  return [...map.values()];
}
function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase()}
function textOf(row={}){
  return [row.primaryCategory,row.currentMainCategory,row.category,row.主分类,row.异常分类,row.currentState,row.scanNormalizedState,row.退回状态,row.specialState,row.shopState,row.门店状态,row.latestEventDesc,row.最后节点,row.QC判断,row.apiStatus,row.API状态]
    .map(v=>String(v||'')).join(' ').toUpperCase();
}
function rowIsPod(row={}){
  const text=textOf(row);
  if(row.是否POD==='是'||Number(row.isPod||0)===1||String(row.orderStatus||'')==='85')return true;
  return /(^|\s)(POD|已签收|签收成功|已妥投|DELIVERED|SIGNED)(\s|$)/i.test(text)&&!/未签收|未妥投|签收失败|POD失败/.test(text);
}
function rowIsReturned(row={}){
  const text=textOf(row);
  if(/未退回|非退回|待退回|退回处理中|NOT_RETURNED|PENDING_RETURN|NO_RETURN/i.test(text))return false;
  return /(已退回|退回完成|RETURN_COMPLETED|RETURNED)(\s|$)/i.test(text);
}
function isWaitingProcessing(row={}){
  const state=String(row.currentState||row.scanNormalizedState||'').toUpperCase();
  const api=String(row.apiStatus||row.API状态||'').toUpperCase();
  return ['PENDING_SCAN','WAITING_SCAN','PENDING_PROCESS'].includes(state)||['PENDING_SCAN','WAITING_SCAN'].includes(api);
}
function rowIsPending(row={}){
  return Number(row.Pending次数||row.Pending天数||row.pendingDistinctDayCount||row.pendingDays||0)>0||/(^|\s)PENDING(\s|$)|待联系|联系待确认/i.test(textOf(row));
}
function rowIsAbnormal(row={}){
  const text=textOf(row);
  return Number(row.OC天数||row.ocDays||0)>0||
    Number(row.盘点天数||row.盘点次数||row.cycleCountDays||0)>0||
    row.入库无扫描节点==='是'||
    /(OC|异常|盘点|工单|入库无扫描|节点未更新|无轨迹|失败待重试|严重超时|滞留)/i.test(text);
}
function rowIsOtherNormal(row={}){
  const text=textOf(row),special=String(row.specialState||row.primaryCategory||row.主分类||'').toUpperCase();
  const shop=String(row.shopState||'').toUpperCase();
  if(['SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION'].includes(special))return true;
  if(row.matchedRule==='NORMAL_FINAL_HUB')return true;
  return /正常分流|自提|CECN|CEZT|580|订单取消|已取消|CANCELLED|CANCELED/.test(text)||
    /^SHOP_/.test(shop)||/门店途中|到达门店|门店入库/.test(text);
}
function rowIsDelivery(row={}){
  return Number(row.派送中停留天数||row.派送中天数||row.deliveringDays||0)>0||/派送中|DELIVERING|OUT_FOR_DELIVERY/i.test(textOf(row));
}
