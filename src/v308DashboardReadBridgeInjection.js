import express from 'express';

export const V308_DASHBOARD_READ_BRIDGE_UI_ID='2026-08-26-v327-shared-history-single-read-bridge-v1';
const MARKER='/v308-dashboard-read-bridge.js?v=20260826-v327-1';
const originalSend=express.response.send;

express.response.send=function v327DashboardReadBridgeSend(body){
  if(typeof body==='string'&&body.includes('</head>')&&body.includes('CE Express')){
    if(!body.includes(MARKER))body=body.replace('</head>',`  <script src="${MARKER}"></script>\n</head>`);
    this.setHeader?.('X-CE-QC-V308-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
    this.setHeader?.('X-CE-QC-V320-UI','2026-08-26-v320-history-dispatch-signing-ui-v2');
    this.setHeader?.('X-CE-QC-V324-UI','2026-08-26-v324-auto-full-uploaded-history-ui-v2');
    this.setHeader?.('X-CE-QC-V327-UI','2026-08-26-v327-shared-history-single-read-ui-v1');
  }
  return originalSend.call(this,body);
};

console.info('[CE-QC][V327_UI_INJECTION]',V308_DASHBOARD_READ_BRIDGE_UI_ID,'Shopee history table and trend share one local persisted-history response; short 6.5s history abort retired.');
