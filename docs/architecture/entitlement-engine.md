# Entitlement & Subscription Engine

Blueprint refs: saas-layer §6–17, §41–45; schema: `schema/80_subscription.sql`;
implemented at `apps/api/src/entitlement/entitlement.service.ts`

## 1. Principle

> "Do not hard-code `if count > 2 then show payment` inside individual
> modules."

Every module that performs a metered action — generating a GRN, an invoice,
a Gate Pass, and so on — calls the **same two functions**:
`checkEntitlement(tenantId, featureCode)` before doing the work, and
`consumeEntitlement(tenantId, featureCode, context)` only after the work
succeeds. No module computes its own "have they hit the limit?" logic. This
is structurally the same discipline as `numbering.md`'s single
`allocateNumber()` and `stock-engine.md`'s ledger-first stock model — one
authoritative service, called everywhere, never reimplemented.

## 2. Ledger-first usage, same pattern as stock

`usage_counters` (the fast "how many has this tenant used" table) is a
**materialised view over `usage_ledger`**, maintained only by the
entitlement service — exactly the relationship `stock_lots` has to
`stock_ledger` in `stock-engine.md` §1. No code path increments
`usage_counters.used_count` directly. Consuming one unit of a feature is,
inside one database transaction:

1. Insert one `usage_ledger` row with `result = 'success'`,
   `consumed = true`.
2. Upsert `usage_counters` for `(tenant_id, feature_code, period_key)`:
   `used_count += 1`.
3. Both steps commit together or not at all.

**Write responsibility, clarified during implementation (DECISIONS.md §19):**
`checkEntitlement` is a cheap, side-effect-free read only — safe to call as
often as a screen likes without generating audit noise. `consumeEntitlement`
is the single atomic operation that *re-checks the limit inside the same
transaction* as recording the outcome and owns every `usage_ledger` write
for both `success` and `blocked` results; re-checking here rather than
trusting an earlier `checkEntitlement` call is what a `FOR UPDATE` lock on
the `usage_counters` row needs in order to prevent two concurrent requests
from both seeing "1 remaining" and both succeeding. A third method,
`recordFailedAttempt`, covers the case where generation work throws
*before* `consumeEntitlement` would even run — nothing to atomically
check-and-consume, just an audit record that an attempt happened.

A **blocked** attempt (limit already reached) or a **failed** attempt
(generation errored) also writes a `usage_ledger` row — for auditability —
but with `consumed = false`, and step 2 never runs. This is what makes
§7/§8's rule precise: only a successful, finalized generation counts;
previews, cancelled drafts, and failed attempts are visible in the ledger
for audit purposes but never move the counter.

## 3. `checkEntitlement`

```
checkEntitlement({ tenantId, featureCode, userId? })
  -> { allowed: boolean,
       reason: null | 'LIMIT_REACHED' | 'FEATURE_DISABLED' | 'SUBSCRIPTION_INACTIVE',
       remaining: number | null,     -- null when unlimited
       limit: number | null,
       used: number,
       upgradeRequired: boolean }
```

Resolution order, first match wins:

1. **`entitlement_overrides`** for this `(tenant, feature)` — an
   admin-granted exception (§6 "admin-configurable limits"), skipped if
   `expires_at` has passed.
2. **`plan_feature_limits`** for the tenant's current plan (via
   `tenant_subscriptions.plan_id`) and this `feature_code`.
3. If neither exists, default to `disabled` — a feature absent from a
   plan's configuration is not silently free, it is explicitly off. This
   is a deliberate fail-closed default; a plan must opt a feature in.

If the resolved row is `limit_type = 'unlimited'`, `allowed = true` and
`remaining = null`. If `disabled`, `allowed = false`,
`reason = 'FEATURE_DISABLED'`. If `counted`, compute `used` from
`usage_counters` for the resolved `period_key` (see §5) and compare against
`limit_value`. If the tenant's subscription `status` is `past_due`,
`cancelled`, or `expired` and the tenant is outside any configured grace
period (§6 "grace periods"), every non-`FREE`-plan feature check short
circuits to `allowed = false, reason = 'SUBSCRIPTION_INACTIVE'` regardless
of remaining counted usage — a lapsed subscription cannot be worked around
by unused free-tier counts.

## 4. `consumeEntitlement` and idempotency

```
consumeEntitlement({ tenantId, featureCode, userId, sourceId, documentType?,
                      generationId?, idempotencyKey })
  -> the usage_ledger row written
```

Called **once**, at the same point `document-engine.md`'s
`commitDocument()` step actually persists the generated document — never at
`previewDocument()` time (§31: the entitlement *check* happens at preview,
the entitlement *consumption* happens at commit). `idempotencyKey` is
derived the same way `stock-engine.md` §4 derives stock idempotency keys,
e.g. `"grn:{grn_id}:generate"`. The insert is
`INSERT INTO usage_ledger ... ON CONFLICT (tenant_id, idempotency_key) DO
NOTHING`, so a double-click or a retried request after a timeout is a
no-op on the second call — it neither consumes a second unit nor blocks a
legitimate first attempt (§10). The caller checks whether its own insert
was the one that landed (via `RETURNING`) to know whether to show "usage
consumed" or "already recorded" in the response, but the user-visible
effect is identical either way: exactly one unit consumed.

