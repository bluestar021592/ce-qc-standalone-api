import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const s=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
assert.match(html,/v625-shell\.js\?v=20261031-v804-1&patch=804/);
const p=s.indexOf("function scheduleHistoricalEvidenceRefresh(target='home')");
const q=s.indexOf("function cambodiaToday()",p);
assert.ok(p>0&&q>p,'scheduler from production source available');
let scheduled=[],live=0,board=0,reloaded=0;
const scope={page:'home',v640EvidenceRefreshTimer:null,
  clearTimeout(){},setTimeout:(cb)=>{scheduled.push(cb);return 1},
  refreshLiveProgress:()=>{live++;return Promise.resolve()},
  loadHome:()=>{reloaded++;return Promise.resolve()},
  loadBusiness:()=>{board++;return Promise.resolve()}};
vm.createContext(scope);
vm.runInContext(s.slice(p,q),scope);
vm.runInContext("scheduleHistoricalEvidenceRefresh('home')",scope);
assert.equal(scheduled.length,1,'historical evidence may schedule a bounded status refresh');
scheduled.shift()();
assert.equal(live,1,'home historical refresh updates only progress, not the whole home');
assert.equal(reloaded,0,'no extra loadHome must invalidate selected-date signing proof');
scope.page='business';
vm.runInContext("scheduleHistoricalEvidenceRefresh('business')",scope);
scheduled.shift()();
assert.equal(board,1,'business branch retains original page refresh');
assert.match(s,/void json\(timingUrl,45000\)/,'independent exact-day signature read kept');
assert.match(s,/const diagnostic=setTimeout\(\(\)=>/);
assert.match(s,/clearTimeout\(diagnostic\)/);
assert.match(s,/if\(!v802RenderSelectedTiming\(payload\)\)/,'non-hydrated response is never silently swallowed');
assert.match(s,/签收时效读取失败（已用时/,'failures must have visible causes');
assert.match(s,/历史汇总仍待核验。指定日期签收统计由独立任务负责。/,'optional history cannot reset exact timing status');
assert.doesNotMatch(s.slice(p,q),/page==='home'\)void loadHome/);
console.log('[V804 HOME] PASS: auxiliary progress cannot restart exact-day timing; real read outcomes visible; business refresh preserved');
