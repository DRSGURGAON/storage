# API — Warehouse Documentation & Operations SaaS

Backend for the product specified in `../../docs/`. So far: project
scaffolding, tenant/user auth with JWT, row-level tenant isolation, the
seeded RBAC role/permission catalog, a fully working entitlement/
subscription engine (2-free-copies enforcement, seeded and tested), audit
logging on every mutating/security-relevant auth action, centralized
document numbering (`allocateNumber()`), RBAC enforcement
(`PermissionsGuard` + `@RequirePermission`), tenant memberships (add /
role / disable), every Phase 2 master — Customers (with addresses and
contacts), Warehouses and their location hierarchy, Product/SKU (with
UOMs and categories), the Transport master (Transporters, Vehicles,
Drivers), and Rate Cards (with Charge Types, Tax Rates, and the full
billing-engine.md §3 resolution priority) — and the onboarding wizard
status endpoint. Phases 2, 3 and 4 are complete: Quotation and Agreement
records, each with its own workflow; the whole inbound chain — Gate
Entry → Inward → GRN (with §50's Operator → Manager approval split) →
Inspection / Discrepancy Report → Put-away → Warehouse Receipt; and a
real document engine — server-rendered PDF generation (headless Chromium
via `puppeteer-core`), QR-code verification, versioning, and FREE-plan
entitlement gating — proven end-to-end against **eight** registered
templates: Quotation, Agreement, Gate Entry, Inward, GRN, Discrepancy
Report, Put-away Slip, and Warehouse Receipt.

Phase 5 is under way: the **stock engine** is built and wired into the
inbound chain. `StockService` is the only thing in the codebase that
writes a stock balance — GRN approval posts real `INWARD` ledger rows
and resolves batches, put-away completion relocates that stock as a
`TRANSFER_OUT`/`TRANSFER_IN` pair, and `GET /stock` / `GET /stock/ledger`
read it back. Stock Transfer, Physical Verification, Stock Adjustment,
the ageing report, and GRN reversal (`'reversed'` still has no
transition) are the rest of the phase; Outward and the billing-run
modules come after it.

## Stack

TypeScript, NestJS, PostgreSQL 16, Drizzle (`postgres-js` driver). See
`../../docs/architecture/DECISIONS.md` §0 for why.

## Setup

```bash
npm install                    # from the repo root (npm workspaces)
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env if your local Postgres differs from the default,
# and set a real JWT_SECRET (the example generates one for local dev only)

cd apps/api
npm run migrate                # applies ../../docs/architecture/schema/*.sql, in order
npm run seed                   # seeds roles/permissions, the feature catalog, and the FREE plan
npm run start:dev              # http://localhost:3000
```

## Where the schema comes from

`src/db/migrate.ts` reads and executes
`../../docs/architecture/schema/*.sql` directly — that directory is the
single source of truth for the data model (see its own `README.md` for
conventions). This app does not keep a second, duplicated copy of the
schema; adding a new domain means adding a file there, not here. Eight of
those files (`85`–`96`) are fixes for real bugs found only by building and
load-testing this app against the schema, not by review — see
`docs/architecture/DECISIONS.md` §16–§25 and §31 if you're wondering why
they exist. The most recent, `96_stock_lots_balance_key.sql`, is the
sharpest example: `stock_lots`' unique constraint has three nullable
columns, so it enforced nothing for the commonest lot in the system, and
every stock posting would have fragmented "current stock" into duplicate
rows with no error at all.

## Endpoints so far

- `GET /health` — DB connectivity check.
- `POST /auth/signup` — creates a tenant, its first user, and an Owner
  membership; returns a JWT.
- `POST /auth/login` — `{ email, password, tenantSlug? }`; `tenantSlug` is
  required only when the account belongs to more than one tenant.
- `GET /auth/me` — requires `Authorization: Bearer <token>`; returns the
  authenticated user's tenant/role, read through `withTenant()`
  (`src/db/tenant-context.ts`) so every response is proven, not assumed,
  to be RLS-scoped to the caller's own tenant.
- `POST /customers` (`create_customer`), `GET /customers?q=&limit=&offset=`
  and `GET /customers/:id` (`view_customer`), `PATCH /customers/:id`
  (`edit_customer`). Every route is behind `JwtAuthGuard` + `PermissionsGuard`;
  the permission codes are the seeded ones from `permissions-matrix.md`.
- `POST/GET/PATCH /customers/:id/addresses[/:addressId]` and
  `.../contacts[/:contactId]` — ride the same `view_customer`/
  `edit_customer` permissions (no separate code exists for either).
  `isDefault` (addresses, scoped per `kind`) and `isPrimary` (contacts,
  per customer) are service-enforced single-flag invariants: setting one
  clears any other of the same scope in the same transaction, since
  neither is a database constraint.
- `GET /users`, `POST /users`, `PATCH /users/:id` (`manage_users_and_roles`)
  — tenant memberships. Adding an email with no account yet requires an
  initial `password` (no email delivery until V1.1's notification engine);
  an existing account just gains a membership. Guards: you cannot change
  your own membership, and the last active Owner cannot be demoted or
  disabled. The `customer` role is rejected here — that's the portal
  (V1.1). `warehouseIds` restricts a Warehouse Manager/Operator to those
  warehouses, and is genuinely enforced: every operational read (gate
  entries, inwards, GRNs, inspections, discrepancy reports, put-aways,
  warehouse receipts, stock, ledger, and the warehouse list itself) is
  filtered to them, and a write naming a warehouse outside the set is a
  403. Reads narrow silently, writes refuse loudly — see
  `tenancy-and-security.md` §4 and `DECISIONS.md` §34. An empty array
  means unrestricted, not "locked out of everywhere".
- `POST/GET/PATCH /warehouses[/:id]` (`create_warehouse` / `view_warehouse`
  / `edit_warehouse`; `code` is immutable) and
  `POST/GET/PATCH /warehouses/:id/locations[/:locationId]` (locations use
  the warehouse permissions). `GET .../locations?level=&parentId=<id|root>&q=`.
  A location's level/segment/parent are immutable — they're baked into
  every descendant's `fullCode`.
- `GET/POST /uoms` and `GET/POST /product-categories` (both ride the
  product permissions — `permissions-matrix.md` has no separate row for
  either), `POST/GET/PATCH /products[/:id]` (`create_product` /
  `view_product` / `edit_product`). `GET /products?q=&customerId=&limit=&offset=`
  matches SKU/name/barcode; `customerId` accepts a real customer id, the
  literal `shared` (products with `customer_id is null`), or is omitted
  for no filter. `volume_cbm` is always server-computed from the product's
  dimensions and cannot be set directly.
- `POST/GET/PATCH /transporters[/:id]`, `POST/GET/PATCH /vehicles[/:id]`,
  `POST/GET/PATCH /drivers[/:id]` — one permission set for all three
  (`create`/`view`/`edit_transport_master`). `vehicleNumber` is normalised
  to uppercase with spaces stripped before storage and search, so `hr 26
  dk 1234` and `HR26DK1234` are the same vehicle. `GET /vehicles?transporterId=`
  and `GET /drivers?transporterId=` filter to one transporter's fleet;
  `transporterId` is optional on both (an owned fleet has no transporter).
- `GET/POST /charge-types` and `GET/POST /tax-rates` (both ride the rate
  card permissions). `list()` merges the system-seeded catalogue
  (`isSystem: true`) with a tenant's own additions, preferring the
  tenant's row when both share a code.
- `POST/GET/PATCH /rate-cards[/:id]` (`create`/`view`/`edit_rate_card`;
  `scope` is `customer`/`warehouse`/`company` with the matching id
  required — enforced as a 400 before it ever reaches the database's own
  check constraint) and `POST/GET/PATCH /rate-cards/:id/lines[/:lineId]`
  (rides the same rate-card permissions). `GET
  /rate-cards/resolve?customerId=&warehouseId=&chargeTypeCode=&productId=&categoryId=`
  runs billing-engine.md §3's resolution priority (customer > warehouse >
  company, product/category line override) and returns the winning line —
  a preview endpoint for the future rate-card UI, since nothing bills yet.
- `GET /onboarding/status` — no permission beyond a valid JWT (informational,
  RLS-scoped to the caller's tenant). Reports `done`/`count` for each
  wizard step (`company`/`warehouse`/`customer`/`products`/`rateCard`),
  derived live from each entity's row count rather than a stored flag, plus
  `nextStep` and `isComplete`. The `rateCard` step checks for at least one
  `rate_card_lines` row, not just a `rate_cards` row — an unpriced card
  isn't a complete step.
- `POST/GET/PATCH /quotations[/:id]` (`create`/`view`/`edit_quotation` —
  Owner/Admin only, per `permissions-matrix.md`; there is no `edit` once a
  quotation leaves `draft`) and the workflow actions
  `POST /quotations/:id/send`, `/accept`, `/reject` (body: `{ reason }`),
  `/cancel`. `customerSnapshot` is captured once at creation and never
  recomputed. `subtotal`/`taxTotal`/`grandTotal` are always server-computed
  from the line items, never accepted from the client.
- `GET /agreements/templates` and `POST/GET/PATCH /agreements[/:id]`
  (`create`/`view`/`edit_agreement`) plus workflow actions
  `POST /agreements/:id/submit`, `/approve` (`approve_agreement` —
  **Owner-only**, distinct from `edit_agreement`), `/sign`,
  `/terminate` (body: `{ reason }`), `/cancel`. Passing `quotationId`
  requires that quotation to be `accepted` and pre-fills
  `customerId`/`warehouseId` from it when the request omits them.
  `renderedClauses` are computed server-side from the resolved template's
  clauses with `{{dotted.path}}` tokens filled in from company/customer/
  warehouse/agreement data — never accepted from the client, and
  recomputed on every `draft` edit.
- `POST /quotations/:id/document/preview` (`view_quotation`) / `POST
  /agreements/:id/document/preview` (`view_agreement`) render and return
  a PDF without writing anything or consuming an entitlement unit.
  `POST /quotations/:id/document` (`create_quotation`) / `POST
  /agreements/:id/document` (`create_agreement`) — both take body
  `{ regenerate?: boolean }` — commit it: first call consumes one
  `QUOTATION_GENERATION`/`AGREEMENT_GENERATION` unit (independent FREE-plan
  budgets) and writes a `documents` row; a plain retry is an idempotent
  no-op returning the same row; `regenerate: true` creates a new version
  (old one's `isLatest` flips to `false`) without consuming another unit.
  Regeneration additionally requires `regenerate_document`, and
  `regenerate_after_approval` on top of that once the source record is past
  its provisional state (`regeneration-policy.ts` holds the per-type table,
  drawn from each module's own edit guard). Checked in the service rather
  than by a route decorator, because which code is needed depends on the
  request body and on the source's live status. A warehouse receipt has no
  provisional state at all — blueprint §22 makes it the one document that
  must never be quietly reissued.
  Blocked with `402 { paywall: true, ... }` once the FREE plan's 2 free
  copies are used up, on both preview and commit. The agreement template
  renders each of its `renderedClauses` as its own titled section rather
  than a separate party card, since the clause text already carries the
  resolved customer/company identity and there's no frozen
  `customer_snapshot` (unlike Quotation) to summarise instead.
- `GET /documents?documentType=&sourceId=&latestOnly=` (default `true`),
  `GET /documents/:id`, `GET /documents/:id/download` (streams the PDF) —
  the Document Centre's read side, gated on the broader `view_documents`
  rather than each source record's own permission (an Operator can view
  documents even though it can't generate a quotation's own).
- `GET /verify/:qrToken` — fully public, no JWT. Resolves `valid` (with
  the document number, issuer trade name, generated date, and the source
  record's live status), `revoked` (a superseded version — not a 404, so
  a scanner can tell "used to be valid" from "never existed"), or
  `not_found`. Never returns line items, amounts, or anything else from
  the document's `render_data_snapshot`.
- `POST/GET/PATCH /gate-entries[/:id]` plus `POST /gate-entries/:id/close`
  (sets `exitAt`) and `/cancel`, and the same `document/preview` /
  `document` pair as Quotation/Agreement (`documentType: 'gate_entry'`,
  `featureCode: 'GATE_ENTRY'`). Every route rides `create_gate_entry` —
  permissions-matrix.md's Operations module seeds no separate view/edit
  code for this entity (unlike Masters/Commercial). Editable only while
  `status = 'open'`; `close` is allowed from `'open'` or `'linked'`,
  `cancel` only from `'open'`. Selecting a `vehicleId` auto-fills its
  linked transporter's id/name (blueprint §16) unless the request already
  set one; selecting a `driverId` similarly snapshots the driver's own
  name/mobile onto the row — both resolved server-side, not left as a
  frontend convention.
- `POST/GET/PATCH /inwards[/:id]` plus `POST /inwards/:id/receive` and
  `/cancel`, and the same `document/preview` / `document` pair
  (`documentType: 'inward'`, `featureCode: 'INWARD'`). Every route rides
  `create_inward` (paired with `create_gate_entry` in the same
  permissions-matrix.md row). `customerId` is required directly, or via
  `gateEntryId` — passing a `gateEntryId` auto-fills `customerId` and the
  vehicle/driver/transporter fields from that gate entry (an explicit
  value on the request still wins), requires the gate entry to be
  `'open'`, and flips it to `'linked'` as a side effect. Each item's
  `productSnapshot` (sku/name/hsn/uom/weight) is captured server-side
  from the product master at creation time, the same freeze-at-creation
  discipline as Quotation's `customerSnapshot`. `supplierId` is optional
  and validated if given, but no Supplier master exists yet
  (`permissions-matrix.md` seeds no permission for one) — `supplierName`
  is a plain, always-usable free-text field instead; see `DECISIONS.md`
  §29. Editable only while `status = 'draft'`; `receive` locks it in as
  the basis a GRN will be raised from, `cancel` works from either
  `'draft'` or `'received'` but not once a GRN exists.
- `POST/GET/PATCH /grns[/:id]` plus the workflow actions
  `POST /grns/:id/submit`, `/check`, `/approve`, `/reject` (body:
  `{ reason }`), `/cancel`, and the same `document/preview` / `document`
  pair (`documentType: 'grn'`, `featureCode: 'GRN'`). Creation, edit,
  submit and cancel ride `create_grn`; **check, approve and reject ride
  `approve_grn`** — that split is blueprint §50's "GRN: Operator →
  Manager" approval rule, and it is the reason a Warehouse Operator can
  raise and submit a GRN but not sign it off. Passing `inwardId` requires
  that inward to be `'received'`, copies its header and maps every
  `inward_items` row into a GRN item (each carrying `inwardItemId` back
  to its origin), and flips the inward to `'grn_created'`.
  `shortQty`/`excessQty` are derived server-side from expected vs.
  received, and `hasDiscrepancy` is recomputed from the item rows on
  every write. `accepted + rejected > received` is rejected as a readable
  400 before the table's own check constraint fires, and `serialNos` are
  refused on a product that isn't `serial_tracked`. **`approve` is where
  stock comes into existence** (§18): it resolves or creates the batch for
  each batch-tracked line (filling `grn_items.batch_id`), writes one
  `INWARD` ledger row per accepted quantity — one row *per serial* for a
  serial-tracked product — and stamps `stock_posted_at`, all in the same
  transaction as the status change. The stock lands **unallocated**
  (`location_id` null); the put-away decides where it goes.
- `POST/GET/PATCH /inspections[/:id]` plus `POST /inspections/:id/complete`
  and `/cancel` (all on `create_inspection`). The inspector defaults to
  the acting user's own name when the request omits one, and
  `overallResult` is always derived from the line results
  (`accepted` / `rejected` / `partially_accepted`), never accepted from
  the client. This is the one Phase 4 record with **no document type** —
  there are no `document` routes, by design.
- `POST/GET/PATCH /discrepancy-reports[/:id]` plus
  `POST /discrepancy-reports/:id/submit`, `/acknowledge` (body:
  `{ driverAckName }`), `/close`, `/cancel`, and the same
  `document/preview` / `document` pair (`documentType:
  'discrepancy_report'`, `featureCode: 'DISCREPANCY_REPORT'`). All on
  `create_discrepancy_report`. Passing `grnId` copies **only** the GRN's
  discrepant lines (those with a short, excess, or damaged quantity) and
  auto-fills customer/supplier from it; a GRN with `hasDiscrepancy: false`
  is refused with a 400 rather than producing an empty report. `acknowledge`
  stamps the warehouse acknowledgement (`warehouseAckBy`/`At`) server-side
  from the acting user and takes only the driver's name from the body.
- `POST/GET /putaways[/:id]` plus `POST /putaways/:id/start`, `/complete`
  (`complete_putaway`, distinct from `create_putaway` which every other
  route rides) and `/cancel`, and the same `document/preview` / `document`
  pair (`documentType: 'putaway'`, `featureCode: 'PUTAWAY'`). Requires an
  **approved** GRN, of which there can be exactly one put-away (a second
  attempt 409s off the unique index, not a read-then-write race). Each
  line defaults to its GRN item's `acceptedQty`, and may be split across
  several locations so long as the per-`grn_item` total never exceeds
  what was accepted; every location must belong to the GRN's own
  warehouse and be active. `complete` stamps `confirmedAt`/`confirmedBy`
  on every line **and moves the stock to match**: each line becomes a
  `TRANSFER_OUT` from the unallocated lot plus a `TRANSFER_IN` at the bin
  (two ledger rows, never a mutation of one row's location), and the
  destination lot's id is written back to `stockLotId`. For a
  serial-tracked product the specific serials are chosen server-side,
  oldest unallocated first, since a put-away line carries only a quantity
  and both halves of a transfer have to name the same lots.
- `POST/GET /warehouse-receipts[/:id]` plus
  `POST /warehouse-receipts/:id/cancel`, and the same `document/preview` /
  `document` pair (`documentType: 'warehouse_receipt'`, `featureCode:
  'WAREHOUSE_RECEIPT'`). All on `issue_warehouse_receipt` — the one
  Operations permission a Warehouse Operator does not hold. Issued off an
  approved GRN (one per GRN, 409 on a second), refused when no line
  accepted anything, and freezes both `customerSnapshot` and a `lines`
  jsonb built server-side — folding in the confirmed put-away locations
  when a non-cancelled put-away exists, and issuing fine without one.
  Per blueprint §22 the document is titled **"Warehouse Receipt
  (Operational)"** and carries an explicit on-page disclaimer that it is
  not a negotiable/WDRA receipt, not a document of title, and may not be
  transferred, endorsed, or pledged — a legal boundary, not a wording
  preference.
- `GET /stock?customerId=&warehouseId=&productId=&locationId=&includeEmpty=`
  (`view_stock`) and `GET /stock/ledger?...&txnType=&sourceType=&sourceId=`
  (`view_stock_ledger`) — current balances and the append-only movement
  log behind them. These are the broadest permissions in
  `permissions-matrix.md`: every internal role holds both, including a
  Billing Executive who cannot touch a GRN. Emptied lots are hidden from
  `GET /stock` unless `includeEmpty=true` (a lot drained by a put-away is
  history, not current stock). Filtering the ledger by `sourceId` gives
  one document's entire stock footprint in one query, which is what §67's
  traceability requirement means in practice.

  **Both are read-only, and that is the design.** There is no endpoint
  anywhere that writes a stock balance: `stock_lots` is a materialised
  view maintained only by `StockService.postWithin()`, called from within
  the transaction of whichever operational document is moving stock
  (`stock-engine.md` §1). That is what makes blueprint §23's "no
  arbitrary editing of current stock" structurally true rather than a
  rule someone can forget. Postings are idempotent per
  `stock_ledger.idempotency_key`, and the negative-stock invariant is
  enforced against the balance the database returns from the upsert, with
  `stock.allow_negative` honoured as §61's per-tenant escape hatch.

`EntitlementService` (`src/entitlement/`) is wired into the document
engine's `commitDocument()`/`previewDocument()` split — the first real
caller. `NumberingService` has real callers: customer codes, `QT`/`AG`
numbers, and now every `documents` row shares its source record's own
number rather than getting one of its own.

## Tests

```bash
npm test
```

All against the real local database (`DATABASE_URL`), not mocks:

- `health.controller.spec.ts` — connectivity.
- `auth/auth.spec.ts` — signup, login, `/me`, the invalid/duplicate/
  unauthenticated cases, repeated `/me` calls across a reused connection to
  catch the class of bug in `DECISIONS.md` §18, and that signup/login/
  login\_failed each land the `audit_logs` row they're supposed to.
- `db/tenant-isolation.spec.ts` — the mechanism every future module will
  rely on (`withTenant()` + RLS), proven directly against a real table
  since no masters module exists yet to prove it through HTTP.
- `entitlement/entitlement.spec.ts` — the 2-free-copies rule end to end:
  allowed twice then `LIMIT_REACHED`, idempotent retries, a genuine
  concurrent race (5 simultaneous calls against a 2-copy limit resolve to
  exactly 2 winners), cross-tenant/cross-feature independence, the
  fail-closed default, and `recordFailedAttempt`.
- `numbering/numbering.spec.ts` — lazy series creation, strictly
  increasing sequences, per-warehouse and per-tenant independence, and a
  genuine concurrent-allocation race (10 simultaneous calls against one
  series resolve to exactly the numbers 1–10, no duplicates, no gaps).
- `customers/customers.spec.ts` — the masters CRUD through HTTP, and with
  it the first API-level proofs of tenant isolation (tenant B sees none
  of tenant A's customers, 404s on fetch/patch, gets its own `CUST0001`)
  and RBAC (a Warehouse Operator can list but gets 403 + a
  `permission_denied` audit row on create). Its nested `addresses and
  contacts` block proves the single-default-per-kind and
  single-primary-contact invariants directly (a new default in one
  address kind leaves another kind's default untouched; re-toggling
  `isPrimary` onto an earlier contact correctly moves it off the one that
  displaced it), 404s under an unknown or cross-tenant customer, and
  operator 403.
- `users/users.spec.ts` — memberships through HTTP: add, log in as the
  member, an existing account joining a second tenant (login then demands
  `tenantSlug`), a role change / disablement taking effect on the member's
  existing token, both lockout guards, and cross-tenant 404.
- `warehouses/warehouses.spec.ts` — warehouse CRUD, the full
  Zone→Rack→Bin→Pallet chain with materialised codes (Row skipped, as in
  the blueprint), every invalid placement rejected, list filters, immutable
  structural fields, operator 403s, and cross-tenant 404s with an
  independently reusable `WH01`.
- `products/products.spec.ts` — the 8 default UOMs seeded at signup and a
  tenant adding its own, nested categories with an unknown-parent 404,
  server-computed `volume_cbm` (including a spoofed client value being
  ignored) both on create and on a partial update that only patches one
  dimension, the same SKU string coexisting as a shared product and a
  per-customer product while a duplicate within either scope 409s,
  uom/category/customer reference validation, search/filter/pagination,
  tenant isolation (including each tenant's independent UOM and SKU
  namespace), and operator 403.
- `transport/transport.spec.ts` — transporter duplicate-name 409, vehicle
  number normalization (a mixed-case/spaced input colliding with its
  already-normalized duplicate), an owned-fleet vehicle/driver with no
  transporter, an unknown `transporterId` 404 on both, duplicate driver
  names being allowed, transporter-scoped filtering, tenant isolation with
  an independently reusable transporter name and vehicle number, and
  operator 403.
- `billing/billing.spec.ts` — the system charge-type/tax-rate catalogue
  plus a tenant's own addition, the scope check constraint as a 400 for
  all three scopes' invalid combinations (including the check constraint
  wouldn't itself catch: the *wrong* id set for a scope), rate card
  duplicate-code 409, line creation with reference validation, and —
  built up as a real 3-card stack (company, then warehouse, then
  customer, each added one at a time so every priority level is proven
  independently) — the full customer > warehouse > company resolution
  order, a product-specific line beating the general one, a second
  customer with no card of its own still landing on the warehouse card
  rather than the first customer's, omitting `warehouseId` correctly
  skipping the warehouse level, an explicit 404 for an unresolvable
  charge type, tenant isolation, and operator 403.
- `onboarding/onboarding.spec.ts` — drives one tenant through all five
  steps via the real master endpoints (warehouse, customer, product, rate
  card), asserting `nextStep`/`isComplete` after each write, including
  the rate-card-with-no-line-yet case still reporting `done: false`, then
  confirms a second, brand-new tenant is unaffected by the first one's
  progress.
- `quotations/quotations.spec.ts` — an allocated `QT` number, a frozen
  customer snapshot built from the customer's own address/contact
  sub-resources, server-computed totals across a taxed quantity line and
  an untaxed flat line, empty-line-array and reference-validation
  rejections, the full draft → sent → accepted workflow with every
  invalid transition (skip-ahead, double-send, edit-after-send, cancel-a-
  terminal-state) rejected as 400, reject requiring a reason, list
  filtering/search, tenant isolation, and Owner/Admin-only enforcement
  (a Warehouse Operator gets 403 even on `GET`, matching
  `permissions-matrix.md`'s all-➖ row for every other role).
- `agreements/agreements.spec.ts` — the seeded system template, an
  agreement created from an accepted quotation with pre-filled
  customer/warehouse and placeholder-resolved clauses asserted by
  content (customer name/GSTIN, warehouse name/code, notice period all
  present in the rendered text), a quotation still in `draft` refused
  with 400, `customerId` required directly or via the quotation, the
  full draft → pending_approval → approved → active workflow with
  skip-ahead rejected, `approve_agreement`'s Owner-only enforcement
  proven against an Admin who *does* hold `edit_agreement` (403 anyway),
  terminate requiring a reason, tenant isolation, and the
  Warehouse-Manager-can-view-but-not-create /
  Warehouse-Operator-can't-even-view split from `permissions-matrix.md`.
- `documents/documents.spec.ts` — the document engine end to end against
  the real headless-Chromium renderer (no mock): preview returns a real
  PDF (`%PDF` magic bytes checked, not just a 200) with no `documents`
  row written; commit is idempotent on a plain retry (same id/version);
  `regenerate: true` produces a new version whose predecessor's QR then
  resolves `revoked` through the *public, unauthenticated* `/verify`
  endpoint while the new version's resolves `valid`; an unknown token
  resolves `not_found`; regenerating a source with no prior commit 400s;
  the FREE-plan 2-copy paywall blocks both preview and commit with `402`
  once used up, on a dedicated tenant so it can't interfere with other
  tests' own entitlement budget; cross-tenant 404s on get/download/list;
  an Operator is 403'd on preview/generate (gated on the quotation's own
  permissions) but can still view/list via the broader `view_documents`;
  404s on an unknown source/document id; and unauthenticated 401s
  everywhere except the deliberately public verify route. Also covers the
  second registered template, Agreement: a real PDF with its
  `renderedClauses` each as their own section, the same preview/commit/
  regenerate/verify chain, rendering correctly with no warehouse chosen
  (optional context), and — on a dedicated tenant, so it doesn't depend on
  how much of another test's shared budget happened to be used —
  `QUOTATION_GENERATION` and `AGREEMENT_GENERATION` metering as fully
  independent FREE-plan budgets through the HTTP layer, not just directly
  against `EntitlementService` as `entitlement.spec.ts` already proves.
  And the third registered template, Gate Entry: a real PDF for the
  simplest document type yet (no line items or clauses, just two summary
  blocks), the same commit/regenerate/verify chain, and
  `GATE_ENTRY` metering independently of the other two features as well.
  And the fourth, Inward: a real PDF with a genuine product/batch/
  quantity line-item table, the same commit/regenerate/verify chain, and
  `INWARD` metering independently of all three other document features.
  And the fifth, GRN: a real PDF whose face carries the full
  expected/received/accepted/rejected/damaged/short/excess grid and the
  discrepancy note, with the same commit/regenerate/verify chain.
  Running this suite needs `NODE_OPTIONS=--experimental-vm-modules`
  (already set in the `test`/`test:watch` scripts) — `puppeteer-core`
  ships ESM-only, and Jest's own module loader needs that flag to service
  the dynamic `import()` that loads it; see `DECISIONS.md` §26, and §30
  for why that import has to be a *direct* `eval` rather than the
  `new Function` shim §26 originally used (it silently bound every spec
  after the first to a torn-down test environment).
- `gate-entries/gate-entries.spec.ts` — an allocated `GE` number;
  selecting a vehicle auto-filling its linked transporter's id/name
  (and an explicitly-passed `transporterId` overriding that auto-fill);
  selecting a driver snapshotting its own name/mobile; 404s on an
  unknown warehouse/customer/vehicle/driver/transporter reference; 400s
  on an invalid `direction`/`purpose`; the full open → closed workflow
  with edit/cancel/re-close all rejected once closed; cancelling an open
  entry; list filtering by status and free-text search across number,
  vehicle number, and reference; tenant isolation with an independently
  reusable `GE0001`; and a Billing Executive (a role the seeded
  permissions matrix grants no gate-entry access at all) 403'd on both
  create and list.
- `inwards/inwards.spec.ts` — an allocated `IN` number with a server-built
  product snapshot; empty-item-array and reference-validation rejections;
  `customerId` required directly or via a gate entry; linking an open
  gate entry auto-filling customer/vehicle/transporter (asserted by
  value, including the vehicle's own linked transporter) and flipping
  that gate entry to `'linked'`; an explicit `vehicleId` overriding the
  gate-entry-derived one; refusing to link a non-`'open'` gate entry; the
  full draft → received workflow with edit/re-receive rejected once
  received; cancel working from either `'draft'` or `'received'`; list
  filtering by status/customer and free-text search across number and LR
  number; tenant isolation with an independently reusable `IN0001`; and
  a Billing Executive 403'd on both create and list.
- `grns/grns.spec.ts` — auto-fill from a received inward with derived
  short/excess and `hasDiscrepancy` (and the inward flipped to
  `grn_created`), the no-discrepancy case, an inward that isn't received
  refused, `accepted + rejected > received` rejected as a readable 400
  *before* the check constraint fires, serial numbers refused on a
  non-serial-tracked product and recorded on a tracked one, the full
  Draft → Submitted → Checked → Approved walk with every skip-ahead
  rejected **and `stockPostedAt` asserted still null**, reject/cancel,
  §50's Operator → Manager split proven directly (an Operator creates and
  submits, then gets 403 on check/approve/reject), list filter/search,
  tenant isolation with an independent `GRN0001`, and 401s.
- `discrepancy-reports/discrepancy-reports.spec.ts` — covers both records
  that share the slice: a report copying **only** a GRN's discrepant
  lines, a clean GRN refused, a standalone report with no GRN at all, the
  draft → submitted → acknowledged → closed walk with both
  acknowledgements recorded, cancel/filter/isolation, and the sixth
  registered template rendered as a real PDF. Then inspections: created
  off a GRN with the inspector defaulting to the acting user and
  `overallResult` derived, completion locking further edits, cancellation,
  an explicit assertion that **no document routes exist** for inspections,
  and each record gated on its own seeded permission plus 401s.
- `stock/stock.spec.ts` — the stock engine, tested through the documents
  that actually move stock. GRN approval posting only what was *accepted*
  (90 of 100 received) as one unallocated `INWARD` row; a batch resolved
  once across two GRNs with `first_received_at` proven not to move on the
  later receipt; a serial-tracked product landing as three one-unit lots;
  a serial-tracked line whose serials don't cover every accepted unit
  refused **with the whole approval rolled back** (still `checked`,
  nothing posted); a put-away splitting 90 across two bins as four ledger
  rows in `TRANSFER_OUT`/`TRANSFER_IN` order, with each line's
  `stockLotId` filled and the drained unallocated lot dropping out of
  current stock but still visible under `includeEmpty`; a serial-tracked
  put-away moving two specific serials and leaving the third where it was;
  and tenant isolation plus the broad-read permission row (a Billing
  Executive reads both endpoints and is 403'd on a GRN). Two cases go
  straight at `StockService` rather than through HTTP, and deliberately:
  idempotency and the negative-stock invariant sit behind transitions that
  already refuse a second attempt, so pretending they're reachable over
  HTTP would be testing the transition, not the guard.
- `putaways/putaways.spec.ts` — a put-away defaulting each line to its
  GRN item's accepted quantity; an unapproved GRN, a location in another
  warehouse, and an over-accepted quantity each refused; one GRN line
  split across several locations while a second put-away for the same GRN
  409s; the pending → in_progress → completed walk with `complete` gated
  on its own `complete_putaway` permission; and the seventh registered
  template as a real PDF. Then warehouse receipts: issued off an approved
  GRN with frozen customer/line snapshots that fold in the confirmed
  put-away locations, issued fine with no put-away at all, an unapproved
  GRN and a GRN that accepted nothing both refused, the eighth registered
  template plus cancellation, an Operator able to run a put-away
  end-to-end but 403'd on `issue_warehouse_receipt`, and tenant isolation
  with 401s.
