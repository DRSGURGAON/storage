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
tracked migrations — now including `85_integrity_fixes.sql` and everything from
`90_row_level_security.sql` through `97_payment_idempotency.sql` — **nine**
fixes found only by building and load-testing real code against the schema,
not by review (`schema/README.md` indexes them; `DECISIONS.md` §16–§22,
§25, §31 and §44 record what each closed).
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
  created with an `active` `tenant_subscriptions` row on the seeded `FREE`
  plan (`active`, not `trial` — see the status note above); `checkEntitlement`/`consumeEntitlement` are implemented and unit
  tested against the seed data even though no document-generating module
  exists yet to call them.
- Exit check: two tenants' users cannot see each other's `tenants` row or
  any tenant-scoped table via the API, verified by an automated test (see
  `test-plan.md` "Customer A cannot access Customer B", generalised to staff
  users too). **Done** for the tenancy/RLS mechanism itself —
  `apps/api/src/db/tenant-isolation.spec.ts` proves it directly against a
  real database, and — since Phase 2 — `apps/api/src/customers/customers.spec.ts`
  and every later suite prove the same thing through HTTP, on real
  endpoints. **Also done**
  for the entitlement engine — `apps/api/src/entitlement/entitlement.spec.ts`
  proves `allowed: true` for the first two `GRN_GENERATION` consumptions and
  `allowed: false, reason: 'LIMIT_REACHED'` on the third, plus idempotent
  retries, a genuine concurrent race (5 simultaneous calls against a
  2-copy limit, exactly 2 win), cross-tenant/cross-feature independence,
  the fail-closed default for an unconfigured feature, and
  `recordFailedAttempt` never touching the counter — all against the real
  database, before any document-generating module exists to call it.

## Phase 2 — Customer, Warehouse, Location, Product/SKU, Transporter, Vehicle, Driver, Rate Card

**Status: complete.** Customer master landed (`apps/api/src/customers/`): create /
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
exists for either sub-resource. KYC documents live in the
`attachments` table with `owner_type = 'customer'`, per the schema's own
comment — built in Phase 12a, and reachable from the customer screen.
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
  `workflow-and-statuses.md` §1 (the auto-fill contract). Built, but not as
  the `resolve{Entity}()` endpoints that document imagined: auto-fill runs
  **server-side inside the create endpoints** that need it (posting an
  Inward with a `gateEntryId` returns it with customer, vehicle, driver and
  transporter already filled from the gate entry). A separate resolve call
  would let a client fill a form from one snapshot and post a different one;
  doing it in the writer means the values that land in the row are the
  values the server read.
- Deliverable: full CRUD + searchable selector (§74) for every master; rate
  card resolution (`billing-engine.md` §3) implemented and unit-tested even
  though nothing bills yet. Also build the onboarding wizard here
  (`ux-system.md` §1) — it is nothing more than these same master-record
  create endpoints called in a guided sequence, so it should ship alongside
  them rather than as separate later work.

## Phase 3 — Quotation, Agreement, Document Engine

**Status: complete.** Quotation record landed (`apps/api/src/quotations/`):
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

**Status: complete.** Gate Entry record landed (`apps/api/src/gate-entries/`):
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
stub. Phase 5 has since filled all four: `POST /grns/:id/reverse` posts
one offsetting ledger row per original and sets `status = 'reversed'`
(`grns.service.ts`, `DECISIONS.md` §39), covered in `grns.spec.ts` and
again in `acceptance.spec.ts`, where the reversal is asserted to net a
receipt back to the exact pre-GRN balance.

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

