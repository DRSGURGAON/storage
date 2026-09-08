# Sections 76–82 — V1 Core Documents, Development Order, Acceptance Criteria, Test Cases, Anti-goals, Quality Bar, Philosophy

## 76. V1 Core Documents

Implement these first: Customer KYC, Warehousing Quotation, Storage/Warehousing
Agreement, Rate Card, Gate Entry, Goods Inward, GRN, Discrepancy/Damage Report,
Put-away Slip, Operational Warehouse Receipt, Stock Ledger, Customer Stock
Statement, Stock Ageing Report, Physical Stock Verification, Stock Transfer
Note, Release/Delivery Order, Pick List, Packing List, Dispatch Note, Loading
Sheet, Gate Pass, POD, Return Inward Note, Storage/Handling Invoice, Debit
Note, Credit Note, Payment Receipt, Customer Account Statement.

## 77. V1 Development Order

- **Phase 1** — Authentication, multi-tenancy, company, users, roles, permissions
- **Phase 2** — Customer, warehouse, location, product/SKU, transporter, vehicle, driver, rate card
- **Phase 3** — Quotation, agreement, document engine
- **Phase 4** — Gate entry, inward, GRN, discrepancy, inspection, put-away, warehouse receipt
- **Phase 5** — Stock engine, ledger, customer stock, ageing, verification, transfer
- **Phase 6** — Release order, reservation, pick, pack, dispatch, loading, gate pass, POD
- **Phase 7** — Storage charges, handling charges, invoice, debit/credit, payment, statement
- **Phase 8** — Customer portal, reports, notifications, audit, QR verification
- **Phase 9** — Full testing: security, permissions, PDFs, stock reconciliation, billing reconciliation, mobile

## 78. Acceptance Criteria

The application is **not** complete merely because all screens exist. It is
complete only when the following end-to-end test works:

1. Create: Company → Customer → Warehouse → SKU → Vehicle → Driver → Rate Card
2. Then: Gate Entry → Inward → GRN → Approve → Put-away → Warehouse Receipt → Stock
3. Then: Release Order → Reserve → Pick → Dispatch → Loading → Gate Pass → Gate Out → POD
4. Then: Storage calculation → Handling calculation → Invoice → Payment → Receipt → Statement

At every stage verify: correct auto-fill; correct document references; correct
stock; correct available stock; correct reserved stock; correct billing;
correct audit trail; correct permissions; correct PDFs.

## 79. Critical Test Cases

Test at minimum:

- Receive 100 → stock = 100
- Dispatch 40 → stock = 60
- Reserve 20 → physical = 60, available = 40
- Cancel reservation → available returns to 60
- Expected 100, received 95 → discrepancy
- Damaged 5 → correct accepted/rejected quantities
- Transfer stock between bins
- Transfer between warehouses
- Return stock
- Prevent dispatch above available stock
- Prevent duplicate GRN posting
- Prevent duplicate invoice posting
- Approved transaction editing restrictions
- Stock adjustment approval
- Customer A cannot access Customer B
- Customer portal cannot access another customer's documents
- Invoice payment correctly reduces outstanding
- PDF contains correct company/customer data
- QR verification works
- Document numbering remains unique
- Cancelled transactions do not corrupt stock
- Refresh/retry does not duplicate transactions
- Multiple warehouses maintain separate stock
- Batch-tracked products maintain correct batch balances
- Audit log records critical changes

## 80. What Not To Do

Do **not**: build disconnected CRUD pages; ask users to re-enter customer
information; ask users to re-enter company information; ask users to manually
calculate storage charges; allow uncontrolled stock editing; hard-code one
customer's data; hard-code GST values without configuration; generate
documents without transaction references; delete historical approved
transactions; put business logic only in the frontend; expose documents
without authorization; build advanced modules outside V1 scope.

## 81. Product Quality Bar

The final product should feel comparable to a serious B2B SaaS. Prioritize:
correctness, data integrity, auto-fill, workflow automation, professional
PDFs, security, auditability, ease of use, performance, scalability.

Do **not** prioritize adding more features over making the existing workflow
reliable.

## 82. Final Product Philosophy

The application should answer one simple customer question:

> "Mere warehouse ka maal andar aane se lekar bahar jaane aur uski billing tak
> saara documentation ek hi system me automatically kaise manage ho?"

The answer should be: **this application**. The user should feel that the
software is doing the paperwork for them rather than asking them to maintain
another complicated system.

The golden rule throughout development:

> **DATA ONCE. AUTOMATION EVERYWHERE. ONE SOURCE OF TRUTH. EVERY MOVEMENT
> TRACEABLE. EVERY DOCUMENT CONNECTED.**

Build V1 around this principle and do not expand scope until this core
workflow is stable.
