import { resolveV200Attempt, V200_EXPORT_VERSION, internalHyperlinkFormulaForV200 } from '../src/v200TemplateDashboardExporter.js';
import { referenceAverageDays } from '../src/v200Metrics.js';

function must(condition, message) { if (!condition) throw new Error(message); }

must(resolveV200Attempt({ pod:true, deliveryDates:['2026-08-01','2026-08-02','2026-08-03'], currentAttemptNo:1, podDate:'2026-08-03' }).attemptNo === 3, 'real delivery dates must win over flattened currentAttemptNo');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:['2026-08-01','2026-08-02'], podDate:'2026-08-02' }).attemptNo === 2, 'code60 assign dates must provide attempt when code70/daily dispatch is absent');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], podAttemptNo:2, podDate:'2026-08-02' }).attemptNo === 2, 'podAttemptNo fallback must remain available');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], currentAttemptNo:1, podDate:'2026-08-04' }).attemptNo === 0, 'default currentAttemptNo=1 must not fabricate first-attempt success');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], podDate:'2026-08-04' }).attemptNo === 0, 'elapsed days must not fabricate dispatch attempt');
must(referenceAverageDays('2026-08-01','2026-08-01') === 1, 'reference same-day POD must equal one natural day');
must(referenceAverageDays('2026-08-01','2026-08-04') === 4, 'reference average must use dashboard date to actual POD date inclusive');
const formula = internalHyperlinkFormulaForV200('POD明细', 1718, 1115);
must(formula === 'HYPERLINK("#\'POD明细\'!A1718",1115)', 'WPS-safe internal hyperlink must match reference workbook formula syntax');
must(V200_EXPORT_VERSION === '2026-08-18-v201-persistent-shopee-dispatch-export-v1', 'unexpected V201 tracked export version');
console.log('[V201] reference template + WPS formula + persistent dispatch tracker export smoke passed');
