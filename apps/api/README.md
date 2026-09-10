# API — Warehouse Documentation & Operations SaaS

Backend for the product specified in `../../docs/`. **Phases 1 through 9
are complete** (`../../docs/architecture/dev-phases.md`): everything the
V1 blueprint describes as backend work is built, tested against a live
database, and documented. There is no frontend in this repository — `apps/`
contains only `api`.

What that covers, in the order the phases built it:

- **Phase 1 — foundations.** Tenant/user auth with JWT, row-level tenant
  isolation (`FORCE ROW LEVEL SECURITY` on all 83 tenant tables, plus
  `withTenant()`), the seeded RBAC catalog with `PermissionsGuard` +
  `@RequirePermission` (fails closed on a route that declares nothing), the
  entitlement/subscription engine, audit logging, and centralized document
  numbering (`allocateNumber()`, gap-free under concurrency).
- **Phase 2 — masters.** Customers with addresses and contacts, Warehouses
  and their location hierarchy, Product/SKU with UOMs and categories, the
  Transport master, Rate Cards with the full `billing-engine.md` §3
  resolution priority, and the onboarding wizard.
- **Phase 3 — commercial + the document engine.** Quotations, Agreements,
  and server-rendered PDF generation (headless Chromium via
  `puppeteer-core`) with QR verification, versioning and FREE-plan
  entitlement gating.
- **Phase 4 — inbound.** Gate Entry → Inward → GRN (with §50's Operator →
  Manager approval split) → Inspection / Discrepancy Report → Put-away →
  Warehouse Receipt.
- **Phase 5 — stock.** `StockService.postWithin()` is the only code path
  that writes a stock balance. GRN approval posts `INWARD`, put-away
  relocates, plus Stock Transfer, Physical Verification, Stock Adjustment
  with its approval chain, GRN reversal, and the stock statement and
  ageing reports.
- **Phase 6 — outbound.** Release Order with reservation and the FIFO /
  LIFO / FEFO / manual allocation policy, Pick List, Packing List,
  Dispatch, Loading Sheet, Gate Pass (the single `OUTWARD` writer), POD,
  and Returns.
- **Phase 7 — billing.** Billing runs that rebuild storage day by day from
  the ledger, GST invoices with CGST/SGST vs. IGST decided once and frozen,
  credit and debit notes, idempotent payments, the customer statement, and
  the nightly overdue job.
- **Phase 8 — the surfaces around it.** Customer portal, dashboard, global
  search, in-app notifications, the audit viewer, Plan & Usage, the public
  pricing page, and a demo workspace seeded by driving the real API.
- **Phase 9 — proof.** An end-to-end acceptance walkthrough
  (`src/acceptance/`), a from-scratch database proof, and a documentation
  reconciliation pass. **35 test suites, 281 tests**, all green against a
  live PostgreSQL database — and against one built from nothing, with all
  twenty schema files applied in order.

The document engine now carries **all twenty-four** templates of
`document-engine.md` §2: Quotation, Agreement, Gate Entry, Inward, GRN,
Discrepancy Report, Put-away Slip, Warehouse Receipt, Stock Transfer Note,
Physical Stock Count Sheet, Customer Stock Statement, Release Order, Pick
List, Packing List, Dispatch Note, Loading Sheet, Gate Pass, POD, Return
Inward, Tax Invoice, Credit Note, Debit Note, Payment Receipt, and Customer
Account Statement.

- **Phase 10 — closing the open items.** The portal's database-level
  isolation (a restrictive RLS policy, so a query that forgets its customer
  filter still cannot see another customer), signed and expiring document
  links, `getDocumentRelations` (Created From / Related Documents / the §68
  chain, read off the schema itself), notification delivery over real
  SMTP and HTTP, and the `DEMO / SAMPLE` marking every document a demo
  workspace generates now carries.

The frontend lives in [`apps/web`](../web/README.md) — React + Vite + Ant
Design, covering the whole operational loop and the customer portal.

**Known gaps**, listed rather than glossed: no object store
(attachments are on the local filesystem behind an interface — the signed
links exist, the S3 adapter does not); no payment gateway; `billing_runs`
is outside the document-relations graph because it has no number; and
`tenants.is_demo` is not excluded from billing runs (a demo's
billing run is part of the demo, and there is no cross-tenant analytics
surface to exclude it from yet).
`../../docs/architecture/test-plan.md` §5 is the full list.

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
schema; adding a new domain means adding a file there, not here. **Eleven**
of those twenty files (`85`, `90`–`99`) were added after the domain model,
each one found by building on the schema rather than by reading it — see
`docs/architecture/DECISIONS.md` §16–§22, §25, §31 and §44 if you're
wondering why they exist. `96_stock_lots_balance_key.sql` is the sharpest
example: `stock_lots`' unique constraint has three nullable columns, so it
enforced nothing for the commonest lot in the system, and every stock
posting would have fragmented "current stock" into duplicate rows with no
error at all. `97_payment_idempotency.sql` adds the column that makes a
retried "Record Payment" click harmless; `98` is the portal's restrictive
RLS policy; `99` gives notification delivery somewhere to record what the
provider said.

