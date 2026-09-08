# Sections 7–13 — Master Data

## 7. Company Master

Fields: company legal name, trade name, logo, address, city, state, pincode,
GSTIN, PAN, CIN (where applicable), phone, email, website, bank name, account
number, IFSC, branch, authorized signatory, signature, stamp, terms and conditions.

Company information must automatically flow into all generated documents. Do
**not** make the user enter company information separately in every document.

## 8. Warehouse Master

Support multiple warehouses.

Fields: warehouse name, warehouse code, address, city, state, pincode, contact
number, email, GST information, capacity, area, manager, working hours,
active/inactive.

When a warehouse is selected on any transaction, its information must auto-fill.

## 9. Location Master

Hierarchy: **Warehouse → Zone → Rack → Row → Bin → Pallet**.

Every location must have a unique code, e.g. `WH01-A-R04-B15-P003`.

Allow QR / barcode generation for locations.

## 10. Customer Master

**Basic:** customer code, customer name, legal name, customer type, contact
person, mobile, email.

**Tax:** GSTIN, PAN, state, place of supply.

**Addresses:** registered address, billing address, delivery address.

**Commercial:** default warehouse, billing cycle, credit period, default rate
card, minimum billing, payment terms.

**Documents (uploads):** GST certificate, PAN, agreement, KYC, other supporting
documents.

Customer master must become the single source of truth.

## 11. Product / SKU Master

Fields: SKU, product name, description, category, brand, HSN, UOM, weight,
dimensions, barcode, batch tracking ON/OFF, serial tracking ON/OFF, expiry
tracking ON/OFF.

When a SKU is selected, auto-fill all relevant information. Allow manual
override only where business rules permit.

## 12. Transport Master

**Transporter:** name, GSTIN, contact, address.

**Vehicle:** vehicle number, vehicle type, capacity, transporter.

**Driver:** name, mobile, license number, transporter.

Selecting a vehicle should automatically populate transporter and vehicle details.

## 13. Rate Card

Create reusable customer-specific and generic rate cards.

**Storage:** per unit/day, per pallet/day, per box/day, per sq.ft/month, per
CBM/day, flat monthly.

**Handling:** inward handling, outward handling, loading, unloading, labour,
palletization, pick & pack.

**Other:** documentation, special handling, additional labour, waiting/detention,
other configurable charges.

Rate priority:
1. Customer-specific rate
2. Warehouse-specific rate
3. Default company rate

Never hard-code rates.
