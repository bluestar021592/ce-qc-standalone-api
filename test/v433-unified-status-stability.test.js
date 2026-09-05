import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

const v168=read('public/v168-seven-business-status.js');
const v169=read('public/v169-seven-business-legacy-status-sync.js');
const v295=read('public/v295-first-attempt-ui.js');
const loader=read('src/v44WhppUiPatch.js');
const firstAttemptInjection=read('src/v295FirstAttemptUiInjectionPatch.js');

test('V433 leaves V168 as the only unconfirmed start-button authority',()=>{
  assert.match(v168,/lockControl\(start, '状态确认中'/,'V168 must keep the fail-closed unconfirmed start lock');
  assert.doesNotMatch(v169,/function\s+releaseStartButtonForConfirmation\s*\(/,'V169 must no longer expose a competing start-button release');
  assert.doesNotMatch(v169,/btn\.disabled\s*=\s*false[\s\S]{0,240}v421UnconfirmedEntry/,'V169 must never re-enable Start while status is unconfirmed');
  assert.doesNotMatch(v169,/releaseStartButtonForConfirmation\s*\(/,'no unconfirmed path may call the retired V421 release');
  assert.match(v169,/V433_V168_SINGLE_START_OWNER/,'V433 ownership marker must be present');
  assert.match(v169,/state\.kind==='unconfirmed'[\s\S]{0,260}lockResumeButtons\(state\)[\s\S]{0,260}SEVEN_BUSINESS_STATUS_UNCONFIRMED/,'entry guard must fail closed while status is unconfirmed');
});

test('V433 defers HOME first-attempt work until persisted seven-business status is fresh',()=>{
  assert.match(v295,/V433_STATUS_FIRST_GATE/,'status-first gate revision must be present');
  assert.match(v295,/function\s+unifiedStatusReady\s*\(/,'V295 must read V168 status readiness before HOME query');
  assert.match(v295,/type==='HOME'&&!unifiedStatusReady\(\)[\s\S]{0,220}scheduleStatusGate\(\)[\s\S]{0,220}return/,'HOME refresh must return before loadExact while status is unconfirmed');
  const refreshIndex=v295.indexOf("if(type==='HOME'&&!unifiedStatusReady())");
  const loadIndex=v295.indexOf('const payload=await loadExact(type,rg,force)',refreshIndex);
  assert.ok(refreshIndex>=0&&loadIndex>refreshIndex,'status-first gate must execute before the heavy exact query');
  assert.match(v295,/ce-qc:seven-business-status[\s\S]{0,240}unifiedStatusReady\(\)[\s\S]{0,240}refresh\(true\)/,'fresh status event must release the deferred metric refresh');
});

test('V433 browser delivery cache-busts both canonical files without changing execution ownership',()=>{
  assert.match(loader,/v169-seven-business-legacy-status-sync\.js\?v=20260905-v433-1/,'V169 browser build must be cache-busted');
  assert.match(loader,/SINGLE_RUNNER_UI_BUILD='2026-08-29-single-unified-runner-v1'/,'V67 single-runner ownership must stay unchanged');
  assert.match(firstAttemptInjection,/v295-first-attempt-ui\.js\?v=20260905-v433-1/,'V295 browser build must be cache-busted');
  assert.match(firstAttemptInjection,/SINGLE_RUNNER_MARKER='2026-08-29-single-unified-runner-v1'/,'first-attempt injection must not alter unified execution ownership');
});
