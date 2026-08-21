# QC11 one-shot final delivery contract

This branch is the final replacement candidate, not an incremental production patch.

- Product shell: Aug-17 ~16:00 CE QC UI/workflow.
- Runtime login: direct 5177 internal account/session; no 5179 auth handoff.
- Startup: exact loopback `/api/health` HTTP 200; old business-data completeness is diagnostic only.
- Businesses: CE, CEAF, TBKH, ALI1688, SHOPEECN, SHOPEEVN, WHPP.
- Data truth: latest effective scan/trajectory evidence, current Pending episode, special-normal closures, real Shopee delivery-cycle attempts.
- Reports: daily report date/range retained, dashboard/detail parity, resumable XLSX exports, seven-business ownership.
- Release gate: `npm run test:golive` = `scripts/qc11-one-shot-acceptance.cjs`.

Do not cut over to production unless the one-shot gate passes. No user-side iterative debugging is part of this release plan.
