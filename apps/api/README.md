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
status endpoint. Phase 2 is complete; operations and billing-run modules
are not built yet (see `docs/architecture/dev-phases.md`).

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
schema; adding a new domain means adding a file there, not here. Five of
those files (`85`–`93`) are fixes for real bugs found only by building and
load-testing this app against the schema, not by review — see
`docs/architecture/DECISIONS.md` §16–§21 if you're wondering why they
exist.

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
  (V1.1).
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

No entitlement-gated endpoint exists yet (nothing generates a document
yet) — `EntitlementService` (`src/entitlement/`) is complete and tested
directly; Phase 3 wires `checkEntitlement`/`consumeEntitlement` into the
first real `generateDocument()` call. `NumberingService` already has a
real caller: customer codes.

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