## Endpoints so far

- `GET /health` — DB connectivity check.
- `POST /auth/signup` — creates a tenant, its first user, and an Owner
  membership; returns a JWT.
- `POST /auth/login` — `{ email, password, tenantSlug? }`; `tenantSlug` is
  required only when the account belongs to more than one tenant.
  Rate-limited to 8/minute per **(IP, email)** — per IP alone would either
  lock out a warehouse office sharing one NAT address or leave room to
  guess one password thousands of times a day; keying on the account under
  attack does neither. Once tripped the correct password is refused too,
  which is the point: otherwise the 429-vs-401 boundary would itself
  answer "was that guess right?". A login for an unknown address now
  verifies a fixed dummy hash so it costs the same ~50ms as a real one —
  returning early was a timing oracle for whether an address is
  registered. See `DECISIONS.md` §36.
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
  an existing account just gains a membership; `password` is required
  either way and ignored (never applied) when the account exists — it used
  to be optional, and the 400 explaining when it was needed told any tenant
  admin whether an address was registered anywhere on the platform. Guards:
  you cannot change
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
  company, product/category line override) and returns the winning line.
  This same resolution is what every billing run prices against
  (`invoicing/`); the endpoint exposes it so a rate-card UI can show which
  line will win before anything is invoiced.
- `GET /company` and `PATCH /company` (`manage_company_settings` — Owner/
  Admin only, on the **read** as well as the write: the row carries bank
  account details and the authorised signatory, `permissions-matrix.md`
  seeds no separate view code, and nothing else needs it since documents
  build their letterhead server-side from the same row). This is what every
  letterhead and the agreement template's `{{company.*}}` tokens resolve
  against — until it existed, signup captured a legal name and nothing could
  write the rest, so every document rendered with no GSTIN and no address
  (`DECISIONS.md` §35). `isDocumentReady` on the response is the same
  GSTIN-plus-full-address condition the onboarding wizard's company step
  now uses. `slug`, `status`, the three attachment ids and
  `financialYearStartMonth` are deliberately not settable — the last
  because number series are keyed by financial year, so moving it mid-year
  would re-key every series.
- `GET /company/settings`, `PUT /company/settings/:key`,
  `DELETE /company/settings/:key` (same permission) — the `tenant_settings`
  store, which previously had no writer at all. Keys are **declared**, in
  `company/tenant-settings.registry.ts`, with a type, a default and a note
  naming what reads them; an unknown key is a 400 rather than a row nothing
  will ever consult, and a wrongly-typed value is a 400. The list returns
  every known key at its effective value with `source: 'tenant' | 'default'`,
  and DELETE restores the documented default rather than writing null.
  `stock.allow_negative` is the first live consumer — `StockService` takes
  the key and default from the same registry, so writer and reader cannot
  drift.
- `GET /onboarding/status` — no permission beyond a valid JWT (informational,
  RLS-scoped to the caller's tenant). Reports `done`/`count` for each
  wizard step (`company`/`warehouse`/`customer`/`products`/`rateCard`),
  derived live from each entity's row count rather than a stored flag, plus
  `nextStep` and `isComplete`. The `company` step reported `done: true`
  unconditionally until `PATCH /company` existed to make it achievable; it
  now checks that the profile carries what a letterhead needs, so a fresh
  tenant's `nextStep` is `company`. The `rateCard` step checks for at least one
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
- `GET /verify/:qrToken` — fully public, no JWT, and rate-limited to
  60/minute per IP: it writes a `document_verifications` row on every
  matching hit, which unbounded is write amplification anyone holding one
  valid token can aim at the database. Resolves `valid` (with
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
  to its origin), and flips the inward to `'grn_created'`. Passing
  `returnInwardId` instead (§37) takes the customer, warehouse and
  transport from the return inward and the lines from its request
  (expected = received = accepted, for the desk to correct), links the
  GRN to the arrival, and makes `approve` post `RETURN` rows where it
  would post `INWARD` — the same chain, the same reversal
  (`DECISIONS.md` §42).
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
- `POST/GET /stock-transfers[/:id]` plus `POST /stock-transfers/:id/approve`,
  `/dispatch`, `/complete`, `/cancel`, and the same `document/preview` /
  `document` pair (`documentType: 'stock_transfer'`, `featureCode:
  'STOCK_TRANSFER'`). Every route rides `create_stock_transfer` — the
  matrix seeds no separate approve code for this module, unlike stock
  adjustments where it seeds two. `transferKind` decides **when** the two
  ledger rows are written, and that is the point of the module: a
  `'location'` (bin-to-bin) move posts `TRANSFER_OUT` and `TRANSFER_IN`
  together at `complete`, because a pallet crossing an aisle has no
  journey; a `'warehouse'` move posts the OUT at `dispatch` and the IN at
  `complete`, so while the truck is on the road the goods are in
  **neither** warehouse's balance — which is where they actually are.
  Consequences, all deliberate: a `'warehouse'` transfer can't be
  completed before it's dispatched, a `'location'` one can't be dispatched
  at all, and an `in_transit` transfer can't be cancelled (the departure
  is already in the ledger; reversal is additive per `stock-engine.md`
  §3.5). A line with no `toLocationId` lands unallocated at the
  destination, exactly as a receipt awaiting put-away does. See
  `DECISIONS.md` §37.
