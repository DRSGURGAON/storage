# Development Phases

Blueprint refs: §77 (order), mapped to the concrete schema files and
architecture docs each phase depends on. The saas-layer blueprint's
onboarding, UX system, and entitlement engine are folded into the phases
below rather than left for a later "polish" pass, per its own instruction
not to bolt monetization onto individual modules after the fact.

## Phase 1 — Authentication, Multi-tenancy, Company, Users, Roles, Permissions, Entitlement Engine

- Schema: `schema/00_core.sql` in full, plus `schema/80_subscription.sql`
  (the entitlement/subscription domain belongs here, not in Phase 8, because
  every metered action from Phase 3 onward must call `checkEntitlement`/
  `consumeEntitlement` from day one — see `entitlement-engine.md` §1).
- Docs to implement against: `tenancy-and-security.md`, `permissions-matrix.md`,
  `entitlement-engine.md` in full.
- Deliverable: a tenant can sign up, invite users, assign roles; RLS policies
  are live from the first migration, not bolted on later; a new tenant is
  created with a `trial` `tenant_subscriptions` row on the seeded `FREE`
  plan; `checkEntitlement`/`consumeEntitlement` are implemented and unit
  tested against the seed data even though no document-generating module
  exists yet to call them.
- Exit check: two tenants' users cannot see each other's `tenants` row or
  any tenant-scoped table via the API, verified by an automated test (see
  `test-plan.md` "Customer A cannot access Customer B", generalised to staff
  users too). Separately, a scripted feature check against a `FREE`-plan
  tenant returns `allowed: true` twice and `allowed: false,
  reason: 'LIMIT_REACHED'` on the third call for a `counted` test feature,
  proving the engine before any real feature depends on it.

## Phase 2 — Customer, Warehouse, Location, Product/SKU, Transporter, Vehicle, Driver, Rate Card

- Schema: `schema/10_masters.sql`.
- Docs: `numbering.md` (customer codes, warehouse codes if numbered),
  `workflow-and-statuses.md` §1 (auto-fill contract — build the
  `resolve{Entity}()` endpoints here, since every later phase depends on them).
- Deliverable: full CRUD + searchable selector (§74) for every master; rate
  card resolution (`billing-engine.md` §3) implemented and unit-tested even
  though nothing bills yet. Also build the onboarding wizard here
  (`ux-system.md` §1) — it is nothing more than these same master-record
  create endpoints called in a guided sequence, so it should ship alongside
  them rather than as separate later work.

## Phase 3 — Quotation, Agreement, Document Engine

- Schema: `schema/20_commercial.sql`, plus `documents` /
  `document_verifications` from `schema/70_documents_governance.sql` (build
  the engine now, since every later phase's documents depend on it).
- Docs: `document-engine.md` in full (including §7's entitlement gating and
  §8's relationship traversal), `numbering.md`, `ux-system.md` §5–§7
  (Document Centre, relationships, timeline).
- Deliverable: `generateDocument()` works end-to-end for Quotation and
  Agreement, including QR verification, the entitlement check/consume
  wiring, and the Document Centre showing both — proves the shared design
  system, versioning, and monetization gate together before 20 more
  document types are built on top of the same pattern.
- Exit check: generating a Quotation on a `FREE`-plan tenant past its
  `QUOTATION_GENERATION` limit shows the paywall (`ux-system.md` §11)
  instead of a document, and a retried "Generate" click on a request that
  timed out produces exactly one `documents` row and one consumed
  `usage_ledger` row, never two.

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
  projections referenced in `schema/60_billing.sql`'s closing comment,
  `ux-system.md` §3–§4, §12–§14 (dashboard, global search, usage nudges,
  Plan & Usage page, pricing page).
- Deliverable: customer-facing read-only views of their own stock/documents/
  statement; the operations dashboard (§54) and report list (§55); in-app
  notifications firing on the events listed in §56; the Plan & Usage page
  and public pricing page rendered from `plans`/`plan_feature_limits`
  (`schema/80_subscription.sql`); a demo tenant seeded with
  `tenants.is_demo = true` and a generous demo plan, for prospect
  walkthroughs.
- Payment gateway integration (subscription checkout, webhook handling per
  `entitlement-engine.md` §8) lands here once a specific gateway is chosen
  — see `DECISIONS.md`. Everything through Phase 7 works correctly on the
  seeded `FREE` plan with no gateway connected at all.

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
- **Entitlement checks** (`entitlement-engine.md`) are needed by every
  metered feature from Phase 3 onward, which is why the engine itself is
  built in Phase 1 rather than Phase 8. A feature ships its
  `checkEntitlement`/`consumeEntitlement` calls in the same change that
  ships the feature — there is no later "add monetization" pass.
