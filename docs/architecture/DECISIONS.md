# Decisions & Open Questions

This document records calls made while turning the blueprint into an
implementable architecture, so a later reader can see *why* something is the
way it is instead of re-litigating it. Each entry cites the blueprint section
it serves and marks whether it is a firm decision or an assumption pending
confirmation.

## §0 — Technology stack: DECIDED

Repository inspection before Phase 1 (per the scope-freeze phase's explicit
instruction to inspect before assuming) confirmed no application code, no
package manifest, and no framework config exist anywhere in this
repository — only documentation and the reference schema. The "keep the
existing stack if sound" default therefore does not apply; there is no
existing stack to evaluate. Decided:

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere (backend, frontend, PWA) |
| Backend framework | NestJS (Node.js) |
| Database | PostgreSQL 16 — already the schema's native format (RLS, generated columns, `FOR UPDATE` row locks, `SET LOCAL` session context) |
| Query layer | Drizzle ORM, SQL-first, raw-SQL escape hatches for tenant context and row locking |
| Auth | Custom Passport-JWT + argon2 (multi-tenant membership and portal scoping don't map cleanly onto a managed IdP) |
| Background jobs | BullMQ + Redis |
| Documents/PDF | Server-rendered HTML/CSS through headless Chromium (Puppeteer), one shared template set |
| File storage | S3-compatible object storage, signed URLs |
| Frontend | React + Vite, Ant Design, TanStack Query, React Hook Form + Zod |
| Mobile | Responsive installable PWA, not a native app, for V1 |
| Hosting | AWS, `ap-south-1` (Mumbai) — data residency for an Indian customer base |

Full reasoning, including the two closer calls (Ant Design vs. shadcn, and
custom auth vs. a managed provider) and why each choice fits the
already-committed schema design (RLS, ledger-first stock/usage,
`FOR UPDATE` numbering, JSON document snapshots), was given in chat when
this was first proposed and is not restated here — this entry exists so a
later reader has the decision without needing that conversation. This
closes the one item that was blocking Phase 1 from starting.

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

## §15 — V1 decisions locked; extensibility verified against actual schema, not assumed

All ten decisions in the scope-freeze phase's approval message are locked
for V1. Three of them came with an explicit extensibility requirement
("don't foreclose this later") — each was checked against the real schema
rather than taken on faith:

- **Approval workflow (Draft→Approved only in V1):** implemented as a
  single-step instance of the *same* generic `approval_chain_templates` /
  `approval_instances` / `approval_steps` tables `schema/70_documents_governance.sql`
  already defines, not a separate simpler mechanism. V1.1's multi-level
  chains are a seed-data and UI addition on the identical tables, never a
  parallel system to migrate off later.
- **Packing List (folded into Dispatch's header totals for V1):**
  `packing_lists`/`packing_list_lines` already exist as fully independent
  tables in `schema/50_outbound.sql`, not derived from `dispatch_lines`.
  V1.1 exposing a standalone Packing List is a new data-loader function
  (the same pattern every `document-engine.md` document type already
  follows) reading Pick List/Dispatch quantities at generation time — it
  needs no change to `dispatches` or `dispatch_lines` at all.
- **Returns (deferred to V1.1):** `stock_ledger.txn_type` already includes
  `'RETURN'` in its check constraint, and `source_type` already includes
  `'return_inward'`, in `schema/40_stock.sql`. The stock engine has
  supported a future Returns module since it was first written; V1
  building no UI for it changes nothing about that.
- **Entitlement engine (action-metering only in V1, no seat/record
  counts):** a future "max 3 warehouses on Starter" limit reuses the exact
  same `plans`/`plan_feature_limits` rows a document-generation limit
  uses — only the resolver differs (compare a live `count(*)` against
  `limit_value` instead of reading `usage_counters`). No second
  entitlement model is needed; confirmed, not assumed.
- **Payment gateway (manual activation only in V1):** the manual flow
  (upgrade request → admin action → active subscription) is not a stopgap
  bolted on before the "real" design — it's the same `tenant_subscriptions`
  update and `subscription_events` row (`source = 'admin'`) that a gateway
  webhook will write later (`source = 'gateway_webhook'`), per
  `entitlement-engine.md` §8. Building the manual path now *is* building
  the real path; V1.1 adds a gateway adapter, it doesn't replace anything.

## §16 — `unique (tenant_id, code)` doesn't dedupe system-seeded rows; fixed

Found while writing the seed script for `roles` in Phase 1A's next
increment. Five tables (`roles`, `charge_types`, `tax_rates`,
`notification_rules`, and `products` via its nullable `customer_id`) use a
nullable tenant/customer column commented "null = system-seeded/shared"
paired with a composite `unique (tenant_id, code)` constraint intended to
also keep those shared rows unique among themselves. SQL's standard
uniqueness semantics treat every `NULL` as distinct from every other
`NULL`, so that constraint silently permitted unlimited duplicate
`(NULL, 'owner')`-shaped rows — a real data-integrity gap, not a
hypothetical one, since a naively-idempotent seed script (`INSERT ...
ON CONFLICT (tenant_id, code) DO NOTHING`) would have created a fresh
duplicate `owner` role on every deploy.

Fixed additively in `schema/85_integrity_fixes.sql`: one partial unique
index per table (`... where tenant_id is null`, or
`where customer_id is null` for `products`), applied after
`schema/80_subscription.sql`. No existing column, table shape, or
composite constraint changed — the fix only closes the gap the comments
already claimed was closed. Verified: the full ten-file sequence applies
cleanly to a fresh database, and applying just the new file against the
already-migrated `warehouse_dev` database (via `apps/api`'s migration
runner) correctly ran only `85_integrity_fixes.sql` and skipped the rest.

## §17 — Row-level security was specified, never actually written; now is

`tenancy-and-security.md` §1 has said since the architecture phase that
every tenant-scoped table gets `ENABLE ROW LEVEL SECURITY` with a
`USING (tenant_id = current_setting('app.tenant_id')::uuid)` policy, and
`dev-phases.md`'s Phase 1 exit criteria assumes it. Found while wiring
per-request tenant context for auth in Phase 1A's next increment: no
`schema/*.sql` file actually contained a `create policy` statement. The
design was real; the SQL implementing it was not.

Fixed in `schema/90_row_level_security.sql`, generated from
`information_schema` rather than hand-enumerated, covering all ~90
tenant-scoped tables in one migration:

- `FORCE ROW LEVEL SECURITY` on every table, not just `ENABLE` — the
  application connects as the same role that owns these tables (it ran
  the migrations), and RLS does not apply to a table's owner without
  `FORCE`. Missing this would have made the whole migration a silent
  no-op for every real query while looking correct in `pg_policies`.
- The five nullable-`tenant_id` "system-shared" tables from §16 get
  `tenant_id = current_setting(...) OR tenant_id IS NULL` instead of
  plain equality, so system-seeded rows stay visible to every tenant
  instead of becoming invisible to all of them.
- `role_permissions` has no `tenant_id` column of its own (unlike every
  other child table in this schema, which redundantly carries one
  specifically to keep RLS a single-column check); its policy instead
  joins to `roles` to inherit that table's tenant/shared visibility.
  Defense-in-depth for a capability V1 doesn't use yet (tenant-owned
  custom roles), written now rather than left as a gap to rediscover
  later.

Verified against a real database, not just applied: as the application's
own connection role (`warehouse_app`, owning the tables), tenant A cannot
read tenant B's rows, a request with no `app.tenant_id` set sees zero
rows anywhere (fail-closed, not an error and not everything), tenant A
cannot INSERT a row claiming tenant B's `tenant_id` (rejected by
`WITH CHECK`), and a system-seeded row (e.g. the `owner` role) is visible
identically to both tenants.