- `POST/GET /stock-verifications[/:id]` plus
  `PATCH /stock-verifications/:id/lines/:lineId` (record what was counted),
  `POST /stock-verifications/:id/lines` (stock found with no lot behind
  it), `/complete`, `/cancel`, and the `document/preview` / `document` pair
  (`documentType: 'stock_verification'`, `featureCode:
  'STOCK_VERIFICATION'`). All on `create_stock_verification`. The count
  sheet **builds itself** from `stock_lots` — the caller does not supply
  lines, because a count whose subject the counter picks is not a count —
  and `systemQty` is frozen at that moment. It **posts no stock at all**:
  finding 8 where the system says 10 records a disagreement, it does not
  correct one. `differenceQty` is a generated column, so the client never
  asserts it. The document renders blank before the count (system quantity
  deliberately hidden, ruled blanks to write in) and filled in after.
- `POST/GET /stock-adjustments[/:id]` plus `/submit`, `/approve`
  (`approve_stock_adjustment`), `/approve-final`
  (`approve_stock_adjustment_final` — **Owner only**, one of just two codes
  Admin does not hold), `/reject`, `/post`, `/cancel`. Raised from a
  verification (copying only the discrepant lines, deltas carried straight
  from the count's own arithmetic) or standalone; `reason` is always
  required. The chain is `draft → pending_manager → [pending_owner] →
  approved → posted`, with the Owner step inserted only when
  `approvals.stock_adjustment.owner_required` is set — read per request, so
  switching it on applies to the next adjustment. **Posting is a separate
  act from approval**, deliberately: a write-off larger than the shelf
  holds fails the negative-stock invariant, and collapsing the two would
  let that failure roll back a decision two people already made
  (`DECISIONS.md` §38). `post` rides the approve permission, not the create
  one. This is the only endpoint in the system that writes an `ADJUSTMENT`
  ledger row.
- `GET /reports/stock-statement?customerId=&warehouseId=&asOf=` and
  `GET /reports/ageing?customerId=&warehouseId=` (`view_reports`). The
  statement is `stock_lots` live, or for a past `asOf` date the ledger's
  stored running balances via one `distinct on` — no replay. Ageing buckets
  come from `stock.ageing_buckets` at query time (change the setting, no
  backfill) over `batches.first_received_at`; non-batch stock is aged from
  its earliest receipt, a stated FIFO assumption (`DECISIONS.md` §39).
  `POST /reports/stock-statement/:customerId/document[/preview]`
  (`view_stock`) issues the Customer Stock Statement, keyed on the customer
  as its source record so reissuing is a new version of the same thing.
- `POST /grns/:id/reverse` (`approve_grn`) — `stock-engine.md` §3.5's
  additive reversal: one offsetting `INWARD` row with `reversal_of_id` per
  original, nothing deleted, the inward released back to `'received'` so a
  corrected GRN can be raised. Refused while a warehouse receipt is issued
  and once a put-away has moved the stock — the unallocated lot is shared
  across receipts, so "would it go negative" was the wrong guard (§39).
- `POST/GET/PATCH /release-orders[/:id]` (`create_release_order` — stops at
  Warehouse Manager; an Operator does not raise outbound orders) plus
  `/approve` (`approve_release_order`), `/reserve` (`reserve_stock`),
  `/cancel`, `/document[/preview]`. Creation snapshots the chosen delivery
  address so a later master edit cannot re-route an order already placed;
  only a draft is editable. **Reserve is where the allocation policy
  runs** (`DECISIONS.md` §40): the body's `allocationPolicy`
  (`fifo|lifo|fefo|manual`) or the tenant's `stock.allocation_policy`
  chooses lots — shelved lots only, aged by batch or by the lot's first
  inward — and one `RESERVE` ledger row is posted per lot. A shortfall
  refuses the whole order with both numbers ("70 requested but only 60
  available in shelved locations (a further 40 is unallocated, awaiting
  put-away)"). `manual` takes explicit `{releaseOrderLineId, stockLotId,
  quantity}` allocations, and names an unallocated lot as the reason when
  one is offered. Cancel from any pre-dispatch state mirrors every
  `RESERVE` with an `UNRESERVE` — §79's "cancel reservation restores
  available".
- `POST/GET /pick-lists[/:id]` and `/cancel`, `/document[/preview]`
  (`create_pick_list`); `/confirm`, `/complete` (`confirm_pick`) — both
  reach the Operator, picking is floor work. A pick list is generated from
  the order's `RESERVE` rows (one line per lot, location first, minus what
  earlier completed lists already took), records the policy the
  reservation used, and one may be open per order at a time. A pick above
  the line's reservation is refused; completion rolls `picked_qty` up to
  the order, which becomes `picked` only when every line is fully picked,
  else `partially_picked`. Picking posts nothing to stock.
- `POST/GET /packing-lists[/:id]` and `/document[/preview]`
  (`create_dispatch`) — §32's box list. No status, moves nothing, lines
  default to the order's picked quantities with weight from the product
  master; package and weight totals sum the lines when not stated.
- `POST/GET/PATCH /dispatches[/:id]`, `/cancel`, `/document[/preview]`
  (`create_dispatch`) and `/confirm` (`confirm_gate_out`) — §33's Dispatch
  Note against a picked order. The transport block is snapshotted as text
  (vehicle number, driver, transporter); lines default to picked − already
  dispatched − what other open notes claim, and a line above that is
  refused by name (§79 "prevent dispatch above available", first wall).
  Only a draft is editable, and its lines are frozen while a loading sheet
  is open. `confirm` is "the goods have left" for a tenant whose
  `workflow.outward_posting_point` is `dispatch`; under the default it is
  refused with the setting named. Cancel (draft/loaded) cancels the sheet
  and pending pass with it.
- `POST/GET /loading-sheets[/:id]`, `/confirm`, `/complete`, `/cancel`,
  `/document[/preview]` (`create_loading_sheet`) — §34's dock tick-list,
  one per dispatch, lines copied from the note. `complete` needs every
  line ticked and makes the dispatch `loaded`.
- `POST/GET /gate-passes[/:id]`, `/cancel`, `/document[/preview]`
  (`create_gate_pass`) and `/gate-out` (`confirm_gate_out`) — §35. One per
  dispatch, seal copied from a loaded sheet, transport and LR/e-way from
  the note. **Gate-out is where physical stock leaves**: one `OUTWARD` row
  per lot the reservation named, `qty_out` and `-reserved_delta` together,
  through the single writer in `outbound-posting.service.ts` keyed
  `dispatch:{id}:outward` — so a pass issued after a dispatch-posting
  tenant's `confirm` posts nothing and says so in `stockPostedAt`
  (`DECISIONS.md` §41). Rolls `dispatched_qty` up to the order, which
  becomes `dispatched` once every line is fully out.
- `POST/GET /pods[/:id]`, `/capture`, `/document[/preview]`
  (`capture_pod`) — §36, raised once the dispatch is `gate_out`, lines
  defaulting to the dispatched quantities. `capture` takes what the
  consignee signed for; received above dispatched or damaged above
  received is refused; status is derived (`delivered`/`short`/`damaged`/
  `rejected`), the dispatch completes, and the order completes once every
  note against it has. Moves no stock.
- `POST/GET /billing-runs[/:id]` and `/discard` (`generate_billing_run`) —
  billing-engine.md §4–§5's preview, computed from operations and committed
  to nothing. Storage is accrued **day by day from the ledger** for every
  `(product, batch)` the customer held (free days counted from that key's
  own first inward), handling charges come from the completions in the
  period (`grn_approved`, `gate_out`, `loading_confirmed`,
  `putaway_completed`, `pick_confirmed`) matched by
  `charge_types.trigger_event`, and `manualLines` are the one hand-typed
  charge, still routed through the same preview. Every intermediate number
  — the daily quantity series, chargeable unit-days, rate, free days,
  minimum charge — is stored in `billing_runs.calculation` for the preview
  to render rather than recompute (§66). Stock with **no rate at any
  level** lands in `calculation.errors` and blocks invoicing; an event
  whose charge type is priced nowhere lands in `calculation.unpriced` and
  is simply not billed (`DECISIONS.md` §43). Re-running a
  customer/warehouse/period replaces the live preview; once its period is
  invoiced, re-running is refused with the invoice number.
- `POST/GET /invoices[/:id]` (`create_invoice`), `/submit`, `/cancel`
  (`create_invoice`), `/approve`, `/issue` (`approve_invoice`),
  `/document[/preview]` — §40's Tax Invoice, created only from a billing
  run. Both party snapshots are frozen at creation and the GST treatment is
  decided there and then from the company's state code against the
  customer's place of supply: same state splits each line into CGST + SGST,
  a different state charges IGST, and the totals round to whole rupees with
  the remainder in `round_off`. The due date defaults to the invoice date
  plus the customer's credit days. A billing run is invoiced **once** (§79
  "prevent duplicate invoice posting"); cancelling before issue hands the
  run back to `previewed` so the corrected invoice comes from the same
  computation.
- `GET /dashboard` and `GET /search?q=` (authentication only, no
  permission of their own) — `ux-system.md` §3 and §4. The dashboard's
  tiles are the engines' own queries (`stock_ledger`, `stock_lots`,
  `invoices.balance_due`), narrowed by warehouse scope, with the billing
  tiles **omitted** rather than zeroed for a role that cannot see money.
  Search is one ranked SQL union across customers, SKUs, vehicles, GRNs,
  dispatches, gate passes, PODs, invoices and document numbers; exact
  identifier matches rank above prefixes above substrings, and each
  branch is dropped when the caller lacks the permission governing it.
  Neither declares a single permission because both are aggregations of
  already-permitted reads — a per-branch decision no route decorator can
  express, so they carry `JwtAuthGuard` alone and say so in a comment
  (`PermissionsGuard` fails closed on an undeclared route by design).
- `GET /notifications?unreadOnly=`, `POST /notifications/:id/read`,
  `POST /notifications/read-all` (authentication only — a notification is
  addressed to one person, and the only rows these reach are the
  caller's). Blueprint §56: who hears about what is **data**
  (`notification_rules`, seeded system-wide, overridable per tenant), the
  person who caused an event is never notified about it, a
  warehouse-scoped member only hears about their own warehouses, and
  emission runs inside the caller's transaction so a rolled-back action
  leaves no notification claiming otherwise. Emitted today on GRN submit,
  GRN discrepancy, stock-adjustment submit, gate-out (POD outstanding),
  a portal return request, and an invoice going overdue. Only `in_app` is
  delivered; a rule listing email/WhatsApp/SMS logs that they were not.
- `GET /audit-logs?entityType=&entityId=&action=&userId=&from=&to=`
  (`view_audit_log`, Owner/Admin) — §57's viewer over `audit_logs`.
- `GET /plan/usage` (`view_plan_usage`) — §13, one `checkEntitlement` per
  metered feature, the same read a paywall makes.
- `GET /pricing` — §14, **public and unauthenticated**, pivoted from
  `plan_feature_limits` across every public plan so it cannot drift from
  what the entitlement engine enforces. A feature with no row reads as
  `disabled`, fail-closed.
- **Customer portal** (`GET /portal/me`, `/stock`, `/goods-receipts`,
  `/dispatches`, `/release-orders`, `/invoices`, `/statement`,
  `/documents`, `/documents/:id/download`, and
  `POST /portal/return-requests`) — blueprint §53. A portal login is a
  `tenant_users` row with `roleCode: 'customer'` and a mandatory
  `customerId` (`POST /users` enforces both halves: a customer membership
  without one is a 400, a staff membership with one is a 400). `PortalGuard`
  admits only an active customer membership and **re-reads its
  `customer_id` from the database on every request**, so a disabled or
  re-pointed portal login stops working immediately rather than when its
  token expires. Every portal query hard-codes that filter in one file,
  and the return-request DTO has no `customerId` or `warehouseId` field at
  all. There is no `PermissionsGuard` on these routes by design: the
  `customer` role holds no staff permission codes, which is also what
  closes the staff API to portal sessions (`tenancy-and-security.md` §2).
- `POST/GET /credit-debit-notes[/:id]`, `/submit`, `/cancel`
  (`create_credit_debit_note`), `/approve`, `/issue`
  (`approve_credit_debit_note`), `/document[/preview]` — §41, the only way
  to correct an issued invoice, since an issued invoice is never edited and
  its billing run is never re-run. A note against a draft invoice is
  refused with "correct it directly". A note **changes no column on the
  invoice**: `amount_paid` and `balance_due` mean cash, and a credit is not
  cash (`DECISIONS.md` §44). Numbering keeps the debit note's `DN2` prefix
  apart from the dispatch note's `DN`.
- `POST/GET /payments[/:id]`, `/allocate`, `/cancel`,
  `/document[/preview]` (`record_payment`) — §42. Every create carries a
  client `idempotencyKey`; a retry (even with a different body) returns the
  receipt already recorded, flagged `replayed`, and
  `payment_receipts.idempotency_key`'s unique index is what makes the race
  safe. Allocations are absolute — what you pass replaces what the receipt
  held — and may not exceed the receipt, name an invoice twice, over-pay an
  invoice, or reach another customer's. Each touched invoice's
  `amount_paid` is **recomputed** as `sum(payment_allocations)` over live
  receipts, never incremented, and its status follows: `issued` →
  `partially_paid` → `paid`, walking back when a receipt is cancelled. A
  receipt with no allocations sits on account.
- `GET /customer-statements/:customerId?from=&to=` and
  `POST /customer-statements/:customerId/document[/preview]`
  (`view_customer_statement`) — §43's statement, which `schema/60_billing.sql`
  says has no table: it is a projection over invoices, notes and receipts,
  each row carrying the running balance, with opening and closing balances
  (a windowed statement opens from the truth, not from zero), totals, and
  an ageing breakdown by how far past due each invoice is. Only documents
  the customer has actually received count. Reading it flips that tenant's
  overdue invoices first; a nightly `@Cron` job does the same across all
  tenants.
- `POST/GET /return-requests[/:id]` and `/cancel` (`create_return_request`),
  `/approve`, `/reject` (`approve_grn`) — §37. With `originalDispatchId`,
  every line must be on that dispatch, for its customer, in no more than
  it carried less what earlier live requests already claim; without one
  the request is unbounded. Cannot be cancelled while a return inward is
  open against it.
- `POST/GET /return-inwards[/:id]`, `/inspect`, `/cancel`,
  `/document[/preview]` (`create_grn`) — the arrival against an approved
  request, one open per request, optionally linked to an inward gate
  entry, vehicle and driver. It carries no lines: the GRN raised from it
  says what came back. `grn_posted` is set by that GRN's approval;
  reversal hands it back to `inspected`.
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

## Rate limiting

One throttler, with per-route overrides — not several named ones. With
`@nestjs/throttler` every named throttler is evaluated on *every* route
(`@Throttle({ auth: ... })` overrides a limit for a route, it does not
scope it to one), so declaring a tight `auth` limit alongside a loose
default silently capped the entire API at the tight figure. The global
2000/minute is a runaway-script backstop and deliberately loose: a per-IP
limit is the wrong shape for authenticated routes in a multi-tenant API,
where a customer's whole office is one address and every route already
requires a JWT and a permission. All limits are env-overridable
(`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `VERIFY_RATE_LIMIT_MAX`, and
their `*_TTL_MS` pairs). `TRUST_PROXY_HOPS` is off by default —
`X-Forwarded-For` is client-settable, so trusting it on a directly
reachable host would hand out a fresh rate-limit bucket per forged
header.

