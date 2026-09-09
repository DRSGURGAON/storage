# API — Warehouse Documentation & Operations SaaS

Backend for the product specified in `../../docs/`. So far: project
scaffolding, tenant/user auth with JWT, row-level tenant isolation, the
seeded RBAC role/permission catalog, a fully working entitlement/
subscription engine (2-free-copies enforcement, seeded and tested), audit
logging on every mutating/security-relevant auth action, centralized
document numbering (`allocateNumber()`), RBAC enforcement
(`PermissionsGuard` + `@RequirePermission`), and the first master —
Customers. No other masters, operations, or billing modules yet (see
`docs/architecture/dev-phases.md`).

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
  `permission_denied` audit row on create).
