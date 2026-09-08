# Sections 23–28 — Stock Engine

## 23. Stock Engine

Stock must be transaction-based. Do **not** allow arbitrary direct editing of
current stock as the normal workflow.

Core stock attributes: tenant, customer, warehouse, location, SKU, batch, serial
(if enabled), physical quantity, reserved quantity, available quantity.

Formula: **AVAILABLE = PHYSICAL − RESERVED**

Stock transactions: `INWARD`, `TRANSFER_IN`, `TRANSFER_OUT`, `OUTWARD`,
`RETURN`, `ADJUSTMENT`.

Every stock transaction must have a source/reference document.

## 24. Stock Ledger

| Date | Reference | Transaction | IN | OUT | Balance |

Every stock change must be traceable. Clicking a ledger entry opens its source
transaction/document.

## 25. Customer Stock Statement

Select customer → system generates: SKU, product, batch, warehouse, location,
opening quantity, inward, outward, closing quantity.

Support date filters. Allow PDF and Excel export.

## 26. Stock Ageing

Configurable ageing buckets. Default: 0–30, 31–60, 61–90, 91–180, 180+ days.

Calculate age based on actual stock receipt date according to configured
business logic.

## 27. Physical Stock Verification

Document: **PHYSICAL STOCK VERIFICATION REPORT**

Fields: date, warehouse, customer, SKU, system quantity, physical quantity,
difference, reason, verified by, remarks.

Do not silently change system stock. If adjustment is required, create an
explicit **STOCK ADJUSTMENT** with approval and audit trail.

## 28. Stock Transfer

Support internal transfer (Location A → Location B) and warehouse transfer
(Warehouse A → Warehouse B). Document: **STOCK TRANSFER NOTE**.

Stock should move through ledger transactions.
