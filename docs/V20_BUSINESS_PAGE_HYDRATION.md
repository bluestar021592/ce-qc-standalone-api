# V20 business page hydration

Purpose: keep the locked V18 UI unchanged while making each business page use the same newest exact-date unified import snapshot as the home summary.

Fixes:
- Unified history only exposes the newest `VALID` import batch for a report date.
- When the selected date equals the current imported date, the frontend prefers `unifiedImportState` rather than an older same-date history snapshot.
- CE/TBKH/ALI1688 ticket totals fall back to the exact imported business slice before scan/track processing exists.
- SHOPEE CN/VN ticket totals also fall back to the exact imported business slice; POD/return/anomaly metrics remain zero until processing produces them.

No HTML/CSS layout changes are included.

Focused Windows validation passed for exact five-business hydration and same-date superseded-history selection.
