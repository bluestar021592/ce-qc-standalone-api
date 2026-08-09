import fs from 'node:fs';

const file = 'src/analyzerV30.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  [
    "import { analyzeStoreFlow } from './storeFlow.js';",
    "import { classifyLatestSpecialNode } from './specialNode.js';",
    "import { lastEffectiveEvent } from './shopCodes.js';"
  ].join('\n'),
  "import { buildTrajectoryFacts } from './trajectoryFacts.js';",
  'trajectory fact import'
);

replaceOnce(
  "  const { waybill = '', scanRow = {}, events = [], reportDate = '' } = args;",
  "  const { waybill = '', scanRow = {}, events = [], reportDate = '', shopCodeMap = null } = args;",
  'analyzer args shop map'
);

replaceOnce(
  [
    '  const legacy = analyzeShipmentLegacy(args);',
    '  const sorted = sortEvents(events);',
    '  const last = lastEffectiveEvent(sorted) || sorted.at(-1) || null;',
    '  const lastCode = codeOf(last);',
    '  const exactTerminal = latestTerminal(sorted);',
    "  const scanStatus = String(scanRow.orderStatus ?? '').trim();",
    "  const isPod = scanStatus === '85' || exactTerminal?.type === 'POD';",
    "  const isReturned = !isPod && (scanStatus === '100' || exactTerminal?.type === 'RETURN_COMPLETED');",
    '  const returnInProgress = !isPod && !isReturned && lastCode === TRACK.RETURN_START;',
    '  const special = !isPod && !isReturned && !returnInProgress ? classifyLatestSpecialNode(sorted) : null;',
    '  const storeFlow = analyzeStoreFlow({ shipmentCode: waybill, events: sorted, reportDate, isPod, isReturned });'
  ].join('\n'),
  [
    '  const legacy = analyzeShipmentLegacy(args);',
    '  const facts = buildTrajectoryFacts({ shipmentCode: waybill, scanRow, events, reportDate, shopCodeMap });',
    '  const sorted = facts.sortedEvents;',
    '  const last = facts.lastEvent;',
    '  const lastCode = facts.lastCode;',
    '  const exactTerminal = facts.latestTrackTerminal;',
    '  const scanStatus = facts.scanStatus;',
    '  const isPod = facts.isPod;',
    '  const isReturned = facts.isReturned;',
    '  const returnInProgress = facts.returnInProgress;',
    '  const special = facts.special;',
    '  const storeFlow = facts.storeFlow;'
  ].join('\n'),
  'authoritative current facts'
);

replaceOnce(
  "  const allPendingDates = distinctDates(sorted.filter(event => codeOf(event) === TRACK.PENDING));",
  '  const allPendingDates = facts.pendingDates;',
  'pending fact dates'
);

replaceOnce(
  "    analysisRuleVersion: '2026-08-09-ccsl-scan-track-code-separation-v30',",
  [
    "    analysisRuleVersion: '2026-08-09-ccsl-scan-track-code-separation-v30',",
    '    trajectoryFactVersion: facts.factVersion,',
    '    trajectoryTerminalSource: facts.terminalSource,',
    '    latestEffectiveEventCode: facts.lastCode,',
    '    latestEffectiveEventTime: facts.lastEventTime,',
    '    latestEffectiveEventText: facts.lastEventText,',
    '    latestEffectiveActionType: facts.latestNodeAction?.actionType || \'OTHER\',',
    '    latestEffectiveTargetNode: facts.latestNodeAction?.targetNode || \'\',',
    '    latestEffectiveTargetNodeCode: facts.latestNodeAction?.targetNodeCode || \'\',',
    '    latestShopFactCode: facts.latestShop?.isShop ? (facts.latestShop.shopCode || \'\') : \'\',',
    '    latestShopFactRule: facts.latestShop?.matchedRule || \'\','
  ].join('\n'),
  'persist trajectory facts'
);

replaceOnce(
  '    pendingRawEventCount: sorted.filter(event => codeOf(event) === TRACK.PENDING).length,',
  [
    '    pendingRawEventCount: facts.pendingRawEventCount,',
    '    pendingFactDateContinuity: facts.pendingDateContinuity ? \'连续\' : \'不连续\','
  ].join('\n'),
  'pending factual counters'
);

fs.writeFileSync(file, source, 'utf8');
