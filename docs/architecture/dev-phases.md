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
duplicates, zero gaps). The RBAC *enforcement* guard
(`apps/api/src/auth/permissions.guard.ts`, `@RequirePermission`) landed
with Phase 2's first endpoint rather than ahead of it: it resolves the
caller's grants live through `tenant_users → role_permissions` on every
request (a role change or disabled membership bites immediately, not at
token expiry), fails closed on an endpoint that declares no permission,
and records `permission_denied` in `audit_logs`. Inviting users and
assigning roles (`apps/api/src/users/`) closes the last open item of this
phase's deliverable: an Owner/Admin adds a member with a role, changes
roles, restricts to warehouses, and disables — with two lockout guards
(never your own membership, never the last active Owner) and the proof
that a role change or disablement bites the member's *existing* token on
the next request. Because there is no email delivery until the
notification engine (V1.1), a brand-new account gets its initial password
from the admin instead of an emailed set-password link — a working flow,
not a placeholder; an email that already has an account elsewhere simply
gains a membership here, password untouched (tenancy-and-security.md
§3's one-identity-many-tenants). See `apps/api/README.md` for setup.

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

**Status: Customer master landed** (`apps/api/src/customers/`): create /
list / get / update, `CUST0001`-style codes from `allocateNumberIn()`
inside the same transaction as the insert (numbering.md §4), name/code/
GSTIN/mobile search with server-side pagination (§74), GSTIN/PAN format
validation at the boundary, and `create`/`update` audit rows carrying
previous and new values. This is also where tenant isolation was first
proven *through HTTP* (tenant B listing, fetching, and patching tenant A's
customer: empty, 404, 404) and where an operator's `create_customer`
denial is asserted as both a 403 and a `permission_denied` audit row.
**Warehouse + Locations landed** (`apps/api/src/warehouses/`): warehouse
CRUD with a tenant-unique, immutable code (it is the first segment of
every location code), and the §9 hierarchy under
`/warehouses/:id/locations` — `full_code` materialised from the parent
chain (`WH01-A-R04-B15-P003`), `barcode_value` defaulting to it, and the
placement rule "deeper than the parent, levels may be skipped" (the
blueprint's own example has no Row). Level/segment/parent are immutable
because they're baked into every descendant's code; a move is a new
location plus deactivating the old one. Locations ride on the warehouse
permissions (`view_warehouse` / `edit_warehouse`) rather than needing
their own.
**Product/SKU master landed** (`apps/api/src/products/`): UOMs, product
categories (self-referencing, nestable) and products, all under one
module. UOMs have no shared/system-wide row the way roles or feature_keys
do (`uoms.tenant_id` is `not null`), so `DEFAULT_UOMS` — 8 canonical units
(NOS, BOX, BAG, KG, MT, PLT, CBM, SQFT) — is seeded per tenant inside the
signup transaction instead of once globally; a tenant can add more
afterwards. `products.uom_code` and `.category_id` have no FK at the
database level (`schema/10_masters.sql`), so `ProductsService` validates
both against the tenant's own rows before insert/update, inside the same
transaction. `volume_cbm` is server-computed from
`length_cm × width_cm × height_cm ÷ 1,000,000` and recomputed on any
partial update that touches a dimension (merging the patch against the
row's existing values first) — a client-supplied `volume_cbm` is silently
ignored, per the schema's own "derived, stored for billing" comment. SKU
uniqueness rides on `unique (tenant_id, customer_id, sku)` plus the
`products_shared_sku_uq` partial index from §16/85_integrity_fixes.sql, so
the same SKU string can exist once as a shared/generic product
(`customer_id is null`) and once per customer without colliding — proven
in `products.spec.ts`, not just assumed from the index existing. Listing
supports a `customerId=shared` sentinel alongside a real customer id or no
filter at all; because that's a three-state filter (unlike the plain
`ILIKE` search pattern), the query passes a real SQL `null`/uuid parameter
plus a separate `NOT $active OR ...` flag rather than trying to overload
`null` as "no filter" — postgres.js rejects a bound JS `undefined`
outright, so that path was checked deliberately, not by accident.
**Transport master landed** (`apps/api/src/transport/`): Transporters,
Vehicles and Drivers, all sharing one permission set
(`view`/`create`/`edit_transport_master` — the matrix has no separate row
per sub-resource). `vehicles.vehicle_number` is normalised to uppercase
with spaces stripped before every insert/update/search
(`schema/10_masters.sql`'s own comment: "normalised uppercase, no spaces:
'HR26DK1234'"), so `hr 26 dk 1234` and `HR26DK1234` collide on the same
`unique (tenant_id, vehicle_number)` row — proven with a real duplicate
in `transport.spec.ts`, not just assumed from the transform existing.
`vehicles.transporter_id` and `drivers.transporter_id` are both nullable
(an owned fleet has no transporter) and validated against the tenant's
own transporters when present; `drivers` carries no unique constraint at
all in the schema, so duplicate names/mobiles are accepted deliberately,
unlike transporters (`unique (tenant_id, name)`) and vehicles.
**Rate Card master + resolution engine landed** (`apps/api/src/billing/`):
Charge Types and Tax Rates (both seeded system-wide at deploy time —
`db/seed-data.ts` `SYSTEM_CHARGE_TYPES`/`SYSTEM_TAX_RATES`, `db/seed.ts`,
same `tenant_id is null` + partial-unique-index pattern as roles — with a
tenant able to add its own; `list()` prefers a tenant's own row over the
system row of the same code when both exist), Rate Cards, and Rate Card
Lines. `rate_cards`' check constraint (`scope='customer' and customer_id
is not null`, etc.) is re-validated in `RateCardsService` before the
insert/update, so a bad scope/id combination is a clean 400 — including
the *wrong* id being set for a scope (e.g. a `company`-scope card with a
`customerId`), which the DB constraint alone would not catch. The
`RateCardResolutionService` implements billing-engine.md §3's priority
order end to end: a customer-scope card (optionally narrowed to one
warehouse) beats a warehouse-scope card beats the company default, and
within whichever card wins, a line is picked product-id match >
category-id match > general line. Critically, "resolve until one
*matches*" is read as matching a **line**, not just an active card — a
customer-scope card that has no line for the requested charge type falls
through to warehouse/company rather than failing outright, so a
customer's card can override only some charge types and inherit the
rest. No line anywhere for a charge type is an explicit 404, never a
fallback to zero (billing-engine.md §1: "never silently generate
incorrect billing"). All of this — the 3-level priority, the
product-override, a second customer with no card of its own correctly
landing on the warehouse card rather than the first customer's, and
omitting `warehouseId` correctly skipping the warehouse-scope level
entirely — is proven against a real 3-card stack in `billing.spec.ts`,
not just asserted from the query shape. A `GET /rate-cards/resolve`
endpoint exposes the same resolution for the future rate-card UI to
preview "what would this actually charge" before Phase 7 bills anything.
**Customer addresses and contacts landed** (nested under
`apps/api/src/customers/`, `customer_addresses`/`customer_contacts` in
`schema/10_masters.sql`): `registered`/`billing`/`delivery` addresses and
contacts, both under `/customers/:id/`. Neither table has a database
constraint enforcing "only one default/primary" — `is_default` is scoped
per `(customer, kind)` and `is_primary` per customer, both service-layer
invariants enforced in the same transaction as the write (clear the old
flag, then set the new one), the same "not a DB constraint, so enforce it
here" pattern as rate cards' scope check. Proven directly: three
addresses across two kinds confirm a new `delivery` default clears the
previous `delivery` default while leaving the unrelated `registered`
default untouched, and toggling `isPrimary` back onto an earlier contact
correctly un-primaries the one that displaced it. Both ride the existing
`view_customer`/`edit_customer` permissions — no separate permission code
exists for either sub-resource. KYC documents are deferred to the
`attachments` table (Phase 4, per the schema's own comment: "Customer
documents... live in attachments with owner_type='customer'").
**Onboarding wizard landed** (`apps/api/src/onboarding/`, `GET
/onboarding/status`): ux-system.md §1 offers two ways to persist wizard
progress — "a small `onboarding_state` field on the tenant, or derived
live by checking whether each entity type has at least one row." This
takes the derived-live option deliberately: no onboarding-only API (every
step is backed by the ordinary master create-endpoint, exactly as §1
specifies), no extra column or migration, and no risk of the flag
drifting from what a tenant actually has if records get created out of
order or the wizard is skipped entirely (§1: "this is guidance, not a
hard gate"). One nuance worth calling out: the rate-card step checks
`rate_card_lines`, not just `rate_cards` — §1's own step description is
"creates one `rate_cards` + `rate_card_lines` set", and a card with no
priced line isn't a usable rate card yet, so counting the card alone
would report a false positive. Proven end to end in `onboarding.spec.ts`
by driving one tenant through all five steps via the real master
endpoints and asserting `nextStep`/`isComplete` after each one — including
the rate-card-with-no-line-yet case landing on `done: false` — plus a
second, brand-new tenant confirmed unaffected by the first one's
progress. No `RequirePermission`: informational and RLS-scoped to the
caller's own tenant, same posture as `GET /auth/me`. This completes
Phase 2 in full.

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

**Status: Quotation record landed** (`apps/api/src/quotations/`):
`quotations` + `quotation_lines`, `QT/{fy}/{seq:6}` numbering
(`allocateNumberIn`, same engine every other module uses), and the
Draft → Sent → Accepted/Rejected/Cancelled workflow from blueprint §14
(`expired` is in the schema's check constraint but has no transition yet
— it needs a scheduler this codebase doesn't have, so it's deliberately
deferred rather than faked with a manual endpoint). `customer_snapshot`
is built server-side at creation from the customer's own record plus its
billing/registered address and primary contact (falling back to the
customer row's own `contact_person`/`mobile`/`email` when neither
sub-resource exists yet) and never touched again — "documents must not
change retroactively" (schema/20_commercial.sql's own comment) enforced
by simply never re-deriving it on update, even when `customerId` itself
changes on a draft. Each line's `amount` is `quantity × rate` when a
quantity is given, or `rate` itself for a flat/lumpsum basis with no
quantity; tax rides on `amount`, never on `rate` directly. Editing (full
header + line replacement) is only permitted in `draft`; every status
transition re-validates its own `allowedFrom` set and audits as
`status_change`. Deliberately scoped to the quotation record and its
workflow only — `generateDocument()`, PDF rendering, and QR verification
(this section's own remaining deliverable, below) are a separate
increment: building a real PDF pipeline is its own technology decision
(a rendering library, a document-storage strategy) that hasn't been made
yet, and doesn't belong bundled into the same increment as the source
record it will eventually render.
**Agreement record landed** (`apps/api/src/agreements/`): `agreements` +
`agreement_templates`, `AG/{fy}/{seq:6}` numbering, and Draft → Pending
Approval → Approved → Active (signed), or Terminated/Cancelled from
blueprint §15 (`expired` deferred for the same no-scheduler reason as
Quotation's). `POST /quotations/:id` isn't a thing — instead, creating an
Agreement with a `quotationId` re-validates that quotation is `accepted`
(§14: "After acceptance provide Create Agreement, which pre-fills
agreement information") and pre-fills `customerId`/`warehouseId` from it
when the request doesn't set them explicitly. Ships exactly one
system-seeded template (`db/seed-data.ts` `SYSTEM_AGREEMENT_TEMPLATE`,
7 clauses covering §15's legal-content wizard steps in plain language) —
§15's "must remain editable/configurable... requiring appropriate legal
review" is read as V1 shipping a usable, generic starting point rather
than an empty-or-authoring-required feature; a tenant's own reviewed
template is not built yet. Clauses use `{{dotted.path}}` tokens resolved
server-side against a `company`/`customer`/`warehouse`/`agreement`
context assembled at create/update time — an unresolvable path (no
warehouse chosen yet, etc.) renders as an empty string rather than
throwing, so a clause never blocks on optional context. `approve` is
gated on `approve_agreement`, separate from `edit_agreement`, matching
permissions-matrix.md's Owner-only row for it (unlike quotations, where
Admin has full parity with Owner) — proven directly: an Admin holding
`edit_agreement` still gets a 403 on `/approve`.

While building this, seeding the one system template surfaced two real
bugs, both in DECISIONS.md: §22 (same nullable-`tenant_id`-without-a-
unique-index gap as §16, this time in `agreement_templates`, caught
before a failing test rather than by one) and §23 (`db/seed.ts` used its
own bare postgres.js connection instead of the shared
`createDbConnection()` factory, and that divergence silently
double-encoded jsonb columns — fixed by having `seed.ts` share the same
connection factory as the running app, not by changing the query
pattern itself, since the query pattern was already correct for every
other caller).

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
