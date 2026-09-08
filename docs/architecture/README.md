# Architecture — Engineering Interpretation of the Blueprint

This folder translates the [product blueprint](../blueprint/README.md) and
the [SaaS layer blueprint](../blueprint-saas-layer/README.md) into concrete
engineering decisions: data model, numbering, permissions, billing rules,
document generation, entitlements/monetization, UX system, and the delivery
plan. Nothing here should contradict either blueprint; where a blueprint
leaves an implementation detail open, the decision made is recorded in
[DECISIONS.md](DECISIONS.md) with the section it serves.

No technology stack has been chosen yet (see `DECISIONS.md` §0). Everything
below is written to be implementable on any mainstream relational database and
backend framework — the schema uses plain PostgreSQL DDL as the most precise,
portable notation, not as a statement that Postgres is the final choice.

## Contents

| Document | Blueprint refs | Covers |
|---|---|---|
| [schema/](schema/README.md) | §7–§51, saas-layer §6–§17 | Full reference data model, one file per domain |
| [tenancy-and-security.md](tenancy-and-security.md) | §6, §52, §69 | Multi-tenancy strategy, RBAC, server-side authorization |
| [numbering.md](numbering.md) | §62, §16–§43 (all numbered docs) | Centralized document numbering engine |
| [stock-engine.md](stock-engine.md) | §23–§28, §61, §70 | Ledger-first stock model, invariants, idempotency |
| [billing-engine.md](billing-engine.md) | §13, §38–§40, §66 | Rate resolution, charge computation, billing run → invoice |
| [document-engine.md](document-engine.md) | §44–§49, §65, §75; saas-layer §11, §24, §31 | Centralized `generateDocument()`, design system, QR, versioning, entitlement gating, document relationships |
| [entitlement-engine.md](entitlement-engine.md) | saas-layer §6–§17, §41–§45 | Centralized subscription/plan/feature-limit engine, usage ledger, idempotent metering |
| [ux-system.md](ux-system.md) | saas-layer §18–§29, §34–§36, §41–§44, §47–§49 | Onboarding, empty states, dashboard, search, Document Centre, paywall/demo/error/success UX, Plan & Usage and pricing pages |
| [workflow-and-statuses.md](workflow-and-statuses.md) | §50, §58–§61, §67–§68 | Auto-fill contract, smart actions, status machines, error prevention |
| [permissions-matrix.md](permissions-matrix.md) | §52, saas-layer §14 | Full role × permission grid, RBAC vs. entitlement distinction |
| [dev-phases.md](dev-phases.md) | §77 | Phase-by-phase build plan mapped to schema files and modules |
| [test-plan.md](test-plan.md) | §78–§79, saas-layer §6–§17 | Acceptance test, critical-case checklist, entitlement-engine test cases |
| [v1-scope-specification.md](v1-scope-specification.md) | scope-freeze direction | The frozen V1 document list, deferred items, workflow map, auto-fill/subscription matrices, screen map, gap analysis, launch blockers, and open decisions |
| [DECISIONS.md](DECISIONS.md) | — | Open questions and the calls made to keep V1 moving |