## Tests

```bash
npm test
```

A demo workspace can be seeded with `npm run seed:demo` — it drives the
real services end to end (masters → receipts → put-away → release →
dispatch → gate-out → billing run → issued invoice) rather than inserting
rows, so it only succeeds if the flow does (`DECISIONS.md` §46).

**35 suites, 281 tests**, all against the real local database
(`DATABASE_URL`), not mocks:

- `acceptance/acceptance.spec.ts` — blueprint §78 walked once, end to end,
  over HTTP, with four roles holding four tokens: gate entry → inward →
  GRN (the Operator raises it and is refused the approval; the Manager
  checks and approves) → put-away → warehouse receipt → release order →
  reserve → pick → dispatch → loading sheet → gate pass → gate-out → POD →
  billing run → invoice → payment → statement → four generated documents,
  each verified through the public QR route → the audit trail. The stock
  balance is asserted after every step that moves it, and a retried
  "Create Invoice" is refused. Then the §79 rows no single module owns: an
  issued invoice keeping its party snapshot and tax treatment after the
  customer renames itself and moves state (the PDF too); two warehouses
  and two batches of one SKU keeping separate balances, with a FEFO
  reservation drawing from the sooner-expiring batch rather than a merged
  pool; and a cancelled receipt netting back to the exact pre-GRN balance
  through an additive reversal.
