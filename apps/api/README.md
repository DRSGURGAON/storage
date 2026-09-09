# API — Warehouse Documentation & Operations SaaS

Backend for the product specified in `../../docs/`. So far: project
scaffolding, tenant/user auth with JWT, row-level tenant isolation, the
seeded RBAC role/permission catalog, and a fully working entitlement/
subscription engine (2-free-copies enforcement, seeded and tested). No
masters, operations, or billing modules yet, and no RBAC *enforcement*
guard — that's deferred to Phase 2, built alongside the first real
permission-gated endpoint rather than against no caller (see
`docs/architecture/dev-phases.md` Phase 1).

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
schema; adding a new domain means adding a file there, not here. Four of
those files (`85`–`92`) are fixes for real bugs found only by building and
load-testing this app against the schema, not by review — see
`docs/architecture/DECISIONS.md` §16–§18 if you're wondering why they
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

No entitlement-gated HTTP endpoint exists yet (nothing generates a
document yet) — `EntitlementService` (`src/entitlement/`) is complete and
tested directly; Phase 3 wires `checkEntitlement`/`consumeEntitlement`
into the first real `generateDocument()` call.

## Tests

```bash
npm test
```

All against the real local database (`DATABASE_URL`), not mocks:

- `health.controller.spec.ts` — connectivity.
- `auth/auth.spec.ts` — signup, login, `/me`, and the invalid/duplicate/
  unauthenticated cases, including repeated `/me` calls across a reused
  connection to catch the class of bug in `DECISIONS.md` §18.
- `db/tenant-isolation.spec.ts` — the mechanism every future module will
  rely on (`withTenant()` + RLS), proven directly against a real table
  since no masters module exists yet to prove it through HTTP.
- `entitlement/entitlement.spec.ts` — the 2-free-copies rule end to end:
  allowed twice then `LIMIT_REACHED`, idempotent retries, a genuine
  concurrent race (5 simultaneous calls against a 2-copy limit resolve to
  exactly 2 winners), cross-tenant/cross-feature independence, the
  fail-closed default, and `recordFailedAttempt`.
