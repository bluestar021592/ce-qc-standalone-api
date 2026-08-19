import { V200_EXPORT_VERSION, internalHyperlinkFormulaForV200 } from '../src/v200TemplateDashboardExporter.js';
import { resolveV202AttemptCycle } from '../src/v202DeliveryTruth.js';
import { V206_SHOPEE_PRECISION_VERSION } from '../src/v206ShopeePrecisionTruth.js';

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
// V202 owns the real 1/2/3 delivery-cycle state machine. V206/V209 owns the
// final Shopee export because it layers exact 3001->real-POD timing and the
// V207 no-loss membership ledger on top of that attempt truth.
must(V200_EXPORT_VERSION === V206_SHOPEE_PRECISION_VERSION, 'V206/V209 precision truth must own current reference dashboard export');
console.log('[V209] reference template + WPS formula + real V202 delivery cycles + V206 precision export ownership smoke passed');
