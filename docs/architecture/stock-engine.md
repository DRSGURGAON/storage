# Stock Engine

Blueprint refs: §23–§28, §61 (error prevention), §67 (traceability), §70 (atomicity), §79 (test cases)

## 1. Ledger-first, not balance-first

`stock_lots` (the "current stock" table everyone reads) is a **materialised
view maintained only by the stock service reading `stock_ledger`**. No code
path — no controller, no migration script, no admin tool — writes to
`stock_lots.physical_qty` or `.reserved_qty` directly. This is what makes
blueprint §23 ("do not allow arbitrary direct editing of current stock")
structurally true rather than a policy someone can forget.

Every physical or reservation movement is exactly one row in `stock_ledger`.
Posting a transaction means, inside one database transaction:

1. Insert the `stock_ledger` row(s) for the movement.
2. Upsert `stock_lots` for the affected `(tenant, customer, warehouse,
   location, product, batch, serial)` key: `physical_qty += qty_in - qty_out`,
   `reserved_qty += reserved_delta`.
3. Both steps commit together or not at all (§70 — stock-affecting operations
   are atomic).

`stock_lots.available_qty` is a generated column
(`physical_qty - reserved_qty`), so it can never drift from its inputs.

## 2. Transaction types

| `txn_type` | Physical effect | Reservation effect | Typical source |
|---|---|---|---|
| `INWARD` | `+qty_in` | — | GRN approval (§18) |
| `RETURN` | `+qty_in` | — | Return Inward → GRN (§37) |
| `TRANSFER_OUT` / `TRANSFER_IN` | `-qty_out` at source, `+qty_in` at destination | — | Stock Transfer Note (§28) |
| `ADJUSTMENT` | `±` per line | — | approved Stock Adjustment (§27) |
| `RESERVE` | — | `+reserved_delta` | Release Order approval (§30) |
| `UNRESERVE` | — | `-reserved_delta` | Release Order cancellation, or pick shortfall write-off |
| `OUTWARD` | `-qty_out` | `-reserved_delta` (releases the matching reservation) | Gate Pass gate-out (§35) |

A dispatch never reduces physical stock at Pick List or Dispatch Note time —
only reservation moves at those stages (§30, §31). Physical stock reduces
exactly once, at the configured outward posting point
(`tenant_settings['workflow.outward_posting_point']`, default = Gate Pass
gate-out per §35/§68; a tenant may instead choose "Dispatch confirmation" if
they don't gate-track outbound vehicles — the *schema* supports either
without change, only the trigger point in the service layer differs).

## 3. Invariants (enforced in the service layer before any commit)

1. `physical_qty >= 0` and `reserved_qty >= 0` and `reserved_qty <=
   physical_qty` for every `stock_lots` row, **unless**
   `tenant_settings['stock.allow_negative'] = true` (§61's explicit escape
   hatch — off by default).
2. `RESERVE` cannot exceed `available_qty` at the reserved location scope —
   this is what makes "reserve unavailable stock" impossible (§61, §79 case
   "Reserve 20 → available 40").
3. `OUTWARD` (or any picked/dispatched quantity) cannot exceed the
   *reserved* quantity it is fulfilling — this is what makes "dispatch more
   than available stock" impossible (§61, §79 case "prevent dispatch above
   available stock").
4. Every `stock_ledger` row has a non-null `source_type`/`source_id` (§67) —
   there is no "manual stock edit" transaction type; a correction is always
   an explicit, approved `ADJUSTMENT` referencing a `stock_adjustments` row
   (§27).
5. Reversal is additive, never destructive: cancelling an approved GRN does
   not delete its `stock_ledger` rows, it inserts offsetting rows with
   `reversal_of_id` set (§80 — never delete historical approved transactions).

## 4. Idempotency (§61, §70, §79 "refresh/retry does not duplicate")

`stock_ledger.idempotency_key` is unique per tenant. It is derived
deterministically from the triggering event, e.g. for a GRN approval:
`"grn:{grn_id}:approve"`; for a gate-out: `"gate_pass:{gate_pass_id}:gate_out"`.
Posting logic always does `INSERT ... ON CONFLICT (tenant_id,
idempotency_key) DO NOTHING` (or an equivalent pre-check inside the same
transaction) before touching `stock_lots`, so a duplicated network retry or a
double-click on "Approve" is a no-op the second time, not a double posting.
This is also why `grns.stock_posted_at` and `gate_passes.stock_posted_at`
exist as columns: a fast, indexed way for the UI to know posting already
happened without scanning the ledger.

## 5. Batch tracking & ageing (§26)

`batches.first_received_at` is set once, from the earliest GRN that created
the batch, and never updated. Ageing buckets
(`tenant_settings['stock.ageing_buckets']`, default `0-30/31-60/61-90/91-180/180+`
per §26) are computed as `now() - batches.first_received_at`, grouped by the
configured bucket edges — a reporting-time computation (see
`reporting.md`, not yet written — tracked as a Phase 8 deliverable in
`dev-phases.md`), not a stored column, so changing the bucket configuration
doesn't require a backfill.

## 6. Allocation policy for picking (§31)

`pick_lists.allocation_policy` (`fifo` default, or `lifo`/`fefo`/
`nearest_location`/`manual`) decides which `stock_lots` rows a Pick List
proposes for a required quantity. FIFO/FEFO order by
`batches.first_received_at` / `batches.expiry_date`; `nearest_location` orders
by a configurable location-proximity ranking; `manual` leaves line-level
location selection to the picker. The policy is a per-warehouse or per-tenant
setting, never hard-coded, per blueprint §31's explicit requirement.

## 7. Multi-warehouse & multi-customer separation (§79)

Because every `stock_lots` and `stock_ledger` row carries both `warehouse_id`
and `customer_id`, two customers' goods in the same warehouse — or the same
customer's goods in two warehouses — never share a balance row. A transfer
between warehouses is two ledger rows (`TRANSFER_OUT` at the source
warehouse, `TRANSFER_IN` at the destination) inside one `stock_transfers`
document, not a mutation of a single row's `warehouse_id`.
