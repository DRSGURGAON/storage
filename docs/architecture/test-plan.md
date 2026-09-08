# Test Plan

Blueprint refs: §78 (acceptance criteria), §79 (critical test cases)

This turns the blueprint's narrative acceptance criteria into a concrete,
runnable checklist. It is meant to become the outline of an automated
end-to-end test suite (Phase 9 in `dev-phases.md`), not just a manual QA
script — every row should map to one integration test.

## 1. End-to-end acceptance scenario (§78)

Run as one continuous scenario, on a single fresh tenant, asserting the
"verify at every stage" column after each step:

| # | Step | Verify |
|---|---|---|
| 1 | Create Company, Customer, Warehouse, SKU, Vehicle, Driver, Rate Card | each record readable via its `resolve{Entity}()` endpoint with all fields populated |
| 2 | Gate Entry → Inward | Inward auto-fills customer/vehicle/driver/transporter from step 1 and the Gate Entry, per `workflow-and-statuses.md` §1 |
| 3 | GRN from Inward → Approve | GRN auto-fills from Inward; `grns.status = 'approved'`; `stock_ledger` has exactly one `INWARD` row per accepted line; `stock_lots.physical_qty` matches accepted quantity |
| 4 | Put-away → complete | `putaway_lines.confirmed_at` set; `stock_lots.location_id` reflects the assigned bin |
| 5 | Warehouse Receipt | issued, references the GRN, snapshot matches accepted quantities |
| 6 | Release Order → Reserve | `stock_lots.reserved_qty` increases by the requested quantity; `available_qty` decreases correspondingly; reservation only possible up to `available_qty` |
| 7 | Pick List → Pick | pick lines reference the Release Order; picked quantity never exceeds reserved quantity |
| 8 | Dispatch → Loading → Gate Pass → Gate Out | physical stock is **unchanged** until gate-out; at gate-out, exactly one `OUTWARD` ledger row is posted and reservation is released |
| 9 | POD | references the Dispatch; shortage/damage quantities computed correctly from dispatched vs. received |
| 10 | Storage + handling calculation → Invoice | Billing Run preview shows a line per accrued/event charge with full formula inputs (`billing-engine.md` §4); Invoice total matches the preview subtotal + tax exactly |
| 11 | Payment → Receipt | `invoices.balance_due` decreases by the allocated amount |
| 12 | Customer Statement | shows the invoice, the payment, and the resulting balance, filterable by date |

At every step also check: correct document references (§67 foreign keys are
populated, not null), correct audit trail (one `audit_logs` row per state
change), correct permissions (an unauthorized role gets 403 on each action),
correct PDF (the generated document's snapshot fields match the source
record at generation time).

## 2. Critical test cases (§79)

Quantitative / stock:

- [ ] Receive 100 → stock = 100
- [ ] Dispatch 40 → stock = 60
- [ ] Reserve 20 → physical = 60, available = 40
- [ ] Cancel reservation → available returns to 60
- [ ] Expected 100, received 95 → Discrepancy Report auto-suggested, short_qty = 5
- [ ] Damaged 5 of the 95 received → accepted_qty = 90, rejected/damaged_qty = 5, and only 90 posts to stock
- [ ] Transfer stock between bins within one warehouse → source bin decreases, destination bin increases, warehouse total unchanged
- [ ] Transfer stock between warehouses → source warehouse decreases, destination warehouse increases
- [ ] Return stock (Return Request → Return Inward → Inspection → GRN) → stock increases only for accepted return quantity
- [ ] Prevent dispatch above available stock → rejected with a validation error, no partial posting
- [ ] Prevent duplicate GRN posting (retry the same approve request) → stock posts once, second call is a no-op
- [ ] Prevent duplicate invoice posting (retry "Create Invoice") → one invoice, not two
- [ ] Approved transaction editing restrictions → editing an approved GRN/Invoice/Agreement is rejected; only a controlled reversal/revision is possible
- [ ] Stock adjustment approval → adjustment only posts to `stock_ledger` after the configured approval chain completes

