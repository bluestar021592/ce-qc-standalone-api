import express from 'express';

export const V308_DASHBOARD_READ_BRIDGE_UI_ID='2026-08-27-v329-three-business-cache-bridge-v1';
const MARKER='/v308-dashboard-read-bridge.js?v=20260827-v329-1';
const originalSend=express.response.send;

express.response.send=function v329DashboardReadBridgeSend(body){
  if(typeof body==='string'&&body.includes('</head>')&&body.includes('CE Express')){
    if(!body.includes(MARKER))body=body.replace('</head>',`  <script src="${MARKER}"></script>\n</head>`);
    this.setHeader?.('X-CE-QC-V308-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
    this.setHeader?.('X-CE-QC-V329-UI','2026-08-27-v329-three-business-cache-ui-v1');
  }
  return originalSend.call(this,body);
};

console.info('[CE-QC][V329_UI_INJECTION]',V308_DASHBOARD_READ_BRIDGE_UI_ID,'TBKH/CN/VN history bridge is cache-only on the web process; background refresh no longer clears the visible table.');