- `health.controller.spec.ts` — connectivity.
- `auth/auth.spec.ts` — signup, login, `/me`, the invalid/duplicate/
  unauthenticated cases, repeated `/me` calls across a reused connection to
  catch the class of bug in `DECISIONS.md` §18, and that signup/login/
  login\_failed each land the `audit_logs` row they're supposed to.
- `auth/auth.spec.ts`'s throttling cases — twelve wrong-password attempts
  on one account returning `401` then `429`, the correct password refused
  once the limit trips, a *different* account from the same address still
  logging in (which is what proves the key includes the email), and a
  timing comparison asserting a login for an unknown address takes the
  same order of magnitude as one for a real account, as a ratio rather
  than an absolute so it does not flake on a slow machine.
- `db/tenant-isolation.spec.ts` — the mechanism every module relies on
  (`withTenant()` + RLS), proven directly against a real table, including
  the reused-pooled-connection case that exposed `DECISIONS.md` §18. Every
  module spec then proves the same thing through HTTP on its own
  endpoints.
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
- `company/company.spec.ts` — the profile starting as just the legal name
  and reporting itself not document-ready; malformed GSTIN/PAN/pincode
  refused, and `slug`/`status`/`financialYearStartMonth`/`id` refused
  outright by `forbidNonWhitelisted` (there is no path that writes them);
  saving it flipping `isDocumentReady` and completing the onboarding step;
  and the payoff asserted directly — the saved GSTIN, address and pincode
  appearing in the rendered agreement clauses with no `{{` left, plus a
  real PDF. Then settings: every known key listed at its default with
  `source`, an unknown key and three wrongly-typed values all refused *and
  proven to have stored nothing*, set/read-back/clear, Owner-only
  enforcement against a Warehouse Manager, and cross-tenant isolation —
  worth asserting here because `tenants` is keyed by `id` rather than
  `tenant_id`, so `schema/90`'s generator gives it no RLS policy and the
  explicit filter is the only thing scoping it.
