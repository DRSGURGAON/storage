# Reference Schema

Plain PostgreSQL DDL expressing the V1 data model. Split by domain so each
file stays reviewable; load order matters because of foreign keys.

Files `00`–`80` are the domain model. Files `85`–`99a` are fixes and
late additions, each found by building on the schema rather than by reading
it; every one carries a header explaining what broke.
`apps/api/src/db/migrate.ts` applies all twenty-one, in this order, and is
the only thing that does. It sorts filenames as strings, which is why the
file after `99` is `99a` and not `100` — `'100_'` would sort *before*
`'10_masters.sql'`.

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
| 10 | [85_integrity_fixes.sql](85_integrity_fixes.sql) | Partial unique indexes closing a real gap: `unique (tenant_id, code)` doesn't dedupe system-seeded rows when `tenant_id` is null (`DECISIONS.md` §16) | — |
| 11 | [90_row_level_security.sql](90_row_level_security.sql) | `ENABLE`/`FORCE ROW LEVEL SECURITY` + a `tenant_isolation` policy on every tenant-scoped table, generated from `information_schema` (`DECISIONS.md` §17) | — |
| 12 | [91_tenant_users_self_lookup.sql](91_tenant_users_self_lookup.sql) | A second, SELECT-only policy on `tenant_users` so login can discover a user's own memberships before a tenant is chosen | — |
| 13 | [92_rls_empty_string_guard.sql](92_rls_empty_string_guard.sql) | Guards every RLS policy against a real Postgres quirk: a custom GUC resets to `''`, not `NULL`, after its first use on a reused connection (`DECISIONS.md` §18) | — |
| 14 | [93_number_series_null_warehouse_fix.sql](93_number_series_null_warehouse_fix.sql) | The §16 nullable-column gap again, found building `allocateNumber()`: `unique (tenant_id, document_type, warehouse_id)` dedupes nothing for the common tenant-wide series, where `warehouse_id` is null (`DECISIONS.md` §20) | — |
| 15 | [94_agreement_template_system_uq.sql](94_agreement_template_system_uq.sql) | The same gap on `agreement_templates.tenant_id` (null = system default), so the system template can be seeded with an `ON CONFLICT` target instead of duplicating on every run (`DECISIONS.md` §22) | — |
| 16 | [95_document_qr_verify_lookup.sql](95_document_qr_verify_lookup.sql) | A second, SELECT-only policy on `documents` so the public `/verify/{qr_token}` route can find a document before any tenant is known — the same shape as `91` (`DECISIONS.md` §25) | — |
| 17 | [96_stock_lots_balance_key.sql](96_stock_lots_balance_key.sql) | Makes `stock_lots`' balance key actually unique: three of its seven columns are nullable, so the declared constraint enforced nothing for the most ordinary lot there is (`DECISIONS.md` §31) | — |
| 18 | [97_payment_idempotency.sql](97_payment_idempotency.sql) | Adds `payment_receipts.idempotency_key` and its partial unique index, so a retried "Record Payment" click cannot over-credit a customer (§79) | — |
| 19 | [98_portal_row_level_security.sql](98_portal_row_level_security.sql) | A **restrictive** `portal_customer_isolation` policy on every table with a `customer_id`, driven by `app.actor_kind`/`app.customer_id`, so a portal query that forgets its customer filter still cannot see another customer (`tenancy-and-security.md` §2) | 53 |
| 20 | [99_notification_delivery.sql](99_notification_delivery.sql) | `attempt_count`, `last_error` and `sent_at` on `notifications`, so the delivery worker can retry with a bound and an operator can read why a send failed | 56 |
| 21 | [99a_shared_row_write_guard.sql](99a_shared_row_write_guard.sql) | The five nullable-`tenant_id` tables let *any* tenant WRITE a `tenant_id is null` row — a rule, role, charge type or tax rate applying to every workspace on the platform. `USING` keeps them readable, `WITH CHECK` no longer lets them be written (`DECISIONS.md` §48) | — |

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
