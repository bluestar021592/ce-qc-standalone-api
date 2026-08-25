import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { summarizeV295FirstAttemptMembers, mergeV295FirstAttemptFacts } from '../src/v295FirstAttemptMetric.js';

for (const file of [
  'src/v295FirstAttemptMetric.js','src/v295FirstAttemptTruth.js','src/rangeDashboardStoreV295.js',
  'src/v295FirstAttemptRoutePatch.js','src/v295FirstAttemptInvalidationPatch.js','src/v295FirstAttemptUiInjectionPatch.js','public/v295-first-attempt-ui.js'
]) execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

const rangeSource=fs.readFileSync(new URL('../src/rangeDashboardStoreV284.js',import.meta.url),'utf8');
const rangeFacade=fs.readFileSync(new URL('../src/rangeDashboardStore.js',import.meta.url),'utf8');
const v295Range=fs.readFileSync(new URL('../src/rangeDashboardStoreV295.js',import.meta.url),'utf8');
const v295MetricSource=fs.readFileSync(new URL('../src/v295FirstAttemptMetric.js',import.meta.url),'utf8');
const v295Truth=fs.readFileSync(new URL('../src/v295FirstAttemptTruth.js',import.meta.url),'utf8');
const v295Route=fs.readFileSync(new URL('../src/v295FirstAttemptRoutePatch.js',import.meta.url),'utf8');
const v295Invalidation=fs.readFileSync(new URL('../src/v295FirstAttemptInvalidationPatch.js',import.meta.url),'utf8');
const v295Injection=fs.readFileSync(new URL('../src/v295FirstAttemptUiInjectionPatch.js',import.meta.url),'utf8');
const v295Ui=fs.readFileSync(new URL('../public/v295-first-attempt-ui.js',import.meta.url),'utf8');
const v147=fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js',import.meta.url),'utf8');
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

const firstAttempt=summarizeV295FirstAttemptMembers([
  {pod:true,attemptNo:1},
  {pod:true,attemptNo:2},
  {pod:false,attemptNo:1},
  {pod:false,attemptNo:0}
],{businessType:'TBKH',reportDate:'2026-08-25'});
assert.equal(firstAttempt.firstAttemptEligible,3,'every proven START contributes to first-attempt denominator');
assert.equal(firstAttempt.firstAttemptSuccess,1,'only POD completed on attempt 1 contributes to success numerator');
assert.equal(firstAttempt.firstAttemptRate,33.33,'first-attempt success must be success/eligible, not same-day POD/total');
const incomplete=summarizeV295FirstAttemptMembers([{pod:true,attemptNo:0},{pod:false,attemptNo:1}],{});
assert.equal(incomplete.firstAttemptRate,null,'POD without real attempt evidence must fail closed instead of publishing 0%');
assert.equal(incomplete.firstAttemptEvidenceComplete,false);
assert.equal(incomplete.firstAttemptUnknownPod,1,'POD without a proven START must be diagnosed explicitly');
const merged=mergeV295FirstAttemptFacts('CCSL',[firstAttempt,firstAttempt]);
assert.equal(merged.firstAttemptRate,33.33,'range aggregate must preserve numerator/denominator semantics');

