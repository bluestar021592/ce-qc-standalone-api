import { resolveAttemptForV199, resolveAverageDaysForV199, V199_EXPORT_VERSION } from '../src/v199UnifiedDashboardExporter.js';

function must(condition,message){if(!condition)throw new Error(message);}

must(resolveAttemptForV199({pod:true,explicitAttempt:2,trackAttempt:3,firstReportDate:'2026-08-01',podDate:'2026-08-04'}).attemptNo===2,'explicit attempt must win');
must(resolveAttemptForV199({pod:true,explicitAttempt:0,trackAttempt:3,firstReportDate:'2026-08-01',podDate:'2026-08-02'}).attemptNo===3,'track attempt must win before day fallback');
must(resolveAttemptForV199({pod:true,explicitAttempt:0,trackAttempt:0,firstReportDate:'2026-08-01',podDate:'2026-08-01'}).attemptNo===1,'same-day POD fallback must be attempt 1');
must(resolveAttemptForV199({pod:true,explicitAttempt:0,trackAttempt:0,firstReportDate:'2026-08-01',podDate:'2026-08-02'}).attemptNo===2,'next-day POD fallback must be attempt 2');
must(resolveAttemptForV199({pod:true,explicitAttempt:0,trackAttempt:0,firstReportDate:'2026-08-01',podDate:'2026-08-03'}).attemptNo===3,'day-3 POD fallback must be attempt 3+');
must(resolveAverageDaysForV199('2026-08-01','2026-08-01')===1,'same-day average must be 1');
must(resolveAverageDaysForV199('2026-08-01','2026-08-04')===4,'inclusive natural days must be 4');
must(V199_EXPORT_VERSION==='2026-08-18-v199-dashboard-attempt-average-v1','unexpected V199 version');
console.log('[V199] dashboard attempt/average metric smoke passed');
