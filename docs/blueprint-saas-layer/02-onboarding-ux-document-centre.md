# Sections 18–29 — Onboarding, UX Surfaces, Document Centre & Relationships

## 18. Professional SaaS Onboarding

First login must not dump the user onto a complicated dashboard. Guided
onboarding steps: (1) Welcome — "Let's set up your warehouse"; (2) Company
details; (3) First warehouse; (4) Customer; (5) Products/SKUs; (6) Rate
card; (7) Ready — "Your warehouse is ready." Show progress: Company ✓,
Warehouse ✓, Customer ✓, Products ✓, Rates ✓.

## 19. Empty States

Every module needs professional empty states. Bad: "No data." Good:
"No customers yet — Add your first customer to start creating warehouse
documents. [Add Customer]." Use contextual CTAs.

## 20. Dashboard

Must feel like a real business operating system. Top row: Today's Inward,
Today's Outward, Current Stock, Pending GRNs, Pending PODs, Outstanding.
Below: Recent Activity, Pending Approvals, Stock Summary, Billing Summary,
Ageing Alerts. Do not fill the screen with meaningless charts.

## 21. Global Search

Search across customer, SKU, vehicle, GRN, invoice, gate pass, dispatch,
POD, document number. Example: searching `ABC-001` returns related records
across types.

## 22. Universal Document Centre

One Document Centre with search, filter by document type, customer,
warehouse, date, status. Every generated document is accessible here — do
not create isolated document storage per module.

## 23. Document Lifecycle

Every major document has: Draft, Generated, Approved, Issued, Cancelled
(where applicable), and version history. Do not allow uncontrolled
modification of issued documents.

## 24. Document Relationship

Every document must show **"Created From"** and **"Related Documents"**.
Example, GRN:

```
Created From: Inward #IN-001
Related: Gate Entry #GE-001 · Warehouse Receipt #WR-001 ·
         Put-away #PA-001 · Stock Transactions
```

This is a major professional UX feature, not a nice-to-have.

## 25. Document Timeline

A visual timeline: Gate Entry → Inward → GRN → Inspection → Put-away →
Warehouse Receipt → Stock → Release → Picking → Dispatch → Gate Pass → POD
→ Invoice. The user navigates between related records directly from it.

## 26. "Create Next" Actions

Every transaction page intelligently suggests the next action. GRN:
`[Approve GRN]`, then after approval `[Create Put-away]`
`[Generate Warehouse Receipt]` `[View Stock]`. Release Order:
`[Reserve Stock]` `[Generate Pick List]`. Dispatch: `[Generate Loading
Sheet]` `[Generate Gate Pass]` `[Add POD]`. Invoice: `[Record Payment]`
`[Generate Receipt]`. This makes the product feel intelligent and
workflow-driven.

## 27. Auto-fill UX

When the user selects an existing master, show the populated information
**immediately**, and allow controlled editing where appropriate. Example: a
Customer selector shows `ABC Traders · CUST-001 · GSTIN: XXXXXXXX`; on
selection, Billing Address, Delivery Address, GSTIN, Contact, and Payment
Terms appear automatically. Do not hide important auto-filled data so
deeply that users cannot verify it.

## 28. Smart Forms

Use searchable selectors rather than huge dropdowns: Customer (search
name/code/GSTIN/mobile), SKU (search SKU/name/barcode), Vehicle (search
registration number), Warehouse (search name/code), Driver (search
name/mobile). Forms should get faster as the user's data grows, not slower.

## 29. Drafts

Long forms support drafts. If the user exits, show "Draft saved" and let
them continue later. Never lose entered data.