## 5. Period keys

`period_key` on both `usage_ledger` and `usage_counters` is `'lifetime'`
for the default free-copies rule (§7 — 2 free GRNs, ever, on the Free
plan), or a calendar bucket (`'2026-09'`, `'2026'`) for a paid plan that
resets its document allowance monthly or yearly, per that plan's
`plan_feature_limits.period`. The entitlement check computes the current
`period_key` from `now()` and the resolved limit's `period` before reading
`usage_counters` — a monthly-reset plan's usage automatically starts at
zero in a new period without any batch job, because a new period simply has
no `usage_counters` row yet.

## 6. Feature catalog and the free-copies default

`feature_keys` is the managed catalog behind §15's stable identifier list
(`GRN_GENERATION`, `INVOICE_GENERATION`, …). The two-free-copies rule (§7)
is not application logic — it is seed data: the `FREE` plan's
`plan_feature_limits` rows have `limit_type = 'counted'`, `limit_value = 2`,
`period = 'lifetime'` for every document-generation feature. Changing the
free allowance from 2 to 5 (§16) is a data update to those rows, not a code
change or deploy.

## 7. Module vs. feature (§17)

`feature_keys.module` groups features (`GRN_GENERATION`,
`WAREHOUSE_RECEIPT`, `PUTAWAY`, … all under `module = 'operations'`, for
example). There is no separate "module-level switch" table — a plan that
wants to gate an entire module sets every feature in that module to
`disabled` or to the same limit; a plan that wants the module "enabled but
limited" (§17's Starter example) sets a shared counted limit across those
features, while "fully enabled" sets them `unlimited`. This keeps a single
mechanism (`plan_feature_limits`) expressive enough for both module- and
feature-level plan design without a second table to keep in sync.

## 8. Subscription lifecycle & payment abstraction (§45)

`tenant_subscriptions.status` is the single source of truth for whether a
tenant's paid access is live: `trial → active → past_due → (cancelled |
expired | paused)`, with `resumed` returning to `active`. State changes
only ever originate from one of: a payment gateway webhook, an admin
action, or a scheduled system check (trial expiry, period rollover) — never
from the client. Every transition is recorded in `subscription_events`,
including the raw webhook payload when the source is `gateway_webhook`, so
a disputed billing state is always reconstructable.

`tenant_subscriptions.payment_gateway` /
`payment_gateway_customer_id` / `payment_gateway_subscription_id` are
deliberately generic string columns, not a foreign key into a specific
gateway's SDK types. The actual gateway integration — Razorpay, Cashfree,
or another Indian PCI-compliant processor — is not yet chosen (see
`DECISIONS.md`); the service-layer contract each gateway adapter must
satisfy is: given a webhook payload, produce one `subscription_events` row
and, if it represents a status change, update `tenant_subscriptions`
accordingly. No other part of the application should need to know which
gateway is in use.

## 9. Grace periods

A grace period is expressed as a duration on the plan or a per-tenant
override (`entitlement_overrides` with `limit_type = 'unlimited'` and an
`expires_at` a few days out), applied when a subscription first enters
`past_due`. This keeps "grace period" a data-driven policy rather than a
hardcoded number of days in the entitlement check.

## 10. Demo mode (§12, §46)

A demo tenant is an ordinary tenant with `tenants.is_demo = true`. It gets
its own `tenant_subscriptions` row (typically on a dedicated `DEMO` plan
with generous or unlimited limits so a prospect isn't paywalled while
exploring) and its own fully isolated data under the same tenant-isolation
rules as any tenant (`tenancy-and-security.md` §1) — demo data cannot leak
into a real tenant's records because it is never in the same tenant's rows
to begin with. Reporting, billing runs, and usage analytics exclude
`is_demo = true` tenants by default, so demo activity never pollutes real
usage accounting (§46's explicit requirement).

> **Implemented, with one part deliberately left out.** Every document a
> demo workspace generates carries a `DEMO / SAMPLE — not a valid
> commercial document` banner and a diagonal watermark, added in
> `renderDocumentShell` so all twenty-four templates get it without any of
> them knowing (`apps/api/src/documents/html/layout.ts`). The document does
> not rely on the UI for this: a PDF leaves the application and is read
> somewhere else, which is exactly where a convincing fake invoice does its
> damage. `isDemo` also travels on `GET /auth/me` and `GET /company`, so
> the UI can label its own screens — read-only, since a workspace does not
> get to declare itself a demo or stop being one.
>
> Billing runs and analytics do **not** exclude demo tenants. A demo's
> billing run is part of what the prospect is being shown, and there is no
> cross-tenant analytics surface in the codebase yet to exclude anything
> from; when one is built, that is where the exclusion belongs.

## 11. Frontend contract

The frontend never decides whether an action is allowed. It calls
`checkEntitlement` to render the right UI state ahead of time (a usage
badge, a disabled button with an upgrade tooltip, the paywall screen from
`ux-system.md` §7), but the backend re-checks and enforces on the actual
write endpoint regardless of what the frontend showed (§14: "never trust
frontend-only restrictions"). A user who bypasses the UI and calls the API
directly gets exactly the same block a normal user would see.
