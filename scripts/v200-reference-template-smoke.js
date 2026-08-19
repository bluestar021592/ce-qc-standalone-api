import { V200_EXPORT_VERSION, internalHyperlinkFormulaForV200 } from '../src/v200TemplateDashboardExporter.js';
import { resolveV202AttemptCycle, V202_DELIVERY_TRUTH_VERSION } from '../src/v202DeliveryTruth.js';

function must(condition, message) { if (!condition) throw new Error(message); }

const first = resolveV202AttemptCycle([
  {kind:'START',time:'2026-08-01 08:00:00',source:'4003'},
  {kind:'POD',time:'2026-08-01 16:00:00',source:'4004'}
]);
const second = resolveV202AttemptCycle([
  {kind:'START',time:'2026-08-01 08:00:00',source:'4003'},
  {kind:'FAIL',time:'2026-08-01 18:00:00',source:'150'},
  {kind:'START',time:'2026-08-02 09:00:00',source:'70'},
  {kind:'POD',time:'2026-08-02 16:00:00',source:'80'}
]);
must(first.attemptNo===1,'first real delivery cycle must be first-attempt POD');
must(second.attemptNo===2,'a failed cycle plus real redispatch must be second-attempt POD');
const formula = internalHyperlinkFormulaForV200('POD明细', 1718, 1115);
must(formula === 'HYPERLINK("#\'POD明细\'!A1718",1115)', 'WPS-safe internal hyperlink must match reference workbook formula syntax');
must(V200_EXPORT_VERSION === V202_DELIVERY_TRUTH_VERSION, 'V202 must own reference dashboard export truth');
console.log('[V202] reference template + WPS formula + real delivery-cycle truth smoke passed');
