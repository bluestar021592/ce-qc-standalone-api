# CE QC Next — clean rebuild

This is a new application path, not another runtime patch on the legacy bootstrap chain.

## Non-negotiable architecture

- New entrypoint: `next/server.js`.
- New UI: `next/public/*`.
- No imports from `bootstrap.js` or any `v27...v253` patch module.
- Legacy production database is never mutated by QC Next.
- Two new SQLite databases:
  - `ce_qc_next_system.db`: users, sessions, settings, audit, shop configuration.
  - `ce_qc_next_data.db`: daily imports, shipments, API facts, current state, carryover, metrics, exports.
- Existing users are copied once from the legacy DB into the new system DB by password hash; business data is not copied.
- Business data may start empty and be re-imported from new daily Excel files.
- `/api/health` depends only on the new service + two new DBs. Empty business data never blocks login.
- Internal login is handled directly by the new 5177 process against the small system DB. No 5179 handoff chain.
- CE API authentication is a separate connector action and never controls internal login.
- Every page fetches only its own data. There is no global dashboard bootstrap request.
- WHPP is a first-class business board, not an injected patch.

## Seven first-class businesses

`CE`, `CEAF`, `TBKH`, `ALI1688`, `SHOPEECN`, `SHOPEEVN`, `WHPP`.

The clean importer reuses only the proven pure Excel classification parser. Classification is explicit and conserved across all seven businesses. No silent fallback to CE.

## Business rules that remain authoritative

- Latest valid track event determines current state.
- Self pickup, CECN/CEZT and 580 are normal special destinations and are excluded from ordinary exception buckets.
- Same-day repeated Pending counts once.
- POD and completed return are terminal facts.
- Shopee attempts use real delivery cycles; no elapsed-day fabrication.
- WHPP uses its own current responsibility/terminal truth and its own board.
- PP/PV is based on recipient province/region, not carrier.

## Rebuild order

1. Core service, split DBs, direct internal login, CE connector login.
2. Seven-board shell including WHPP, date selector and per-board detail list.
3. Clean unified Excel import into the new data DB.
4. Scan + tracking pipeline and business-rule state engine.
5. Day/week/month metrics and drill-down parity.
6. Excel export and restart persistence.
7. New managed-launcher acceptance for QC Next only.

Legacy application remains untouched until QC Next passes its own acceptance suite. The cutover will be one switch, not a sequence of legacy patches.
