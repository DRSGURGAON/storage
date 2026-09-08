# Reference Schema

Plain PostgreSQL DDL expressing the V1 data model. Split by domain so each
file stays reviewable; load order matters because of foreign keys.

| Order | File | Domain | Blueprint §§ |
|---|---|---|---|
| 1 | [00_core.sql](00_core.sql) | Tenants, users, roles/permissions, membership, number series, attachments, tenant settings | 5,6,7,52,62,63 |
| 2 | [10_masters.sql](10_masters.sql) | Warehouse, Location, Customer, Supplier, Product/SKU, Transport, Charge Types, Tax, Rate Cards | 8–13 |
| 3 | [20_commercial.sql](20_commercial.sql) | Quotation, Agreement | 14–15 |
| 4 | [30_inbound.sql](30_inbound.sql) | Gate Entry, Inward, GRN, Discrepancy, Inspection, Put-away, Warehouse Receipt | 16–22 |
| 5 | [40_stock.sql](40_stock.sql) | Batches, Stock Lots (balance), Stock Ledger (transactions), Transfer, Verification, Adjustment | 23–28 |
| 6 | [50_outbound.sql](50_outbound.sql) | Release Order, Pick List, Packing List, Dispatch, Loading Sheet, Gate Pass, POD, Returns | 29–37 |
| 7 | [60_billing.sql](60_billing.sql) | Billing Run, Invoice, Debit/Credit Note, Payment Receipt | 38–43 |
| 8 | [70_documents_governance.sql](70_documents_governance.sql) | Document registry/versioning, QR verification, Approval instances, Audit log, Notifications | 44–51, 56 |
| 9 | [80_subscription.sql](80_subscription.sql) | Feature catalog, Plans, Plan/Feature limits, Tenant Subscriptions, Subscription events, Entitlement overrides, Usage ledger & counters | saas-layer 6–17, 41–45 |

## Conventions

- **Primary keys** are `uuid`, generated application-side (or `gen_random_uuid()`)
  so records can be assigned an id before insert (needed for idempotent retries
  and for pre-computing QR tokens/number-series reservations).
- **Every tenant-owned table carries `tenant_id`** and every foreign key
  target is implicitly scoped to the same tenant by the service layer — see
  [`../tenancy-and-security.md`](../tenancy-and-security.md) for how this is
  enforced (row-level security + service-layer guard, not just an app-level `WHERE`).
- **Snapshots, not live joins, for documents.** Any table that backs a printed
  or issued document (quotations, agreements, GRNs, warehouse receipts,
  invoices, …) stores a `*_snapshot jsonb` of the party/company details at
  issue time. Master data can change later without altering history — this is
  what blueprint §67 ("every downstream record references its source") and
  §78's PDF-correctness acceptance test actually require.
- **Money** is `numeric(14,2)`; **rates** that need finer precision (e.g.
  per-kg rates) are `numeric(14,4)`. Never `float`/`double`.
- **Status columns** are `text` with a `check` constraint enumerating legal
  values; the *transitions* allowed between them are enforced in the service
  layer per [`workflow-and-statuses.md`](../workflow-and-statuses.md), not by
  the database (Postgres doesn't have a clean way to express a transition
  graph in a `check` constraint, and the transition rules need audit logging
  and permission checks the DB layer shouldn't own).
- **No hard deletes on transactional tables.** Cancellation/reversal is a
  status + a reversal reference (e.g. `grns.reversed_by_grn_id`,
  `stock_ledger.reversal_of_id`), never a `DELETE`. This directly implements
  blueprint §80 ("do not delete historical approved transactions").
- **Generated columns** (`short_qty`, `available_qty`, `balance_due`, …) keep
  derived quantities consistent without relying on every call site to
  recompute them correctly.
