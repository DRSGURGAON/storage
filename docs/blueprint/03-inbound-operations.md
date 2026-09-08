# Sections 16–22 — Inbound Operations

## 16. Gate Entry

Document: **VEHICLE GATE ENTRY**. Auto-number example: `GE/26-27/000001`.

Fields: gate entry number, date, time, in/out, customer, warehouse, vehicle,
driver, transporter, purpose, reference, remarks.

Selecting vehicle must auto-fill transporter. Selecting customer must auto-fill
customer information.

## 17. Inward

Document: **GOODS INWARD**

**Header:** inward number, date/time, customer, supplier, warehouse.

**Transport:** vehicle, driver, transporter, LR/GR number, LR date.

**Commercial:** invoice number, invoice date, e-way bill number, PO number.

**Items:** SKU, product, batch, expected quantity, received quantity, accepted
quantity, rejected quantity, packages, weight, condition, remarks.

**Attachments:** invoice, LR, e-way bill, photos, other documents.

If a Gate Entry already exists, selecting it must auto-fill its available data.

## 18. GRN

One of the most important V1 transactions. Document: **GOODS RECEIPT NOTE**.
Auto-fill from Inward.

Fields: GRN number, date, customer, supplier, warehouse, vehicle, driver,
transporter, LR, invoice, e-way bill.

Items: SKU, product, batch, expected quantity, received quantity, accepted
quantity, rejected quantity, short quantity, excess quantity, weight, packages,
condition, remarks.

Approval: **Draft → Submitted → Checked → Approved**.

Only approved GRNs post stock.

## 19. Discrepancy / Damage Report

If expected quantity ≠ received quantity, or damage exists, show
**Create Discrepancy Report**.

Auto-fill: GRN, customer, supplier, product, expected quantity, received
quantity, damage quantity, short quantity, excess quantity.

Additional: reason, photos, driver acknowledgement, warehouse acknowledgement,
remarks.

## 20. Inspection

Basic inspection support. Fields: product, batch, quantity, packaging condition,
seal condition, visible damage, quality remarks, accepted/rejected, inspector.

Do not turn this into a specialized pharma/food QA system in V1.

## 21. Put-away

After GRN approval generate **PUT-AWAY SLIP**.

Auto-fill: GRN, customer, SKU, batch, quantity. User selects: zone, rack, row,
bin, pallet. Once completed, stock location is updated.

## 22. Warehouse Receipt

Generate from approved GRN / put-away. Document: **WAREHOUSE RECEIPT**.
Auto-fill all available data.

Clearly label it as an *operational* warehouse receipt unless a separate legally
compliant regulatory implementation exists. Do not call it a negotiable / WDRA
warehouse receipt.
