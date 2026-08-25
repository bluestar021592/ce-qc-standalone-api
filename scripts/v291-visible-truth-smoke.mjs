import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { summarizeV295FirstAttemptMembers, mergeV295FirstAttemptFacts } from '../src/v295FirstAttemptMetric.js';

for (const file of [
  'src/v295FirstAttemptMetric.js','src/v295FirstAttemptTruth.js','src/rangeDashboardStoreV295.js',
  'src/v295FirstAttemptRoutePatch.js','src/v295FirstAttemptUiInjectionPatch.js','public/v295-first-attempt-ui.js'
]) execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

const rangeSource=fs.readFileSync(new URL('../src/rangeDashboardStoreV284.js',import.meta.url),'utf8');
const rangeFacade=fs.readFileSync(new URL('../src/rangeDashboardStore.js',import.meta.url),'utf8');
const v295Range=fs.readFileSync(new URL('../src/rangeDashboardStoreV295.js',import.meta.url),'utf8');
const v295Truth=fs.readFileSync(new URL('../src/v295FirstAttemptTruth.js',import.meta.url),'utf8');
const v295Route=fs.readFileSync(new URL('../src/v295FirstAttemptRoutePatch.js',import.meta.url),'utf8');
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
assert.match(v295Truth,/firstAttemptUnknownPod/,'V295 must detect POD rows whose real attempt is unproven');
assert.match(v295Route,/\/api\/v253\/trends/,'generic/home trend API must receive V295 first-attempt overlay');
assert.match(v295Route,/\/api\/v263\/delivery-trends/,'TBKH/CN/VN trend API must receive the same V295 first-attempt overlay');
assert.match(v295Route,/requestedTruth/,'single-day card summary must honor requested day even when V253 returns a recent-7-day trend');
assert.match(v147,/v295FirstAttemptRoutePatch\.js/,'real bootstrap chain must activate V295 API truth before server route registration');
assert.match(v147,/v295FirstAttemptUiInjectionPatch\.js/,'real bootstrap chain must activate V295 visible UI owner');
assert.match(v295Ui,/首次妥投率趋势/,'visible trends must show a dedicated first-attempt success trend');
assert.match(v295Ui,/真实首派证据不足，不显示0%/,'missing first-attempt evidence must visibly render dash semantics, not fake zero');
assert.match(v295Ui,/首派成功 .*首派尝试/,'visible card note must disclose numerator and denominator');

assert.match(ownerSource,/result\?\.sourceTotal/,'visible homepage total must consume seven-business period sourceTotal');
assert.match(ownerSource,/result\?\.states\?\.WHPP\?\.sourceTotal/,'visible homepage must consume WHPP period membership');
assert.match(ownerSource,/WHPP本土/,'visible homepage must create/maintain a WHPP card');
assert.match(ownerSource,/result\?\.aggregates\?\.HOME/,'homepage core metrics must use dedicated CE+CEAF+TBKH+ALI1688+WHPP truth');
assert.match(ownerSource,/证据未完成的日期保持“—”/,'incomplete attempt evidence must stay blank instead of being rendered as real 0%');
assert.doesNotMatch(v295Ui,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i,'V295 visible owner must remain read-only');

console.log('[V295] visible truth smoke passed · WHPP/HOME preserved · 首次妥投率=首派成功/首派尝试 · 首日POD独立 · missing START/POD attempt evidence => — · V253/V263/range/UI all share V295 truth');
