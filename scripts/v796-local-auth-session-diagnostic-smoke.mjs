import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source=fs.readFileSync('src/accessControl.js','utf8');
const start=source.indexOf('function localSessionStatus(req) {');
const end=source.indexOf('export async function accessIdentity(',start);
assert.ok(start>0&&end>start,'V796 local-only session classifier exists');
const snippet=source.slice(start,end).trim();
const secret='V796_LOCAL_TEST_SECRET_ONLY_NOT_PRODUCTION_9e8bba535ac17';
const COOKIE='ce_qc_local_auth_v431';
const cookieValue=(req,name)=>String(req.headers.cookie||'').split(';')
  .map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const classify=vm.runInNewContext('('+snippet.replace(/^function localSessionStatus/,'function')+')',{
  cookieValue,LOCAL_AUTH_COOKIE:COOKIE,localAuthSecret:()=>secret,crypto,Buffer,Date
});
const sign=payload=>{
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');
};
const now=Date.now();
const basic={v:431,channel:'LOCAL',exp:now+60_000,user:{username:'test',role:'VIEWER'}};
const run=value=>classify({headers:{cookie:value?COOKIE+'='+value:''}});
assert.equal(run('').reason,'COOKIE_MISSING');
assert.equal(run('invalid').reason,'COOKIE_FORMAT_INVALID');
assert.equal(run(sign(basic)).reason,'SESSION_VALID');
assert.equal(run(sign({...basic,exp:now-1000})).reason,'SESSION_EXPIRED');
assert.equal(run(sign({...basic,channel:'LAN'})).reason,'SESSION_CHANNEL_MISMATCH');
const token=sign(basic);const [body]=token.split('.');
assert.equal(run(body+'.'+'A'.repeat(43)).reason,'SESSION_SIGNATURE_MISMATCH');
assert.equal(run(sign({...basic,user:{}})).reason,'SESSION_PAYLOAD_INVALID');
assert.equal(run(token).sessionValid,true);
assert.match(source,/req\.path==='\/api\/local-auth\/session-check'/);
assert.match(source,/!isLoopbackHost\(host\)\|\|!isLoopbackIp\(remote\)/);
assert.match(source,/authDatabaseReady:auth\.dbReady/);
assert.doesNotMatch(snippet,/getDb\(/,'session status may not open business SQLite');
console.log('[V796] seven nonsecret session diagnosis cases PASS (missing, malformed, valid, expired, channel, signature, payload)');
