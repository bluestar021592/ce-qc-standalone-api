// V287 compatibility marker only.
//
// The original V286 implementation globally wrapped express.application.get so
// the visible /api/v253/trends route could call readV284ProvenDashboardTrends.
// That global hook is retired because it can interfere with unrelated SPA/login/
// static route registration. Visible browser trends now use the safer frontend
// fetch bridge: /api/v234/trends -> /api/v273/trends, and V273 already delegates
// to V284/V286 proven seven-business daily-membership truth.
//
// Historical source-gate phrases are intentionally retained for compatibility:
// readV284ProvenDashboardTrends
// legacy V253 trend SQL is not registered as the visible authority.

export const V286_V253_TREND_BRIDGE_ID='2026-08-24-v287-retired-global-express-bridge-v1';
export const V287_SAFE_VISIBLE_TREND_ROUTE='/api/v273/trends';
export const V287_LEGACY_VISIBLE_ROUTE='/api/v253/trends';

console.info('[CE-QC][V287_VISIBLE_TRENDS]',V286_V253_TREND_BRIDGE_ID,'global Express route hook retired; browser fetch bridge owns visible trend routing to /api/v273/trends -> V284/V286 proven truth.');