- `reports/reports.spec.ts` — the statement per lot with per-product
  totals and only that customer; a past `asOf` rebuilt from the ledger
  after a bin move (100 then, 30+70 now); ageing bucketing a 45-day-old
  batch into `31-60` and non-batch stock into `0-30`, then re-bucketing
  under a custom `stock.ageing_buckets` setting; the eleventh template
  keyed on the customer with reissue as v2 and the old QR revoked; and
  `view_reports` gating (Billing Executive yes, Operator no). The spec's
  own fixture updates go through `withTenant` because the ledger is under
  FORCE RLS — a bare update silently touches zero rows, which is the
  point.
- `grns/grns.spec.ts` additionally covers reversal: refused while a
  warehouse receipt is issued (naming it), then the offsetting `INWARD`
  row with `qtyOut` equal to the original's `qtyIn` and `reversalOfId`
  pointing at it, the inward back to `'received'`, and a second GRN
  refused once its put-away has run.
- `stock-verifications/stock-verifications.spec.ts` — both halves of §27.
  The sheet building itself from current stock with `systemQty` frozen; a
  counted line's `differenceQty` computed by the database; **counting
  proven to move nothing**; the sheet locking on completion; a found line
  with no lot behind it (systemQty 0, positive difference); an adjustment
  copying only the discrepant lines with the count's own deltas; a missing
  reason refused; the full chain with posting refused at every stage before
  `approved` and the balance asserted unchanged until it; the Owner step
  appearing only once the setting is on; all four roles walked through the
  permission split (Operator raises but cannot approve, Manager approves
  but cannot finalise their own approval, Admin cannot finalise either,
  Owner can, and posting is refused to the Operator); a negative posting
  refused **with the approval left standing and no ledger row written**;
  each resolved count line pointing back at the adjustment that fixed it;
  the tenth template rendering differently blank versus completed; and
  reject/cancel plus tenant isolation.
