import express from 'express';

export const V581_STABLE_SHELL_RESPONSE_ID='2026-09-26-v586-anchor-owned-response-v1';
const V581_TAG='  <script src="/v581-stable-shell-owner.js?v=20260926-v586-1"></script>';

const previousSend=express.response.send;

function stripScriptSrc(body,fileName){
  const escaped=fileName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return body.replace(new RegExp('\\s*<script\\b[^>]*src=["\\\']/'+escaped+'(?:\\?[^"\\\']*)?["\\\'][^>]*><\\/script>\\s*','gi'),'\n');
}
function stripInlineV575(body){
  return body.replace(/\s*<script>\s*\(function installV575CoordinateOwner\([\s\S]*?\}\)\(window\);\s*<\/script>\s*/i,'\n');
}
export function rewriteV581StableShellHtml(body){
  if(typeof body!=='string'||!body.includes('CE Express')||!body.includes('</body>'))return body;
  body=stripInlineV575(body);
  for(const file of ['v580-visible-shell-recovery.js','v569-final-interaction-owner.js','v581-stable-shell-owner.js']){
    body=stripScriptSrc(body,file);
  }
  body=body.replace(/auth=v(?:575|578|579|580)/g,'auth=v581');
  // V581 must own interaction before app.js starts its asynchronous bootstrap.
  // The markup is already fully parsed at this point in index.html, so the owner
  // can bind immediately and keep sidebar navigation available even if app startup
  // is slow or a later compatibility script misbehaves.
  const appTag=/<script\b[^>]*src=["']\/app\.js(?:\?[^"']*)?["'][^>]*><\/script>/i;
  if(appTag.test(body))body=body.replace(appTag,match=>V581_TAG+'\n'+match);
  else body=body.replace('</body>',V581_TAG+'\n</body>');
  return body;
}

express.response.send=function v581StableShellSend(body){
  if(typeof body==='string')body=rewriteV581StableShellHtml(body);
  this.setHeader?.('X-CE-QC-V581-Shell',V581_STABLE_SHELL_RESPONSE_ID);
  return previousSend.call(this,body);
};

console.info('[CE-QC][V581_STABLE_SHELL_RESPONSE]',V581_STABLE_SHELL_RESPONSE_ID,'final response pass retires V575/V580 shell owners and injects one V586 anchor-owned stable shell owner immediately before app.js.');
