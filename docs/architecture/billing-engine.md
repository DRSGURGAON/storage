# Billing Engine

Blueprint refs: §13, §38–§40, §66, §79

## 1. Principle

> "Billing must derive charges from actual operational transactions. Do not
> make the user manually calculate every monthly charge... Never silently
> generate incorrect billing."

Concretely: every `invoice_lines` row traces back to a `billing_run_lines`
row, which traces back to a `source_type`/`source_id` operational record
(a GRN, a dispatch, a loading sheet, or an accrual over `stock_lots`). There is
no "type an amount, pick a customer, issue an invoice" path for the recurring
storage/handling charges this module exists to automate — only for one-off
manual lines explicitly marked `source_type = 'manual'` (e.g. a negotiated
one-time charge), which still go through the same preview → invoice flow so
they are auditable and taxed consistently.

## 2. Charge type catalogue (seeded, `charge_types`, tenant-editable)

| Category | Code (example) | Trigger |
|---|---|---|
| Storage | `STORAGE` | period accrual (not event-triggered — see §3) |
| Handling | `INWARD_HANDLING` | `grn_approved` |
| Handling | `OUTWARD_HANDLING` | `gate_out` |
| Handling | `LOADING` | `loading_confirmed` |
| Handling | `UNLOADING` | `grn_approved` (or a separate unloading confirmation, per tenant workflow) |
| Handling | `LABOUR` | manual or `pick_confirmed` |
| Handling | `PALLETIZATION` | `putaway_completed` |
| Handling | `PICK_PACK` | `pick_confirmed` |
| Other | `DOCUMENTATION`, `SPECIAL_HANDLING`, `ADDITIONAL_LABOUR`, `WAITING_DETENTION` | manual, or tenant-defined trigger |

Tenants may add charge types beyond this seed list (§13 "other configurable
charge types") — the catalogue is data, not an enum baked into code.

## 3. Rate resolution (§13 priority order)

For a given `(tenant, customer, warehouse, charge_type, product?)`, resolve
the applicable `rate_card_lines` row by trying, in order, until one matches:

1. An **active** `rate_cards` row with `scope = 'customer'` for this
   customer (optionally further narrowed by `warehouse_id` if the
   customer has warehouse-specific lines within their own rate card).
2. An **active** `rate_cards` row with `scope = 'warehouse'` for this
   warehouse.
3. The tenant's **active** `scope = 'company'` default rate card.

Within whichever rate card wins, a line scoped to the specific `product_id`
or `category_id` outranks a line with neither (a SKU-specific override beats
the charge type's general rate). If no line resolves at any level, the
billing run **fails that line with an explicit "no applicable rate"
error** rather than silently charging zero or falling back to a guess — this
is what "never hard-code rates" and "never silently generate incorrect
billing" require together.

## 4. Storage accrual algorithm

Unlike handling charges (one event → one charge), storage is a function of
*how long stock sat in the warehouse during the billing period*. For a
billing period `[period_start, period_end]` and a `stock_lots` row (or its
underlying `stock_ledger` history, when the balance changed mid-period):

1. Reconstruct, from `stock_ledger`, the quantity-on-hand for each
   relevant `(customer, warehouse, product, batch)` on each day of the
   period (or at coarser granularity if the resolved rate's `basis` is
   monthly, e.g. `sqft_month`/`flat_month`).
2. For a `basis` of `unit_day`/`pallet_day`/`box_day`/`cbm_day`: sum
   `quantity_on_hand(day) × rate` over the days in the period, after
   subtracting `rate_card_lines.free_days` from the very first inward day
   (§13's storage grace-period lines).
3. For `sqft_month`/`flat_month`: charge the flat/area rate once per
   calendar month (or pro-rated for a partial first/last month, a tenant
   setting — `tenant_settings['billing.partial_month_policy']`).
4. Apply `minimum_charge` as a floor on the computed line amount.

Every intermediate number (quantity, days, rate, resulting amount) is stored
verbatim in `billing_run_lines` and echoed in `billing_runs.calculation`
(§66's transparency requirement) — the preview screen renders directly from
these columns, it does not recompute or hide the formula.

## 5. Billing run → invoice (§39)

```
User selects customer + warehouse(s) + period
  → system resolves rate card (§3)
  → system computes every applicable storage + handling + other line (§4, event triggers from §2)
  → writes one `billing_runs` row (status='previewed') + its `billing_run_lines`
  → UI shows the full calculation for review (§66) — nothing is committed yet
  → user clicks "Create Invoice"
  → one `invoices` row + `invoice_lines` are created from the billing run,
    billing_runs.status → 'invoiced', billing_runs.invoice_id set
```

Re-running a preview for the same `(customer, warehouse, period)` before it
is invoiced replaces the existing `previewed` row (service-layer enforced,
see the comment on `billing_runs`' unique key) — it never creates a second
live preview that could be invoiced twice. Once `invoiced`, a billing run is
immutable; correcting an issued invoice goes through a Credit/Debit Note
(§41), never an edit of the original invoice or a re-run of its billing run.

## 6. Tax (§40)

`invoices.tax_treatment` decides whether a line's tax splits into
CGST+SGST (`intra_state`: buyer and seller state codes match) or IGST
(`inter_state`), or is zero (`export`/`exempt`/`nil_rated`) — computed once
at invoice creation from `tenants.state_code` vs.
`customers.place_of_supply`, then frozen into `customer_snapshot` /
`company_snapshot` and the per-line CGST/SGST/IGST columns. `tax_rates` is
tenant-editable data (§40 "must not hard-code one universal GST treatment"),
not a constant.

## 7. Idempotency for payment posting (§61, §79)

A `payment_receipts` row is only ever inserted once per user action; the
create-payment endpoint requires a client-supplied idempotency token (same
mechanism as `stock-engine.md` §4) so a retried "Record Payment" click cannot
post the same receipt twice. `invoices.amount_paid` /
`invoices.balance_due` are maintained by summing `payment_allocations` for
that invoice, recomputed transactionally whenever an allocation is
inserted/reversed — never incremented ad hoc — so a duplicate allocation
cannot silently under-reduce outstanding.
