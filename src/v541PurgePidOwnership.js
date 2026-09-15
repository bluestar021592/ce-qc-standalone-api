import { classifyV539ExportAdmissionPid, inspectExportSubmissionRecord } from './v505PurgeExternalActivity.js';

export const V541_PURGE_PID_OWNERSHIP_ID='2026-09-15-v541-global-purge-pid-reuse-v1';

function ownerAnchor(job={}){
  return job.workerClaimedAt||job.startedAt||job.submittedAt||job.heartbeatAt||job.updatedAt||0;
}

export function classifyV541PurgePidOwnership({workerState='',ownerAcquiredAt=0,processStartedAt=0,toleranceMs}={}){
  return classifyV539ExportAdmissionPid({
    workerState,
    acquiredAt:ownerAcquiredAt,
    processStartedAt,
    ...(toleranceMs===undefined?{}:{toleranceMs})
  });
}

export function inspectV541PurgePidOwnership({pid=0,ownerAcquiredAt=0}={}){
  return inspectExportSubmissionRecord({pid,acquiredAt:ownerAcquiredAt});
}

export function inspectV541PurgeJobWorker(job={}){
  return inspectV541PurgePidOwnership({pid:job.workerPid,ownerAcquiredAt:ownerAnchor(job)});
}
