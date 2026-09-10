# Workflow, Auto-fill, Smart Actions & Status Machines

Blueprint refs: §3, §58–§61, §67–§68, §72–§74

## 1. Auto-fill contract (§3, §58)

Auto-fill is implemented as one pattern reused everywhere, not per-form
one-off logic: every "picker" field (customer, warehouse, SKU, vehicle,
driver, or an upstream document like Gate Entry/Inward/GRN/Release
Order/Pick List/Dispatch) is backed by a `resolve{Entity}(id)` API that
returns a **flat object of every field the target form might need**. The
form layer merges that object into its state; it never re-fetches the same
master record field-by-field.

| Selecting… | `resolve...()` returns | Consumed by |
|---|---|---|
| Customer | legal name, GSTIN, PAN, billing/delivery addresses, contact, mobile, email, payment terms, default rate card | Quotation, Agreement, Inward, GRN, Release Order, Invoice, … |
| Warehouse | name, code, address, GST info, contact, manager | every transaction with a warehouse field |
| Product/SKU | name, SKU, HSN, UOM, weight, dimensions, barcode, batch/serial/expiry tracking flags | Inward, GRN, Release Order lines, Rate Card lines |
| Vehicle | vehicle type, capacity, **and** its linked transporter's name/GSTIN/contact | Gate Entry, Inward, Dispatch, Loading Sheet, Gate Pass |
| Driver | name, mobile, license number | Gate Entry, Dispatch, Loading Sheet |
| Gate Entry | customer, vehicle, driver, transporter, purpose, reference | Inward |
| Inward | customer, supplier, transport block, LR/invoice/e-way bill | GRN |
| GRN | everything Inward had, plus accepted items/batches | Warehouse Receipt, Put-away, Discrepancy Report |
| Release Order | customer + **only currently available** stock (via `stock_lots.available_qty`, never physical) | Pick List |
| Pick List | release order lines + picked locations/batches | Dispatch |
| Dispatch | pick list + release order data | Loading Sheet, Gate Pass, POD |
| Gate Pass | dispatch data | (gate-out completes outward stock, §35) |
| Billing Run | customer + every unbilled operational charge event | Invoice |

The user only ever types information that is genuinely new to that specific
transaction (§3's closing sentence) — e.g. on a GRN, the *received quantity*
per line, because nothing upstream could know it yet.

## 2. Smart create buttons (§59)

Every source-record detail page renders contextual actions computed from
its **current status**, not a static list:

| Page | Actions when status allows |
|---|---|
| GRN | Generate Warehouse Receipt · Create Put-away · Create Discrepancy Report · View Stock |
| Release Order | Reserve Stock · Generate Pick List · Create Dispatch |
| Dispatch | Generate Loading Sheet · Generate Gate Pass · Add POD |
| Invoice | Record Payment · Generate Receipt |

Each button is really "navigate to create-form X, pre-filled via
`resolve{SourceDoc}()`" — the same auto-fill contract from §1, not a
separate code path.

## 3. Status state machines (§60)

Each entity's legal transitions are enforced by a single per-entity
transition table in the service layer — `canTransition(entity, from, to,
actingRole)` — that every mutation must pass through. Illegal transitions
(e.g. `Draft → Completed` directly, or `Approved → Draft`) are rejected with
a clear error, never silently coerced.

```
GRN:            Draft → Submitted → Checked → Approved → (Completed by downstream putaway/WR)
                                                  └──► Rejected
                Approved ──(controlled reversal, §50)──► Reversed

Release Order:  Draft → Approved → Reserved → Partially Picked → Picked
                       → Dispatched → Completed
                any pre-Dispatched state ──► Cancelled (releases reservation, §30)

Dispatch:       Draft → Loaded (loading sheet complete) → Gate Out (gate pass, or
                       dispatch confirm when the tenant posts there) → Completed (POD)
                Draft/Loaded ──► Cancelled (sheet and pending pass cancelled with it)

Invoice:        Draft → Pending Approval → Approved → Issued
                       → Partially Paid → Paid
                Issued/Partially Paid ──(overdue crossing due_date)──► Overdue
                Draft/Pending Approval ──► Cancelled

Stock
Adjustment:     Draft → Pending Manager → Pending Owner* → Approved → Posted
                                                  └──► Rejected
                (*only when tenant_settings['approvals.stock_adjustment.owner_required'])

Agreement:      Draft → Pending Approval (Admin) → Approved (Owner) → Active
                       → Expired | Terminated
```

`Overdue` is not a manual click — a scheduled job flips `issued`/
`partially_paid` invoices past `due_date` to `overdue` and fires the
`payment_overdue` notification (§56).

## 4. Error prevention (§61)

Enforced centrally, not per-form:

| Rule | Mechanism |
|---|---|
| Dispatch more than available stock | `stock-engine.md` §3 invariant #3 |
| Reserve unavailable stock | `stock-engine.md` §3 invariant #2 |
| Duplicate document numbers | `numbering.md` §4 (row-locked sequence) |
| Duplicate stock transactions | `stock-engine.md` §4 (`idempotency_key`) |
| Duplicate payment posting | `billing-engine.md` §7 (idempotency token) |
| Editing approved transactions without permission | status machine (§3 above) + permission check; approved records only accept a controlled revision/reversal, never a plain `UPDATE` |
| Cross-tenant data access | `tenancy-and-security.md` §1 |
| Negative stock unless explicitly enabled | `stock-engine.md` §3 invariant #1 |
| Deleting referenced transactions | no `DELETE` endpoint exists for any table with inbound foreign-key references from another domain table; cancellation is always a status change |

Validation failures return a structured error (`field`, `code`, human
message) so the UI can show it next to the offending field rather than a
generic failure toast.

## 5. Form design & drafts (§72–§73)

Every multi-section transaction form (GRN's Basic Info / Customer & Warehouse
/ Transport / Reference Documents / Goods / Inspection / Attachments /
Remarks / Approval, per §72) auto-saves to a per-user, per-form draft
(`status = 'draft'` row, the same table the final record lives in — there is
no separate "drafts" table) on every section change, debounced. Navigating
away and back reopens the same draft; nothing is lost (§73).

## 6. Selector UX (§74)

Customer/SKU/warehouse/vehicle/driver pickers are all the same searchable
combobox component, backed by a search endpoint that matches on the fields
listed in §74 (name, code, GSTIN, mobile, …) and renders the concise
`Name · Code · secondary-identifier` result row. One component, one backend
search contract, reused everywhere a master record is picked — this is the
UI-level twin of the `resolve{Entity}()` auto-fill contract in §1.
