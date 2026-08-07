V20 focused validation result: PASS

Validated on GitHub Actions Windows runner with Node.js 24 on 2026-08-07.

Checks passed:
- source syntax
- same selected date prefers newest unified import snapshot
- unified history ignores superseded same-date batches
- exact snapshot hydrates CE, TBKH, ALI1688, SHOPEECN, SHOPEEVN imported slices before API processing
- business cards preserve imported ticket totals before scan/track processing

Historical tests that require uncommitted local workbook fixtures were not used for this focused validation.
