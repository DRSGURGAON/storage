# Decisions & Open Questions

This document records calls made while turning the blueprint into an
implementable architecture, so a later reader can see *why* something is the
way it is instead of re-litigating it. Each entry cites the blueprint section
it serves and marks whether it is a firm decision or an assumption pending
confirmation.

## §0 — Technology stack: not yet decided

The blueprint specifies product behavior, not a stack. Nothing in this
repository commits to a language, framework, database engine, or hosting
model. The reference schema (`schema/*.sql`) is written in plain PostgreSQL
DDL because it is the most precise, portable way to pin down the data model —
not because Postgres has been chosen over another RDBMS. **Action needed:**
before Phase 1 of `dev-phases.md` starts, pick: backend language/framework,
frontend framework, database engine, object storage for attachments, PDF
rendering approach, and hosting/deployment target. This is the single biggest
open item blocking actual code.

## §1 — Multi-tenancy: shared database, `tenant_id` column + RLS

Chosen over "database per tenant" or "schema per tenant" because it scales
to many small/medium warehousing businesses without an operational burden of
migrating hundreds of databases per schema change, while row-level security
gives the same isolation guarantee the blueprint demands (§6, §69). If a
future enterprise tenant needs a dedicated database for compliance reasons,
that is a deployment-level decision (route that tenant's connection string
elsewhere) that does not change the schema.

## §2 — Stock balance is derived, ledger is authoritative

`stock_lots` is a materialised view over `stock_ledger`, never written
directly (`stock-engine.md` §1). This is a firm decision, not a preference:
the blueprint's explicit ban on "arbitrary direct editing of current stock"
(§23) and its traceability requirement (§67) are close to impossible to
guarantee any other way.

## §3 — Outward stock posting point: Gate Pass gate-out (default, configurable)

The blueprint's lifecycle diagram (§68) shows "Gate out → stock automatically
reduces," which this architecture takes as the default trigger. A
`tenant_settings['workflow.outward_posting_point']` key allows a tenant
without vehicle gate tracking to instead post at Dispatch confirmation. The
schema does not need to change either way — only which service call fires
the `OUTWARD` ledger insert.

## §4 — Rate card scope resolution order

§13 specifies "Customer-specific → Warehouse-specific → Default company
rate" as the priority. This architecture treats "customer-specific" as
potentially further narrowed by warehouse within the customer's own rate
card (a customer might store differently-priced goods in two warehouses).
This is an interpretation, not stated explicitly in the blueprint — flag for
confirmation if a customer should instead have exactly one rate card
regardless of warehouse.

## §5 — Warehouse Receipt is explicitly non-negotiable

Per §22's direct instruction ("do not call it a negotiable/WDRA warehouse
receipt"), `warehouse_receipts` has no fields suggesting negotiability
(no endorsement/transfer-of-title fields) and its document template must
carry a visible "Operational Warehouse Receipt — not a document of title"
label. This is a compliance-driven firm decision, not a stylistic one.

## §6 — Discrepancy Report and Inspection are shared between Inward and Returns

The blueprint describes Discrepancy (§19) and Inspection (§20) in the
context of GRN, but Returns (§37) also names "Return Inspection Report" and
implies damage/shortage handling on the way back in. Rather than duplicate
these as separate tables, `discrepancy_reports` and `inspections` carry both
a `grn_id` and a `return_inward_id` (mutually exclusive in practice) so one
engine serves both flows. Confirm this matches intent rather than wanting
fully separate Return-side documents.

## §7 — Debit Note numbering prefix

§41 and §33 both use "DN" naturally (Debit Note vs. Dispatch Note). This
architecture assigns Dispatch Note the `DN` prefix (matching its blueprint
usage in the §68 lifecycle diagram) and Debit Note `DN2`, both editable per
tenant in `number_series`. Purely a default-seed choice, not a behavioral
one — a tenant can rename either prefix.

## §8 — Storage accrual granularity

§66 requires transparent Quantity/Pallet/Area × Days/Month × Rate
calculation. This architecture reconstructs daily quantity-on-hand from
`stock_ledger` for day-based bases, and calendar-month snapshots for
month-based bases (`billing-engine.md` §4). An alternative — snapshotting
end-of-day stock into a dedicated daily-balance table for performance at
scale — is deferred; flagged here so it isn't forgotten if billing-run
performance becomes a problem with a large ledger.

## §9 — Sections 56–82 arrived after initial drafting

The blueprint was delivered in two parts. All 82 sections are now reflected
in `../blueprint/` and this architecture folder. No section is outstanding.

## §10 — Audit performed for the saas-layer blueprint (product architecture, UX, subscription engine)

A second blueprint arrived requesting a project audit before any further
work. The audit was performed by inspecting the actual repository state
directly, not assumed: as of that request, the repository contained only
the documentation and schema from §1–§9 above — no frontend, backend,
running database, authentication, PDF generation, or subscription logic
existed. The audit's findings (current state, what's good, what must
change, what should not be touched, proposed architecture, implementation
order) were reported in that turn and are not duplicated here; nothing in
the existing schema or design docs was found to need rework, only
extension. See `../blueprint-saas-layer/README.md` for the process rule
that prompted this and `entitlement-engine.md` for the resulting design.

## §11 — Entitlement engine mirrors the stock engine's ledger-first pattern

`usage_counters` (schema/80_subscription.sql) is a materialised view over
`usage_ledger`, exactly as `stock_lots` is over `stock_ledger`
(`stock-engine.md` §1). This was a deliberate reuse of an already-proven
pattern in this codebase rather than a new design, for the same reason:
the saas-layer blueprint's ban on double-consuming usage on a retry (§10)
and its audit requirement (§9 of that document) are best guaranteed
structurally, not by convention.

## §12 — Feature-disabled is the default when a plan has no row for a feature

`entitlement-engine.md` §3 resolves an unconfigured `(plan, feature)` pair
to `disabled` rather than `unlimited`. This is a fail-closed choice: a new
feature added to `feature_keys` without also adding `plan_feature_limits`
rows is off for every plan until explicitly enabled, rather than
accidentally free for everyone. Confirm this matches intent if a future
feature should default to available-on-all-plans instead.

## §13 — Payment gateway: not yet chosen

`entitlement-engine.md` §8 and `dev-phases.md`'s Phase 8 entry deliberately
keep `tenant_subscriptions.payment_gateway` and related columns generic.
Common choices for an India-first SaaS are Razorpay and Cashfree; neither
has been selected. **Action needed** before Phase 8's payment integration
work starts: pick the gateway (subscription/recurring-billing support,
webhook reliability, and settlement timelines are the relevant criteria),
matching this document's existing practice of naming stack decisions as
explicit open items rather than silently assuming one.

## §14 — "Two free copies" is Free-plan seed data, not a constant

Per saas-layer §16's explicit instruction, the number 2 is never written
into application code. It exists exactly once, as
`plan_feature_limits.limit_value = 2` on the seeded `FREE` plan's
document-generation feature rows. Confirm the intended free allowance is
uniform across all document-generation features (GRN, Invoice, Gate Pass,
Quotation, POD, …) as the blueprint's examples suggest — if any feature
should have a different free allowance than others, that's still just a
different seed row, not an architecture change, but the seed data itself
needs that input.
