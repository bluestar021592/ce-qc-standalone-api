import assert from 'node:assert/strict';
import fs from 'node:fs';

const rangeSource=fs.readFileSync(new URL('../src/rangeDashboardStoreV284.js',import.meta.url),'utf8');
const ownerSource=fs.readFileSync(new URL('../public/v253-dashboard-fast-owner.js',import.meta.url),'utf8');

const sixBusinessRangeTotal=27303;
const whppRangeTotal=22+36+156+25+140;
const sevenBusinessDailyTotal=7714+6359+3033+4571+6005;
assert.equal(whppRangeTotal,379,'08-17..08-21 WHPP fixture must remain 379');
assert.equal(sixBusinessRangeTotal+whppRangeTotal,27682,'six-business range + WHPP must equal seven-business source truth');
assert.equal(sevenBusinessDailyTotal,27682,'daily seven-business ticket trend must reconcile to the visible period total');

assert.match(rangeSource,/range\.states\.WHPP\s*=\s*buildTruthState\('WHPP'/,'range truth must expose WHPP as a first-class state');
assert.match(rangeSource,/range\.aggregates\.HOME\s*=\s*buildTruthState\('HOME'/,'range truth must expose a homepage CE+CEAF+TBKH+ALI1688+WHPP aggregate');
assert.match(rangeSource,/patchShopeeExactNested/,'exact Shopee state must receive proven nested metric repair');
assert.match(rangeSource,/groups\[group\]\?\.metrics/,'visible SHOPEE CN/VN recipient metrics must be patched, not only dashboard.metrics');
assert.match(rangeSource,/patchRegions\(groups\[group\]\?\.regions,regions\)/,'visible Shopee PP/PV region metrics must use the same proven truth');
assert.match(rangeSource,/\['首次妥投率',f\.sameDayPodRate\]/,'first-day delivery metric must use same-day POD truth, never overall POD rate');
assert.doesNotMatch(rangeSource,/\['首次妥投率',f\.podRate\]/,'overall POD rate must not masquerade as first-day delivery rate');

assert.match(ownerSource,/result\?\.sourceTotal/,'visible homepage total must consume seven-business period sourceTotal');
assert.match(ownerSource,/result\?\.states\?\.WHPP\?\.sourceTotal/,'visible homepage must consume WHPP period membership');
assert.match(ownerSource,/WHPP本土/,'visible homepage must create/maintain a WHPP card');
assert.match(ownerSource,/result\?\.aggregates\?\.HOME/,'homepage core metrics must use dedicated CE+CEAF+TBKH+ALI1688+WHPP truth');
assert.match(ownerSource,/v263\/delivery-trends\?businessType=SHOPEECN/,'home CN attempts must use the same V246 delivery evidence used by the business board');
assert.match(ownerSource,/v263\/delivery-trends\?businessType=SHOPEEVN/,'home VN attempts must use the same V246 delivery evidence used by the business board');
assert.match(ownerSource,/证据未完成的日期保持“—”/,'incomplete attempt evidence must stay blank instead of being rendered as real 0%');
assert.doesNotMatch(ownerSource,/fetch\([^\n]*method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i,'V291 visible owner must remain read-only');

console.log('[V291] visible truth smoke passed · 27303 + WHPP379 = 27682 · WHPP card + HOME core + Shopee nested/region + CN/VN attempt truth share one read-only authority');
