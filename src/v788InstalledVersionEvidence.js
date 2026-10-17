// V788 installed build identity: READ ONLY Git metadata, never fetch/merge.
// Only the managed updater (main) can install the formally published build.
// Do not confuse origin/main cached locally with live GitHub confirmation.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {getRuntimeConfig} from './db.js';

const SHA=/^[0-9a-f]{40}$/i;
function git(args,root){
  try{
    const value=execFileSync('git',['-C',root,...args],{
      encoding:'utf8',timeout:2500,windowsHide:true,
      stdio:['ignore','pipe','ignore'],maxBuffer:4096
    }).trim();
    return value.slice(0,80);
  }catch{return ''}
}
export function inspectV788InstalledVersionEvidence(){
  const root=getRuntimeConfig().projectRoot;
  const tracked=fs.existsSync(path.join(root,'.git'));
  const commit=tracked?git(['rev-parse','--verify','HEAD'],root):'';
  const branch=tracked?git(['symbolic-ref','--short','HEAD'],root):'';
  const localRemoteMain=tracked?git(['rev-parse','--verify','refs/remotes/origin/main'],root):'';
  const installedCommit=SHA.test(commit)?commit.toLowerCase():'';
  const cachedMainCommit=SHA.test(localRemoteMain)?localRemoteMain.toLowerCase():'';
  const mainCheckout=branch==='main'&&Boolean(installedCommit);
  return {
    installedCommit,installedBranch:branch.slice(0,64)||'UNKNOWN',
    cachedOriginMainCommit:cachedMainCommit,
    installedOnLocalMain:mainCheckout,
    cachedMainMatchesInstalled:Boolean(mainCheckout&&cachedMainCommit
      &&installedCommit===cachedMainCommit),
    metadataAvailable:Boolean(installedCommit),
    // A locally cached remote ref is not an online update attestation.
    liveRemoteVersionVerified:false,
    formalUpdateVerified:false,
    installedThroughManagedUpdaterVerified:false
  };
}
