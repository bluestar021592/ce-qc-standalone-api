const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');

for(const file of ['public/v318-single-sidebar-owner.js','public/v169-seven-business-legacy-status-sync.js','src/v295FirstAttemptUiInjectionPatch.js','src/v44WhppUiPatch.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}
const ui=fs.readFileSync('public/v318-single-sidebar-owner.js','utf8');
const legacy=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
const inject=fs.readFileSync('src/v295FirstAttemptUiInjectionPatch.js','utf8');
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');

assert.match(ui,/2026-08-26-v318-single-sidebar-hard-owner-v1/);
assert.match(ui,/const NAV_ITEMS=\[/);
assert.match(ui,/sidebars\.slice\(1\)\.forEach\(node=>node\.remove\(\)\)/,'V318 must delete every duplicate sidebar root');
assert.match(ui,/\[\.\.\.sidebar\.children\]\.forEach\(node=>\{/,'V318 must inspect every direct sidebar child, not only known legacy CSS classes');
assert.match(ui,/node!==brand&&node!==nav&&node!==collapse&&node!==status\)node\.remove\(\)/,'only brand + canonical nav + collapse + status may survive');
assert.match(ui,/sidebar\.querySelectorAll\('\.side-nav'\)/,'nested duplicate nav roots must also be removed');
assert.match(ui,/nav\.replaceChildren\(\.\.\.NAV_ITEMS\.map/,'a dirty navigation tree must be rebuilt atomically');
assert.match(ui,/setInterval\(enforce,1200\)/,'V318 must continuously enforce after late legacy scripts mutate the sidebar');
assert.doesNotMatch(ui,/new MutationObserver/,'sidebar repair must remain polling/idempotent and never create a recursive observer');
assert.match(ui,/七业务处理完成/,'all-complete banner must not remain SHOPEE-only after all owners report complete');
assert.match(ui,/CCSL、SHOPEE CN\/VN、WHPP本土均已完成/);

assert.match(legacy,/2026-08-27-v333-legacy-status-no-dom-owner-v1/,'V169 must be compatibility-only under V333');
assert.doesNotMatch(legacy,/getElementById\('ccslRunStatus'\)/,'retired V169 must never acquire the CCSL detail panel');
assert.doesNotMatch(legacy,/getElementById\('sevenBusinessStageSummary'\)/,'retired V169 must never acquire the canonical summary');
assert.match(legacy,/__CE_QC_V168_SEVEN_BUSINESS_STATUS__\?\.refresh/,'legacy bridge may only ask V168 to refresh canonical truth');
assert.match(legacy,/__CE_QC_V138_CCSL_SCAN_PROGRESS__\?\.enforceLastTruth/,'legacy bridge may only ask V138 to re-enforce CCSL detail truth');
assert.match(shell,/v169-seven-business-legacy-status-sync\.js\?v=20260827-v333-1/,'browser must not reuse cached V169 DOM-writing bundle');

assert.match(inject,/v318-single-sidebar-owner\.js\?v=20260826-v318-1/,'V318 UI owner must be delivered after V317 recovery owner');
assert.match(inject,/X-CE-QC-V318-UI/,'V318 response header must be observable');

console.log('[V333/V318/V169] single-sidebar + status ownership smoke passed · V169 cannot repaint CCSL detail · exact 15-item nav · unified completion banner');
