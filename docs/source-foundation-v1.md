# Source Data Foundation V1

This document records the source-layer invariants for the CE QC system before scan/track processing.

## Six business types

1. CEAF: customer name contains normalized token `CCAF`.
2. SHOPEEVN: recipient contains `SHOPEEVN`.
3. SHOPEECN: recipient contains `SHOPEECN`.
4. TBKH: shipment code starts with `TBKH`, or recipient contains `TBKH`.
5. ALI1688: recipient contains `ALI1688`.
6. CE: all remaining valid unique waybills.

CEAF has highest classification priority. The source token is `CCAF`; the normalized business type is `CEAF`.

## Source reconciliation gate

For every imported daily report:

`CE + CEAF + TBKH + ALI1688 + SHOPEECN + SHOPEEVN = valid unique waybills`

If the equality fails, parsing must fail with `SOURCE_CLASSIFICATION_RECONCILIATION_FAILED` and processing must not proceed to scan/track.

## Source facts are independent from processing completion

Daily source totals are established at import time. Later scan/track/API failures must never reduce the source denominator.
