# Architecture — Engineering Interpretation of the Blueprint

This folder translates the [product blueprint](../blueprint/README.md) into
concrete engineering decisions: data model, numbering, permissions, billing
rules, document generation, and the delivery plan. Nothing here should
contradict the blueprint; where the blueprint leaves an implementation detail
open, the decision made is recorded in [DECISIONS.md](DECISIONS.md) with the
blueprint section it serves.

No technology stack has been chosen yet (see `DECISIONS.md` §0). Everything
below is written to be implementable on any mainstream relational database and
backend framework — the schema uses plain PostgreSQL DDL as the most precise,
portable notation, not as a statement that Postgres is the final choice.

## Contents

| Document | Blueprint refs | Covers |
|---|---|---|
| [schema/](schema/README.md) | §7–§51 | Full reference data model, one file per domain |
| [tenancy-and-security.md](tenancy-and-security.md) | §6, §52, §69 | Multi-tenancy strategy, RBAC, server-side authorization |
| [numbering.md](numbering.md) | §62, §16–§43 (all numbered docs) | Centralized document numbering engine |
| [stock-engine.md](stock-engine.md) | §23–§28, §61, §70 | Ledger-first stock model, invariants, idempotency |
| [billing-engine.md](billing-engine.md) | §13, §38–§40, §66 | Rate resolution, charge computation, billing run → invoice |
| [document-engine.md](document-engine.md) | §44–§49, §65, §75 | Centralized `generateDocument()`, design system, QR, versioning |
| [workflow-and-statuses.md](workflow-and-statuses.md) | §50, §58–§61, §67–§68 | Auto-fill contract, smart actions, status machines, error prevention |
| [permissions-matrix.md](permissions-matrix.md) | §52 | Full role × permission grid |
| [dev-phases.md](dev-phases.md) | §77 | Phase-by-phase build plan mapped to schema files and modules |
| [test-plan.md](test-plan.md) | §78–§79 | Acceptance test and critical-case checklist |
| [DECISIONS.md](DECISIONS.md) | — | Open questions and the calls made to keep V1 moving |