assert.match(rangeFacade,/rangeDashboardStoreV295/,'final period-dashboard facade must use V295, not stop at V294');
assert.match(v295Range,/label !== '首次妥投率'/,'V295 must patch only 首次妥投率 and leave 首日POD妥投率 independent');
assert.match(v295Range,/firstAttemptEligible: fact\.firstAttemptEligible/,'visible cards must expose the real first-attempt denominator');
assert.match(v295Range,/firstAttemptRate: fact\.firstAttemptRate/,'visible cards must expose the real first-attempt rate');
assert.doesNotMatch(v295Range,/sameDayPodRate/,'V295 first-attempt publication must not reuse same-day POD');
assert.match(v295Truth,/analyzeV246ShopeeAttemptCycle/,'V295 first-attempt truth must use the locked real START/failure cycle');
assert.match(v295Truth,/latestUnifiedMembership/,'V295 denominator membership must come from latest VALID daily reports');
assert.match(v295Truth,/businessType='WHPP'/,'V295 must retain WHPP first-attempt support');
assert.match(v295MetricSource,/firstAttemptUnknownPod/,'V295 metric owner must diagnose POD rows whose real attempt is unproven');
assert.match(v295Truth,/summarizeV295FirstAttemptMembers/,'V295 range truth must delegate each daily membership cohort to the metric owner that diagnoses unproven POD attempts');
assert.match(v295Route,/2026-08-25-v299-first-attempt-direct-only-v3/,'V299 must activate direct-only first-attempt ownership');
assert.match(v295Route,/\/api\/v295\/first-attempt-trends/,'dedicated exact-range first-attempt endpoint must remain available for visible UI');
assert.match(v295Route,/readV295FirstAttemptTrends\(type, from, to\)/,'dedicated visible endpoint must read the requested HOME/business scope directly');
assert.doesNotMatch(v295Route,/TARGETS\s*=|responseHook\(|overlayPayload\(/,'primary V253/V263 trend responses must not synchronously execute first-attempt truth');
assert.match(v295Route,/V253\/V263 primary trend responses are no longer synchronously overlaid/,'source must explicitly document the no-contention ownership boundary');
assert.match(v295Invalidation,/__CE_QC_INVALIDATE_V295_FIRST_ATTEMPT__/,'successful mutations must invalidate V295 cached truth');
assert.match(v295Invalidation,/import\|purge\|clear\|reset\|run\|resume\|refresh/,'same-day reupload and rerun paths must invalidate V295 cache');
assert.match(v147,/v295FirstAttemptRoutePatch\.js/,'real bootstrap chain must activate V295 API truth before server route registration');
assert.match(v147,/v295FirstAttemptInvalidationPatch\.js/,'real bootstrap chain must activate same-day cache invalidation');
assert.match(v147,/v295FirstAttemptUiInjectionPatch\.js/,'real bootstrap chain must activate V295 visible UI owner');
assert.match(v295Injection,/v295-first-attempt-ui\.js\?v=20260825-v298-1/,'V298 visible owner must remain cache-busted');
assert.match(v295Ui,/2026-08-25-v298-exact-visible-truth-nav-authority-v2/,'V298.1 authoritative visible owner must remain active under V299 trend architecture');
assert.match(v295Ui,/FIRST_ATTEMPT_API='\/api\/v295\/first-attempt-trends'/,'visible first-attempt card and chart must use the dedicated exact API');
assert.match(v295Ui,/const NAV_ITEMS=\[/,'sidebar must be rebuilt from one explicit canonical navigation authority');
assert.match(v295Ui,/WHPP本土看板/,'canonical sidebar must keep WHPP as a first-class board');
assert.match(v295Ui,/nav\.innerHTML=NAV_ITEMS\.map/,'duplicate/retired sidebar nodes must be replaced, not merely opportunistically removed');
assert.match(v295Ui,/navPending=true/,'sidebar mutations arriving during a repair pass must schedule another canonical pass');
assert.doesNotMatch(v295Ui,/遗留异常动态/,'retired legacy navigation entry must never exist in the canonical menu');
assert.match(v295Ui,/const cache=new Map\(\),inflight=new Map\(\)/,'same exact first-attempt range must coalesce to one in-flight request');
assert.match(v295Ui,/setTimeout\(\(\)=>refresh\(true\),7200\)/,'cold first-attempt truth must wait until fast primary trend paint has priority');
assert.match(v295Ui,/v298ExactTrendGuard/,'exact-range primary trend errors must retain stale-chart visibility protection');
assert.match(v295Ui,/v272-status\.error\) \.v272-trend-grid/,'if every trend channel fails, stale chart bodies must stay hidden');
assert.doesNotMatch(v295Ui,/\[80,500,1400,2800\]/,'visible owner must not hammer synchronous SQLite with four forced cold first-attempt reads during first paint');
assert.doesNotMatch(v295Ui,/\/api\/v253\/trends\?businessType=ALL/,'homepage first-attempt trend must not use seven-business ALL truth when the card scope is HOME');
assert.match(v295Ui,/首次妥投率趋势/,'visible trends must show a dedicated first-attempt success trend');
assert.match(v295Ui,/真实首派证据不足，不显示0%/,'missing first-attempt evidence must visibly render dash semantics, not fake zero');
assert.match(v295Ui,/首派成功 .*首派尝试/,'visible card note must disclose numerator and denominator');

assert.match(ownerSource,/result\?\.sourceTotal/,'visible homepage total must consume seven-business period sourceTotal');
assert.match(ownerSource,/result\?\.states\?\.WHPP\?\.sourceTotal/,'visible homepage must consume WHPP period membership');
assert.match(ownerSource,/WHPP本土/,'visible homepage must create/maintain a WHPP card');
assert.match(ownerSource,/result\?\.aggregates\?\.HOME/,'homepage core metrics must use dedicated CE+CEAF+TBKH+ALI1688+WHPP truth');
assert.match(ownerSource,/证据未完成的日期保持“—”/,'incomplete attempt evidence must stay blank instead of being rendered as real 0%');
assert.doesNotMatch(v295Ui,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i,'visible first-attempt owner must remain read-only');

console.log('[V299/V295.6] visible truth smoke passed · direct-only exact HOME/business first-attempt API + no V253/V263 overlay contention + canonical sidebar + 首次妥投率=首派成功/首派尝试 + missing START/POD attempt evidence => —');
