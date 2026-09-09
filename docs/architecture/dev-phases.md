# Development Phases

Blueprint refs: §77 (order), mapped to the concrete schema files and
architecture docs each phase depends on. The saas-layer blueprint's
onboarding, UX system, and entitlement engine are folded into the phases
below rather than left for a later "polish" pass, per its own instruction
not to bolt monetization onto individual modules after the fact.

## Phase 1 — Authentication, Multi-tenancy, Company, Users, Roles, Permissions, Entitlement Engine

**Status: tenancy, auth, the entitlement engine, audit logging, and
numbering have landed.**
`apps/api` is a NestJS + TypeScript + Drizzle project (`../../DECISIONS.md`
§0) whose migration runner applies this directory's schema files as real,
tracked migrations — now including `85_integrity_fixes.sql`,
`90_row_level_security.sql`, `91_tenant_users_self_lookup.sql`,
`92_rls_empty_string_guard.sql`, and `93_number_series_null_warehouse_fix.sql`,
five fixes found only by building and load-testing real code against the
schema, not by review (see `DECISIONS.md` §16–§21 for what each closed).
Signup, login (including
multi-tenant membership selection), JWT issuance, and a protected `/me`
endpoint are live and covered by integration tests against a real
database, including the exact connection-reuse scenario that exposed
§18's bug. `checkEntitlement`, `consumeEntitlement`, and
`recordFailedAttempt` are implemented exactly as `entitlement-engine.md`
specifies (clarified in one respect during implementation — see
`DECISIONS.md` §19), with the full feature catalog and the FREE plan's
2-free-copies limits seeded; every new tenant gets an `active`
`tenant_subscriptions` row on the FREE plan at signup (`active`, not
`trial` — there is no time-boxed trial without a paid plan to convert to
yet, and the doc's original "trial" wording below is superseded by this).
`AuditService.record()` is wired into signup (`create`) and both login
outcomes (`login`/`login_failed`, the latter fanned out across every
tenant a wrong-password attempt could have reached, looked up before the
password check so it's available on failure too), each verified against
real `audit_logs` rows, not just that the call didn't throw.
`NumberingService.allocateNumber()` implements `numbering.md` in full —
lazy per-tenant series creation from the canonical prefix list, FY and
reset-policy computation, and `FOR UPDATE` row-lock serialization proven
under a genuine concurrent-allocation test (10 simultaneous calls, zero
duplicates, zero gaps). The RBAC *enforcement* guard is still deliberately
deferred to Phase 2, alongside the first real permission-gated endpoint,
rather than built against no caller (the seed data it will enforce —
`roles`/`permissions`/`role_permissions` — is already live). See
`apps/api/README.md` for setup.

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
  users too). **Done** for the tenancy/RLS mechanism itself —
  `apps/api/src/db/tenant-isolation.spec.ts` proves it directly against a
  real database (no masters module exists yet to prove it through HTTP;
  that's Phase 2's job once there's a real endpoint to call). **Also done**
  for the entitlement engine — `apps/api/src/entitlement/entitlement.spec.ts`
  proves `allowed: true` for the first two `GRN_GENERATION` consumptions and
  `allowed: false, reason: 'LIMIT_REACHED'` on the third, plus idempotent
  retries, a genuine concurrent race (5 simultaneous calls against a
  2-copy limit, exactly 2 win), cross-tenant/cross-feature independence,
  the fail-closed default for an unconfigured feature, and
  `recordFailedAttempt` never touching the counter — all against the real
  database, before any document-generating module exists to call it.

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

- **Audit logging** (`audit_logs`) is wired in starting Phase 1, not
  deferred to Phase 8 — Phase 8 only adds the UI to browse it.
  `apps/api/src/audit/audit.service.ts`'s `record()` is the one function
  every mutating and security-relevant action calls; signup (`create`) and
  login/login\_failed already go through it. Every later phase's
  create/update/approve/reject/cancel endpoints must call it too, not
  write their own `audit_logs` insert.
- **Numbering** (`numbering.md`) is implemented —
  `apps/api/src/numbering/numbering.service.ts`'s `allocateNumber()` — and
  tested directly against a real tenant (sequential allocation, per-warehouse
  independence, and a genuine concurrent-allocation race producing zero
  duplicates and zero gaps), ahead of Phase 3 needing it for Quotation, the
  first numbered document. No later phase may compute its own `number`
  column inline.
- **Attachments** (`attachments` table) is needed starting Phase 2 (customer
  KYC uploads) and reused by every later phase.
- **Entitlement checks** (`entitlement-engine.md`) are needed by every
  metered feature from Phase 3 onward, which is why the engine itself is
  built in Phase 1 rather than Phase 8. A feature ships its
  `checkEntitlement`/`consumeEntitlement` calls in the same change that
  ships the feature — there is no later "add monetization" pass.
