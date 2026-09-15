import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const file='public/v471-history-audit-abort-normalizer.js';
execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const source=fs.readFileSync(file,'utf8');
assert.match(source,/2026-09-08-v471-history-audit-timeout-abort-normalizer-v1/,'V471 marker missing');
assert.match(source,/reason===TARGET_REASON/,'V471 must normalize only the exact history-audit timeout reason');
assert.doesNotMatch(source,/fetch\s*\(/,'V471 must not issue network requests');
assert.doesNotMatch(source,/business_|sqlite|getDb|INSERT|UPDATE|DELETE/i,'V471 must not touch business/database state');

class FakeAbortController{
  constructor(){this.received='__UNSET__';}
  abort(reason){this.received=reason;}
}
const sandbox={AbortController:FakeAbortController,console:{info(){}}};
sandbox.window=sandbox;
vm.runInNewContext(source,sandbox,{filename:file});
assert.equal(sandbox.__CE_QC_V471_HISTORY_ABORT_NORMALIZER__?.installed,true,'V471 should install when AbortController exists');
const timeoutController=new sandbox.AbortController();
timeoutController.abort('V451_HISTORY_AUDIT_TIMEOUT');
assert.equal(timeoutController.received,undefined,'V451 legacy timeout must remain normalized for cached/older clients');
const otherController=new sandbox.AbortController();
otherController.abort('OTHER_REASON');
assert.equal(otherController.received,'OTHER_REASON','all non-target abort reasons must remain unchanged');

const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
const prelude='v471-history-audit-abort-normalizer.js?v=20260908-v471-1';
const audit='v142-history-integrity-audit.js?v=20260915-v543-1';
assert.ok(shell.includes(prelude),'V471 prelude must be wired into the shell');
assert.ok(shell.includes(audit),'V543 isolated history audit UI must be wired into the shell');
assert.ok(shell.indexOf(prelude)<shell.indexOf(audit),'V471 legacy timeout normalizer must load before the V543/V142 history audit');

console.log('[V471/V543] legacy history timeout normalizer remains compatibility-only and ordered before the V543 isolated audit UI; no network/database/business mutation');