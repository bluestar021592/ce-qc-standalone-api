// V788 installed build identity: READ ONLY Git metadata, never fetch/merge.
// Only the managed updater (main) can install the formally published build.
// Do not confuse origin/main cached locally with live GitHub confirmation.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {getRuntimeConfig} from './db.js';

const SHA=/^[0-9a-f]{40}$/i;
function readManagedReceipt(root){
  try{
    const file=path.join(root,'logs','v788_managed_install_receipt.json');
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)return null;
    const obj=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    return obj&&typeof obj==='object'&&!Array.isArray(obj)?obj:null;
  }catch{return null}
}
function git(args,root){
  try{
    const value=execFileSync('git',['-C',root,...args],{
      encoding:'utf8',timeout:2500,windowsHide:true,
      stdio:['ignore','pipe','ignore'],maxBuffer:4096
    }).trim();
    return value.slice(0,80);
  }catch{return ''}
}
export function inspectV788InstalledVersionEvidence({projectRoot}={}){
  const root=projectRoot||getRuntimeConfig().projectRoot;
  const tracked=fs.existsSync(path.join(root,'.git'));
  const commit=tracked?git(['rev-parse','--verify','HEAD'],root):'';
  const branch=tracked?git(['symbolic-ref','--short','HEAD'],root):'';
  const localRemoteMain=tracked?git(['rev-parse','--verify','refs/remotes/origin/main'],root):'';
  const installedCommit=SHA.test(commit)?commit.toLowerCase():'';
  const cachedMainCommit=SHA.test(localRemoteMain)?localRemoteMain.toLowerCase():'';
  const mainCheckout=branch==='main'&&Boolean(installedCommit);
  const matchesMain=Boolean(mainCheckout&&cachedMainCommit&&installedCommit===cachedMainCommit);
  const receipt=readManagedReceipt(root);
  const receiptSha=String(receipt?.installedCommit||'').toLowerCase();
  const receiptRemote=String(receipt?.remoteCommit||'').toLowerCase();
  const releaseInstalled=Boolean(process.platform==='win32'||projectRoot)
    &&matchesMain&&receipt?.schemaVersion===1&&receipt?.mode==='INSTALLED'
    &&receipt?.candidateGatePassed===true&&SHA.test(receiptSha)
    &&SHA.test(receiptRemote)&&receiptSha===installedCommit
    &&receiptRemote===cachedMainCommit;
  return {
    installedCommit,installedBranch:branch.slice(0,64)||'UNKNOWN',
    cachedOriginMainCommit:cachedMainCommit,
    installedOnLocalMain:mainCheckout,
    cachedMainMatchesInstalled:matchesMain,
    metadataAvailable:Boolean(installedCommit),
    // Receipt is recorded only after an exact-SHA install; do not claim this
    // confirms current GitHub availability or the real Excel acceptance.
    liveRemoteVersionVerified:false,
    formalUpdateVerified:releaseInstalled,
    installedThroughManagedUpdaterVerified:releaseInstalled
  };
}
