# Sections 29–37 — Outbound Operations & Returns

## 29. Release Order

Document: **STOCK RELEASE / DELIVERY ORDER**

Fields: order number, date, customer, warehouse, consignee, delivery address,
requested date, SKU, batch, quantity, transport details, instructions.

Customer and warehouse data must auto-fill.

## 30. Stock Reservation

On approved Release Order: physical stock does NOT decrease; reserved stock
increases. Example: Physical 500, Reserved 100, Available 400.

If a Release Order is cancelled, the reservation must be released.

## 31. Pick List

Generate from approved Release Order. Automatically select appropriate stock
locations according to configured allocation rules. Default logic may use FIFO
where applicable, but allocation policy must be configurable.

Fields: order, customer, warehouse, location, SKU, batch, required quantity,
pick quantity, picker.

## 32. Packing List

Basic V1 document. Fields: order, customer, consignee, SKU, quantity, packages,
weight, box number, remarks.

## 33. Dispatch

Document: **DISPATCH NOTE**. Auto-fill from Release Order / Pick List.

Fields: dispatch number, customer, consignee, order, invoice, LR, vehicle,
driver, transporter, e-way bill reference, packages, weight, remarks.

## 34. Loading Sheet

Fields: vehicle, driver, dispatch, package, SKU, quantity, weight, loaded
status, seal number (if used), loading time, loaded by.

Loading completion should be explicitly confirmed.

## 35. Gate Pass

Document: **WAREHOUSE GATE PASS**. Auto-fill from Dispatch.

Fields: gate pass number, date/time, vehicle, driver, customer, goods, quantity,
invoice, LR, e-way bill reference, seal, authorized by, gate-out time.

Gate-out should complete the outward stock transaction according to the
configured workflow.

## 36. POD

Document: **PROOF OF DELIVERY**

Fields: dispatch reference, delivery date, receiver name, receiver mobile,
signature, stamp, quantity received, shortage, damage, remarks, photo,
attachment.

Allow mobile-friendly POD capture.

## 37. Return

Basic V1 return workflow:
Return Request → Return Inward → Inspection → Accepted / Damaged / Rejected →
Stock Update.

Documents: Return Inward Note, Return Inspection Report, Damage Report.
