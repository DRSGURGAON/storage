# Warehouse Documentation & Operations SaaS

A production-oriented SaaS blueprint for Indian general warehousing / storage
businesses (3PL, godowns, distribution warehousing, industrial storage). The
core principle: **enter data once, reuse everywhere, generate documents
automatically, update stock automatically, bill from actual operations.**

This repository holds the **product blueprint, the engineering
architecture, and the built product**.

Twenty-five phases in (`docs/architecture/dev-phases.md`), that is: a
NestJS + PostgreSQL API with row-level-secured multi-tenancy, the whole
inbound chain (gate entry → inward → GRN → put-away → warehouse receipt),
the stock engine, the whole outbound chain (release order → pick →
dispatch → gate pass → POD), returns, transfers and verifications, billing
runs through to invoices, payments and customer statements, twenty-four
PDF document templates rendered by a real browser, a reports library, a
customer portal, and the subscription/entitlement engine that meters it and
prices it per godown —
**43 test suites, 342 tests**, every one against a live database rather
than a mock. On top of it, `apps/web`: every screen in the scope
document's screen map, checked in a real browser at desktop and phone
width.

```bash
cp .env.example .env       # set POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build  # http://localhost:8080
```

It is sold per godown per month — Free (1 godown, 2 copies of each
document), Starter ₹2,999, Growth ₹7,999 (3), Scale ₹19,999 (10), with
every document, user and customer login unlimited on a paid plan. The
prices are seed data, not code: see `apps/api/src/db/seed-data.ts`, the
public `/pricing` page, and `docs/architecture/entitlement-engine.md` §12
for why a godown is counted differently from a document. Upgrades are
requested in-app and arranged by hand; no gateway is wired yet.

See [`docs/architecture/deployment.md`](docs/architecture/deployment.md)
for what that does and what it does not do yet (a payment gateway,
off-site backups, error monitoring), and
[`ops/twa/README.md`](ops/twa/README.md) for putting it on a phone — five
minutes to a real installed app, or the whole path to a Play Store
listing.

## Where to start

- [`apps/api/`](apps/api/README.md) — the backend: every endpoint, and why
  it is shaped the way it is.
- [`apps/web/`](apps/web/README.md) — the operator frontend and the
  customer portal.
- [`docs/architecture/deployment.md`](docs/architecture/deployment.md) —
  running it somewhere real.
- [`docs/blueprint/`](docs/blueprint/README.md) — the functional product
  requirements, organized by numbered section (§1–§82).
- [`docs/blueprint-saas-layer/`](docs/blueprint-saas-layer/README.md) — a
  second blueprint layered on top of the first: the SaaS product
  architecture, UX system, and subscription/entitlement engine (§1–§51 of
  that document).
- [`docs/architecture/`](docs/architecture/README.md) — the engineering
  interpretation of both: a full reference database schema, multi-tenancy
  and security model, numbering engine, stock engine, billing engine,
  document engine, entitlement engine, UX system, permissions matrix,
  V1 scope specification, phased delivery plan, and test plan.

## Scope

V1 covers general warehousing end to end: customer onboarding through
quotation/agreement, gate entry, inward, GRN, put-away, warehouse receipt,
stock tracking, release orders, picking, dispatch, gate pass, POD, and
storage/handling billing through to customer statements. Cold storage, WDRA,
customs bonding, RFID/IoT, and full ERP/HR are explicitly out of scope for V1
(see blueprint §2) but the architecture is designed to extend to them later.
