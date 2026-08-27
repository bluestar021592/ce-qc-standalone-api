import express from 'express';

export const V308_DASHBOARD_READ_BRIDGE_UI_ID='2026-08-27-v334-three-business-cache-bridge-spa-title-v1';
const MARKER='/v308-dashboard-read-bridge.js?v=20260827-v334-1';
const V329_COMPAT_MARKER='/v308-dashboard-read-bridge.js?v=20260827-v329-1';
void V329_COMPAT_MARKER;
const originalSend=express.response.send;

express.response.send=function v334DashboardReadBridgeSend(body){
  if(typeof body==='string'&&body.includes('</head>')&&body.includes('CE Express')){
    if(!body.includes(MARKER))body=body.replace('</head>',`  <script src="${MARKER}"></script>\n</head>`);
    this.setHeader?.('X-CE-QC-V308-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
    this.setHeader?.('X-CE-QC-V329-UI','2026-08-27-v329-three-business-cache-ui-v1');
    this.setHeader?.('X-CE-QC-V334-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
  }
  return originalSend.call(this,body);
};

console.info('[CE-QC][V334_UI_INJECTION]',V308_DASHBOARD_READ_BRIDGE_UI_ID,'TBKH/CN/VN history bridge is cache-only and visible SPA page title is authoritative before URL fallback.');