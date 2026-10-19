// Stage 0: installed-main transport proof ONLY. Pure metadata, read only.
// No CE token, customer shipment, SQLite, TMS call, backup or file writes.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const STAGE0_PROBE_ID='2026-10-19-v788-stage0-main-update-readonly-v1';
const SHA=/^[0-9a-f]{40}$/i;
function localGit(root,args){
  try{
    return execFileSync('git',['-C',root,...args],{
      encoding:'utf8',windowsHide:true,timeout:1800,
      stdio:['ignore','pipe','ignore'],maxBuffer:1024
    }).trim().slice(0,80);
  }catch{return ''}
}
export function inspectStage0UpdateProbe(projectRoot){
  const root=path.resolve(String(projectRoot||process.cwd()));
  // No GitHub access: local cached ref is NOT a fresh remote attestation.
  const tracked=fs.existsSync(path.join(root,'.git'));
  const head=tracked?localGit(root,['rev-parse','--verify','HEAD']):'';
  const cached=tracked?localGit(root,['rev-parse','--verify','refs/remotes/origin/main']):'';
  const branch=tracked?localGit(root,['symbolic-ref','--short','HEAD']):'';
  const installed=SHA.test(head)?head.toLowerCase():'';
  const cachedMain=SHA.test(cached)?cached.toLowerCase():'';
  return {
    ok:true,probeId:STAGE0_PROBE_ID,backendResponding:true,
    readOnly:true,productionModified:false,v788FullReleaseInstalled:false,
    installedCommit:installed,installedBranch:branch.slice(0,64)||'UNKNOWN',
    cachedOriginMainCommit:cachedMain,
    localMainMatchesCachedRemote:!!(installed&&cachedMain&&branch==='main'&&installed===cachedMain),
    // Intentionally do not infer user-device readiness from this transport probe.
    realExcelValidated:false,sevenBusinessValidated:false,
    authorizedToClear:false,officialV788ReleaseApproved:false
  };
}
