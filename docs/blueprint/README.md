# Master Development Blueprint — V1

This folder is the **source of truth** for product scope. Every section number
below matches the numbering used in the original blueprint so that code, issues
and commits can reference `BP-§18` (GRN), `BP-§23` (Stock Engine), etc. The
blueprint was delivered in two parts (§1–55, then §56–82); both are folded in
below with continuous section numbers.

| File | Sections | Topic |
|------|----------|-------|
| [00-objective-scope-principles.md](00-objective-scope-principles.md) | 1–6 | Objective, V1 scope, core principle, data flow, architecture, multi-tenancy |
| [01-master-data.md](01-master-data.md) | 7–13 | Company, Warehouse, Location, Customer, Product/SKU, Transport, Rate Card |
| [02-commercial.md](02-commercial.md) | 14–15 | Quotation, Agreement |
| [03-inbound-operations.md](03-inbound-operations.md) | 16–22 | Gate Entry, Inward, GRN, Discrepancy, Inspection, Put-away, Warehouse Receipt |
| [04-stock-engine.md](04-stock-engine.md) | 23–28 | Stock Engine, Ledger, Customer Stock Statement, Ageing, Verification, Transfer |
| [05-outbound-operations.md](05-outbound-operations.md) | 29–37 | Release Order, Reservation, Pick, Pack, Dispatch, Loading, Gate Pass, POD, Return |
| [06-billing.md](06-billing.md) | 38–43 | Billing Engine, Monthly Billing, Invoice, Debit/Credit Note, Payment, Statement |
| [07-documents.md](07-documents.md) | 44–49 | Document Centre, Timeline, Document Engine, Design System, QR, Versioning |
| [08-governance.md](08-governance.md) | 50–52 | Approval Engine, Audit Log, Roles & Permissions |
| [09-portal-dashboard-reports.md](09-portal-dashboard-reports.md) | 53–55 | Customer Portal, Dashboard, Reports |
| [10-platform-ux-rules.md](10-platform-ux-rules.md) | 56–65 | Notifications, Search, Auto-fill Rules, Smart Create Buttons, Status System, Error Prevention, Numbering Engine, Attachments, Mobile, QR/Barcode |
| [11-billing-transparency-and-traceability.md](11-billing-transparency-and-traceability.md) | 66–68 | Storage Charge Transparency, Data Relationship Principle, Document Lifecycle Example |
| [12-nonfunctional.md](12-nonfunctional.md) | 69–70 | Security, Backup/Reliability |
| [13-ux-and-forms.md](13-ux-and-forms.md) | 71–75 | UI/UX Design, Form Design, Auto-save/Draft, Customer Selection UX, Document Preview |
| [14-v1-delivery-plan.md](14-v1-delivery-plan.md) | 76–82 | V1 Core Documents, Development Order, Acceptance Criteria, Critical Test Cases, Anti-goals, Quality Bar, Product Philosophy |

The engineering interpretation of this blueprint — schema, numbering, permissions,
billing rules, document engine, dev phases, test plan — lives in
[`../architecture`](../architecture/README.md).