**Status: complete.** Release Order and Pick List landed (`apps/api/src/release-orders/`,
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

- Schema: `schema/50_outbound.sql`.
- Docs: `stock-engine.md` §2/§6 (reservation + allocation policy),
  `workflow-and-statuses.md` (Release Order status machine).
- Deliverable: full outbound chain; gate-out posts the `OUTWARD` ledger
  transaction exactly once (idempotency per `stock-engine.md` §4).
- Exit check: §79 cases "dispatch 40 → stock 60", "reserve 20 → available
  40", "cancel reservation restores available", "prevent dispatch above
  available."

## Phase 7 — Storage Charges, Handling Charges, Invoice, Debit/Credit, Payment, Statement

**Status: complete.** Billing runs and invoices landed (`apps/api/src/invoicing/`).
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
template.

**Credit/debit notes, payments and the statement landed**
(`apps/api/src/receivables/`), which closes the phase. Notes are the only
way to correct an issued invoice and change no column on it; payments
carry a client idempotency token backed by a unique index
(`schema/97_payment_idempotency.sql`) and recompute `amount_paid` as a
fresh sum after every allocation or reversal; the Customer Statement is
the projection that nets all three, with an ageing breakdown; and the
overdue flip is a nightly per-tenant job (`DECISIONS.md` §44). Four more
templates (Credit Note, Debit Note, Payment Receipt, Customer
Statement) complete the §46/§76 list of twenty-four.

- Schema: `schema/60_billing.sql`.
- Docs: `billing-engine.md` in full.
- Deliverable: Billing Run preview → Invoice → Payment → Customer Statement,
  driven entirely by Phase 4–6's operational data plus Phase 2's rate cards.
- Exit check: §79 "invoice payment correctly reduces outstanding," "prevent
  duplicate invoice posting."

## Phase 8 — Customer Portal, Reports, Notifications, Audit, QR Verification

**Status: complete.** The customer portal landed (`apps/api/src/portal/`). A portal
login is an ordinary `tenant_users` row with `role = customer` and a
mandatory `customer_id`; `PortalGuard` re-reads that membership on every
request, and `PortalService` hard-codes the customer filter into every
query rather than passing one around. The portal shows the customer their
own stock, goods receipts, dispatches with delivery status, release
orders, invoices, account statement and documents (with the download
re-checking ownership at issue time), and lets them raise a return
request against a dispatch they actually received. The staff API is
closed to portal sessions by the permission matrix and the portal to
staff by its guard — the two halves are independent.

**The console surfaces landed too** (`apps/api/src/console/`,
`notifications/`): the dashboard composed from the engines' own queries
with the money tiles absent (not zeroed) for a role that cannot see
money; global search as one ranked SQL union across customers, SKUs,
vehicles, GRNs, dispatches, gate passes, PODs, invoices and document
numbers, each branch dropped when the caller lacks its permission;
in-app notifications driven by seeded `notification_rules` (who hears
about what is data, and the person who caused an event is never told
about it); the audit viewer behind `view_audit_log`; the Plan & Usage
page reading the same `checkEntitlement` a paywall uses; and a public
pricing page pivoted from `plan_feature_limits` so it cannot drift from
what is enforced. The Document Centre gained the filters and pagination
§5 asks for, replacing an unbounded full-table read. A demo workspace is
seeded by `npm run seed:demo`, which drives the real services rather than
inserting rows (`DECISIONS.md` §46).

Still open at the end of this phase were three items, all noted in their
own documents rather than silently skipped: the portal-specific RLS policy
(`app.customer_id` / `app.actor_kind`), signed time-limited document URLs,
and the email/WhatsApp/SMS notification adapters. Phase 10 closes them.

**Status: complete.**

- Schema: `notification_rules`/`notifications`, `audit_logs`,
  `approval_chain_templates`/`approval_instances`/`approval_steps` from
  `schema/70_documents_governance.sql` (audit logging is wired in from Phase
  1 onward, as an explicit `AuditService.record()` call inside each service's
  transaction — see "Cross-cutting" below; this phase adds only the *viewer*
  over it).
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

**Status: complete for everything that can be tested without a frontend.**
The suite is **33 files, 269 tests**, all green, all against a live
PostgreSQL database — no mocked repositories anywhere. `test-plan.md` now
carries a **Proven by** column naming the file and the test behind every
§78 step and every §79 row, so a claim in that document can be checked
against a test rather than taken on trust.

Three things landed in this phase:

- **`apps/api/src/acceptance/acceptance.spec.ts`** — §78's scenario walked
  once, end to end, through HTTP: gate entry → inward → GRN (Operator
  raises, is refused the approval, Manager signs off) → put-away →
  warehouse receipt → release order → reserve → pick → dispatch → loading
  → gate pass → gate-out → POD → billing run → invoice → payment →
  statement → documents → audit trail, with the stock balance asserted
  after every step that moves it. Plus the §79 rows no single module owns:
  a snapshot outliving a master-data change, two warehouses and two batches
  of one SKU staying separate, and a cancelled receipt netting back to the
  exact pre-GRN balance.
- **A fresh-database proof.** `warehouse_fresh` was created from nothing,
  all eighteen schema files applied through `migrate.ts`, both seeds run,
  and the full suite passed against it. The migration path is not something
  that only works on the database it grew up on.
- **A documentation reconciliation.** Every architecture document was
  audited against the code, and roughly forty stale or false claims were
  corrected — including this file's own phase headings, which still read
  "Customer master landed" for phases that had been finished for weeks.
  Where a documented mechanism was never built (`getDocumentRelations`,
  `resolve{Entity}()` endpoints, signed URLs, `nearest_location`
  allocation, `tenants.is_demo` enforcement), it is now marked unbuilt in
  the document that specifies it, rather than left to be discovered from
  the absence of a route.

What Phase 9's original scope does **not** cover, and why: mobile
responsiveness (§64) and every screen-level check need a frontend, and
`apps/` contains only `api`. Fault injection and load testing are also
absent — concurrency is tested where it decides correctness (numbering and
entitlement both run genuine parallel races), but nothing kills a process
mid-transaction. `test-plan.md` §5 lists the full set of gaps.

- No new schema.
- Docs: `test-plan.md` — execute it in full: the §78 end-to-end acceptance
  scenario, the §79 critical test-case list, plus security/permission testing
  (`tenancy-and-security.md`), PDF correctness (`document-engine.md` §3–§4),
  stock and billing reconciliation, and mobile responsiveness (§64).

## Phase 10 — Closing the open items

Phase 8 ended with three named gaps and Phase 9's audit found two more.
This phase closes them; it exists because "named in a document" is not the
same as fixed.

**Status: complete.** 35 suites, 281 tests, re-proved against a database
built from nothing: all twenty schema files applied in order, both seeds
run, and the whole suite green against it.

**a. The portal's database-level isolation.**
`schema/98_portal_row_level_security.sql` adds a **restrictive** policy,
`portal_customer_isolation`, to every table with a `customer_id` and to
`customers` (on its `id`). `withPortalTenant()` sets `app.actor_kind =
'customer'` and `app.customer_id` for the transaction, and the policy
narrows every read and write to that customer.

Restrictive, not permissive, is the whole point: ordinary policies are
OR-ed together, so a second permissive policy would have *widened* access
while looking like it worked — the portal's own tests would still have
passed. A restrictive policy is AND-ed with `tenant_isolation`, which is
the semantics needed: that tenant's rows, and additionally that customer's.
Staff requests never set `app.actor_kind`, so the added clause is trivially
true for them and nothing else in the application changes.

Three tables get a deliberate exception: `products`, `rate_cards` and
`suppliers` carry a nullable `customer_id` where NULL means "shared across
this tenant's customers", and those rows stay visible — otherwise the
portal's own stock list could not name the product it is holding.
Everywhere else NULL means "not this customer's" and is refused.

`portal.spec.ts` proves it the only way worth proving: by running the
queries *without* their `customer_id` filter — the mistake the service is
one typo away from — and asserting the rows come back narrowed anyway,
including a write claiming another customer being refused by `WITH CHECK`.

**b. Signed, time-limited document links.**
`POST /documents/:id/download-link` (and `POST
/portal/documents/:id/download-link`) mints
`/document-links/<payload>.<signature>`: HMAC-SHA256 over claims naming one
document, its tenant, an optional customer, and an expiry. The public
consumer checks the signature in constant time, refuses an expired link
with a message that says *expired* rather than *invalid*, and re-reads the
document under the claims' tenant and customer. See
`tenancy-and-security.md` §5 for the design and for the trade it accepts —
a minted link cannot be revoked before it expires, which is why the default
life is five minutes.

**c. Document relationships.** `GET /documents/relations/{sourceType}/{sourceId}`
(`apps/api/src/documents/document-relations.service.ts`) returns the
record, its "Created From", its "Related Documents", its own generated
copies, and the §68 chain around it. The graph is read out of
`information_schema` at first use — a record is a table with a `number`
column, an edge is a foreign key between two of them — so it cannot drift
from the schema the way a hand-written edge list would.

The one hop that is not a foreign key is the interesting one: no Release
Order references the GRN its goods arrived on, so the FK graph is two
components, inbound and outbound. The chain bridges them through
`stock_ledger` — same customer, warehouse, product and batch — and labels
that hop `via: 'stock_ledger'`, because "the same goods" is a different
claim from "the same paperwork". `document-engine.md` §8 has the full
design and its limitations.

**d. Notification delivery.** Blueprint §56 lists four channels and V1
delivered one. The other three were never a design problem —
`notification_rules.channels` already said which to use and
`notifications.channel` already recorded which was tried — they were an
integration problem: nothing knew how to hand a message to an SMTP server.

- `EmailChannel` is real SMTP through `nodemailer`, configured with one
  connection string (`SMTP_URL`), because one URL is what a provider
  actually gives you and splitting it into five variables only creates five
  ways to get it half-right.
- `WhatsappChannel`/`SmsChannel` POST a documented JSON envelope to a
  configured endpoint. Provider-agnostic on purpose: no provider is chosen
  (`DECISIONS.md` §13), every candidate in this market takes an HTTPS POST
  with a destination and a text, and hard-coding one of their field
  shapes now would be guessing.
- `NotificationDispatcherService` owns everything the channels do not:
  who to send to, when, how often, what to record. `emitWithin` still runs
  in the caller's transaction and writes `pending` for the non-in-app
  channels; the worker drains them after the commit. Network I/O inside a
  database transaction holds a connection open for the length of someone
  else's outage, and a send that succeeds inside a transaction that then
  rolls back cannot be taken back.
- `schema/99_notification_delivery.sql` adds `attempt_count`, `last_error`
  and `sent_at`. `delivery_status = 'failed'` with no reason attached is a
  column that looks like observability and provides none; `attempt_count`
  is also what makes the retry loop terminate.

An unconfigured channel leaves its rows **pending, visibly** rather than
marking them sent — a deployment with no SMTP server is the normal case in
development and a real one in production, and the one thing a delivery
worker must never do is claim it delivered something.

The tests send over a real SMTP session (a socket server that speaks enough
of RFC 5321 to accept a message) and a real HTTP POST, then assert the
retry, the give-up, the recorded provider error, and that draining one
tenant never sends another's.

**e. `tenants.is_demo`, which was written by the demo seed and read by
nothing.** A demo workspace produced Tax Invoices indistinguishable from
real ones: real-looking number, real-looking GSTIN, a QR code that
verifies, and nothing on their face saying otherwise. Every document a
demo workspace generates now carries a `DEMO / SAMPLE — not a valid
commercial document` banner and a diagonal watermark. Two markings rather
than one, because either alone survives a bad photocopy or a screenshot
cropped to the header.

The marking lives in `renderDocumentShell`, so all twenty-four templates
get it without any of them knowing about it — the only way a rule like this
can be relied on. The flag also travels on `GET /auth/me` and `GET
/company`, read-only, so the UI can label its screens
(`entitlement-engine.md` §10); a workspace cannot declare itself a demo or
stop being one.

What is deliberately *not* done: excluding demo tenants from billing runs
and cross-tenant analytics. A demo's billing run is part of what a prospect
is being shown, and there is no cross-tenant analytics surface in the
codebase to exclude anything from. When one is built, this is where the
exclusion belongs.

## Phase 11 — The frontend

`v1-scope-specification.md` §10 listed "no frontend exists" as the
remaining P0 launch blocker from the scope freeze onward. `apps/web`
closes it: React 18 + TypeScript on Vite, Ant Design, TanStack Query,
React Router — `DECISIONS.md` §0's choices, unchanged.

**What is built**: sign-in and workspace signup; the role-filtered shell;
the dashboard; the setup checklist; every master (customers with addresses
and contacts, warehouses with their location tree, products, transport,
rate cards with priced lines); the inbound chain (gate entry → inward →
GRN → put-away → warehouse receipt) with its status actions; stock on
hand, the ledger and ageing; the outbound chain (release order → reserve →
pick → dispatch → gate pass → gate-out → POD); billing runs, invoices,
payments and statements; quotations and agreements; stock transfers and
verifications; returns; the Document Centre with the relationship graph;
notifications; company, users, plan-and-usage and audit settings; and the
customer portal, which a `customer` login lands in instead of the staff
app.

**Three principles the code holds to.**

1. *The session is read, not decoded.* `GET /auth/me` returns the caller's
   live permission codes and the app reads its session from there. The
   JWT's claims are the same data and one fetch cheaper, but they are a
   snapshot from login: the API re-resolves grants per request, so a role
   change bites the server immediately and a UI drawn from stale claims
   would keep offering actions that no longer exist.
2. *`can(permission)` decides what to offer, never what to allow.* The
   navigation, the buttons and the status actions are filtered by the
   caller's grants and the record's status — mirroring
   `@RequirePermission` and each service's `allowedFrom` — and the API
   applies both again. Where the two disagree, the server is right.
3. *The API's own message reaches the screen.* `ApiError` carries it
   through. The API says specific, useful things ("A workspace must keep at
   least one active Owner", "Only 30 of that product is available to return
   on this dispatch"), and replacing those with "Something went wrong"
   throws away the most valuable thing the client was handed.

**Verified by using it**, not only by building it: the whole inbound chain
driven in a browser against a from-nothing database (gate entry → inward →
receive → GRN → submit → check → approve, stock posted), then the whole
outbound chain (release order → approve → reserve → pick → confirm →
complete → dispatch → gate pass → gate-out), with the stock screen showing
the balance fall and the reservation release afterwards.

That is also how the one API bug of this phase was found: `POST /inwards`
required a `warehouseId` it could have taken from the gate entry, and never
checked the two agreed (`DECISIONS.md` §47).

**Phase 11g** closed the two things this list used to name. §64's mobile
check was run for real, at 390×844 in a browser, across the operator
screens, the settings screens and a create drawer; it found three defects,
all fixed and re-verified: below `lg` there was *no way to open the
navigation at all* (there is now a hamburger and a drawer), the list tables
pushed the page sideways (they scroll inside their card), and the login
card's fixed 440px and the form drawers' fixed 520–720px were both wider
than the screen (both are capped now). Every screen checked reports
`scrollWidth == clientWidth == 390`.

And notification rules became editable: `GET /notification-rules` and
`PUT /notification-rules/:code`, behind `manage_company_settings`, with
Settings → Notifications over them. Building it turned up two more real
defects — a tenant could have written a `tenant_id is null` rule that
applied to *every* workspace on the platform (`schema/99a`), and
deactivating a rule fell through to the still-active system default, so
switching an event off switched it back on (`DECISIONS.md` §48).

**Still not built at the close of Phase 11**, and named rather than
implied: a full reports library beyond the stock statement and ageing
(Phase 13 takes it up), and the Agreement wizard's eleven separate steps
(Phase 14).

## Phase 12 — the things a warehouse actually holds in its hands

**a. Attachments: uploads, photographs and a signature.** The
`attachments` table, the `AttachmentStorage` seam and the columns that
point at a signature all existed from Phase 1, and the only thing that
ever wrote them was the document engine storing its own PDFs. So blueprint
§21's damage photos, §36's POD signature and §9's customer KYC pack were
columns with no way to fill them —
`DiscrepancyReportsService`'s own header said so out loud.

`POST /attachments` (multipart), `GET /attachments?ownerType=&ownerId=`,
`GET /attachments/:id/file` and `DELETE /attachments/:id` close that.
Three decisions worth naming, all in `DECISIONS.md` §49: the permission
comes from *what the file is attached to* rather than from a route
decorator; `attachment-owners.ts` is simultaneously that mapping and the
whitelist that stops a polymorphic `owner_id` from pointing anywhere; and
a category that the owner row points back at (a POD's signature, the
company logo) writes the column on upload and clears it on delete.

On the web: an `Attachments` card on the GRN, gate entry, customer and POD
screens, whose upload control carries `capture="environment"` so a phone
opens the camera; a signature pad that draws on a canvas with pointer
events and saves a PNG; and a **POD screen**, which the dispatch screen
had been linking to since Phase 11d without one existing.

Using it found two more defects, both fixed here. Any failure of
`GET /auth/me` — a 500, an offline moment, a request the browser aborted
mid-navigation — discarded the token and forced a fresh login; only a 401
means the token is actually bad, and the app now says "cannot reach the
server" and offers to retry instead. And the §64 phone pass had covered
the *list* screens but not the *detail* screens: their three-column
`Descriptions` and their line tables both pushed the page sideways, and a
Card header at 390px squeezed the record number out of existence entirely.
All seventeen screens now measure `scrollWidth == clientWidth == 390`.

**b. The letterhead.** With those three columns finally fillable, the
document engine prints them: the logo in the header band, the signature
and stamp above the ruled line, and — through
`DocumentTemplateData.imageAttachmentIds` — the receiver's own signature
on a POD and the driver's on a discrepancy acknowledgement.
`document-engine.md` §3 carries the design; `DECISIONS.md` §51 carries the
two things looking at an actual PDF taught: images must be `data:` URIs
because the renderer has no session, and a signature and a seal must sit
side by side rather than overlap, because both are photographs on white
paper and the second would simply erase the first.

**c. The letterhead, reachable.** A Letterhead card on Settings → Company,
over the same `Attachments` component the GRN and POD screens use. Two
small things came with it: `GET /auth/me` now returns the workspace's own
`tenant.id`, because `POST /attachments` addresses the workspace as a
record and the client had no way to name it; and `GET /attachments` marks
which file the record actually points at (`isLinked`), because uploading a
second logo does not delete the first and a list showing two logos as
equals says nothing about which one prints.

## Phase 13 — the reports library (§55)

Blueprint §55 lists twenty-three reports in four groups, and the
application had two of them. The rest were not missing code so much as
missing a *shape*: twenty-three controller methods, each with its own
filters, its own response and its own export, is how a reports section
becomes twenty-three slightly different things.

**a. The framework, and the Operations and Documents groups.** A report is
a definition object (`report-definition.ts`): a code, a group, the
permission it needs, which filters it accepts, its columns, and a `run`
that returns rows. `GET /reports/catalogue` lists the ones the caller can
actually run — filtered by their own grants, so the screen offers nothing
the API would refuse. `GET /reports/run/:code` runs one and returns
columns, rows, the totals of the columns that declare themselves summable,
and the filters *as applied* (an open date range means the last thirty
days, and the response says so rather than leaving the client to guess).
`GET /reports/run/:code/csv` is the same rows and the same columns as
text, behind `export_reports` rather than `view_reports` — taking a report
out of the building is its own decision.

Nine reports so far: daily inward, daily outward, and the gate entry, GRN
and dispatch registers; plus the document register, pending POD, pending
approvals and agreement expiry. Three of those four are *exception*
reports — they exist to be empty, and a row on one is a delivery nobody
closed out or a contract about to lapse unnoticed.

One screen serves all of them (`apps/web/src/screens/Reports.tsx`), built
from the catalogue: adding a report to the backend makes it appear in the
UI, with its filters and its column types, with no frontend change.

**b. The Stock and Billing groups — §55 complete.** Fourteen more, and the
catalogue now answers with exactly the twenty-three §55 lists: five
operations, eight stock, six billing, four documents.

The stock eight read `stock_lots` and `stock_ledger` and nothing else.
Stock movement is the one worth naming: opening / in / out / closing per
product, where *opening* is the `balance_physical_qty` the engine wrote on
the last movement before the window rather than a sum from the beginning
of time — the running-balance columns exist precisely so a period can be
opened without a replay. Ageing reads the workspace's own
`stock.ageing_buckets` setting, so the bands here and on the ageing screen
are the same bands.

The billing six read what the billing engine computed
(`billing_run_lines`), never a re-derivation from stock-days and handling
events: a report that arrived at a different number than the invoice would
be a second opinion about somebody's bill. Two judgements are recorded in
the definitions themselves. The **invoice register** lists cancelled
invoices — it is the numbering record, and a missing number is the thing
an auditor asks about. The **collection** report excludes cancelled
receipts — a cancelled receipt is money that was not collected, and
counting it would overstate the day. `receivables.spec.ts` checks the
billing reports against the customer statement's own totals, which is how
the difference between *outstanding* (unpaid invoice balances) and
*closing balance* (the whole account, including an unapplied credit note)
stopped being a bug and became a documented distinction.

## Phase 14 — the Agreement wizard (§15)

Blueprint §15 lists eleven wizard steps by name. What existed was
`agreements.wizard_data`: a jsonb column the API accepted any shape into,
nothing that said what a complete agreement was, and a template that could
not print an answer because no answer had a name. The clauses said "as
mutually agreed between the parties" where a figure belonged.

The eleven steps are now declared once, as data
(`agreements/agreement-wizard.ts`) — id, title, help, the fields each
collects, which are required, and which masters pre-fill it. Everything
else reads that one definition:

- `GET /agreements/wizard` serves it, so the screen draws itself and
  cannot offer a field the API would refuse.
- A step or field nobody declared is **refused**. jsonb would have stored
  either happily and never read it — an operator would fill something in,
  watch it save, and find it missing from the printed agreement.
- `PATCH` merges **one step at a time**. The wizard saves as you go, and a
  whole-object replace would take the other ten steps with it.
- The record carries `wizardSteps`: per step, complete or not, and what is
  missing. That is what the screen shows and what
  **submit-for-approval refuses on** — a draft may be half-filled, because
  that is what a wizard is for, but an agreement approved with no
  termination clause and no signatories is a piece of paper that helps
  nobody.
- The system template grew from seven clauses to eleven, one per step,
  with `{{wizard.<step>.<field>}}` tokens. A `select` is stored as its
  machine value and printed as words — `per_pallet_per_day` becomes "per
  pallet per day" — because a stored answer should be stable and a
  printed one should be readable.

The screen is a vertical eleven-step form on the agreement itself, each
step saving on its own, with what is outstanding beside every step name.

Two things this fixed on the way: the agreements screen was reading
`effectiveFrom`/`effectiveTo` and `clauses[].renderedClause`, none of
which the API has ever returned (so the dates were blank and the clauses
never rendered), and its "Activate" button called an action the API does
not have — it is `sign`.

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
