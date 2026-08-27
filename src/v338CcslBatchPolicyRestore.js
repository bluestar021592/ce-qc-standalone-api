export const V338_CCSL_BATCH_POLICY_RESTORE_ID='2026-08-27-v338-final-350-scan-50-track-policy-v1';

// V315 is a legacy evidence-refresh module that still writes the old 100-ticket
// environment value during module evaluation. The real CCSL pipeline is imported
// later by server/carryover. Re-assert the user-approved production policy here,
// after V315 but before every pipeline import, so module snapshot order cannot
// silently shrink order scanning back to 100 tickets.
const legacyOrderBatchSize=Number(process.env.ORDER_BATCH_SIZE||0);
const legacyConfirmBatchSize=Number(process.env.CONFIRM_QUERY_BATCH_SIZE||0);
process.env.ORDER_BATCH_SIZE='350';
process.env.CONFIRM_QUERY_BATCH_SIZE='350';

console.info('[CE-QC][V338_BATCH_POLICY_FINAL]',JSON.stringify({
  id:V338_CCSL_BATCH_POLICY_RESTORE_ID,
  legacyOrderBatchSize,
  legacyConfirmBatchSize,
  finalOrderBatchSize:Number(process.env.ORDER_BATCH_SIZE),
  finalConfirmQueryBatchSize:Number(process.env.CONFIRM_QUERY_BATCH_SIZE),
  finalTrackBatchSize:50,
  policy:'FINAL_PIPELINE_SNAPSHOT_SCAN_350_TRACK_50'
}));
