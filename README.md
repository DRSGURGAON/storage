# Warehouse Documentation & Operations SaaS

A production-oriented SaaS blueprint for Indian general warehousing / storage
businesses (3PL, godowns, distribution warehousing, industrial storage). The
core principle: **enter data once, reuse everywhere, generate documents
automatically, update stock automatically, bill from actual operations.**

This repository holds the **product blueprint, engineering architecture,
and the implementation now underway**. Phase 1 (`docs/architecture/dev-phases.md`)
has landed tenancy and auth: `apps/api`, a NestJS + PostgreSQL backend with
row-level-secured multi-tenancy, JWT signup/login, and the seeded RBAC
catalog, all covered by integration tests against a real database. Masters,
operations, and billing modules are not built yet — see `apps/api/README.md`
to run what exists so far.

## Where to start

- [`apps/api/`](apps/api/README.md) — the backend implementation, as far as
  it's built.
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
