# Test Plan

Blueprint refs: §78 (acceptance criteria), §79 (critical test cases)

This turns the blueprint's narrative acceptance criteria into a concrete,
runnable checklist. Every row maps to a real integration test: the
**Proven by** column names the spec file and the test that covers it. All
of them run against a live PostgreSQL database — there are no mocked
repositories in this suite — and the whole set is
**39 suites, 308 tests, green** (`cd apps/api && npm test`).

Two files carry most of the cross-module rows:

- `apps/api/src/acceptance/acceptance.spec.ts` — section 1's walkthrough as
  one continuous scenario on a fresh tenant, plus the section 2 rows no
  single module owns.
- each module's own `*.spec.ts` — the mechanism in isolation, in more
  detail than the walkthrough goes into.

Where a row is proven in both, both are named: the module spec is the
detailed proof, the acceptance spec proves it still holds when the modules
are composed.

## 1. End-to-end acceptance scenario (§78)

Run as one continuous scenario, on a single fresh tenant, asserting the
"verify at every stage" column after each step:

| # | Step | Verify |
|---|---|---|
| 1 | Create Company, Customer, Warehouse, SKU, Vehicle, Driver, Rate Card | each record readable through its own `GET` endpoint with all fields populated (there is no `resolve{Entity}()` endpoint — auto-fill happens server-side inside the create endpoints; see `workflow-and-statuses.md` §1) |
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

**Proven by `src/acceptance/acceptance.spec.ts`**, test *"walks §78 end to
end"*, which runs all twelve steps in order on one fresh tenant, with four
different roles holding four different tokens: the Operator raises the GRN
and is refused the approval (403), the Manager checks and approves it, the
Accountant runs the billing and takes the payment, and the Owner reads the
paper trail. It asserts the stock balance after each stock-affecting step,
the `intra_state` tax split, that a retried "Create Invoice" is refused,
that the statement closes at the expected balance, that four documents
generate and verify through the public QR route, and that the audit log
holds the GRN's `create` and `status_change` rows.

## 2. Critical test cases (§79)

Every row below is covered. "Proven by" names the file and the test.

### Quantitative / stock

| Case | Proven by |
|---|---|
| Receive 100 → stock = 100 | `stock/stock.spec.ts` *"posts accepted stock at GRN approval — unallocated, and only what was accepted"*; `acceptance.spec.ts` §78 walkthrough |
| Dispatch 40 → stock = 60 | `outbound/outbound.spec.ts` *"walks the chain and posts OUTWARD once at gate-out: dispatch 40 → stock 60"*; `acceptance.spec.ts` |
| Reserve 20 → physical = 60, available = 40 | `release-orders/release-orders.spec.ts` *"reserves 20 with FIFO from shelved bins only: physical stays 100, available drops to 80"*; `acceptance.spec.ts` (reserve 40 of 100) |
| Cancel reservation → available returns | `release-orders.spec.ts` — cancelling posts one `UNRESERVE` per `RESERVE`, asserted as the ledger pair `['RESERVE','UNRESERVE']` |
| Expected 100, received 95 → short_qty = 5, Discrepancy Report | `grns/grns.spec.ts` *"derives short/excess and hasDiscrepancy"*; `discrepancy-reports/discrepancy-reports.spec.ts` |
| Damaged 5 of 95 → accepted 90, only 90 posts | `stock/stock.spec.ts` *"only what was accepted"*; `grns.spec.ts` rejects `accepted + rejected > received` at the boundary |
| Transfer between bins in one warehouse | `stock-transfers/stock-transfers.spec.ts` *"moves stock bin to bin in one posting"* |
| Transfer between warehouses | `stock-transfers.spec.ts` *"leaves warehouse-to-warehouse stock in neither warehouse while it is on the road"* (`DECISIONS.md` §37) |
| Return stock → increases only for the accepted return quantity | `returns/returns.spec.ts` *"brings 10 back as RETURN through a GRN raised from the return inward: 60 → 70"* |
| Prevent dispatch above available stock | `release-orders.spec.ts` *"refuses to reserve more than is shelved, all or nothing, and says how much is still unallocated"*; `stock.spec.ts` *"refuses to take a balance negative"* |
| Prevent duplicate GRN posting on retry | `stock/stock.spec.ts` *"is idempotent: re-posting the same key writes nothing a second time"* |
| Prevent duplicate invoice posting on retry | `acceptance.spec.ts` (second `POST /invoices` for the same run → 400); `invoicing/invoicing.spec.ts` *"invoices the run once"* |
| Approved transactions cannot be edited | `acceptance.spec.ts` (`PATCH` an approved GRN → 400); `grns.spec.ts`, `invoicing.spec.ts` and `agreements/agreements.spec.ts` each reject the same on their own record |
| Stock adjustment posts only after the approval chain | `stock-verifications/stock-verifications.spec.ts` *"walks draft → pending_manager → approved → posted, and only then moves stock"* (`DECISIONS.md` §38) |

