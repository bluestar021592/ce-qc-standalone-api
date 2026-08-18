import { resolveV200Attempt, resolveV200AverageDays, V200_EXPORT_VERSION } from '../src/v200TemplateDashboardExporter.js';
import { internalHyperlinkFormulaForV200 } from '../src/v200TemplateDashboardExporter.js';

function must(condition, message) { if (!condition) throw new Error(message); }

must(resolveV200Attempt({ pod:true, deliveryDates:['2026-08-01','2026-08-02','2026-08-03'], currentAttemptNo:1, podDate:'2026-08-03' }).attemptNo === 3, 'real code70 delivery dates must win over flattened currentAttemptNo');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:['2026-08-01','2026-08-02'], podDate:'2026-08-02' }).attemptNo === 2, 'code60 assign dates must provide attempt when code70 is absent');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], podAttemptNo:2, podDate:'2026-08-02' }).attemptNo === 2, 'podAttemptNo fallback must remain available');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], podDate:'2026-08-04' }).attemptNo === 0, 'elapsed days must not fabricate dispatch attempt');
must(resolveV200AverageDays({ firstDispatchDate:'2026-08-01', firstReportDate:'2026-07-31', podDate:'2026-08-04' }) === 4, 'average days must use first real dispatch date when available');
must(resolveV200AverageDays({ firstDispatchDate:'', firstReportDate:'2026-08-01', podDate:'2026-08-04' }) === 4, 'average days must fall back to first report date only for time start');
const formula = internalHyperlinkFormulaForV200('POD明细', 1718, 1115);
must(formula === 'HYPERLINK("#\'POD明细\'!A1718",1115)', 'WPS-safe internal hyperlink must match reference workbook formula syntax');
must(V200_EXPORT_VERSION === '2026-08-18-v200-reference-template-track-attempt-v1', 'unexpected V200 version');
console.log('[V200] reference template, WPS link, real dispatch-attempt and average-day smoke passed');
