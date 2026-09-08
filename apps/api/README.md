# API — Warehouse Documentation & Operations SaaS

Backend for the product specified in `../../docs/`. This is Phase 1A's
first increment: project scaffolding, a database connection, and the
reference schema applied as real migrations. No tenancy, auth, or business
logic yet — that's the next increment, built on top of this.

## Stack

TypeScript, NestJS, PostgreSQL 16, Drizzle (`postgres-js` driver). See
`../../docs/architecture/DECISIONS.md` §0 for why.

## Setup

```bash
npm install                    # from the repo root (npm workspaces)
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env if your local Postgres differs from the default

cd apps/api
npm run migrate                # applies ../../docs/architecture/schema/*.sql, in order
npm run start:dev              # http://localhost:3000/health
```

## Where the schema comes from

`src/db/migrate.ts` reads and executes
`../../docs/architecture/schema/*.sql` directly — that directory is the
single source of truth for the data model (see its own `README.md` for
conventions). This app does not keep a second, duplicated copy of the
schema; adding a new domain means adding a file there, not here.

## Tests

```bash
npm test
```

`health.controller.spec.ts` is an integration test against a real database
(`DATABASE_URL`), not a mock — proving connectivity is the point of this
increment.