### Multi-tenancy / security

| Case | Proven by |
|---|---|
| Tenant A cannot reach tenant B's records via any staff API | `db/tenant-isolation.spec.ts` (directly, including a reused pooled connection) and every module spec's own *"isolates tenants"* test — `customers.spec.ts` proves it first through HTTP: list empty, fetch 404, patch 404 |
| A portal session cannot reach another customer's data, even by guessing ids | `portal/portal.spec.ts` *"cannot see the other customer, whichever door it tries"* and *"stops working the moment the membership is disabled"* — plus *"§2: a portal transaction cannot read another customer, even with the filter left out"*, which drops the service-layer filter on purpose and proves `schema/98`'s restrictive policy catches it |
| A user without `approve_grn` cannot approve one by calling the API directly | `acceptance.spec.ts` (the Operator's approve → 403); `grns.spec.ts` *"a Warehouse Operator can create and submit but cannot check, approve, or reject"* |

### Financial

| Case | Proven by |
|---|---|
| Payment reduces `balance_due` | `acceptance.spec.ts` (half the invoice → `partially_paid`, `balanceDue` exact); `receivables/receivables.spec.ts` *"reduces outstanding by recomputing amount_paid, and refuses to over-pay"* |
| A PDF renders from the frozen snapshot, not from live master data | `acceptance.spec.ts` *"a document keeps the party details it was issued with, even after the master changes"* — the customer is renamed and moved to another state after issue; the invoice's snapshot, tax treatment, CGST amount and PDF all stand |
| QR verification works and returns only the minimal public fields | `documents/documents.spec.ts` (valid → revoked after regeneration, unauthenticated); `acceptance.spec.ts` verifies all four generated documents |

### Integrity

| Case | Proven by |
|---|---|
| Numbering stays unique under concurrent creation | `numbering/numbering.spec.ts` *"serializes concurrent allocations for the same series — no duplicates, no gaps"* (10 simultaneous allocations) |
| A cancelled transaction nets stock back exactly | `acceptance.spec.ts` *"a cancelled receipt nets back to exactly the pre-GRN balance"* — and asserts the reversal is additive: two ledger rows, the second pointing at the first |
| Retry does not duplicate a transaction | `receivables.spec.ts` *"records a payment exactly once however many times the button is clicked"*; `documents.spec.ts` (commit retry → one row); `entitlement/entitlement.spec.ts` *"does not double-consume on a retried idempotency key"* |
| Multiple warehouses keep separate balances for one SKU | `acceptance.spec.ts` *"two warehouses and two batches of one SKU keep separate balances"* |
| Two batches of one SKU never merge | same test — and it goes further: a FEFO reservation of 25 draws entirely from the sooner-expiring batch rather than from a merged pool |
| Document relationships resolve from the graph, not a hand-written list | `documents/document-relations.spec.ts` — a real inbound chain (gate entry → inward → GRN → put-away → warehouse receipt) and a real outbound one (release order → pick list → dispatch → gate pass → POD), asserting "Created From"/"Related" off the actual foreign keys, the §68-ordered chain from the far end, the `stock_ledger` hop that joins the two halves, cross-tenant 404, and a 400 naming the known types for a table that is not a record |
| Notifications reach the other three channels | `notifications/notification-delivery.spec.ts` — a real SMTP session against an in-process socket server and a real HTTP POST against an in-process endpoint, plus one row per channel, the bell showing the event once, retry-then-give-up with the provider's own error recorded, an unconfigured channel left pending rather than marked sent, and per-tenant draining |
| The audit log records the critical changes | `acceptance.spec.ts` (GRN `create` + `status_change`, and `document_generate` rows); `auth/auth.spec.ts` (signup, login, `login_failed` with the IP); `console/console.spec.ts` (the viewer, filtered, and hidden from those who may not read it) |

## 3. Non-functional checks (Phase 9, from §69–§70, §64)

| Check | State |
|---|---|
| Rate limiting on login and public QR verification | **Done.** `auth/auth.spec.ts` *"throttles repeated login attempts against one account, without penalising the rest of the office"* — the limit is keyed per (IP, email), so one account being hammered does not lock out the next login from the same office (`DECISIONS.md` §36). `/verify/:qrToken` carries its own limit (`documents/verify.controller.ts`) |
| File access requires a signed, scoped URL | **Done** (Phase 10b). `POST /documents/:id/download-link` mints an HMAC-signed link naming one document, its tenant and optionally its customer, expiring in five minutes; `documents.spec.ts` and `portal.spec.ts` cover the unauthenticated fetch, a flipped signature byte, a forged payload, an expired link, and links scoped to the wrong customer or tenant. The bytes still come from `LocalFilesystemAttachmentStorage` — the object store itself is still unbuilt (`DECISIONS.md` §0's update, §24) |
| Stock postings are atomic under mid-transaction failure | **Partly.** Atomicity is structural, not chaos-tested: `StockService.postWithin()` takes the caller's transaction, so the ledger insert, the lot upsert and the caller's own status change commit together or not at all — `stock.spec.ts` proves the negative-balance refusal leaves nothing behind, and every posting spec asserts no partial rows. What is *not* done is killing the process mid-transaction to prove it; that needs a fault-injection harness this suite does not have |
| Mobile responsiveness of the operator flows | **Done (Phase 11g), except capture.** Driven at 390×844 in a real browser — login, dashboard, gate entries, GRNs, stock, release orders, invoices, settings and a create drawer — each reporting `scrollWidth == clientWidth == 390`, with the navigation drawer opened and screenshotted. Three defects found and fixed: no way to open the navigation below `lg`, list tables pushing the page sideways, and the login card's fixed 440px plus the form drawers' fixed 520–720px. Phase 12a then built photo and signature capture and repeated the pass over the *detail* screens, which the first one had missed: seventeen screens, all measuring 390, after fixing three-column `Descriptions`, line tables and a Card header that squeezed the record number to nothing |

## 4. Entitlement & subscription engine (saas-layer §6–§17, §41–§45; `entitlement-engine.md`)

| Case | Proven by |
|---|---|
| A `FREE` tenant gets exactly 2 of a counted feature; the 3rd returns `LIMIT_REACHED, upgradeRequired: true` | `entitlement/entitlement.spec.ts` *"allows the first two consumptions, then blocks the third with LIMIT_REACHED"*; `documents/documents.spec.ts` proves the same through HTTP as a 402 paywall on both preview and commit |
| A failed generation does not increment usage | `entitlement.spec.ts` *"records a failed attempt for audit without touching usage or the counter"* |
| A cancelled draft never consumes | **By construction, not by a dedicated test:** `consumeEntitlement` is called from exactly one place, `commitDocument`. A draft that is never committed cannot reach it, and `documents.spec.ts` shows preview leaving both `documents` and the counter untouched |
| Repeated `previewDocument` never consumes; only `commitDocument` does | `documents.spec.ts` *"previews a PDF without writing a document row, and consuming no entitlement"* |
| A retried "Generate" produces one `documents` row and one `usage_ledger` row | `documents.spec.ts` *"commits a document, is idempotent on retry"*; `entitlement.spec.ts` *"does not double-consume on a retried idempotency key"*, plus a genuine 5-way concurrent race against a 2-copy limit where exactly 2 win |
| Downloading, printing or viewing never consumes | **By construction:** `GET /documents/:id/download` streams the stored attachment and never touches the entitlement service. `documents.spec.ts` downloads repeatedly (including on a tenant at its limit) without a 402, but no test asserts the counter directly afterwards |
| Changing `plan_feature_limits.limit_value` changes enforcement with no deploy | **By construction:** every check reads the row at call time — there is no cached or compiled limit anywhere. `entitlement.spec.ts` exercises the same resolver against differently-seeded limits, but no test edits a limit mid-run and re-checks |
| An `entitlement_overrides` row for one tenant does not move another tenant's limit | **Partly.** The resolver reads `entitlement_overrides` ahead of `plan_feature_limits` (`entitlement.service.ts`), and cross-tenant independence is proven for the plan path in `entitlement.spec.ts` *"keeps different features and different tenants fully independent"* — but no test writes an override row. This is the weakest square in the grid |
| A `past_due` subscription past its grace period is blocked even under the limit | **Partly.** `entitlement.service.ts` treats `past_due`, `cancelled` and `expired` as not-entitled regardless of usage; there is no test that puts a subscription into those states, because nothing in the product writes them yet (no gateway — `DECISIONS.md` §13) |
| Two tenants' usage never intermixes | `entitlement.spec.ts` *"keeps different features and different tenants fully independent"* |
| A demo tenant is unmistakable, and excluded from real-usage accounting | **Half done, and the half that matters.** `documents/documents.spec.ts` proves every document a demo workspace generates carries the `DEMO / SAMPLE` banner and watermark (the marking is in the shared shell, so it holds for all 24 templates), and that `isDemo` reaches the session and the company profile read-only. Not done: excluding demo tenants from billing runs and cross-tenant analytics — a demo's billing run is part of the demo, and no cross-tenant analytics surface exists yet to exclude them from |
| The API cannot be bypassed by skipping the UI | `documents.spec.ts` calls the generation endpoints directly on an exhausted tenant and gets the same 402 the UI would have shown |
| The public pricing page's limits match `plan_feature_limits` exactly | `console/console.spec.ts` *"reports plan usage from the same check a paywall uses, and serves pricing publicly"* — both pages are pivots over the same rows the engine enforces, so there is no second number to drift (`console/plan.service.ts`) |

## 5. What is not covered

Named here rather than left as silent gaps in the grid above:

- **An S3 adapter.** Attachments still live on the local filesystem behind
  the `AttachmentStorage` interface. Signed, time-limited links themselves
  are built (Phase 10b) and tested in `documents.spec.ts` and
  `portal.spec.ts`: minting, an unauthenticated fetch, a tampered
  signature, an expired link, and one scoped to the wrong customer or
  tenant.
- **Fault injection** (killing a process mid-transaction) and **load
  testing**. Concurrency is tested where it decides correctness — numbering
  and entitlement both run genuine parallel races — but nothing here
  measures throughput or survives a hard kill.
- **Frontend tests.** `apps/web` has no automated tests of its own. It is
  exercised by driving a real browser against a live API — the whole
  inbound and outbound chains, plus every screen loaded and screenshotted —
  which catches what a component test would not (a wrong endpoint shape, a
  required field the API can derive) and misses what one would (a
  regression in a single component's rendering). §64's mobile check is run
  the same way — a real browser at phone size, measuring the document's own
  scroll width — which is why it found three defects that reading the CSS
  would not have.
