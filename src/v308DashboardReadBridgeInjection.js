import express from 'express';

export const V308_DASHBOARD_READ_BRIDGE_UI_ID='2026-08-26-v308-nonblocking-dashboard-read-bridge-v1';
const MARKER='/v308-dashboard-read-bridge.js?v=20260826-v308-1';
const originalSend=express.response.send;

express.response.send=function v308DashboardReadBridgeSend(body){
  if(typeof body==='string'&&body.includes('</head>')&&body.includes('CE Express')){
    if(!body.includes(MARKER))body=body.replace('</head>',`  <script src="${MARKER}"></script>\n</head>`);
    this.setHeader?.('X-CE-QC-V308-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
  }
  return originalSend.call(this,body);
};

console.info('[CE-QC][V308_UI_INJECTION]',V308_DASHBOARD_READ_BRIDGE_UI_ID,'V308 bridge is delivered in <head> before legacy dashboard owners so duplicate/heavy passive trend reads are intercepted before they reach SQLite.');
