import express from 'express';

export const V308_DASHBOARD_READ_BRIDGE_UI_ID='2026-08-27-v343-history-signing-region-ui-v1';
const MARKER='/v308-dashboard-read-bridge.js?v=20260918-stability-v319-1';
const V334_COMPAT_MARKER='/v308-dashboard-read-bridge.js?v=20260827-v334-1';
const V329_COMPAT_MARKER='/v308-dashboard-read-bridge.js?v=20260827-v329-1';
void V334_COMPAT_MARKER;void V329_COMPAT_MARKER;
const originalSend=express.response.send;

express.response.send=function v343DashboardReadBridgeSend(body){
  if(typeof body==='string'&&body.includes('</head>')&&body.includes('CE Express')){
    if(!body.includes(MARKER))body=body.replace('</head>',`  <script src="${MARKER}"></script>\n</head>`);
    this.setHeader?.('X-CE-QC-V308-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
    this.setHeader?.('X-CE-QC-V329-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
    this.setHeader?.('X-CE-QC-V334-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
  }
  return originalSend.call(this,body);
};

console.info('[CE-QC][V343_UI_INJECTION]',V308_DASHBOARD_READ_BRIDGE_UI_ID,'one active TBKH/CN/VN history table owner; browser cache is busted for PP/PV signing averages and automatic stale-cache rebuild.');
