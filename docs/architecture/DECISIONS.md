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

## §19 — `checkEntitlement`/`consumeEntitlement` write responsibility, clarified during implementation

`entitlement-engine.md` described both functions and said a "blocked"
attempt writes a `usage_ledger` row for auditability, but not which
function owns that write, and `checkEntitlement`'s own params
(`tenantId`, `featureCode`) have no `idempotencyKey` or `sourceId` to write
a meaningful ledger row with. Resolved while implementing
`apps/api/src/entitlement/entitlement.service.ts`:

- **`checkEntitlement`** is a cheap, side-effect-free read, safe to call as
  often as a screen likes (usage badges, paywall pre-checks) without
  generating audit noise.
- **`consumeEntitlement`** is the single atomic operation that re-checks
  the limit *inside the same transaction* as recording the outcome, and
  owns every `usage_ledger` write for both `'success'` and `'blocked'`
  results. Re-checking here rather than trusting an earlier
  `checkEntitlement` call is what prevents two concurrent requests from
  both seeing "1 remaining" and both succeeding — a `FOR UPDATE` lock on
  the `usage_counters` row serializes them, the same discipline as
  `numbering.md`'s `allocateNumber()`.
- **`recordFailedAttempt`** is a third method, not in the original doc:
  for the case where the generation work itself throws *before*
  `consumeEntitlement` would even be called (nothing to atomically
  check-and-consume, just an audit record that an attempt happened and
  didn't consume anything).

A real bug surfaced writing the test for this: `consumeEntitlement`'s
return value initially reused the same `evaluate()` result whether or not
*this* call was the one that consumed a unit. For the second of two
allowed calls on a 2-copy limit, `evaluate()` correctly reports "no
future call is allowed" (`remaining: 0`) — but that got returned as
`allowed: false` for the call that had, in fact, just succeeded. Fixed:
a successful consumption always reports `allowed: true` for itself;
`upgradeRequired` (not `allowed`) is what signals "that was the last
one." Caught by asserting the exact response shape of the second of three
sequential calls, not just the third (blocked) one — a test that only
checked the final blocked call would have missed this.

## §20 — `number_series` had the same nullable-unique gap as §16

Found implementing `allocateNumber()`. `number_series.warehouse_id` is
nullable ("optional per-warehouse series" — most document types get one
tenant-wide series, `warehouse_id` null) and
`unique (tenant_id, document_type, warehouse_id)` is the composite
constraint meant to keep each series unique. Same bug as §16: SQL treats
every `NULL` as distinct for uniqueness, so two rows for the same
`(tenant, document_type)` with `warehouse_id` null — the common case —
would not be caught as duplicates. A lazy-init `allocateNumber()` call
("create this tenant's GE series if it doesn't exist yet") racing itself
would have silently created two competing series instead of upserting
into one. Fixed the same way, additively, in
`schema/93_number_series_null_warehouse_fix.sql`.

## §21 — postgres.js returns `bigint` columns as strings; `number_series.next_seq` arithmetic silently broke

Found by the numbering test suite itself, not by review: the second and
third sequence numbers for the same series came back as `21` and `211`
instead of `2` and `3`. `number_series.next_seq` is `bigint` (chosen so a
tenant can never overflow it at document-numbering volumes), and
postgres.js deliberately returns `bigint` columns as JavaScript strings
rather than numbers, to avoid silent precision loss above
`Number.MAX_SAFE_INTEGER`. `NumberingService`'s own `SeriesRow` interface
declared `next_seq: number`, so nothing caught it at compile time —
`seq + 1` was silently doing string concatenation (`"2" + 1 -> "21"`)
instead of arithmetic. Fixed by declaring the field's real runtime type
(`next_seq: string`) and converting once with `Number(...)` before any
arithmetic, with the reasoning for the conversion's safety (fine at this
column's realistic scale) written down next to it rather than left
implicit. Worth remembering for any other `bigint` column read through
postgres.js in this codebase — the type declaration has to say `string`,
or a future `+ 1` will pass TypeScript and silently misbehave exactly
like this one did.

## §22 — `agreement_templates` had the same nullable-tenant_id gap as §16, caught before it bit

Same root cause as §16 (roles/charge_types/tax_rates/notification_rules):
`agreement_templates.tenant_id` is nullable ("null = system default
template") with a comment implying system-wide rows should be unique
among themselves, but the table has *no* uniqueness constraint on it at
all — not even the composite one §16's tables had. This one wasn't found
by a failing test; it was caught while writing `seed.ts`'s insert for the
one system default template required for Phase 3's Agreement feature,
before the code that would have exposed it (repeated `npm run seed` runs
silently duplicating the row) ever ran. Fixed the same way as §16:
`schema/94_agreement_template_system_uq.sql` adds
`agreement_templates_system_name_uq`, a partial unique index on `(name)
where tenant_id is null`, so `on conflict (name) where tenant_id is null`
has a real target and the seed is idempotent — verified by running `npm
run seed` twice and confirming exactly one system-default row exists
afterward, not by inspection alone.

## §23 — `db/seed.ts` used its own bare postgres.js connection, not `createDbConnection()` — jsonb columns came back double-encoded

Found while seeding the system default agreement template (§22):
`agreement_templates.clauses` round-tripped as a jsonb *string* holding
escaped JSON text (`jsonb_typeof` = `'string'`), not a jsonb array, even
though the insert used the same `${JSON.stringify(value)}::jsonb` pattern
`AuditService.record()` already used successfully everywhere else in the
app. Isolated with a series of throwaway repro scripts (see the session
transcript for the full trail) down to one variable: `db/seed.ts` created
its own connection with a bare `postgres(databaseUrl, { max: 1 })`, while
every other write path goes through `db/client.ts`'s `createDbConnection()`,
which additionally wraps that same connection with `drizzle(sql)`.
`drizzle()`'s wrapping changes how postgres.js resolves a jsonb-cast
parameter — with it, `JSON.stringify(x)::jsonb` round-trips correctly (an
object stored as a real jsonb object); without it, the same code
double-encodes. (Other combinations were tried and are *not* the fix:
passing the raw object without `JSON.stringify` breaks the
`drizzle()`-wrapped path when a query has more than one jsonb parameter,
as `AuditService.record()`'s insert does — reverting AuditService's
pattern to match my first, drizzle-unaware hypothesis would have broken
its two-jsonb-column insert instead of fixing anything. postgres.js's own
`sql.json()` helper fails outright under the `drizzle()`-wrapped
connection, single param or not.)

Given that fragility, the fix is not a different serialization idiom —
it's removing the divergence that caused it. `db/seed.ts` now calls the
same `createDbConnection()` factory as the running app instead of
instantiating its own connection, so every write path shares one proven
jsonb behavior instead of two silently different ones. Verified by
re-running `npm run seed` and confirming `jsonb_typeof(clauses) = 'array'`
with the expected element count, not by re-reasoning about the driver.

Lesson for this codebase: any script that binds a value to a jsonb column
must go through `db/client.ts`'s `createDbConnection()`, not a bare
`postgres(...)` connection of its own — the two are not equivalent for
jsonb parameters, and the difference is invisible from the query code,
only from what actually comes back. `db/migrate.ts` keeps its own bare
connection deliberately (it needs an `onnotice` override
`createDbConnection()` doesn't expose, and it only ever runs raw DDL from
the schema files — no jsonb parameter binding, so it isn't exposed to
this bug); anything that starts binding jsonb parameters would need to
move onto the shared factory or gain the same wrapping some other way.

## §24 — Document engine implementation: Puppeteer per §0 (not re-decided), `qrcode`, and local-filesystem attachment storage behind an interface

`document-engine.md` specifies the design system's *shape* (one shared
A4 layout, header/title/party/table/totals/signature/QR/footer blocks)
but the actual rendering library was not an open question here — §0
already decided it, back in Phase 1's stack table: *"Documents/PDF:
Server-rendered HTML/CSS through headless Chromium (Puppeteer), one
shared template set."* Building the engine now means implementing that,
not re-opening it. (An earlier draft of this entry picked Playwright
instead, reasoning from this session's environment having Playwright's
browser cache pre-configured rather than from checking §0 first — caught
before committing any code, by rereading DECISIONS.md itself. Left in
here as a reminder: check what's already been decided before deciding
again, even the second time you write a "decision" entry.) Implemented
with `puppeteer-core` — no bundled browser download, since one already
needs to be pointed at either way — driving the same headless Chromium
this session's environment provides at `/opt/pw-browsers/chromium`
(`PLAYWRIGHT_BROWSERS_PATH`; the env var name is Playwright's own, but
the binary itself is a normal Chromium build any CDP-speaking driver,
Puppeteer included, can launch). Verified directly: `puppeteer-core`
against that binary needs `--no-sandbox` (this container runs as root,
and Chromium's sandbox requires either a non-root user or that flag —
confirmed by hitting `ERROR: Running as root without --no-sandbox is not
supported` on the first attempt, not assumed). `PdfRendererService`
reads an optional `PUPPETEER_CHROMIUM_EXECUTABLE` env var and only
passes `executablePath` when it's set, so a real deployment that ran its
own `npx puppeteer browsers install chrome` (or points at a system
Chromium another way) runs the identical code path unmodified.

Considered pdfkit/pdf-lib (draw text and shapes imperatively, no CSS)
as an alternative to §0's own choice and rejected reopening it in their
favor: this codebase's specific requirement is *one* shared design
system reused unmodified by ~23 document types (`document-engine.md`
§3), and CSS makes "one header partial, one footer partial, one
line-item table style" trivial and visually enforced, where an
imperative drawing API means re-deriving x/y positions by hand per
template with nothing structurally preventing drift from the shared
look — the same reasoning §0 itself must have used. No templating
engine (Handlebars/EJS) was added on top of Puppeteer — the codebase's
existing pattern (`AgreementsService`'s own placeholder resolver) is
small hand-written TypeScript functions over a new dependency for
something this size, so each document type's HTML is built the same
way: composable functions returning escaped HTML strings, sharing one
CSS block. The operational cost is real and worth naming plainly: every
render spins up a headless browser process, heavier than a pure-JS PDF
library, and needs a Chromium-capable container image in production —
accepted because it's what §0 already committed to, and the alternative
would fail the shared-design-system requirement structurally, not just
cosmetically.

**QR codes: the `qrcode` npm package.** Single-purpose, no native
dependency, `toDataURL()` embeds directly as an `<img>` src before
Puppeteer renders the page — no separate image-file step.

**Attachment storage: an `AttachmentStorage` interface, with
`LocalFilesystemAttachmentStorage` as the only implementation for now.**
This is the one place V1 does not literally follow this repository's own
`README`-level architecture note ("File storage: S3-compatible object
storage, signed URLs") — because no object-storage bucket or credentials
exist in this environment to point at, and inventing one would be
choosing infrastructure the user hasn't provisioned, not a technology
decision this session can make unilaterally. `tenancy-and-security.md`
itself already sanctions the fallback taken here, verbatim: "Downloads
are served via short-lived signed URLs **(or a proxy endpoint)**..." —
V1 implements the proxy-endpoint half of that either/or:
`GET /documents/:id/download` re-authenticates the caller (JWT +
`view_documents` + tenant match) on every request and streams the file
from local disk, rather than issuing a bearer-token signed URL. Nothing
in `attachments.storage_key`'s meaning changes (still an opaque path,
never a public URL); only *which* implementation resolves it does. A
real `S3AttachmentStorage` is a drop-in second implementation of the
same interface — swapping it in requires no change to `documents`,
`attachments`, or any caller, only a different provider bound in
`AttachmentsModule`. This is flagged here explicitly so it reads as a
deliberate, documented gap — not a silent substitution of the locked
architecture.

## §25 — `documents` had the same "no session, no rows" gap as §17 — the public `/verify/:qrToken` endpoint needed its own self-lookup RLS policy

Manually curling the freshly built `GET /verify/:qrToken` against a real,
just-committed document returned `{"result":"not_found"}` for a token
that genuinely existed. Root cause was the same class of bug already
seen once before and fixed as §17/`91_tenant_users_self_lookup.sql`:
`documents` carries `force row level security` with only
`tenant_isolation` (`tenant_id = current_setting('app.tenant_id')::uuid`)
from `90_row_level_security.sql`, and the whole point of the verify
endpoint is that it runs with **no** JWT and **no** tenant context at
all — discovering which tenant a document belongs to *is* the lookup.
With `app.tenant_id` unset, `tenant_isolation` blocks every row,
unconditionally, every time.

Fixed the same way §17 was: not by weakening `tenant_isolation` or
adding a blanket `using(true)` policy (which would let any caller list
every tenant's documents), but with a second, narrow, SELECT-only policy
additional to it —
`docs/architecture/schema/95_document_qr_verify_lookup.sql`:
```sql
create policy qr_verify_lookup on documents
  for select
  using (qr_token = current_setting('app.verify_qr_token', true));
```
A row becomes visible under this policy only when its own `qr_token`
matches a session variable the *caller* sets to the exact value it's
looking up — so seeing one document requires already possessing that
document's own random, unguessable token (`document-engine.md` §4), the
same shape as `tenant_users`' self-lookup requiring an already-verified
user id. It cannot be used to enumerate other tenants' documents (there
is no way to iterate `qr_token` values you don't already have), and it's
SELECT-only. `VerifyService.verify()` sets that session variable inside
an explicit `sql.begin()` transaction (`set_config('app.verify_qr_token',
qrToken, true)`, the `true` making it transaction-local) before running
the lookup, then re-scopes to the discovered tenant via `withTenant` for
everything after — recording the `document_verifications` row and
resolving the source record's live status through its template's
`loadData`.

One more check worth recording rather than assuming: unlike the
UUID-cast policies elsewhere in this schema, this comparison is plain
text (`qr_token = current_setting(...)`), so it doesn't need a `nullif`
guard against the "empty string after GUC reset" failure mode §18 found
— `qr_token = ''` just evaluates to `false` harmlessly here, it never
throws a cast error the way `''::uuid` would.

Verified against the live database end-to-end, not just re-read: a
valid token resolves `result: 'valid'` with the correct document number,
issuer trade name, and current status; a superseded token (after
`regenerate: true`) resolves `result: 'revoked'`, not 404, while the new
version's token resolves `valid`; an unknown token resolves
`not_found`. (A stale `node dist/main.js` process from before the fix
briefly masked this during re-testing — `pkill` reported success but
left the old PID holding port 3000, so the "confirmed" first pass was
actually against pre-fix code. Caught by `ps aux | grep "node dist/main"`
showing two PIDs; `kill -9` on the stale one and a clean restart before
re-verifying for real.)

## §26 — `puppeteer-core` is ESM-only; Jest's module loader can't `require()` it the way plain Node can

Writing `documents.spec.ts` hit `SyntaxError: Cannot use import
statement outside a module`, pointing at `puppeteer-core`'s own entry
file, the moment any test imported `AppModule`. The live server (`node
dist/main.js`) had already been rendering real PDFs for hours by this
point with no such error, so this wasn't `PdfRendererService` being
broken — it was Jest's module loader being a different thing from plain
Node's.

`puppeteer-core@25`'s `package.json` declares `"type": "module"` all the
way down its own files (not just a dual-published package with a CJS
fallback — `exports["."].require` points at the *same* ESM file as
`.import`). This project's `tsconfig.json` targets `module: commonjs`,
so `import puppeteer from 'puppeteer-core'` compiles to a plain
`require('puppeteer-core')`. Under plain Node 22+ that succeeds, because
Node itself gained the ability to `require()` an ESM module
synchronously (stable since Node 22.12, and this environment runs
22.22). Jest does not run test files under plain Node `require` — its
own `jest-runtime` implements CommonJS module loading independently, and
that implementation doesn't have Node's require(-esm) interop, so the
identical `require('puppeteer-core')` call throws inside Jest even
though it works fine outside it.

The fix is not a Jest-only test hack; it replaces the static import with
a genuine dynamic `import()`, resolved lazily at first render rather
than at module load — something `PdfRendererService.getBrowser()` was
already structured to do lazily for the *browser launch* itself, so this
extends the same laziness one level further to the *module load*. The
one wrinkle: TypeScript's `commonjs` module target downlevels dynamic
`import()` right back into a wrapped `require()` (confirmed by
compiling a throwaway file and reading the emitted JS — not assumed),
which would hit the exact same Jest failure. Routing the call through
`new Function('return import("puppeteer-core")')` hides it from
TypeScript's compiler entirely (it's just a string literal from tsc's
point of view), so the emitted code contains a literal `import(...)`
expression that survives to runtime unchanged, rather than whatever tsc
would otherwise have rewritten it into.

That alone still wasn't enough, and this was verified, not assumed —
the first run under plain `jest` hung for minutes and then failed every
test touching `PdfRendererService` with `TypeError: A dynamic import
callback was invoked without --experimental-vm-modules`. Jest's own
test VM (`jest-runtime`, built on Node's `vm` module) intercepts *every*
dynamic `import()` executed inside it — including one reached through
`new Function`, which only hides the call from TypeScript's compiler,
not from the VM the compiled code actually runs in — and by default
refuses to let it through at all. The remaining piece is
`apps/api/package.json`'s `test`/`test:watch` scripts running Jest with
`NODE_OPTIONS=--experimental-vm-modules`, which is what makes Jest
service that `import()` call for real rather than rejecting it. Verified
by running the same suite both ways: identical `SyntaxError`/`TypeError`
failures without the flag, a real headless Chromium launching and real
PDFs rendering with it. This is a portability improvement, not merely a
workaround: it stops relying on Node 22's specific require(-esm) interop
at all, so the same production code would keep working under an older
Node major that lacks it — Jest is the only piece that needed the extra
flag.

## §27 — `db/client.ts` wraps the shared connection with `drizzle(sql)`, which silently turns `timestamptz` columns into strings, not `Date` objects, on every raw `postgres.js` query in the app

Building Gate Entry (blueprint §16), a curl smoke test against a
freshly built `PATCH /gate-entries/:id` (editing an already-created
entry, no `entryAt` in the request body) returned `500`, with the
server log showing `before.entry_at.toISOString is not a function`.
The `create()` path that had "worked" moments earlier, on closer look,
had the same bug in the opposite direction: `POST /gate-entries`
without an explicit `entryAt` hit `TypeError [ERR_INVALID_ARG_TYPE]:
... Received an instance of Date` from deep inside postgres.js's own
parameter-binding code, on `${dto.entryAt ?? new Date()}`.

Both stemmed from the same wrong assumption: that a `timestamptz`
column comes back from a raw `postgres.js` tagged-template query
(`` tx`select entry_at from gate_entries...` ``) as a native JS `Date`
— the everywhere-else-in-this-codebase row interfaces all type
`created_at`/`sent_at`/`approved_at`/etc. as `Date`, and nothing had
ever contradicted that, because every other timestamp column in this
codebase is either server-stamped with `now()` and never read back
into a new query, or (for actual editable dates like
`quotation_date`/`agreement_date`) a plain `date` column carried as a
`.toISOString().slice(0, 10)` string from day one — never a full
timestamp that gets round-tripped. Gate Entry's `entry_at`/`exit_at`
are the first `timestamptz` columns in this codebase that are both
client-settable *and* read back and reused (editing a gate entry
without changing its `entryAt` re-sends the value `update()` just
selected).

Root-caused, not guessed at: a one-off script confirmed `entry_at`
comes back as the *string* `"2026-09-09 13:52:55.329+00"`
(`typeof === 'string'`, `instanceof Date === false`) when queried
through `createDbConnection()`'s `sql` — but as a genuine `Date` object
when queried through a bare `postgres(DATABASE_URL)` client with no
other change. The only difference between the two is
`db/client.ts` also calling `drizzle(sql)` on the same instance before
returning it:
```ts
export function createDbConnection(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sql);   // <- mutates sql's own type parser registry
  return { sql, db };
}
```
`drizzle-orm/postgres-js` registers its own parser for `timestamptz`
(and, symmetrically, its own serializer for binding values back out) on
the underlying `postgres.js` instance it's handed — a side effect on
the *shared* connection object, not something scoped to Drizzle's own
query builder. This project deliberately never uses that query builder
(`db/client.ts`'s own comment: "there is deliberately no Drizzle schema
module yet"), but the raw `sql` tagged-template calls every service
in this codebase uses are the *same* object Drizzle mutated, so they
inherit its parser/serializer choices regardless. The serializer side
expects a string-shaped value, which is what turned a plain `new
Date()` into a wire-encoding crash instead of silently doing the wrong
thing.

Fixed in `gate-entries.service.ts` only (the only place this had a real
consequence): `GateEntryRow`'s `entry_at`/`exit_at`/`created_at`/
`updated_at` fields are typed `string`/`string | null`, matching what
the connection actually returns, with a comment recording why; `create()`
and `close()` already passed `new Date().toISOString()` rather than a
raw `Date` (matching `quotations`/`agreements`' own `.toISOString()`
pattern for their `date` columns), so those needed no change beyond
being *understood* correctly; `update()`'s `before.entry_at.toISOString()`
— wrong in the other direction, since `before.entry_at` was already a
string — is now just `before.entry_at`. Not fixed everywhere else in
the codebase: every other `Date`-typed timestamp field remains
technically mistyped by the same measure, but genuinely inert (never
re-serialized), so relabeling ~15 unrelated row interfaces across every
existing module for a distinction that changes no behavior there would
be exactly the unrequested, unrelated cleanup this project's own
discipline argues against — flagged here instead, so the next module
that round-trips a `timestamptz` (Inward's `inward_at`, most likely)
starts from a correct mental model rather than rediscovering this by a
second crash.

(Predicted correctly: Inward's own increment, immediately after this
one, does round-trip `inward_at` the same way in `update()` — written
correctly the first time, `${dto.inwardAt ?? before.inward_at}` with no
`.toISOString()`, because this entry existed to check against.)

## §28 — Inward's `customerId` was declared required in the DTO, contradicting the service's own "required directly, or via a gate entry" logic three lines below it

Building Inward (blueprint §17), a curl smoke test of the very first
documented use case — creating an Inward from an already-open Gate
Entry, supplying no `customerId` because the gate entry already has one
— failed with `400 { message: ["customerId must be a UUID"] }` before
`InwardsService.create()` ever ran. `class-validator`'s `ValidationPipe`
rejects a missing required field before the request reaches the
controller at all, so the service's own fallback logic
(`customerId = dto.customerId ?? gateEntry.customer_id`, and only then
a "customerId is required (directly, or via a gate entry that has one)"
check) was correct and never even got exercised — `create-inward.dto.ts`
still had `@IsUUID() customerId!: string` (required) from an earlier
draft, unchanged when the "or via a gate entry" fallback was written
into the service. The exact same shape as `AgreementsService`'s
`customerId` (required directly, or via an accepted `quotationId`) —
copied correctly at the service layer, not at the DTO layer.

Fixed by making the field `@IsOptional() @IsUUID() customerId?: string`
in `create-inward.dto.ts`, matching what the service already assumed.
Caught by curling the documented use case before writing the automated
test for it, not by reading the code back — the same discipline that
has caught every other DTO/service mismatch in this project so far.

## §29 — No Supplier master exists yet; Inward's `supplierId` stays optional-and-unenforced by design, not by oversight

`schema/10_masters.sql` has a full `suppliers` table (id, tenant_id,
customer_id, name, gstin, address, contact info, an
`(tenant_id, name, customer_id)` uniqueness constraint) — shaped exactly
like every other master in this codebase. But no blueprint section ever
numbers it (`01-master-data.md` never mentions "supplier"; the only
blueprint mentions are as a bare field on Inward's and GRN's own forms),
`permissions-matrix.md`'s Masters module seeds no `create_supplier` /
`view_supplier` / `edit_supplier` row the way it does for every other
master, and no prior phase built a `SuppliersModule`. Building one now,
as a side effect of Inward needing somewhere to point `supplierId`,
would mean inventing permission codes `permissions-matrix.md` — "the
seed data specification... source of truth" per its own header — never
specifies, which is exactly the kind of unilateral, undocumented
expansion of the locked architecture this project's discipline exists
to prevent.

`CreateInwardDto.supplierId` is optional and validated against the
`suppliers` table *if supplied* (so nothing here is broken — a caller
that already knows a real supplier row's id can use it, and a future
`SuppliersModule` would slot in as a drop-in, no `inwards` schema or
code change needed), while `supplierName` is a plain, always-usable
free-text field — the same "id optional + name optional, both usable
independently" shape already established for
`transporterId`/`transporterName` on Gate Entry and Inward's own
transport fields. A tenant can record a supplier by name today; nothing
about `supplierId` being effectively unreachable through this API right
now blocks Inward from being genuinely usable. Flagged here, in the
same spirit as §24's `LocalFilesystemAttachmentStorage` gap, so a real
Supplier master — if one turns out to be needed — is a deliberate future
decision, not something rediscovered as "why does this column go
nowhere."

## §30 — §26's `new Function` import shim resolved `import()` through Node's *process-wide* default callback, so every spec after the first to render a PDF failed

Phase 4's last increment pushed the number of spec files that render a
real PDF from two to five, and the full suite started failing two
`putaways.spec.ts` tests with `500`s whose server log read
`Error: Test environment has been torn down`, thrown from inside
§26's dynamic `import("puppeteer-core")`. Run on its own,
`putaways.spec.ts` passed every time — only the whole-suite run failed,
and only for the specs that happened to render *after* the first one.

The cause is in §26's own shim, not in anything Phase 4 added:

```ts
const importPuppeteerCore = new Function('return import("puppeteer-core")') as ...;
```

V8 gives a `new Function` body the **default** host-defined options, so
Node resolves its `import()` through the process-wide default dynamic
import callback rather than through the calling script's own. Jest
registers that default callback once, from whichever test environment
happens to be created first, and then gives **each test file** its own
environment which it tears down when that file finishes. So the first
spec to render a PDF fixed the callback to its own environment, and
every later spec's import resolved against an environment Jest had
since destroyed.

The first fix attempted was to move the `new Function` construction
inside the call, on the theory that the stale binding came from
*hoisting*. It does not: the identical failure reproduced with the
function built fresh per call, because the default host-defined options
are a property of how `new Function` compiles, not of when. Worth
recording, because the hoisting explanation is the plausible one and it
is wrong.

`createRequire` is the other obvious escape and is also a dead end: Jest
patches `node:module`, so the require handle it hands back is
jest-runtime's own, which refuses ESM outright
(`Must use import to load ES Module`).

What works is a **direct** `eval`:

```ts
function loadPuppeteerCore(): Promise<typeof import('puppeteer-core')> {
  return eval('import("puppeteer-core")') as Promise<typeof import('puppeteer-core')>;
}
```

A direct `eval` inherits the host-defined options of the script that
calls it — this module, as compiled by the runtime that is *live* — so
the import always resolves against the environment actually running.
It still hides the `import()` from TypeScript's commonjs downlevel,
which is what §26 needed in the first place, and plain Node treats the
two forms alike, so the running server is unaffected either way.

Before this increment the bug was invisible for a reason worth
recording: with only `documents.spec.ts` rendering PDFs, there was
never a *second* consumer to hit the stale callback. It became
reachable the moment a second spec file rendered one — which is to say
it was latent from §26 onward and surfaced by ordinary growth, not by
anything the new code did wrong. Verified the way the failure was
found: the whole suite green, not just the one spec in isolation.

## §31 — `stock_lots`' balance key was unenforced for the commonest lot there is, and the stock engine could not have been built on it

40_stock.sql declares

```sql
unique (tenant_id, customer_id, warehouse_id, location_id, product_id, batch_id, serial_no)
```

to make each `stock_lots` row *the* balance for one logical lot. That is
the entire premise of `stock_lots` being a materialised balance
(`stock-engine.md` §1), and of the upsert that maintains it.

Three of those seven columns are nullable, and SQL treats every NULL as
distinct from every other NULL for uniqueness. So the constraint
enforced nothing at all for the most ordinary lot in the system:
unallocated (`location_id` null), non-batch-tracked (`batch_id` null),
non-serial-tracked (`serial_no` null) stock — which is precisely what a
GRN posts. Verified against the live database before writing anything:
three inserts of the identical lot key all succeeded, leaving three
"current stock" rows for one lot.

This is the same class of gap as §16's five (fixed in
`85_integrity_fixes.sql`), but the consequence is worse. There the
unenforced half was the system-seeded rows and the failure was a
duplicate someone would notice. Here it is the ordinary path and the
failure is silent: an `on conflict` upsert keyed on the constraint would
never match, every posting would insert a *new* lot instead of adding to
the existing one, and current stock would fragment into as many rows as
there were receipts, each holding a partial quantity. No error — just a
wrong number, in the table the whole product exists to keep right.

Fixed additively in `96_stock_lots_balance_key.sql` with a unique index
carrying `nulls not distinct` (Postgres 15+), which says what the
constraint meant. No column, table shape, or existing constraint
changed. It is also the conflict target the engine's upsert infers on,
so the invariant and the mechanism that depends on it are now the same
object — the upsert cannot silently stop deduplicating without the index
going missing.

Worth recording how it was found: not by reading the schema, but by
trying to write `on conflict ... do update` against it and asking
whether the constraint would actually match. The three-insert check took
a minute and settled it.

## §32 — `stock_ledger.txn_at` is written with `clock_timestamp()`, not left to its `now()` default

The ledger is an append-only *sequence*, and the read endpoint orders by
`txn_at`. `now()` in Postgres is the transaction's start time, identical
for every statement in it, so every row of one posting shared a
timestamp and the only tiebreaker left was a random uuid. A put-away
posts a `TRANSFER_OUT`/`TRANSFER_IN` pair per line, and the ledger read
them back in arbitrary order — a transfer's arrival ahead of its own
departure, and balances that looked like they had been recorded out of
sequence. Caught by a test asserting the four rows of a two-line
put-away in order, which failed on the shuffle.

`clock_timestamp()` advances inside a transaction, so rows read back in
the order they were written. The alternative — adding a `bigserial`
sequence column — would order them just as well but grows the reference
schema for something the existing column can express, and a per-row
instant is not a lie: each movement really did happen at a distinct
moment inside the transaction. Atomicity is unaffected either way; the
rows still commit together.

## §33 — `regenerate: true` was specified, seeded and granted, but enforced by nothing

Found by the full audit at the end of Phase 5, and reproduced against a
running server before anything was changed.

`document-engine.md` §2 says regeneration "is only permitted when the
source record's status still allows edits, or by a user holding a
specific `regenerate_after_approval` permission."
`permissions-matrix.md` grants `regenerate_document` to Owner, Admin,
Warehouse Manager and Billing Executive, and `regenerate_after_approval`
to Owner and Admin alone. Both codes are seeded, and both were granted to
roles. **Neither appeared in a single `@RequirePermission` anywhere.**

So `commitDocument()` honoured `regenerate: true` for anyone who could
reach the route, and the route's own permission is the source record's
*create* code. A Warehouse Operator holds `create_grn` and neither
regenerate code. The reproduction, against a real server:

```
Customer holds a printed GRN copy, QR token 715f593d v3  ->  verifies "valid"
Operator POSTs {"regenerate": true} on the approved GRN  ->  HTTP 201, v4
The customer's printed copy now verifies                 ->  "revoked"
Entitlement units consumed                               ->  0
```

That is the whole severity of it. Regeneration is deliberately unmetered
(§7: it "does not call consumeEntitlement again"), so the act was free
and repeatable, and its visible effect landed on the *customer's* copy
through the public, unauthenticated verify endpoint — the one surface the
warehouse does not control.

Two things made it invisible for four phases. The permission existed, was
seeded, and showed up correctly in the matrix, so every review that
checked "is this permission defined and granted?" passed. And
`PermissionsGuard` fails closed on a route that declares *no*
permission — a genuinely good property that turns out to say nothing
about a route that declares the *wrong* one. Nothing in the codebase
could have noticed: an unused permission code is not an error.

### The fix, and why it is not a decorator

`@RequirePermission` takes one static code per route. The code needed
here depends on the request body (`regenerate`) and on the source
record's live status, so the check has to happen after `loadData` and
inside the same transaction. `assertMayRegenerate()` does it there, and
audits a `permission_denied` row in the same shape the guard does, so a
refused regeneration reads identically in the audit log however it was
refused.

Which statuses count as "still allows edits" is a table
(`regeneration-policy.ts`) rather than a per-template flag, because the
answer already exists: it is exactly the set of statuses in which each
module accepts a `PATCH`. Deriving it from the edit guards means the
table cannot drift from the workflow. Two entries are deliberately not
edit guards, and are commented as such — a put-away has no `PATCH` at all
yet is provisional until `complete`, and a warehouse receipt has no
provisional state at all, because §22 makes it the document a customer
keeps and the one that must never be quietly reissued.

The lookup itself moved to a plain function, `auth/has-permission.ts`,
which `PermissionsGuard` now calls too. A second copy of the RBAC query
was the alternative, and two copies of an authorization check is how the
next gap gets written. It is a function rather than an injectable
because making it a provider would mean adding a dependency to all
twenty-odd modules that use the guard, to share four lines of SQL.

### What this suggests about the other seeded-but-unused codes

`regenerate_document` was not the only permission the seed defines and no
route references; the same audit found `manage_company_settings` in that
state (no company-settings endpoint exists yet). The difference is that
the missing endpoint is *visibly* missing, while a missing check on an
endpoint that does exist looks exactly like a working one. Worth a
periodic diff of seeded codes against `@RequirePermission` usage —
"unused" is the interesting direction, not "undefined".

## §34 — `warehouse_ids` was a restriction the API reported as active and enforced nowhere

The second finding of the Phase 5 audit, and the same shape as §33: a
control that was specified, stored, surfaced, and never applied.

`tenancy-and-security.md` §4 says `tenant_users.warehouse_ids`, when set,
makes "every operational query additionally filter `warehouse_id =
ANY(...)`", and `permissions-matrix.md` adds that it narrows every one of
that role's permissions. The column was written by `POST /users`, echoed
back by `GET /users`, and matched by exactly one file in the whole
repository — the one that wrote it. Reproduced against a running server:

```
Member created; the API reports warehouseIds: [WH02]
Operator creates a gate entry in WH01  ->  201 GE/26-27/000002
Operator reads WH01 stock              ->  200, 1 lot
```

No cross-tenant leak, so it never showed up in an isolation test — the
tenant's own RLS was working perfectly. That is what made it survive: the
axis it guards is *inside* the tenant, and nothing else in the system
looks there.

### Reads narrow, writes refuse

The two halves behave differently on purpose. A read filters: an
out-of-scope gate entry is simply absent from the list and 404s on
fetch, because that is what "additionally filters" means, and because a
403 on a read would tell the caller the record exists. A write refuses
with 403 and says why. A silent 404 on `POST /gate-entries` would read as
"that warehouse doesn't exist", which is both confusing to a real
operator and less honest than naming the restriction.

Where the warehouse is derived rather than supplied — a put-away and a
warehouse receipt both take it from their GRN — the check is against the
GRN's warehouse. Checking the request body there would check nothing,
since the body never names a warehouse.

### Empty array means unrestricted

`warehouse_ids = '{}'` is treated as "no restriction", identically to
`NULL`. The alternative reading — "assigned to zero warehouses,
therefore sees nothing" — is defensible in the abstract and dangerous in
practice: it turns a stray empty write from a UI multi-select into a
silently disabled account, with no error anywhere to explain it.
Disabling someone is what `status` is for, and it is visible.

### Why it is a filter in the service and not RLS

RLS would have been the tempting answer, given §90's policies already
exist. It is the wrong tool here: the restriction is per *user*, not per
tenant, and `withTenant()` deliberately knows only the tenant — it sets
one GUC and has no notion of who is asking. Threading a user into it to
drive a second family of policies would put per-user authorization into
the layer whose whole job is the tenant boundary, and would apply it to
migrations and seeds too. The service-layer filter is explicit,
greppable, and testable through HTTP, which is how it is now covered.

### The pattern worth noticing

§33 and §34 are the same failure twice: a control that exists everywhere
except in the code path it governs. Both passed every review that asked
"is this specified, stored, and granted?" — the question that would have
caught them is "what reads this?" A column or permission code that
nothing references is the signal; it looks like completeness and is the
opposite.

## §35 — the company profile and `tenant_settings` had no writer, so three "implemented" features rendered blank

Third finding of the Phase 5 audit, and the one with the widest blast
radius even though it is the least like a security bug.

Signup writes `tenants.legal_name` and nothing else — `SignupDto` has no
other company field. A repo-wide grep found **no `update tenants`
anywhere**, and no write to `tenant_settings` at all. So:

- **Every document letterhead was two-thirds empty.**
  `documents/company-context.ts` selects nine fields (trade name, address,
  city, state, pincode, GSTIN, phone, email) and all nine were permanently
  null. `document-engine.md` §5 specifies a letterhead of "Company legal
  name & GSTIN / Address · Phone · Email"; what actually rendered was the
  legal name alone, on all eight templates.
- **Every agreement's Parties clause had holes in it.** The seeded
  template resolves `{{company.gstin}}`, `{{company.addressLine1}}`,
  `{{company.city}}`, `{{company.state}}` and `{{company.pincode}}` — five
  tokens, in the clause that names who the contract is between, all
  resolving to empty.
- **`stock.allow_negative` could not be switched on.** Three documents
  describe it as implemented, `StockService` reads it on every posting,
  and there was no way to write it — so the branch was not merely
  untested, it was unreachable.
- `manage_company_settings` was seeded and granted with no endpoint
  behind it, exactly like §33's regenerate codes.

None of this failed. It rendered, silently, wrong.

### `GET /company` is Owner/Admin too, not just the write

`permissions-matrix.md` seeds one code for this area,
`manage_company_settings`, granted to Owner and Admin. There is no
`view_company_settings`, and inventing one to make reads broader would be
inventing policy rather than implementing it. The row also carries bank
account number, IFSC, and the authorised signatory. And nothing else
needs it: documents build their letterhead server-side from the same row,
so no client fetches it to render one, and `GET /onboarding/status`
reports whether the profile is complete without exposing its contents.

### A settings *registry*, not a free-form key/value API

`tenant_settings` is `(tenant_id, key, jsonb)`, which will accept
anything — including `stock.allow_negatives`, which would save cleanly,
read back on a settings page, and do nothing forever. That is the same
failure as §33 and §34 (a value stored and surfaced but never consulted),
so keys are declared in `tenant-settings.registry.ts` with a type, a
default, and a note naming what reads them; an unknown key is a 400 and a
wrongly-typed value is a 400. `GET /company/settings` returns every known
key with its effective value and a `source` of `tenant` or `default`, so
a settings page shows real behaviour rather than a list of blanks, and
`DELETE` restores the documented default rather than writing null.

`StockService` now takes the key and default from that same registry, so
the writer and the reader cannot drift apart.

### Fields deliberately not settable

`slug` (it is the workspace identity at login — changing it locks people
out), `status` (suspension is the platform's call, not the tenant's), the
three `*_attachment_id` fields (they need an upload flow, not a raw id
from the client), and `financial_year_start_month`. That last one is the
interesting one: number series are keyed by financial year, so moving the
FY boundary mid-year would re-key every series and start issuing numbers
that collide with ones already printed on paper. It stays at its default
until there is a migration path for it.

### The onboarding wizard's company step now means something

It reported `done: true` unconditionally, with a comment explaining that
the tenant row exists from signup. True, and useless — it was reporting a
step complete that nothing could complete, because nothing could fill it
in. It now checks the same condition `GET /company` exposes as
`isDocumentReady`: GSTIN plus a full address, the minimum a letterhead
needs to stop looking unfinished. A fresh tenant's `nextStep` is
therefore `company` rather than `warehouse`.

## §36 — rate limiting: one throttler with per-route limits, keyed on the credential for auth

Findings 4 and 6 of the Phase 5 audit. There was no throttling of any
kind. `POST /auth/login` accepted unlimited attempts, and passwords are
argon2id at 64 MiB a hash, so it was both a guessing oracle and a cheap
way to make the server allocate memory on request: a hundred concurrent
attempts is 6.4 GB of work an anonymous caller can ask for.
`GET /verify/:qrToken` is public, unauthenticated, and *writes* a
`document_verifications` row on every matching hit.

### The library does not scope named throttlers to routes

The obvious shape — a generous `default`, a tight `auth`, a middling
`verify` — is wrong with `@nestjs/throttler`, and wrong in a way that
looks right. Every named throttler is evaluated on **every** route;
`@Throttle({ auth: ... })` overrides one's *configuration* for a route,
it does not confine it to that route. Declaring `auth: 8/min` alongside
the others therefore capped the whole API at eight requests a minute.
The suite went from green to 54 failures, every one a `429`, on document
and gate-entry routes that have nothing to do with logging in — and the
first instinct, that the global limit was too low, was wrong: raising it
from 300 to 2000 changed nothing, because the limit doing the rejecting
was the one named `auth`.

So: **one throttler, with per-route overrides**. `@Throttle({ default:
{...} })` on the routes that need something tighter says exactly what it
means and nothing else.

### The global limit is deliberately loose

2000/minute per IP is a runaway-script backstop, not a policy. A per-IP
limit is the wrong shape for the authenticated half of a multi-tenant
API: a whole warehouse office sits behind one NAT address, so any figure
tight enough to be a real defence throttles a customer's entire staff as
one caller. Those routes already require a JWT and a permission, so the
attacker it would stop has to authenticate first. Rationing them properly
means a per-tenant quota — a plan/entitlement question, not a network
one. Until that exists, a ceiling that catches an infinite loop is worth
more than one that pages someone every busy shift.

### Auth is keyed on (IP, email), not IP

The credential endpoints are limited to 8 per minute per **(IP, email)**.
Per-IP alone fails in both directions: too low and the shared-NAT office
locks itself out, too high and one account's password can be guessed
thousands of times a day. Keying on the account being attacked fixes
both — guessing one password stops after eight tries while forty people
at one address never collide.

The IP stays in the key on purpose. Keying on the account alone would let
anyone lock a victim out of their own account from anywhere, trading a
guessing problem for a denial-of-service one.

Once the limit trips, the *correct* password is refused too. That is the
point rather than a side effect: if a valid credential still got through,
the 429-vs-401 boundary would itself answer "was that guess right?"

### The enumeration oracles

Three, and they did not all deserve the same treatment.

**Login timing — fixed.** Returning early for an unknown email answered
in about a millisecond while a real account spent ~100ms in argon2: a
clean oracle for "does this address have an account?", readable off the
wire without even parsing the response. The unknown path now verifies
against a fixed dummy hash, so both do the same work. Measured on the
running server afterwards: 56ms for a known address, 52ms for an unknown
one.

**`POST /users` — fixed.** `password` was optional, with a 400 explaining
it was needed "when the email has no account yet". That told any tenant
admin, for any address they cared to try, whether it was registered
*anywhere on the platform*, other tenants included. The membership is
tenant-scoped; that answer was not. `password` is now required
unconditionally and discarded when the account exists — and it is hashed
either way, since branching there would move the same oracle into the
response time.

**Signup — kept, deliberately.** It still distinguishes "an account with
this email already exists" from "that workspace URL is taken". A generic
message would close a weak oracle at real cost to a real person: someone
who has forgotten they already have an account, being told only that
something unspecified went wrong. The mitigation is the throttle — eight
attempts a minute per (IP, email) makes enumeration expensive without
making the product worse for the person it is actually talking to. Worth
naming as a decision rather than leaving as an oversight.

### `trust proxy` stays off by default

`@Ip()` behind a load balancer records the balancer's address, which
degrades the audit trail. The fix is `trust proxy`, and turning it on
unconditionally would be worse than the problem: `X-Forwarded-For` is
client-settable, so on a directly reachable host it hands an attacker a
fresh rate-limit bucket per forged header and a fabricated IP in every
`audit_logs` row. `TRUST_PROXY_HOPS` is opt-in and takes a hop count, so
a deployment trusts only the addresses its own proxy appended.

## §37 — a warehouse transfer posts its two ledger rows at *different* moments

`stock-engine.md` §7 says a transfer between warehouses is two ledger
rows, `TRANSFER_OUT` at the source and `TRANSFER_IN` at the destination,
"not a mutation of a single row's `warehouse_id`". It does not say
*when*, and the two available answers are not equivalent.

Posting both at completion would show the goods sitting in the source
warehouse for as long as the journey takes — a day, a week for a
Gurugram-to-Bhiwandi run. That is not a rounding error; it is stock a
picker can see, reserve, and be sent to fetch from a rack it left on
Tuesday. Posting both at dispatch has the mirror problem: the
destination shows stock that has not arrived, and someone allocates it.

So the two rows are written at the two moments they describe:

| kind | `TRANSFER_OUT` | `TRANSFER_IN` |
|---|---|---|
| `location` (bin to bin) | at `complete` | at `complete` |
| `warehouse` | at `dispatch` (`in_transit`) | at `complete` |

A bin-to-bin move has no journey and no vehicle, so splitting it would
invent a state that does not exist; both rows go together.

### The gap is the honest part

Between dispatch and arrival, a warehouse transfer's goods are in
**neither** warehouse's balance. Verified live: 100 bags in, 40 dispatched,
`GET /stock` totals 60 until the truck arrives. That looks like missing
stock and is not — it is stock in a vehicle, on a road, in nobody's rack,
and the balance now says exactly that. The trace is the transfer record
itself plus `GET /stock/ledger?sourceId=`, which shows the departure with
no matching arrival yet.

The alternative considered and rejected was an in-transit holding row —
`location_id` null at the destination warehouse, reusing 40_stock.sql's
"unallocated / in-transit" comment. It keeps the total constant, which is
its whole appeal, and it lies about *where*: the goods would appear in
the destination warehouse's balance before reaching the building, which
is the same error as posting both rows at dispatch, only better hidden.
Four ledger rows per line instead of two, to make a number look tidier.

### What follows from the gap

An `in_transit` transfer cannot be cancelled. The `TRANSFER_OUT` is
already in the ledger and §3.5 is explicit that reversal is additive:
undoing a departure is a second, deliberate movement, not an edit to this
record. `cancel` therefore allows `draft` and `approved` only, and says
so.

A `warehouse` transfer also cannot be completed without being dispatched
— goods cannot arrive before they leave — and `dispatch` is refused on a
`location` transfer, which has nothing to dispatch. Both are 400s that
name the reason rather than silently reinterpreting the request.

### Everything rides `create_stock_transfer`

`permissions-matrix.md` seeds one code for this module and no separate
approve code — unlike stock adjustments, where it seeds two. So approval
here is the same authority as raising the note. Inventing a distinction
the matrix does not make would be inventing policy, not implementing it.

### A line with no destination bin

Allowed on a warehouse transfer, and it means what a GRN's receipt means:
the goods have arrived but not been shelved, so they land unallocated
(`location_id` null) at the destination and wait for a put-away. Refused
on a location transfer, where "move this pallet to nowhere in particular"
is not a real instruction.

## §38 — approval and posting are separate acts on a stock adjustment

A Stock Adjustment is the only way a stock figure changes in this system
with no receipt and no dispatch behind it, so it is the one record that
carries a real approval chain (§50). The chain ends at `approved`, and a
*separate* `post` writes the ledger rows. `stock_adjustments` has both a
status and a `posted_at`, so the schema already expects two events; the
question is whether the code should collapse them, as GRN approval does.

It should not, and the reason is concrete rather than procedural:
**posting can fail on its own merits.** A write-off of 50 bags against a
lot now holding 30 hits the negative-stock invariant. If approval posted
in the same transaction, that failure would roll the approval back too —
silently discarding a decision a manager and possibly an Owner had
already made, and leaving the record looking as though nobody had ever
looked at it. Keeping them apart makes the authorisation durable and the
posting retryable, which is exactly the shape of the problem: the
approval is a judgement about whether the correction is *right*, and the
posting is a mechanical question of whether the shelf can bear it.

Proven directly: an approved write-off of 9999 is refused with a
negative-stock 400, the adjustment stays `approved`, no ledger row
exists, and no balance moved.

This is also why a GRN can collapse the two. Its approval *is* the
acceptance of goods that physically arrived; its posting cannot fail for
lack of stock, because it only ever adds.

### The count changes nothing, deliberately

A verification posts no stock in either direction. Finding 8 bags where
the system says 10 does not correct the system — it records a
disagreement, and correcting it is a separate, approved act. That is
`stock-engine.md` §3.4 ("there is no manual stock edit transaction type")
made structural: there is no code path from a count to a balance.

Its lines are **built from `stock_lots`, not supplied by the caller**. A
count whose subject the counter chooses is not a count; the value is
entirely in comparing the shelf against what the system claims,
independently of who is looking. `system_qty` is frozen at that moment
for the same reason a GRN freezes its product snapshot — the sheet has to
still mean what it meant when it was printed.

`stock_verification_lines.stock_lot_id` is nullable, and that carries
real weight: it is how a counter records goods sitting in a rack that the
system has no lot for at all. Without it a count could only ever report
shortages, never a find.

### The blank sheet hides the expected quantity

The count-sheet document renders differently by status, and it is not
cosmetic. Printed from a `draft` it omits the system quantity entirely
and leaves a ruled blank — telling a counter what they are expected to
find is how a count stops being one. Printed from a `completed`
verification it shows system, counted, difference and reason, because
then it is the record of what was found rather than the instrument for
finding it.

### One narrow permission, and why it is narrow

`approve_stock_adjustment_final` is Owner-only — Admin does not hold it,
which is true of only one other code in the entire catalogue
(`approve_agreement`). The Owner step is inserted only when the tenant
sets `approvals.stock_adjustment.owner_required`, read per request so
switching it on applies to the next adjustment rather than the next
deploy. Verified through all four roles: an Operator may raise one but
not approve it; a Manager approves and then cannot finalise their own
approval; an Admin cannot finalise either; the Owner can. `post` rides
`approve_stock_adjustment` rather than the create code — applying an
approved change is the approver's act, not the requester's.

## §39 — GRN reversal refuses on "has it moved", not on "would it go negative"

`stock-engine.md` §3.5 says reversal is additive: cancelling an approved
GRN inserts offsetting rows with `reversal_of_id` set, never deletes. The
Phase 5 engine slice left GRN `'reversed'` without a transition on the
grounds that undoing a posting once the goods have been put away is a
design question. This is the answer.

The first cut of the guard was the obvious one: post the offsetting rows
and let the engine's negative-stock invariant refuse if the goods are no
longer where the receipt put them. It is wrong, and the test that caught
it is worth describing. GRN approval posts stock *unallocated* — one lot
per (customer, warehouse, product, batch) with `location_id` null — and
that lot is **shared** by every receipt of that product. Reverse GRN #2
after its put-away has emptied its share, and the offset does not go
negative at all: it quietly consumes GRN #3's still-unallocated stock,
and the balance stays positive. No error, wrong number, on the table the
whole product exists to keep right.

So the guard is about movement, not arithmetic: a non-cancelled put-away
against the GRN refuses the reversal outright, with a message that says
what to do instead (a Stock Adjustment with a reason). The negative-stock
check stays as a backstop, but it is no longer the thing being relied on.

Two other refusals and one release, all deliberate:

- An **issued warehouse receipt** blocks reversal. A customer is holding a
  document that says these goods are in storage; cancelling that document
  is a separate, visible act that has to come first.
- The offsetting rows are `INWARD` with `qty_out`, not `ADJUSTMENT`. §3.4
  reserves `ADJUSTMENT` for rows that reference a `stock_adjustments`
  record, and a reversal references the GRN. The type names what is being
  undone; `reversal_of_id` says it is an undoing.
- The **inward goes back to `'received'`**, so a corrected GRN can be
  raised from it — which is the only reason anyone reverses one.

### Ageing for stock with no batch is a stated FIFO assumption

`batches.first_received_at` was kept stable since the engine slice
precisely so ageing (§26) could read it. Stock that is not batch-tracked
has no such anchor. It is aged from the earliest `INWARD`/`RETURN` of that
product for that customer in that warehouse — the oldest layer's age
applied to the whole quantity. That is a FIFO assumption and it is written
down rather than hidden, because it is also the *conservative* reading: in
a storage-charge dispute the customer is told the age of the oldest goods
they have not yet taken out, not an average that flatters the newest.

## §40 — allocation runs at reservation, over shelved stock only, all or nothing

`stock-engine.md` §6 describes the allocation policy (FIFO/LIFO/FEFO,
§31) as the Pick List's concern, and the schema agrees: `pick_lists`
carries `allocation_policy`, `release_orders` does not. Building it
moved the decision one step earlier, and the reason is a column.
`stock_lots.reserved_qty` is a *per-lot* balance. The moment a Release
Order reserves, some specific lot's reserved quantity goes up, so the
reservation has already chosen lots — and choosing lots *is* the
allocation policy. Running it again at pick time could only disagree
with what is already reserved. So `POST /release-orders/:id/reserve`
takes the policy (or falls back to the tenant's `stock.allocation_policy`,
default FIFO, or accepts explicit lot allocations as `manual`), posts one
`RESERVE` row per lot chosen, and records which policy it used in its
audit row. The pick list is generated from those `RESERVE` rows and
copies the policy onto its own row for the printed sheet; it never
re-chooses. The schema column is still where the blueprint put it; only
the moment of decision moved.

Three further choices that the tests pin:

- **Only shelved lots are eligible** (`location_id` not null). A pick
  list line has to send a picker somewhere, and goods still awaiting
  put-away are not anywhere a picker can go. The refusal says both
  numbers — "70 requested but only 60 available in shelved locations (a
  further 40 is unallocated, awaiting put-away)" — so the fix is obvious
  from the message: put it away, then reserve.
- **Reservation is all or nothing per order.** Reserving 15 of 20 and
  calling the order reserved is an under-fulfilment the customer
  discovers at the dock. §79's "reserve unavailable stock is impossible"
  is satisfied by refusing with the numbers, and the refusal rolls the
  whole transition back — no partial `RESERVE` rows, order still
  `approved`.
- **Age for FIFO/LIFO comes from the batch, else from the lot's first
  inward ledger row.** The obvious proxy for a non-batch lot,
  `stock_lots.updated_at`, was the first cut and it is wrong: every
  reservation and release bumps it, so a lot that had been reserved and
  released once became "newer" than one that had sat untouched, and the
  test that reserved across two bins picked them in the wrong order. The
  earliest `qty_in > 0` row for the lot's key is what "first received"
  actually means, and it never moves.

Picking, as `stock-engine.md` §2 says, moves nothing physically; it
changes `pick_qty` and the order's `picked_qty`, with a pick refused above
the reservation it draws on (§79 step 7). A picked order that is cancelled
releases its reservation in full: nothing left the shelf, so there is
nothing to put back in the ledger, only in the staging bay.

## §41 — one `OUTWARD` writer, fired from whichever document says the goods left

Blueprint §35 makes gate-out the moment physical stock leaves, and the
schema's `tenant_settings['workflow.outward_posting_point']` lets a
tenant that does not gate-track outbound vehicles post at dispatch
instead. Two trigger points, so the obvious risk is two postings. The
build puts the posting in one place — `OutboundPostingService.postOutward`
— keyed `dispatch:{id}:outward`, and both transitions call it: the gate
pass's `gate-out` always, the dispatch's `confirm` only when the setting
says `dispatch`. Whichever fires first posts; the other finds the rows
already in the ledger and posts nothing. The gate pass records which
happened in `stock_posted_at`, so a pass issued after a dispatch-posting
tenant's confirm reads as the paper record it is. `confirm` under the
default setting is refused outright, with the message naming the setting:
a dispatch declaring itself gone would be a second, unwitnessed way to say
what the gate pass exists to witness.

**Each dispatch line is drawn against the release order's own `RESERVE`
rows**, not against the pick list. The pick list groups by location and
batch and loses the serial; the reservation rows carry location, batch
*and* serial, and they are what the goods were promised from. One
`OUTWARD` per lot takes the physical quantity and releases the
reservation in the same row (`qty_out` and `reserved_delta` together), so
a lot's `reserved_qty` cannot outlive the stock it was reserving, and
§79's "dispatch 40 → stock 60" holds at the lot as well as in the total.
What earlier dispatches of the same order line already took from a lot is
subtracted through `dispatch_lines.release_order_line_id`, so partial
dispatches draw down the reservation in receipt order.

Three more choices the tests pin:

- **"Prevent dispatch above available" has two walls.** The dispatch line
  is checked at creation against picked − dispatched − what other open
  notes on the same line already claim, and refused by name. The ledger's
  negative-stock and negative-reservation invariants stand behind that as
  the backstop nobody should reach.
- **A loading sheet freezes the dispatch lines.** Its lines are copies
  (`loading_sheet_lines.dispatch_line_id`), and the first cut let a `PATCH`
  replace the dispatch lines under an open sheet — a foreign-key 500, and
  had it succeeded, a dock ticking a list that no longer matched the note.
  Line edits are refused while a sheet is open; header edits are not.
- **A POD changes no stock.** Short or damaged at the consignee is
  recorded, derived into the POD's status rather than chosen, and left
  there: the goods left the building, and what happens next is a return
  (§37) or a claim, each its own record.

And one on the release order: it may be cancelled while `picked`
(nothing moved physically; the reservation releases in full), but not
while a dispatch note is open against it — the note has to be cancelled
first, so no reservation is released out from under a consignment
someone is loading.

## §42 — a return is a GRN with a different ledger type, not a second inbound path

Blueprint §37 and `schema/50_outbound.sql` already say it — "stock
re-enters via a GRN with source flag" — and the build keeps to it
literally. A Return Request says what the customer wants to send back; a
Return Inward is the arrival and the inspection gate; and the goods come
onto the books through `POST /grns` with `returnInwardId`, which is the
same GRN, the same submit → check → approve chain, the same Operator →
Manager split (§50), the same reversal. Two things differ. The defaults
come from the return (customer, warehouse, transport, and the request's
lines as expected = received = accepted, for the desk to correct), and
approval posts `RETURN` rows instead of `INWARD`. Nothing else does:
returned goods land unallocated and go through put-away like any
receipt, and ageing (§39) counts a `RETURN` as a receipt because it is
one.

The alternative — a return-specific posting endpoint — was rejected
because every control the inbound chain has (accepted versus received,
damaged and rejected quantities, serials per unit, the discrepancy flag,
the manager's sign-off) would have had to be rebuilt or, more likely,
skipped. Goods that were ours once are not exempt from being counted on
the way back in.

Two guards on the request, both about the dispatch it points at:

- **A request against a dispatch is held to what that dispatch carried**,
  per product and batch, less what earlier live requests against the
  same dispatch already claim — so ten bags cannot be returned twice.
  The customer on the request must be the customer the dispatch went to.
  A request with no dispatch (goods returned from somewhere the system
  did not ship to) is allowed and simply unbounded, which is what "no
  dispatch" means.
- **Reversing a return GRN** puts the return inward back to `inspected`
  and the request back to `approved`, and clears `grn_id`, so a corrected
  GRN can be raised — the same shape as an ordinary GRN reversal handing
  the inward back to `received` (§39). The offsetting rows are `RETURN`
  with `qty_out`, mirroring what was posted, on the same reasoning that
  keeps a GRN reversal `INWARD` rather than `ADJUSTMENT`.

Approving a return request rides `approve_grn`. The matrix has only
`create_return_request` for this module, and the approval is a receiving
decision — "will we take these goods back" is the same authority as
"will we sign for these goods", and it stops at the same role.

## §43 — the billing run computes, the invoice freezes, and neither guesses

`billing-engine.md` §1 sets one rule the whole module answers to: every
charge traces back to an operational record, and nothing is silently
wrong. Building it turned that into four decisions.

**A missing rate is not always the same kind of problem.** Stock that sat
in a warehouse all month with no storage rate at any level is an
*error*: the goods were stored, the money is owed, and issuing an invoice
without that line would under-bill silently. So the run records the SKU
in `calculation.errors` and `POST /invoices` refuses the run outright
until the rate card is fixed and the preview re-run. But a *handling
event* whose charge type is priced nowhere is different: a tenant that
does not bill for unloading has not made a mistake by leaving
`UNLOADING` unpriced, and forcing them to add a zero rate to invoice
their storage would be the system inventing work. Those land in
`calculation.unpriced` — visible in the preview, not billed, not
blocking. The distinction is between *stock we are holding* (always
chargeable, so an unpriced one is a gap) and *a service we performed*
(chargeable only if the tenant says so).

**Storage is accrued day by day, from the ledger, not from the current
balance.** For every `(product, batch)` the customer had in the
warehouse, the run reconstructs quantity-on-hand for each day of the
period by summing `qty_in - qty_out` up to that day, applies
`free_days` from the resolved rate line against the key's *first*
inward, and stores the whole daily series in `billing_runs.calculation`.
The live walkthrough is what proves this is not decoration: 100 bags
received, 40 dispatched mid-period, and the series steps 100 → 60 on the
day the truck left, giving 600 chargeable unit-days rather than the
1,000 a current-balance reading would have billed or the 600 a
closing-balance reading would have. §66's transparency requirement is
satisfied by the preview rendering that stored series, never
recomputing it.

**A period is invoiced once.** Re-previewing a customer/warehouse/period
deletes the previous `previewed` row and writes a fresh one, so there is
never a second live preview to invoice twice; and once a run for that
key is `invoiced`, re-previewing it is refused with the invoice number,
because the correction path for an issued bill is a credit or debit note
(§41), not a second invoice. Individually, each *handling event* is
checked against the invoiced runs that already carry it, so an
overlapping period bills the storage again (correctly — different days)
but not the same GRN's inward handling. Cancelling a draft invoice hands
its run back to `previewed`, which is what makes "wrong period, start
over" possible without inventing a new billing key.

**The invoice freezes what the run computed and decides GST once.**
Party details go into `customer_snapshot`/`company_snapshot` at creation
and the treatment is derived there and then from `tenants.state_code`
against the customer's `place_of_supply`: same state splits the line's
tax into CGST + SGST, a different state charges IGST, and both are
stored per line. A later edit to either master cannot re-tax a document
someone has already filed. The grand total is rounded to whole rupees
with the difference kept in `round_off`, so the arithmetic on the paper
adds up exactly.

One thing deliberately *not* done: no charge type triggers on a
document being *created*. Every event the run reads is a completion —
GRN approved, gate-out posted, loading confirmed, put-away completed,
pick confirmed — because a draft that is later cancelled must never have
generated a charge.
