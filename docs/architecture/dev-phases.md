# Development Phases

Blueprint refs: §77 (order), mapped to the concrete schema files and
architecture docs each phase depends on.

## Phase 1 — Authentication, Multi-tenancy, Company, Users, Roles, Permissions

- Schema: `schema/00_core.sql` in full.
- Docs to implement against: `tenancy-and-security.md`, `permissions-matrix.md`.
- Deliverable: a tenant can sign up, invite users, assign roles; RLS policies
  are live from the first migration, not bolted on later.
- Exit check: two tenants' users cannot see each other's `tenants` row or
  any tenant-scoped table via the API, verified by an automated test (see
  `test-plan.md` "Customer A cannot access Customer B", generalised to staff
  users too).

## Phase 2 — Customer, Warehouse, Location, Product/SKU, Transporter, Vehicle, Driver, Rate Card

- Schema: `schema/10_masters.sql`.
- Docs: `numbering.md` (customer codes, warehouse codes if numbered),
  `workflow-and-statuses.md` §1 (auto-fill contract — build the
  `resolve{Entity}()` endpoints here, since every later phase depends on them).
- Deliverable: full CRUD + searchable selector (§74) for every master; rate
  card resolution (`billing-engine.md` §3) implemented and unit-tested even
  though nothing bills yet.

## Phase 3 — Quotation, Agreement, Document Engine

- Schema: `schema/20_commercial.sql`, plus `documents` /
  `document_verifications` from `schema/70_documents_governance.sql` (build
  the engine now, since every later phase's documents depend on it).
- Docs: `document-engine.md` in full, `numbering.md`.
- Deliverable: `generateDocument()` works end-to-end for Quotation and
  Agreement, including QR verification — proves the shared design system
  and versioning before 20 more document types are built on top of it.

## Phase 4 — Gate Entry, Inward, GRN, Discrepancy, Inspection, Put-away, Warehouse Receipt

- Schema: `schema/30_inbound.sql`.
- Docs: `workflow-and-statuses.md` (GRN status machine, auto-fill chain
  Gate Entry→Inward→GRN), `document-engine.md` (six new document types).
- Deliverable: the inbound half of the §68 lifecycle works manually up to
  Warehouse Receipt — **stock does not move yet** (Phase 5 owns posting);
  GRN approval in this phase should insert stock only once the stock engine
  exists, so sequence Phase 4 and 5 tightly or build GRN approval's stock
  posting call as a stub until Phase 5 lands.

## Phase 5 — Stock Engine, Ledger, Customer Stock, Ageing, Verification, Transfer

- Schema: `schema/40_stock.sql`.
- Docs: `stock-engine.md` in full.
- Deliverable: GRN approval (Phase 4) now posts real `stock_ledger` rows;
  Customer Stock Statement, Stock Ledger view, and Ageing report are
  queryable; Stock Transfer and Stock Verification/Adjustment work with
  approval chains.
- Exit check: the §79 quantitative test cases (receive 100 → stock 100,
  transfer between bins/warehouses, prevent negative stock) pass.

## Phase 6 — Release Order, Reservation, Pick, Pack, Dispatch, Loading, Gate Pass, POD

- Schema: `schema/50_outbound.sql`.
- Docs: `stock-engine.md` §2/§6 (reservation + allocation policy),
  `workflow-and-statuses.md` (Release Order status machine).
- Deliverable: full outbound chain; gate-out posts the `OUTWARD` ledger
  transaction exactly once (idempotency per `stock-engine.md` §4).
- Exit check: §79 cases "dispatch 40 → stock 60", "reserve 20 → available
  40", "cancel reservation restores available", "prevent dispatch above
  available."

## Phase 7 — Storage Charges, Handling Charges, Invoice, Debit/Credit, Payment, Statement

- Schema: `schema/60_billing.sql`.
- Docs: `billing-engine.md` in full.
- Deliverable: Billing Run preview → Invoice → Payment → Customer Statement,
  driven entirely by Phase 4–6's operational data plus Phase 2's rate cards.
- Exit check: §79 "invoice payment correctly reduces outstanding," "prevent
  duplicate invoice posting."

## Phase 8 — Customer Portal, Reports, Notifications, Audit, QR Verification

- Schema: `notification_rules`/`notifications`, `audit_logs`,
  `approval_chain_templates`/`approval_instances`/`approval_steps` from
  `schema/70_documents_governance.sql` (audit logging should really be wired
  in from Phase 1 onward at the interceptor level — this phase is where the
  *viewer* UI for it ships).
- Docs: `tenancy-and-security.md` §2 (portal isolation), the reporting
  projections referenced in `schema/60_billing.sql`'s closing comment.
- Deliverable: customer-facing read-only views of their own stock/documents/
  statement; the operations dashboard (§54) and report list (§55); in-app
  notifications firing on the events listed in §56.

## Phase 9 — Full Testing

- No new schema.
- Docs: `test-plan.md` — execute it in full: the §78 end-to-end acceptance
  scenario, the §79 critical test-case list, plus security/permission testing
  (`tenancy-and-security.md`), PDF correctness (`document-engine.md` §3–§4),
  stock and billing reconciliation, and mobile responsiveness (§64).

## Cross-cutting, not a phase

- **Audit logging** (`audit_logs`) should be wired into the service-layer
  interceptor starting Phase 1, not deferred to Phase 8 — Phase 8 only adds
  the UI to browse it.
- **Numbering** (`numbering.md`) is needed by Phase 3 onward (Quotation is
  the first numbered document) and must not be reimplemented per phase.
- **Attachments** (`attachments` table) is needed starting Phase 2 (customer
  KYC uploads) and reused by every later phase.