Multi-tenancy / security:

- [ ] Customer A cannot access Customer B's records via any staff-facing API
- [ ] Customer portal session cannot access another customer's documents, stock, or statement, even by guessing an id in the URL
- [ ] A user without `approve_grn` cannot approve a GRN via a direct API call, even if the button is hidden in the UI

Financial:

- [ ] Invoice payment correctly reduces `invoices.balance_due`
- [ ] PDF contains correct company/customer data (matches `company_snapshot`/`customer_snapshot`, not live master data that may have since changed)
- [ ] QR verification works, and returns only the minimal public fields (`document-engine.md` §4)

Integrity:

- [ ] Document numbering remains unique under concurrent creation (parallel GRN creation stress test)
- [ ] Cancelled transactions do not corrupt stock (a cancelled GRN's reversal nets back to the pre-GRN balance exactly)
- [ ] Refresh/retry does not duplicate transactions (idempotency key reused on retry)
- [ ] Multiple warehouses maintain separate stock balances for the same SKU
- [ ] Batch-tracked products maintain correct per-batch balances (two batches of the same SKU never merge)
- [ ] Audit log records critical changes (create/approve/reject/cancel/adjustment/status change/document generation all produce an `audit_logs` row)

## 3. Non-functional checks (Phase 9, from §69–§70, §64)

- [ ] Rate limiting on login and public QR-verification endpoints
- [ ] File access requires a valid signed URL scoped to the requester's tenant/customer
- [ ] Stock-affecting endpoints are atomic under simulated mid-transaction failure (kill the process between ledger insert and lot upsert in a test double — the transaction must roll back both or neither)
- [ ] Mobile responsiveness for the operator-facing flows: Gate Entry, GRN, stock lookup, scan, picking, loading, Gate Pass, POD, photo/signature capture

## 4. Entitlement & subscription engine (saas-layer §6–§17, §41–§45; `entitlement-engine.md`)

- [ ] A `FREE`-plan tenant can generate exactly 2 of a `counted` document feature (e.g. GRN), and the 3rd call returns `allowed: false, reason: 'LIMIT_REACHED', upgradeRequired: true`
- [ ] A failed generation (simulate a rendering error after `checkEntitlement` passes) does not increment `usage_counters` — the next `checkEntitlement` call still shows the same `remaining` as before the failed attempt
- [ ] A cancelled draft never calls `consumeEntitlement` at all
- [ ] Calling `previewDocument` repeatedly for the same source record never consumes usage; only `commitDocument` does
- [ ] Retrying the same "Generate" click twice (simulated network retry with the same idempotency key) produces exactly one `documents` row and exactly one consumed `usage_ledger` row, not two
- [ ] Downloading, printing, or viewing an already-generated document never calls `consumeEntitlement`
- [ ] Changing a plan's `plan_feature_limits.limit_value` from 2 to 5 changes enforcement immediately, with no application deploy
- [ ] An `entitlement_overrides` row for one tenant does not affect any other tenant's limit for the same feature
- [ ] A tenant whose `tenant_subscriptions.status` is `past_due` beyond its grace period is blocked from a paid-plan-only feature even if its counted usage for the period has not been reached
- [ ] Two tenants' `usage_ledger`/`usage_counters` rows never intermix — Tenant A's consumption never affects Tenant B's `remaining`
- [ ] A demo tenant (`tenants.is_demo = true`) is excluded from billing runs, real-usage reports, and cross-tenant analytics
- [ ] The frontend cannot bypass a block by skipping the UI: calling the generation API directly on a limit-exhausted feature is rejected server-side with the same `LIMIT_REACHED` response the UI would have shown
- [ ] The public pricing page's displayed limits match `plan_feature_limits` exactly — no hard-coded numbers in the page that could drift from what is enforced
