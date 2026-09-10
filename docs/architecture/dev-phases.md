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

**Document engine landed** (`apps/api/src/documents/`,
`apps/api/src/attachments/`): `DocumentEngineService.previewDocument()`
/ `.commitDocument()`, headless-Chromium PDF rendering (`puppeteer-core`
— `DECISIONS.md` §24 records this as §0's own already-locked choice,
implemented rather than reopened), the shared A4 design system
(`documents/html/layout.ts`), QR generation and the public
`GET /verify/:qrToken` endpoint, `documents` versioning
(regenerate → new version, old version's QR resolves `revoked`), and the
`AttachmentStorage` interface with `LocalFilesystemAttachmentStorage` as
its only implementation so far (`DECISIONS.md` §24 again, against this
repo's own S3-signed-URL note). Two real bugs surfaced building the
engine itself, both in DECISIONS.md: §25 (`documents` needed the same
self-lookup RLS policy as `tenant_users` — §17 — since the public verify
endpoint has no tenant context to filter by until the row itself is
found) and §26 (`puppeteer-core`'s ESM-only build breaks under Jest's
own module loader even though it runs fine under plain Node 22; fixed
with a `new Function`-hidden dynamic `import()` that TypeScript's
`commonjs` downlevel can't rewrite back into a `require()`, plus running
the test scripts with `NODE_OPTIONS=--experimental-vm-modules` so Jest's
own VM sandbox actually services that `import()` instead of rejecting
it). The exit check below (FREE-plan paywall on `QUOTATION_GENERATION`)
is proven in `documents.spec.ts`, including preview and commit both
blocking before any PDF is built, and idempotent-retry-produces-one-
document is proven directly against the same source record across
multiple retries.

**Both document types now registered**: `AgreementDocumentTemplate`
followed the same shape as `QuotationDocumentTemplate` — one more
constructor argument on `DocumentTemplateRegistry`, no change to
`DocumentEngineService` itself, exactly as document-engine.md §2
promises ("adding one template + one data-loader function, not a new
rendering pipeline"). Unlike Quotation, Agreement has no frozen
`customer_snapshot` of its own; its already-placeholder-resolved
`rendered_clauses` (computed by `AgreementsService` on every `draft`
edit, left untouched once submitted) serve the same "immutable at
generation time" role, so the template renders each clause as its own
titled section rather than duplicating customer/company identity into a
separate party card — a contract's body *is* its clauses. `AGREEMENT_GENERATION`
is a separate FREE-plan budget from `QUOTATION_GENERATION`
(`documents.spec.ts` proves this through the HTTP layer, not just
directly against `EntitlementService` as `entitlement.spec.ts` already
did). `generateDocument()` now genuinely works "for Quotation and
Agreement" — Phase 3's deliverable below is met, and the phase is
closed. No new bugs surfaced building this slice; it reused the
document engine's existing mechanics unchanged.

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

**Status: Gate Entry record landed** (`apps/api/src/gate-entries/`):
`gate_entries`, `GE/{fy}/{seq:6}` numbering, and the
Open → Closed/Cancelled workflow from blueprint §16 (`'linked'` — an
Inward referencing this gate entry — is set by Inward's own increment,
not this one; there's nothing to link to yet). Editability lives on
`status = 'open'`, the same "draft-like" shape as Quotation/Agreement
even though the column's own value is `'open'`, not literally `'draft'`.
"Selecting vehicle must auto-fill transporter" (§16) is resolved
server-side, not left to a frontend convention: `vehicleId` pulls the
vehicle's own `transporter_id`/name unless the request already set one
explicitly, and `driverId` similarly snapshots the driver's name/mobile
onto the row — proven directly (a vehicle-only request correctly fills
in its linked transporter's name) rather than merely documented.
`GateEntryDocumentTemplate` is the third template registered on the
document engine (`documentType: 'gate_entry'`, `featureCode:
'GATE_ENTRY'`) — a single-block slip with no line items, proving the
engine handles a document type simpler than Quotation/Agreement just as
well as one with line items or clauses. permissions-matrix.md's
Operations module seeds only `create_gate_entry`, no separate view/edit
code (unlike Masters/Commercial) — every route here, reads included,
rides that one permission, the same "no dedicated code exists" pattern
already used for rate-card lines and customer addresses/contacts.

Building this surfaced one real bug, DECISIONS.md §27:
`db/client.ts`'s `createDbConnection()` wraps the shared connection with
`drizzle(sql)` even though this codebase never uses Drizzle's own query
builder — and that wrapping silently registers a `timestamptz`
parser/serializer on the *shared* connection, so every raw
`postgres.js` query in the app reads timestamp columns back as plain
strings, not `Date` objects, and a raw `new Date()` bound as a query
parameter fails outright. Latent everywhere else in the codebase
(every other timestamp column is either server-stamped and never read
back, or a `date`-only column already carried as a string) but real
here, since `entry_at` is the first client-settable `timestamptz` that
gets read back and reused (editing a gate entry without changing its
entry time re-sends the value `update()` just selected). Fixed in
`gate-entries.service.ts` only, with the reasoning for not chasing the
same mistyping across every other module recorded in §27 itself.

**Inward record landed** (`apps/api/src/inwards/`): `inwards` +
`inward_items`, `IN/{fy}/{seq:6}` numbering, and the
Draft → Received/Cancelled workflow from blueprint §17
(`'grn_created'` is set by GRN's own increment, not this one — the same
deferral shape as Gate Entry's `'linked'`). "If a Gate Entry already
exists, selecting it must auto-fill its available data" is resolved
server-side: passing `gateEntryId` auto-fills `customerId` and the
vehicle/driver/transporter fields from that gate entry (an explicit
value on the request still wins), validates the gate entry is `'open'`
before allowing the link, and flips it to `'linked'` as a side effect
in the same transaction — proven directly (a gate-entry-only Inward
correctly inherits the vehicle's own transporter, and the gate entry
really does read back as `'linked'` afterward), not merely implemented
per the blueprint's prose. Each line's `product_snapshot` is built
server-side from the product master at creation time (sku/name/hsn/uom/
weight), the same "freeze at creation" discipline as Quotation's
`customer_snapshot`. `InwardDocumentTemplate` is the fourth template
registered on the document engine (`documentType: 'inward'`,
`featureCode: 'INWARD'`) — the first with a genuine product/batch/
quantity table, proving the shared design system's line-item table
isn't Quotation-specific. `supplierId`/`supplierName` are deliberately
optional-and-independent rather than backed by a real Supplier master —
DECISIONS.md §29 records why building one now would mean inventing
permission codes `permissions-matrix.md` never specifies, which this
project's discipline treats as out of bounds for a single increment to
decide unilaterally.

One real bug, DECISIONS.md §28: `CreateInwardDto.customerId` was still
declared required, contradicting `InwardsService.create()`'s own
"required directly, or via a gate entry that has one" fallback three
lines below it in the same file — caught by curling the documented
gate-entry-only use case before writing the automated test for it, the
same discipline that has caught every prior DTO/service mismatch here.

**GRN landed** (`apps/api/src/grns/`): `grns` + `grn_items` +
`grn_item_serials`, `GRN/{fy}/{seq:6}` numbering, and §18's
Draft → Submitted → Checked → Approved (or Rejected) machine. §50's
approval engine names the split explicitly — "GRN: Operator → Manager" —
so create/edit/submit/cancel ride `create_grn` while check/approve/
reject ride `approve_grn`, which permissions-matrix.md withholds from
Warehouse Operator. "Auto-fill from Inward" covers header *and* items:
an `inwardId` copies the transport/LR/invoice/e-way/PO block and turns
each `inward_item` into a `grn_item` (keeping `inward_item_id` as the
trace back), requires the inward to be `'received'`, and flips it to
`'grn_created'`. `short_qty`/`excess_qty` are the schema's own generated
columns and `has_discrepancy` is derived from them plus `damaged_qty`
after the lines land — never client-supplied — which is what §19's
"Create Discrepancy Report" triggers on.

**Inspection and Discrepancy Report landed**
(`apps/api/src/inspections/`, `apps/api/src/discrepancy-reports/`).
Inspection (§20) is deliberately "basic inspection support... not a
specialized pharma/food QA system in V1": one flat record, per-line
packaging/seal condition and accept/reject, `overall_result` derived
(all accepted → `accepted`, none → `rejected`, a mix →
`partially_accepted`), inspector defaulted to the acting user. It is
the one Phase 4 record with **no document type** — `INSPECTION` is in
neither the metered feature catalogue nor `document-engine.md` §2's
list, so it is an internal record, not something a customer is handed;
it still gets an `INS/{fy}/{seq:6}` number, since numbering keys off its
own prefix table rather than the entitlement catalogue. Discrepancy
Report (§19) copies exactly a GRN's *discrepant* lines (short, excess,
or damaged), refuses a GRN with nothing wrong rather than producing an
empty report, can also be raised standalone for damage found later, and
records §19's two acknowledgements — warehouse side as the acting user,
driver side as a typed name, since a driver has no login.

**Put-away and Warehouse Receipt landed** (`apps/api/src/putaways/`,
`apps/api/src/warehouse-receipts/`), closing the phase. A put-away
(§21) requires an approved GRN, defaults each line's quantity to that
GRN line's accepted quantity, validates the chosen location belongs to
the GRN's own warehouse and is active, and allows one receipt line to
be split across several locations — but never more than was accepted.
`putaways.grn_id` is unique, so a second slip for the same GRN is a
409. Completion confirms every line and records who and when.
A warehouse receipt (§22) issues from an approved GRN, folds in the
put-away's confirmed locations when one exists, and freezes both
`customer_snapshot` and `lines` as jsonb at issue time — the same
"never changes retroactively" discipline as Quotation's own snapshot.
§22's labelling requirement is treated as the legal boundary it is:
the document is titled *Warehouse Receipt (Operational)* and carries a
disclaimer stating it is **not** a negotiable warehouse receipt, not a
document of title, and may not be pledged as security.

**Stock did not move in Phase 4**, deliberately: GRN `approve()` left
`stock_posted_at` null, `putaway_lines.stock_lot_id` stayed null,
`grn_items.batch_id` was never resolved, and GRN's `'reversed'` status
had no transition — a controlled reversal (§50) exists to undo a
posting, and there was no posting to undo. Each was commented as such
at the point where it would otherwise have been tempting to write a
stub. Phase 5 has since filled the first three; `'reversed'` is still
open (see below).

- Schema: `schema/30_inbound.sql`.
- Docs: `workflow-and-statuses.md` (GRN status machine, auto-fill chain
  Gate Entry→Inward→GRN), `document-engine.md` (six new document types).
- Deliverable: the inbound half of the §68 lifecycle works manually up to
  Warehouse Receipt — **stock does not move yet** (Phase 5 owns posting);
  GRN approval in this phase should insert stock only once the stock engine
  exists, so sequence Phase 4 and 5 tightly or build GRN approval's stock
  posting call as a stub until Phase 5 lands.

## Phase 5 — Stock Engine, Ledger, Customer Stock, Ageing, Verification, Transfer

**Status: complete** (`apps/api/src/stock/`, `stock-transfers/`,
`stock-verifications/`, `stock-adjustments/`, `reports/`).

`StockService` is the only thing in the codebase that writes a stock
balance, which is what makes stock-engine.md §1 ("`stock_lots` is a
materialised view maintained only by the stock service") structurally
true instead of a convention. Every posting goes through one method,
inside the caller's own transaction, so the `stock_ledger` rows and the
`stock_lots` balances they imply commit together or not at all (§70).
The ledger row's `balance_physical_qty` is read back from the upsert
rather than computed in application memory, so it is the balance the
database actually holds. `stock.allow_negative` (§61) is honoured as
the per-tenant escape hatch it is documented to be — off unless a
tenant turns it on.

**Building on the schema found a real bug in it.** `stock_lots`'
seven-column unique constraint has three nullable columns, and SQL
treats every NULL as distinct, so the constraint enforced nothing for
the commonest lot there is: unallocated, non-batch-tracked,
non-serial-tracked stock. Left alone, every posting would have inserted
a *new* lot instead of adding to the existing one and "current stock"
would have fragmented silently. Verified against the live database,
then fixed additively in `schema/96_stock_lots_balance_key.sql` — the
same class of gap as 85's five, one level deeper. See `DECISIONS.md`
§31.

**GRN approval posts stock** (§18). Approval writes one `INWARD` ledger
row per accepted quantity and stamps `stock_posted_at`, in the same
transaction as the status change. Stock lands **unallocated**
(`location_id` null, which 40_stock.sql defines as exactly that): a GRN
records what arrived, not where it was shelved. Batches are resolved
or created at this moment, filling `grn_items.batch_id`, with
`first_received_at` stamped once from the first GRN and never moved —
ageing (§26) is computed from it, so a later receipt into the same
batch must not make the stock look younger. A serial-tracked product
posts **one lot per serial** of one unit each, because
`stock_lots.serial_no` is part of the lot key and §67's "which unit is
where" has to be answerable.

**Put-away completion relocates it** (§20). Each line becomes a
`TRANSFER_OUT` from the unallocated lot and a `TRANSFER_IN` at the bin
— two rows, per §7, never a mutation of one row's `location_id` — and
the destination lot's id is written back to
`putaway_lines.stock_lot_id`. For serial-tracked goods the specific
serials are chosen server-side, oldest unallocated first, since a
put-away line carries only a quantity and both halves of a transfer
have to name the same lots.

**Read side:** `GET /stock` (current balances, empty lots hidden unless
asked for) and `GET /stock/ledger` (the movement log, filterable by
source document so one GRN's whole stock footprint is one query, per
§67). Both are read-only by design: there is no endpoint anywhere that
writes a balance.

**Stock Transfer landed** (`apps/api/src/stock-transfers/`), §28's
Stock Transfer Note, and with it §79's "transfer between bins/warehouses"
and "prevent negative stock" cases. `transferKind` decides *when* the two
ledger rows are written, which is the whole design of the slice: a
bin-to-bin move posts both at completion (there is no journey), while a
warehouse-to-warehouse move posts the `TRANSFER_OUT` when the truck
leaves and the `TRANSFER_IN` when it arrives — so while the goods are on
the road they are in **neither** warehouse's balance, because that is
where they physically are. `DECISIONS.md` §37 records why an in-transit
holding row was rejected. An `in_transit` transfer cannot be cancelled
(the departure is already in the ledger; §3.5's reversal is additive),
and a line with no destination bin lands unallocated at the far end
exactly as a receipt awaiting put-away does. The Stock Transfer Note is
the **ninth** registered document template.

**Physical Verification and Stock Adjustment landed**
(`apps/api/src/stock-verifications/`, `apps/api/src/stock-adjustments/`),
§27 in full with §50's approval chain. A verification builds its own
count sheet from `stock_lots` — the caller does not supply lines, because
a count whose subject the counter chooses is not a count — freezes
`system_qty`, accepts a physical count per line, and **posts no stock at
all**: finding 8 where the system says 10 records a disagreement, it does
not correct one. Correcting it is a Stock Adjustment, which copies only
the discrepant lines, requires a reason, and walks `draft →
pending_manager → [pending_owner] → approved → posted` — the Owner step
present only when `approvals.stock_adjustment.owner_required` is set.
`approve_stock_adjustment_final` is Owner-only; not even Admin holds it.

Posting is a **separate act** from approval, and `DECISIONS.md` §38
records why: a posting can fail on its own merits (a write-off larger
than the shelf holds), and collapsing the two would let that failure roll
back a decision two people already made. The count sheet document — the
tenth registered template — renders blank before the count and filled in
after, hiding the system quantity on the blank form so the counter is
counting rather than confirming.

**Reports and reversal landed, closing the phase**
(`apps/api/src/reports/`). `GET /reports/stock-statement` (§25) is
`stock_lots` for the customer live, and for a past `asOf` date is rebuilt
from the ledger's stored running balances in one `distinct on` — which is
what those columns were kept for. `GET /reports/ageing` (§26) buckets by
`stock.ageing_buckets` at query time over `batches.first_received_at`,
with non-batch stock aged from its earliest receipt as a stated FIFO
assumption (`DECISIONS.md` §39). The Customer Stock Statement is the
**eleventh** document template, keyed on the customer as its source
record so reissuing is a new version of the same thing. GRN reversal
(`POST /grns/:id/reverse`, `approve_grn`) is §3.5's additive reversal:
offsetting `INWARD` rows with `reversal_of_id`, refused while a warehouse
receipt is issued or once a put-away has moved the stock — the latter
because the unallocated lot is shared across receipts, so "would it go
negative" is the wrong question (§39). The inward returns to `'received'`
so a corrected GRN can be raised.

- Exit check met: receive 100 → stock 100; transfer between bins and
  warehouses; prevent negative stock — all proven through real documents
  in `stock.spec.ts`, `stock-transfers.spec.ts`, and
  `stock-verifications.spec.ts`.

- Schema: `schema/40_stock.sql`.
- Docs: `stock-engine.md` in full.
- Deliverable: GRN approval (Phase 4) now posts real `stock_ledger` rows;
  Customer Stock Statement, Stock Ledger view, and Ageing report are
  queryable; Stock Transfer and Stock Verification/Adjustment work with
  approval chains.
- Exit check: the §79 quantitative test cases (receive 100 → stock 100,
  transfer between bins/warehouses, prevent negative stock) pass.

## Phase 6 — Release Order, Reservation, Pick, Pack, Dispatch, Loading, Gate Pass, POD

**Status: Release Order and Pick List landed** (`apps/api/src/release-orders/`,
`pick-lists/`). Reservation is where the allocation policy actually runs
— `stock_lots.reserved_qty` is per lot, so reserving means choosing lots
(`DECISIONS.md` §40) — with FIFO/LIFO/FEFO from `stock.allocation_policy`
or the request, or explicit `manual` lot allocations. Only shelved lots
are eligible, the reservation is all or nothing with both the shelved
and unallocated figures in the refusal, and the pick list is generated
from the `RESERVE` ledger rows and records the policy used. Picks are
capped at the reservation, roll up to `partially_picked`/`picked`, and
cancellation before dispatch mirrors every `RESERVE` with an `UNRESERVE`.
§79's "reserve 20 → available 40" and "cancel reservation restores
available" are asserted in `release-orders.spec.ts`; the Release Order
and Pick List are the twelfth and thirteenth templates.

**Packing List, Dispatch, Loading Sheet, Gate Pass and POD landed**
(`apps/api/src/outbound/`). `OUTWARD` has exactly one writer, fired
from gate-out or -- for a tenant whose `workflow.outward_posting_point`
is `dispatch` -- from dispatch confirmation, keyed per dispatch so the
second trigger posts nothing (`DECISIONS.md` §41). Each dispatch line
draws against the order's own `RESERVE` rows, taking physical stock and
releasing the reservation in the same ledger row. Dispatch above what
is picked and not already on a note is refused at creation; a loading
sheet freezes the note's lines; the POD derives its status from what
the consignee signed for and moves no stock. §79's "dispatch 40 → stock
60" and "prevent dispatch above available" are asserted in
`outbound.spec.ts`, under both posting points; five more templates
(fourteenth to eighteenth).

**Returns landed** (`apps/api/src/returns/`), which closes the phase:
Return Request (held to what the original dispatch carried, less what
earlier requests already claim; approval rides `approve_grn`), Return
Inward (the arrival and inspection gate, one open per request), and the
goods re-entering through the ordinary GRN with `returnInwardId` --
defaults from the return, `RETURN` rows on approval, the same reversal
handing the arrival back to `inspected` (`DECISIONS.md` §42). The
Return Inward note is the nineteenth template. Every transaction type
in `stock-engine.md` §2 now has a writer.

**Status: complete.**

- Schema: `schema/50_outbound.sql`.
- Docs: `stock-engine.md` §2/§6 (reservation + allocation policy),
  `workflow-and-statuses.md` (Release Order status machine).
- Deliverable: full outbound chain; gate-out posts the `OUTWARD` ledger
  transaction exactly once (idempotency per `stock-engine.md` §4).
- Exit check: §79 cases "dispatch 40 → stock 60", "reserve 20 → available
  40", "cancel reservation restores available", "prevent dispatch above
  available."

## Phase 7 — Storage Charges, Handling Charges, Invoice, Debit/Credit, Payment, Statement

**Status: billing runs and invoices landed** (`apps/api/src/invoicing/`).
The run rebuilds storage day by day from `stock_ledger` (free days
against each key's first inward, the whole daily series kept for the
preview), adds handling charges from the operational *completions* that
happened in the period, accepts explicit manual lines, and refuses to be
invoiced while any stock it found has no rate at any level. The invoice
freezes both party snapshots, decides CGST+SGST versus IGST once from
the two state codes, rounds to whole rupees into `round_off`, and walks
draft → pending approval → approved → issued with approval above the
Billing Executive. A run is invoiced once; cancelling a draft invoice
hands it back (`DECISIONS.md` §43). The Tax Invoice is the twentieth
template. Credit/debit notes, payments and the customer statement
follow.

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
