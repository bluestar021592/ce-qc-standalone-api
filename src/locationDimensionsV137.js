import { classifyFinalRoutingDestination, ROUTING_DESTINATIONS } from './routingDestinationV48.js';

export const LOCATION_DIMENSIONS_V137_ID='2026-08-15-v137-region-location-separation-v1';

export function decorateLocationDimensions(row={},dailyRow={}){
  const region=resolveDeliveryRegion(row,dailyRow);
  const routing=classifyFinalRoutingDestination(row);
  const shopCode=String(row.currentShopCode||row.targetShopCode||row.latestShopFactCode||row.shopCode||'').trim().toUpperCase();
  const shopState=String(row.shopState||row.currentState||'').toUpperCase();
  const isStore=Boolean(shopCode)||/^SHOP_/.test(shopState)||/门店/.test(String(row.primaryCategory||row.主分类||''));
  const selfPickup=String(row.currentState||row.specialState||'').toUpperCase()==='SELF_PICKUP'||row.primaryCategory==='仓库自提'||row.主分类==='仓库自提';

  let currentLocationType='TRACK_NODE';let currentLocationLabel='轨迹节点';
  if(routing.destination===ROUTING_DESTINATIONS.CCSLCN){currentLocationType='CECN';currentLocationLabel='CECN/CCSLCN';}
  else if(routing.destination===ROUTING_DESTINATIONS.CCSLZT){currentLocationType='CEZT';currentLocationLabel='CEZT/CCSLZT';}
  else if(routing.destination===ROUTING_DESTINATIONS.CCSL580){currentLocationType='CE580';currentLocationLabel='580滞留';}
  else if(selfPickup){currentLocationType='SELF_PICKUP';currentLocationLabel='仓库自提';}
  else if(isStore){
    const storeRegion=storeRegionFromCode(shopCode)||region.regionCode;
    if(storeRegion==='PP'){currentLocationType='PP_STORE';currentLocationLabel='金边门店';}
    else if(storeRegion==='PV'){currentLocationType='PV_STORE';currentLocationLabel='外省门店';}
    else {currentLocationType='STORE';currentLocationLabel='门店';}
  }else if(region.regionCode==='PP'){currentLocationType='PP';currentLocationLabel='金边';}
  else if(region.regionCode==='PV'){currentLocationType='PV';currentLocationLabel='外省';}

  return {
    ...row,
    deliveryRegionCode:region.regionCode,
    deliveryRegionType:region.regionType,
    deliveryRegionSource:region.source,
    收件区域:region.regionCode==='PP'?'金边':region.regionCode==='PV'?'外省':'待识别',
    currentLocationType,
    currentLocationLabel,
    当前轨迹位置类型:currentLocationLabel,
    currentShopCode:row.currentShopCode||shopCode||'',
    finalRoutingDestination:routing.destination||'',
    finalRoutingNode:routing.finalNode||'',
    locationDimensionVersion:LOCATION_DIMENSIONS_V137_ID
  };
}

export function resolveDeliveryRegion(row={},dailyRow={}){
  const candidates=[
    dailyRow.regionCode,row.regionCode,row.deliveryRegionCode,dailyRow.区域,row.区域,
    dailyRow.regionRaw,dailyRow.省份标识,dailyRow.收件省份,dailyRow.省份,
    row.regionRaw,row.省份标识,row.收件省份,row.省份
  ];
  const rawSource=firstNonEmpty(candidates);
  const code=normalizeRegionCode(rawSource);
  if(code)return {regionCode:code,regionType:code==='PP'?'PHNOM_PENH':'PROVINCE',source:rawSource===dailyRow.regionCode?'DAILY_REGION_CODE':'DAILY_OR_ROW_REGION'};
  const raw=unwrapRaw(dailyRow,row);
  for(const [key,value] of Object.entries(raw)){
    if(!/province|region|area|省|区域/i.test(String(key)))continue;
    const resolved=normalizeRegionCode(value);
    if(resolved)return {regionCode:resolved,regionType:resolved==='PP'?'PHNOM_PENH':'PROVINCE',source:`RAW:${key}`};
  }
  return {regionCode:'UNKNOWN',regionType:'UNKNOWN',source:'UNRESOLVED'};
}

function normalizeRegionCode(value){
  const raw=String(value||'').normalize('NFKC').trim();if(!raw)return'';
  const text=raw.toUpperCase().replace(/\s+/g,' ');
  if(/^(?:PP\d*|PNH)$/.test(text)||/PHNOM\s*PENH|金边/i.test(raw))return'PP';
  if(/^PV\d*$/.test(text))return'PV';
  // A named destination province that is explicitly not Phnom Penh is PV.
  if(/[A-Z\u1780-\u17FF\u4E00-\u9FFF]/i.test(raw))return'PV';
  return'';
}
function storeRegionFromCode(value=''){
  const code=String(value||'').replace(/\s+/g,'').toUpperCase();
  if(/^PNH\d{3}$/.test(code))return'PP';
  if(/^PV\d{3}$/.test(code))return'PV';
  return'';
}
function firstNonEmpty(values=[]){return values.find(value=>String(value??'').trim())??'';}
function unwrapRaw(...rows){const out={};for(const row of rows){if(!row||typeof row!=='object')continue;const raw=row.raw||row.rawJson||row.rowJson;if(raw&&typeof raw==='object')Object.assign(out,raw);else if(typeof raw==='string'&&raw.trim())try{Object.assign(out,JSON.parse(raw));}catch{}}return out;}
