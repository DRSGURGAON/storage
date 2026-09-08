# Product Blueprint — SaaS Layer (UX, Architecture & Subscription Engine)

This is a **second, distinct blueprint document**, layered on top of the
original functional blueprint in [`../blueprint/`](../blueprint/README.md).
Where that document specifies *what the warehouse workflows do*, this one
specifies *how the product must feel and monetize as a SaaS business*: the
UX system, the document lifecycle experience, and — critically — a
centralized subscription/entitlement engine.

Section numbers here (1–51) are this document's own numbering and are
independent of the functional blueprint's §1–82. Where the two overlap
(e.g. auto-fill, document centre, QR verification), this document
reinforces and extends the same requirement rather than replacing it — no
content in `../blueprint/` is superseded by anything here.

## Process note (§1)

Before any significant code is written or modified, audit the existing
project state first: inspect frontend, backend, database, auth, routing,
components, document/PDF generation, subscription logic, UI design system,
APIs, and storage; identify what's reusable, what's broken, what's
duplicated, what's insecure, and what would block SaaS scale; report before
implementing. See [`../architecture/DECISIONS.md`](../architecture/DECISIONS.md)
for the audit performed against this repository's actual state.

## Contents

| File | Sections | Topic |
|---|---|---|
| [00-positioning-principles-scope.md](00-positioning-principles-scope.md) | 2–5 | Product positioning, enter-once-autofill-everywhere, connected workflow, V1 scope guardrails |
| [01-subscription-entitlement-engine.md](01-subscription-entitlement-engine.md) | 6–17 | Centralized entitlement engine, free-copy rule, usage tracking, idempotency, plan/feature architecture |
| [02-onboarding-ux-document-centre.md](02-onboarding-ux-document-centre.md) | 18–29 | Onboarding, empty states, dashboard, global search, document centre/lifecycle/relationships/timeline, smart next-actions, auto-fill UX, smart forms, drafts |
| [03-document-engine-and-portal.md](03-document-engine-and-portal.md) | 30–33 | Professional PDF system, preview, QR verification, customer portal |
| [04-design-system-responsive-mobile.md](04-design-system-responsive-mobile.md) | 34–36 | Visual design direction, responsive workflows, mobile document capture |
| [05-security-stock-audit.md](05-security-stock-audit.md) | 37–39 | Security, stock integrity, audit log |
| [06-billing-and-monetization-ux.md](06-billing-and-monetization-ux.md) | 40–45 | Billing architecture, subscription UX, usage indicators, Plan & Usage page, pricing page, payment integration abstraction |
| [07-demo-error-success-performance-data-principles.md](07-demo-error-success-performance-data-principles.md) | 46–51 | Demo vs. real data, error/success UX, performance, database entity principle, no-duplicated-business-logic rule |

The engineering interpretation lives in [`../architecture`](../architecture/README.md),
specifically [`entitlement-engine.md`](../architecture/entitlement-engine.md),
[`ux-system.md`](../architecture/ux-system.md), and
[`schema/80_subscription.sql`](../architecture/schema/80_subscription.sql).