- `console/console.spec.ts` — the dashboard's numbers traced to the
  ledger (50 posted, one GRN still awaiting approval) with the billing
  tile **absent** for an Operator and a fresh tenant's dashboard empty
  rather than broken; search finding a GRN by number, a customer by name
  and by exact GSTIN (which ranks first), a SKU by prefix, with the
  invoice branch dropped for an Operator and a one-character term
  refused; notifications reaching the Owner and Manager but **not** the
  Operator who submitted the GRN, a discrepancy raising its own warning,
  reading being per person (the Manager's read leaves the Owner's unread,
  and one user's notification 404s for another), read-all clearing the
  count; the audit viewer filtered by entity and by action, refused to
  Manager and Operator, empty across tenants; plan usage showing 1 of 2
  GRN copies used and then 2 of 2 with `upgradeRequired` after spending
  the last one **through the real document endpoint**, refused to an
  Operator; pricing served with no token at all; and the Document Centre
  paging (limit/offset returning different rows) and filtering by
  customer, type and date.
- `portal/portal.spec.ts` — two customers with real goods, documents and
  dispatches behind them, then: a portal membership refused without a
  customer, with an unknown customer, with warehouse scoping, and a staff
  membership refused *with* a customer; the portal showing its own stock,
  receipts, dispatches, release orders, statement and documents with the
  numbers asserted; the other customer's portal seeing only its own, and
  Acme's document id returning 404 to Bolt's portal rather than a file;
  seven staff endpoints and a staff-side statement all 403 to a portal
  session, and the portal 403 to staff; a return request refused above
  what the dispatch carried and refused outright on another customer's
  dispatch, then raised, appearing in the staff queue attributed to the
  right customer, approved by staff and refused to the portal; and a
  disabled membership killing a still-valid token on the next request.
- `receivables/receivables.spec.ts` — two real issued invoices billed over
  their own weeks, then: a payment posted once however many times the
  button is clicked (the retry sends a **different amount** under the same
  token and gets the original receipt back, with one receipt in the list);
  a quarter-payment moving an invoice to `partially_paid` with
  `amount_paid`/`balanceDue` asserted, an over-payment refused by name with
  nothing partial left behind, allocations refused for exceeding the
  receipt, naming an invoice twice, or reaching another customer's invoice;
  one receipt settling one invoice and starting another, then cancelled —
  reversing both in one move because the figure is recomputed rather than
  decremented; a credit note refused against a draft invoice, raised
  against the issued one with its tax computed, leaving the invoice's paid
  figure untouched, and walked submit → approve → issue with approval
  refused to the Billing Executive; a debit note with the `DN2` prefix; the
  statement carrying all four entry types with every row's running balance
  checked against the arithmetic and the closing balance against the
  totals, a window opening from the previous closing balance, and the
  document reissuing as version 2 (refused to the Accountant, who lacks
  `regenerate_document`); an invoice flipped `overdue` by reading the
  statement and landing in the 1-30 day ageing bucket, then paid in full
  and clearing to a zero closing balance; plus the Operator refused
  throughout, filters and tenant isolation.
- `invoicing/invoicing.spec.ts` — nine days of history made by moving the
  ledger, the GRNs and the put-aways back together, so the accrual and the
  handling charges agree about when things happened. 100 bags with 2 free
  days over a 10-day period bill 800 unit-days across 8 days, with the
  stored daily series asserted line by line (10 days, 8 chargeable, all at
  100); the GRN's inward handling billed per unit while `UNLOADING` — which
  triggers on the same event but is priced nowhere — is listed as unpriced
  and not billed; re-running replacing the live preview rather than
  stacking a second (the first 404s afterwards) and taking a manual line;
  a discarded preview refusing to be invoiced; a customer whose only SKU
  has no storage rate producing a named error and an invoice refused with
  it; then the invoice itself — CGST 153 + SGST 153 on 1,700 in-state, the
  per-line split asserted too, a due date at 15 credit days, both
  snapshots frozen, the run marked `invoiced` and a second invoice **and**
  a re-preview of that period both refused; the draft → pending approval →
  approved → issued walk with approval refused to the Billing Executive
  and an issued invoice refused cancellation; the twentieth template
  rendering, committing and verifying. Then IGST for an out-of-state
  customer with CGST/SGST zero on every line, and a later overlapping
  period billing the storage again but listing that GRN's handling as
  already billed; a cancelled draft handing its run back to `previewed`
  for a corrected invoice; plus the Operator refused throughout, filters
  and tenant isolation.
- `returns/returns.spec.ts` — 100 in and 40 out through the whole
  outbound chain first, so there is a dispatch to return against; a
  request for 41 refused with "carried 40", one for another customer
  refused, the Operator refused to raise one; then 10 back: nothing
  arriving against an unapproved request, approval refused to the
  Operator and taken by the Owner, a second request for 31 refused with
  the 30 still unclaimed named, one open arrival per request, the request
  uncancellable under it, the blank note rendering, inspection, the GRN
  refusing both an `inwardId` and a `returnInwardId`, defaulting
  customer/warehouse/lines from the return and refused twice for one
  arrival, then submit/check/approve moving stock 60 → 70 as exactly one
  `RETURN` row (unallocated), the arrival `grn_posted` and the request
  `received`, the posted arrival uncancellable, the nineteenth template
  committing and verifying; reversal back to 60 with `RETURN` mirrored by
  `RETURN`, the arrival back to `inspected` with its `grnId` cleared and a
  corrected GRN raised from it; plus reject, cancel, filters and tenant
  isolation.
- `outbound/outbound.spec.ts` — the whole chain on one order: nothing
  dispatchable or packable from a draft; the packing list defaulting to
  picked quantities with weight from the product master; dispatch of 41
  against 40 picked refused by name and the default note taking all 40
  with the transport block snapshotted; a second note for the same goods
  refused; `confirm` refused under the default posting point; the loading
  sheet refusing completion with a line unticked (naming the SKU), one
  sheet per dispatch, the dispatch turning `loaded`; the gate pass
  carrying the sheet's seal with **nothing moved yet**; then §79's
  gate-out — physical 100 → 60, reservation 40 → 0, one `OUTWARD` row with
  both `qtyOut` and `reservedDelta` and the stored balances — the order
  `dispatched`, a second gate-out and a cancellation of the dispatched
  order both refused; the POD refusing received above dispatched and
  damaged above received, deriving `damaged` from 38 received / 2 damaged,
  completing the dispatch and the order, and leaving stock untouched; all
  five templates rendering, committing and verifying. Then the other
  posting point: `confirm` posting at dispatch (60 → 48 with 8 still
  reserved), the gate pass afterwards posting nothing (`stockPostedAt`
  null, still one ledger row), a second note defaulting to the 8
  remaining and a third refused, the order `dispatched` after the
  remainder. Then a draft note edited (and a second note refused for what
  it claims), its lines frozen under an open sheet with header edits
  still allowed, cancelled together with its sheet and pass, the goods
  freed for a new note and the one-per-dispatch keys released; the order
  refusing to cancel while a note is open and cancelling once it is gone;
  filters and tenant isolation.
- `release-orders/release-orders.spec.ts` — an order snapshotting its
  delivery address and keeping it after the master is edited, editable
  only as a draft; §79's reservation case walked with the numbers (100
  physical, 20 reserved from the FIFO bin, 80 available), the pick list
  generated from that reservation with a pick of 21 against 20 refused,
  a partial pick leaving the order `partially_picked` and a second list
  carrying only the outstanding 8, `picked` once it is all taken, stock
  untouched throughout, then cancellation restoring 100 available with
  `RESERVE`/`UNRESERVE` mirrored; 70 against 60 shelved + 40 unallocated
  refused with both figures **and nothing partial leaked** (no ledger
  rows, still `approved`); FIFO spanning two bins 40+10 in receipt
  order — the case that caught `updated_at` as the wrong age proxy (§40)
  — and a manual allocation refusing the unallocated lot by name then
  reserving from the named bin; FEFO choosing the sooner-expiring batch
  that arrived later, per request and then via the tenant setting, with
  an invalid policy value refused; the twelfth and thirteenth templates
  rendering, committing and verifying; the Operator refused to raise,
  approve or reserve but allowed to pick; filters and tenant isolation.
- `stock-transfers/stock-transfers.spec.ts` — a kind that contradicts its
  warehouses refused both ways, a location outside its own warehouse and a
  same-bin move refused; a bin-to-bin transfer moving nothing until it is
  completed and then posting exactly `TRANSFER_OUT`/`TRANSFER_IN`; the
  warehouse transfer asserted through its whole shape — arrival refused
  before departure, the total on hand dropping by 40 while in transit and
  returning on arrival, cancellation refused once the goods have left, and
  the two ledger rows landing in the two different warehouses; a line with
  no destination bin arriving unallocated; §79's negative-stock case
  reached through a real document with the transition proven to roll back
  whole (still `approved`, no ledger rows, no balance moved); the ninth
  template rendering, committing and verifying; plus cancel-before-move,
  filtering and tenant isolation.
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
