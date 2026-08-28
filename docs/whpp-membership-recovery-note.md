# WHPP verified-backup membership recovery

This repair is intentionally limited to restoring an erased WHPP daily membership from a previously verified pre-update SQLite backup.

Safety gates:
- current WHPP normalized membership must be zero;
- latest valid unified batch for that date must exist and contain zero WHPP rows;
- backup WHPP daily header must be non-zero;
- backup header total must exactly equal unique WHPP parse-row count;
- if preserved WHPP history has a non-zero total, it must exactly equal the backup membership count;
- every surviving current WHPP final-fact shipment must be a member of the backup set;
- otherwise recovery is rejected.

Write scope:
- `business_daily_reports` for `businessType='WHPP'` and the target report date;
- `business_daily_parse_rows` for `businessType='WHPP'` and the target report date.

Not modified:
- scan results;
- tracking results / ledger;
- final facts;
- POD state;
- carryover state;
- run locks;
- snapshots;
- unified import history.
