import { spawnSync } from 'node:child_process';

const script='scripts/v581-production-shell-browser-smoke.mjs';
const maxAttempts=3;
const transient=/CDP\s+(?:Runtime\.evaluate|DOM\.[A-Za-z]+|Input\.[A-Za-z]+)\s+timed out|Could not find node with given id|No node with given id|timeout waiting for (?:Chromium|browser target)|ECONNRESET|WebSocket.*(?:closed|open error)/i;

for(let attempt=1;attempt<=maxAttempts;attempt+=1){
  console.log(`[V587_BROWSER_RETRY] attempt ${attempt}/${maxAttempts}`);
  const run=spawnSync(process.execPath,[script],{
    cwd:process.cwd(),
    env:{...process.env,CE_QC_BROWSER_GATE_ATTEMPT:String(attempt)},
    encoding:'utf8',
    windowsHide:true,
    timeout:120_000,
    maxBuffer:8*1024*1024
  });
  if(run.stdout)process.stdout.write(run.stdout);
  if(run.stderr)process.stderr.write(run.stderr);
  if(!run.error&&run.status===0){
    console.log(`[V587_BROWSER_RETRY] PASS on attempt ${attempt}`);
    process.exit(0);
  }
  const combined=String(run.stdout||'')+'\n'+String(run.stderr||'')+'\n'+String(run.error?.message||'');
  const isTransient=transient.test(combined)||String(run.error?.code||'')==='ETIMEDOUT';
  if(!isTransient||attempt===maxAttempts){
    console.error(`[V587_BROWSER_RETRY] ${isTransient?'transient browser/CDP failure persisted':'non-transient browser assertion failed'}; no further retry`);
    process.exit(run.status||1);
  }
  console.warn('[V587_BROWSER_RETRY] transient hosted-Windows browser/CDP stall; retrying in a fresh Edge/backend process');
}
process.exit(1);