Those checks used one fresh `psql` connection per test, which turned out
to hide a real bug from them — see §18.

## §18 — Postgres custom GUCs reset to `''`, not `NULL`, after the first use on a pooled connection

Found building `GET /auth/me` against a real request, not a fresh `psql`
session: the second transaction to ever run `current_setting('app.tenant_id',
true)` on a given physical connection returned `''` (empty string), not
`NULL`, once an earlier transaction on that same connection had `SET
LOCAL`'d it at least once. Reproduced directly and minimally:

```sql
begin; select set_config('app.test_probe', 'hello', true); commit;
begin; select current_setting('app.test_probe', true); commit;
-- returns '' , not NULL
```

This is standard Postgres behavior for custom ("placeholder") GUCs, not a
bug in this schema, but every RLS policy in `schema/90_row_level_security.sql`
and `schema/91_tenant_users_self_lookup.sql` cast the raw result straight to
`::uuid`, and `''::uuid` raises a hard error rather than evaluating to
false — turning "no tenant context set on this request" from a silent,
safe zero-rows result into a 500. It went unnoticed in §17's verification
because every one of those tests used a brand-new `psql` connection, where
the setting had truly never been touched and `current_setting` genuinely
returns `NULL` the first time. `apps/api`'s postgres.js pool reuses
physical connections across unrelated requests by design, so in the real
application this isn't an edge case — it's what happens on the very next
authenticated request to land on a connection that previously served one.

Fixed in `schema/92_rls_empty_string_guard.sql`: every policy's
`current_setting(...)::uuid` becomes `nullif(current_setting(...), '')::uuid`,
converting the empty-string reset value to a true `NULL` before the cast,
so the comparison evaluates to false (no rows) instead of erroring — the
originally-intended fail-*safe* behavior, not fail-*loud*. Re-verified with
the exact reused-connection scenario that exposed it (two transactions on
one session, the second never re-setting `app.tenant_id`) and, end to end,
by calling `GET /auth/me` three times in a row and switching between two
tenants' tokens on the same running server without a single error.

This is also a reminder for future schema/RLS work: **verify against the
real connection-pooled application, not only fresh manual sessions** — a
fresh session's `current_setting` semantics are not the same as a reused
one's for custom GUCs.
