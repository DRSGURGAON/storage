# V1 Scope Specification

Blueprint refs: functional blueprint (`../blueprint/`), saas-layer blueprint
(`../blueprint-saas-layer/`), and this phase's scope-freeze direction
(not yet given its own numbered blueprint file — recorded here as the
authoritative scope decision).

This document is the output of a scope-freeze pass, not a new architecture.
No schema table, service contract, or design decision from the prior two
phases is changed here — this is a **prioritization** of what has already
been designed, checked against the actual schema
(`schema/00_core.sql`–`schema/80_subscription.sql`) so every call below is
grounded in what's really built, not re-derived from the blueprint text
alone.

## 1. Executive Recommendation

> **Status, as of Phase 9 (this is now a historical record).** This document
> was written before any code existed, as a scope-freeze pass over the two
> architecture phases. It has since been overtaken by the build, and is kept
> for the reasoning behind each in/out call rather than as a description of
> the system. What changed:
>
> - The backend is built. `apps/api` is a NestJS + PostgreSQL application
>   with ~40 modules covering Phases 1–8 and 33 integration-test suites;
>   §9's "Backend service/API: Missing" column is false in every row, and
>   §10's "no application code exists yet" and "technology stack is still
>   not chosen" are both false (`DECISIONS.md` §0 was decided, and the whole
>   stack is built on it).
> - **Returns and the Customer Portal were not deferred.** §1 and §3 defer
>   both to V1.1; both were built (`apps/api/src/returns/`,
>   `apps/api/src/portal/`), as were the P1 items Debit Note, Stock
>   Transfer, Stock Verification, standalone Packing List, Notifications,
>   and the Stock Ageing report.
> - Still genuinely not built, exactly as this document expected: the
>   **payment gateway** (`DECISIONS.md` §13), a **full reports library**
>   beyond the customer stock statement and ageing. The frontend, which
>   this banner previously listed here too, was built in Phase 11
>   (`apps/web`: React + Vite + Ant Design), so §8's screen map is now
>   mostly built rather than aspirational.
>
> Individual sections below carry inline corrections where a claim would
> otherwise mislead. Where this document and `dev-phases.md` disagree about
> what exists, `dev-phases.md` and the code are right.


Ship V1 as: **customer onboarding → commercial terms → inward → stock →
outward → billing**, exactly as this phase's closing philosophy states,
with every document in that loop generated automatically from the
transaction that created it, gated by the existing centralized entitlement
engine, and nothing else. Of the 26-item proposed baseline, 21 items ship
in V1 (19 as P0, 2 folded into an existing document rather than built
separately), 5 stay in the schema but are not built into V1's UI, and one
entire blueprint-listed module (Returns) and one large surface (Customer
Portal self-service) are deferred whole to V1.1, despite already having
schema support, because neither is needed to complete the core loop this
phase's philosophy defines.

The single most important finding from checking this against the actual
schema: **every V1 P0 item is already fully modeled** in
`schema/00_core.sql` through `schema/80_subscription.sql`. Nothing here
requires a new table or a schema migration. The entire gap is application
code — no backend service, no API, no frontend screen exists yet (see
§9). *(That held when written. The backend half has since been built; nine
schema fixes were needed after all, `schema/85`–`97`, each found by building
on the model rather than reading it.)* That means this scope freeze is a build-order and UI-complexity
decision, not a data-model decision, and every "defer" call below can be
reversed later by building the missing UI against schema that's already
there, not by re-architecting anything.

Two calls in here are genuine judgment calls the product owner should
confirm before Phase 1 starts building against this document — see §12.

## 2. Final V1 Document List

Legend: **Doc** = generated, versioned, entitlement-metered document
(`document-engine.md`); **Report** = rendered through the same PDF
template for a consistent look, but recomputed live from current data,
never versioned, and not metered by the 2-free-copies rule (see §7 of
`docs/blueprint-saas-layer/07-...md`'s no-duplication rule — a customer
statement is not a "copy," it's a live query); **Master/Workflow** = a
status or attachment set on an existing master record, not a generated
document at all.

| # | Name | Category | Priority | Why it belongs in V1 | Primary user | Source transaction | Next step | Consumes usage? | Feature key |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Customer KYC | Master/Workflow | P0 | Required before a customer can be trusted with agreements/billing; drives `customers.kyc_status` | Admin | Customer created | Quotation/Agreement | No — not a generation event | `CUSTOMER_KYC` |
| 2 | Warehousing Quotation | Commercial Doc | P0 | First commercial artifact; blueprint's own entry point to Agreement | Admin/Owner | Customer (+ optional KYC) | Agreement | Yes | `QUOTATION_GENERATION` |
| 3 | Warehousing/Storage Agreement | Commercial Doc | P0 | Establishes rates/terms that gate all billing; **ships as one structured form in V1, not the full 11-step wizard** (see §12) | Admin/Owner | Accepted Quotation (or direct) | Rate Card | Yes | `AGREEMENT_GENERATION` |
| 4 | Rate Card | Master (commercial) | P0 | Billing cannot resolve a rate without one; required before the first invoice | Admin | Agreement (or standalone) | Gate Entry / any operation | No — config, not a generation event | `RATE_CARD` |
| 5 | Gate Entry | Operational Doc | P0 | First physical event; feeds Inward's vehicle/driver auto-fill | Operator | Customer + Vehicle | Goods Inward | Yes | `GATE_ENTRY` |
| 6 | Goods Inward | Operational Doc | P0 | Captures the physical receipt before quality/quantity is confirmed | Operator | Gate Entry (optional) | GRN | Yes | `INWARD` *(kept — see §12 naming note)* |
| 7 | GRN | Operational Doc | P0 | The single most important V1 transaction; only approved GRNs post stock | Operator → Manager | Inward | Put-away, Discrepancy (conditional) | Yes | `GRN_GENERATION` |
| 8 | Discrepancy / Damage Report | Operational Doc | P0 | Conditional — only when qty/condition mismatches; critical audit evidence and dispute protection | Operator | GRN (branch) | (informational; GRN continues) | Yes | `DISCREPANCY_REPORT` |
| 9 | Put-away Slip | Operational Doc (internal) | P0 | Explicit in this phase's mandatory chain; completes the location assignment that Warehouse Receipt depends on | Operator | Approved GRN | Warehouse Receipt | Yes | `PUTAWAY` |
| 10 | Operational Warehouse Receipt | Commercial Doc | P0 | Customer's proof of custody; the trigger that makes stock "theirs" in the system | Admin/System | GRN + Put-away | Stock | Yes | `WAREHOUSE_RECEIPT` |
| 11 | Stock Ledger | Report | P0 | Every stock change must be traceable; this *is* the audit trail, not a generated copy | Admin/Manager | derived from all postings | (drill into source doc) | No | `STOCK_LEDGER` *(new — see §12)* |
| 12 | Customer Stock Statement | Report | P0 | Customers need to see what's in storage; recomputed per date range, never "issued" as a fixed copy | Admin/Customer | derived from `stock_ledger` | — | No | `STOCK_STATEMENT` |
| 13 | Release / Delivery Order | Operational Doc | P0 | Entry point to the entire outward chain | Admin/Customer request | Customer + Stock | Pick List | Yes | `RELEASE_ORDER` |
| 14 | Pick List | Operational Doc | P0 | Tells staff what/where to pick; auto-filled entirely from the Release Order, near-zero extra entry | Operator | Approved Release Order | Dispatch | Yes | `PICK_LIST` |
| 15 | Dispatch Note | Operational Doc | P0 | Central outbound document; **absorbs Packing List's fields for V1** (see §12) | Operator | Pick List | Loading, Gate Pass | Yes | `DISPATCH_NOTE` |
| 16 | Loading Sheet | Operational Doc (internal) | P0 | Explicit mandatory gate in this phase's workflow before Gate Pass | Operator | Dispatch | Gate Pass | Yes | `LOADING_SHEET` |
| 17 | Gate Pass | Operational Doc | P0 | Security/compliance control; fires the outward stock posting | Operator/Security | Loading confirmed | POD | Yes | `GATE_PASS` |
| 18 | POD | Operational Doc | P0 | Closes the outward loop; mobile capture is a core differentiator | Driver/Customer | Gate Pass | Invoice | Yes | `POD` |
| 19 | Storage/Handling Invoice | Financial Doc | P0 | Revenue-critical; the entire product's monetizable outcome for the tenant's own customer | Billing Exec. | Billing run over Phases 4–6 data | Payment | Yes | `INVOICE_GENERATION` |
| 20 | Credit Note | Financial Doc | P0 | India GST correctness requires a proper credit note for any downward invoice adjustment — this is a compliance need, not a nice-to-have | Billing Exec. | Invoice (branch) | — | Yes | `CREDIT_NOTE` |
| 21 | Payment Receipt | Financial Doc | P0 | Closes the billing loop; updates outstanding | Billing Exec./Accountant | Invoice | Customer Statement | Yes | `PAYMENT_RECEIPT` |
| 22 | Customer Account Statement | Report | P0 | Needed for collections from day one; recomputed, not versioned | Accountant/Customer | Invoices+Debit+Credit+Payments | — | No | `CUSTOMER_STATEMENT` |
| 23 | Debit Note | Financial Doc | P1 | Same mechanism as Credit Note, schema-ready, but less urgent in the first billing cycles | Billing Exec. | Invoice (branch) | — | Yes | `DEBIT_NOTE` |
| 24 | Stock Transfer | Operational Doc | P1 | Common in multi-location operations but not required to complete the core loop; zero extra schema cost to include if time allows | Operator | Stock (parallel to main chain) | — | Yes | `STOCK_TRANSFER` |
| 25 | Physical Stock Verification | Operational Doc | P1 | Audit/compliance value, not a launch blocker | Manager | Stock (parallel) | Stock Adjustment (approval-gated) | Yes | `STOCK_VERIFICATION` |
| 26 | Packing List | Operational Doc | P1 (optional toggle) | Redundant with Dispatch Note's own `total_packages`/`total_weight_kg` fields for most general-warehousing customers; kept as an opt-in separate document for customers needing box-level breakdown | Operator | Pick List | Dispatch | Yes, only if a tenant enables it | `PACKING_LIST` |

19 P0 items ship at launch (17 metered documents + 2 reports counted
above as P0 non-doc + KYC/Rate Card as P0 non-doc — 23 rows total above,
19 of them P0). 4 items are P1, included in V1's scope but not gating the
launch date.

## 3. Deferred / Future Roadmap

| Name | Reason for deferral | Suggested phase |
|---|---|---|
| Return workflow (Return Request, Return Inward, Return Inspection, Damage Report) | Not in this phase's 26-item baseline and not part of the stated core loop sentence; schema (`return_requests`, `return_inwards` in `schema/50_outbound.sql`) already exists and needs no rework when built | V1.1 |
| Customer Portal (self-service login) | A full second authentication/authorization surface and its own dashboard; V1 delivers the same documents by direct staff share/download/email without requiring a customer login | V1.1 |
| Inspection as a standalone document | Blueprint's own §20 warns against turning this into a QA system; condition/seal/damage capture already lives on `grn_items` columns, which covers general warehousing's actual need. The `inspections` table stays in the schema, unused, for later | V1.x, if a customer segment needs formal inspection sign-off |
| Full configurable multi-step Approval Engine (§50's Operator→Manager→Owner chains per document type) | `approval_chain_templates`/`approval_instances`/`approval_steps` already model this generically; V1 ships one simple Draft→Approved gate per document instead of tenant-configurable chains, to avoid building approval-chain admin UI before any tenant has asked for it | V1.1, config-only addition, no schema change |
| Full Reports library (§55: Daily Inward/Outward, Stock Ageing, Collection, Document Register, Agreement Expiry, etc.) | Only the three reports already required to close the core loop (Stock Ledger, Customer Stock Statement, Customer Statement) ship in V1; the rest are genuinely "nice to have," not core-loop-blocking | V1.1–V2, prioritized by actual usage data per this phase's own "launch → collect usage → expand" philosophy |
| In-app/email/WhatsApp Notification Engine (§8, §56) | Not needed to complete a single transaction; every document is still visible and downloadable without it | V1.1 |
| Stock Ageing report/buckets UI | The underlying computation is already possible from `stock_lots`/received date (`stock-engine.md` §5); only the report screen is missing | V1.1 |
| Live payment gateway checkout (Razorpay/Cashfree) | V1 launches on the seeded Free plan with upgrades handled manually/offline by the vendor's own team (see §12); this is explicitly compatible with "launch, get subscribers, then expand" | V1.1, once a gateway is chosen (`DECISIONS.md` §13, still open) |
| Full guided Demo Mode walkthrough with pre-seeded sample data | The mechanism (`tenants.is_demo`, isolated tenant) is P0; a polished scripted demo experience is UI polish on top of it | V1.1 |
| ASN, Cold Storage, WDRA, Customs Bonded Warehouse, Advanced TMS, Full Accounting ERP, HRMS, Payroll, RFID, IoT, AI forecasting, Marketplace integrations, Advanced e-commerce OMS | Explicitly out of scope per both blueprints; reaffirmed, not reconsidered | Roadmap, unscheduled |

## 4. End-to-End V1 Workflow

```
                         ┌── (soft gate, not code-enforced) ──┐
Customer ───────────► KYC (recommended before Agreement, not before Quotation)
   │
   ▼
Quotation ──(optional — may start directly at Agreement)──► Agreement ──► Rate Card
   │                                                                        │
   └────────────────────────────────────────────────────────────┬─────────┘
                                                                  ▼
                                                            Gate Entry (optional)
                                                                  │
                                                                  ▼
                                                            Goods Inward
                                                                  │
                                                                  ▼
                                                                GRN ──(mismatch/damage)──► Discrepancy Report
                                                                  │
                                                                  ▼
                                                              Put-away
                                                                  │
                                                                  ▼
                                                       Operational Warehouse Receipt
                                                                  │
                                                                  ▼
                                                                Stock ◄──(parallel, optional)── Stock Transfer / Verification
                                                                  │
                                                                  ▼
                                                          Release / Delivery Order
                                                                  │
                                                                  ▼
                                                              Pick List
                                                                  │
                                                          (packing = a status flag on the
                                                           Dispatch record, not a gate)
                                                                  ▼
                                                             Dispatch Note
                                                                  │
                                                                  ▼
                                                          Loading (confirm)
                                                                  │
                                                                  ▼
                                                              Gate Pass
                                                                  │
                                                                  ▼
                                                                 POD
                                                                  │
                                                                  ▼
                                              Storage/Handling Charges (billing run)
                                                                  │
                                                                  ▼
                                                               Invoice ──(correction)──► Credit Note / Debit Note
                                                                  │
                                                                  ▼
                                                                Payment
                                                                  │
                                                                  ▼
                                                       Customer Account Statement
```

**Mandatory backbone (cannot be skipped to complete a sale):** Customer →
Gate Entry or direct Inward → Goods Inward → GRN → Put-away → Warehouse
Receipt → Stock → Release Order → Pick List → Dispatch → Loading
confirmation → Gate Pass → POD → Invoice → Payment.

**Optional / branching:**
- KYC and Quotation are recommended but not code-enforced hard gates — a
  tenant may create an Agreement directly for an existing relationship, and
  a KYC-pending customer can still transact (a soft warning, not a block,
  keeps onboarding fast — see §12 if this needs to become a hard gate for
  some tenants' compliance needs).
- Discrepancy Report only exists when GRN detects a mismatch.
- Debit/Credit Note only exist when a correction is needed.
- Stock Transfer/Verification run in parallel to the main chain, not on it.
- Gate Entry itself is optional when a customer's own vehicle brings goods
  without a formal gate process (small operations); Inward can be created
  directly.

## 5. Document Dependency Map

Implemented as real foreign keys, not UI labels — see `ux-system.md` §7's
`getDocumentRelations()` traversal, which walks exactly this graph:

| Document | Created From (FK) | Related Documents (reverse FK) |
|---|---|---|
| Agreement | `agreements.quotation_id` → Quotation (nullable) | Rate Card(s) linked via `rate_cards.source_agreement_id` |
| Rate Card | `rate_cards.source_agreement_id` / `source_quotation_id` | every Invoice line priced from it |
| Inward | `inwards.gate_entry_id` (nullable) | GRN(s) |
| GRN | `grns.inward_id` | Discrepancy Report, Put-away, Warehouse Receipt, `stock_ledger` rows |
| Discrepancy Report | `discrepancy_reports.grn_id` | — (informational leaf) |
| Put-away | `putaways.grn_id` | Warehouse Receipt |
| Warehouse Receipt | `warehouse_receipts.grn_id` | `stock_ledger` rows (`source_type='grn'`) |
| Release Order | `release_orders.customer_id` + requested stock | Pick List |
| Pick List | `pick_lists.release_order_id` | Dispatch |
| Dispatch | `dispatches.pick_list_id` | Loading Sheet, Gate Pass |
| Loading Sheet | `loading_sheets.dispatch_id` | Gate Pass |
| Gate Pass | `gate_passes.dispatch_id` | POD, `stock_ledger` OUTWARD row |
| POD | `pods.dispatch_id` (or gate pass) | Invoice (via billing run's source period) |
| Invoice | billing run over GRN/Dispatch-derived charges | Credit Note, Debit Note, Payment Receipt |
| Credit/Debit Note | `*.invoice_id` | Customer Account Statement line |
| Payment Receipt | `payments.invoice_id` (or on-account) | Customer Account Statement line |

## 6. Auto-Fill Matrix

| Field group | Master/source | Reused by (V1 P0 documents) |
|---|---|---|
| Legal name, GSTIN, PAN, billing/delivery address, contact, payment terms, default rate card | `customers` + `customer_addresses` + `customer_contacts` | Quotation, Agreement, Gate Entry, Inward, GRN, Warehouse Receipt, Release Order, Dispatch, Invoice, Credit/Debit Note, Customer Statement |
| Warehouse name, address, GST, contact, manager | `warehouses` | Gate Entry, Inward, GRN, Warehouse Receipt, Release Order, Dispatch, Gate Pass, Invoice (warehouse-scoped rate card) |
| SKU, product name, HSN, UOM, weight, dimensions, barcode, batch tracking | `products` | Inward items, GRN items, Put-away lines, Pick List lines, Dispatch lines, Invoice lines (for weight/CBM-based storage rates) |
| Vehicle number, vehicle type, transporter | `vehicles` (→ `transporters`) | Gate Entry, Inward, Dispatch, Loading Sheet, Gate Pass |
| Driver name, mobile, license | `drivers` | Gate Entry, Dispatch, Loading Sheet, Gate Pass, POD |
| Location code (zone/rack/row/bin/pallet) | `locations` | Put-away, Pick List (via allocation policy), Stock Ledger |
| Rate lines (storage/handling basis, rate, minimum charge, free days) | `rate_cards` + `rate_card_lines`, resolved customer → warehouse → company (`billing-engine.md` §3) | Quotation, Invoice |
| Company legal name, logo, GSTIN, bank details, signatory | `tenants` | every generated document's header/footer |
| Prior-stage document number and totals (e.g. GRN's accepted quantities) | the immediately preceding document in §5's chain | every document one step downstream in the chain |

A field only needs to be typed once, at its master or at the earliest
document in the chain that first captures it — every downstream document
in §5 pulls it via the source record's foreign key, per
`workflow-and-statuses.md` §1's `resolve{Entity}()` contract, not by
re-asking the user.

## 7. Subscription & 2-Free-Copy Matrix

Default free limit is **2, `period = 'lifetime'`**, for every metered
document type below, seeded on the `FREE` plan per `entitlement-engine.md`
§6. The seed (`apps/api/src/db/seed-data.ts`) holds **27 feature keys — 22
metered, 5 unmetered** — matching this table since `RETURN_INWARD` was
added to it, once Returns was built rather than deferred. Rows marked "Not metered" are `feature_keys.is_meterable = false`
(schema already supports this — no change needed).

| Feature | Feature key | Free limit | Usage event | Counts | Does not count | Subscription requirement past limit | Demo behavior |
|---|---|---|---|---|---|---|---|
| Quotation | `QUOTATION_GENERATION` | 2 | `commitDocument` succeeds | 1 successful finalized generation | Preview, failed render, cancelled draft, re-download/print/view, retry of same request | Paywall → View Plans / Continue Exploring | Unlimited on demo tenant's plan |
| Agreement | `AGREEMENT_GENERATION` | 2 | same | same | same | same | same |
| Gate Entry | `GATE_ENTRY` | 2 | same | same | same | same | same |
| Goods Inward | `INWARD` | 2 | same | same | same | same | same |
| GRN | `GRN_GENERATION` | 2 | same | same | same | same | same |
| Discrepancy Report | `DISCREPANCY_REPORT` | 2 | same | same | same | same | same |
| Put-away | `PUTAWAY` | 2 | same | same | same | same | same |
| Warehouse Receipt | `WAREHOUSE_RECEIPT` | 2 | same | same | same | same | same |
| Release Order | `RELEASE_ORDER` | 2 | same | same | same | same | same |
| Pick List | `PICK_LIST` | 2 | same | same | same | same | same |
| Dispatch Note | `DISPATCH_NOTE` | 2 | same | same | same | same | same |
| Loading Sheet | `LOADING_SHEET` | 2 | same | same | same | same | same |
| Gate Pass | `GATE_PASS` | 2 | same | same | same | same | same |
| POD | `POD` | 2 | same | same | same | same | same |
| Invoice | `INVOICE_GENERATION` | 2 | same | same | same | same | same |
| Credit Note | `CREDIT_NOTE` | 2 | same | same | same | same | same |
| Payment Receipt | `PAYMENT_RECEIPT` | 2 | same | same | same | same | same |
| Debit Note (P1) | `DEBIT_NOTE` | 2 | same | same | same | same | same |
| Stock Transfer (P1) | `STOCK_TRANSFER` | 2 | same | same | same | same | same |
| Stock Verification (P1) | `STOCK_VERIFICATION` | 2 | same | same | same | same | same |
| Packing List (P1, opt-in) | `PACKING_LIST` | 2 | same | same | same | same | same |
| Return Inward | `RETURN_INWARD` | 2 | same | same | same | same | same |
| Customer KYC | `CUSTOMER_KYC` | — | Not metered | — | — | Always available on every plan | Always available |
| Rate Card | `RATE_CARD` | — | Not metered | — | — | Always available | Always available |
| Stock Ledger | `STOCK_LEDGER` | — | Not metered | — | — | Always available | Always available |
| Customer Stock Statement | `STOCK_STATEMENT` | — | Not metered | — | — | Always available | Always available |
| Customer Account Statement | `CUSTOMER_STATEMENT` | — | Not metered | — | — | Always available | Always available |

Every "Not metered" row is a deliberate choice, not an oversight: metering
a report the way a document is metered would mean paying customers get
punished for checking their own stock or statement, which contradicts
"materially improve customer value" (§5, test 3). See §12 if the product
owner wants a *different* limit dimension (e.g. export count) applied to
these instead of leaving them fully open.

## 8. V1 Screen Map

| Module | Screen | Primary actions | Related documents | Permissions (from `permissions-matrix.md`) | Subscription behavior |
|---|---|---|---|---|---|
| Dashboard | Dashboard | View today's inward/outward/stock/pending items | links into every module below | `view_*` per widget's module | Usage nudge only near/at a limit (`ux-system.md` §12) |
| Masters | Customers, Products/SKUs, Warehouses, Locations, Transporters, Vehicles, Drivers, Rate Cards, Users | CRUD, KYC status update | feeds every operational doc via auto-fill | `*_customer`, `*_product`, etc. | Not metered |
| Operations | Gate Entry, Inward, GRN, Put-away, Stock, Stock Transfer (P1), Release Orders, Picking, Dispatch, Gate Pass, POD | Create → auto-filled from source → generate/commit | full chain per §5 | `create_grn`, `approve_grn`, etc. | Paywall on generate/commit past free limit |
| Documents | Document Centre (all types), Quotations, Agreements, Warehouse Receipts | Search/filter, view lifecycle, "Created From"/"Related" | all P0 docs | `view_documents`, `regenerate_document` | Viewing/downloading never consumes usage |
| Billing | Storage/Handling Charges (billing run preview), Invoices, Credit Notes, Debit Notes (P1), Receipts, Customer Statements | Preview → Generate Invoice → Record Payment | Invoice ↔ Credit/Debit Note ↔ Receipt ↔ Statement | `create_invoice`, `approve_invoice`, etc. | Paywall on invoice/credit-note generate past free limit |
| Reports | Stock Ledger, Customer Stock Statement, Customer Account Statement | Filter, export | n/a (these are the reports) | `view_reports` | Not metered |
| Settings | Company, Number Series, Users & Roles, Plan & Usage | Configure | n/a | Owner/Admin only for most | Plan & Usage page itself is the usage-transparency surface |
| Customer Portal | *(excluded from V1 — see §3; **built anyway**: `GET /portal/*` and `POST /portal/return-requests`)* | Read-only own stock, receipts, dispatches, invoices, documents | own records only | portal membership, not a staff role | — |

No screen exists for Returns, full Reports library, Notifications config,
or the Agreement wizard's 11 separate steps — deliberately, per §3. *(The
**APIs** for Returns, Notifications and the portal were built after all;
what is missing for all of them, and for every row in this table, is the
frontend, since none exists yet.)*

## 9. Existing Architecture vs. V1 Gap Analysis

> **Superseded.** Every "Missing" in the *Backend service/API* column below
> is now built; the module that implements each row is named in the Notes.
> The *Frontend* column is still accurate — nothing has been built there.

| Area | Schema | Backend service/API | Frontend | Notes |
|---|---|---|---|---|
| Tenancy, auth, RBAC | Already implemented (`schema/00_core.sql`) | **Built** | Missing | `apps/api/src/auth/`, `db/tenant-context.ts`, `users/`; RLS in `schema/90`–`92` |
| Entitlement/subscription engine | Already implemented (`schema/80_subscription.sql`) | **Built** | Missing | `apps/api/src/entitlement/entitlement.service.ts` — `checkEntitlement`/`consumeEntitlement`/`recordFailedAttempt` |
| Numbering engine | Already implemented (`number_series` in `schema/00_core.sql`) | **Built** | n/a | `apps/api/src/numbering/numbering.service.ts`; needed `schema/93` to make its unique key real |
| Masters (Customer/Warehouse/Product/Transport/Rate Card) | Already implemented (`schema/10_masters.sql`) | **Built** | Missing | `customers/`, `warehouses/`, `products/`, `transport/`, `billing/` |
| Commercial (Quotation, Agreement, Rate Card linkage) | Already implemented (`schema/20_commercial.sql`) | **Built** | Missing | `quotations/`, `agreements/`; wizard-vs-single-form is still a frontend decision |
| Inbound (Gate Entry → Warehouse Receipt) | Already implemented (`schema/30_inbound.sql`) | **Built** | Missing | `gate-entries/`, `inwards/`, `grns/`, `inspections/`, `discrepancy-reports/`, `putaways/`, `warehouse-receipts/` — `inspections` is used after all |
| Stock engine | Already implemented (`schema/40_stock.sql`) | **Built** | Missing | `stock/`, `stock-transfers/`, `stock-verifications/`, `stock-adjustments/`; needed `schema/96` before the balance key was real |
| Outbound (Release Order → POD, Returns, Packing List) | Already implemented (`schema/50_outbound.sql`) | **Built** | Missing | `release-orders/`, `pick-lists/`, `outbound/`, `returns/` — Returns and a standalone Packing List were built rather than deferred |
| Billing (Invoice, Debit/Credit Note, Payment) | Already implemented (`schema/60_billing.sql`) | **Built** | Missing | `invoicing/`, `receivables/`; needed `schema/97` for payment idempotency |
| Document engine, QR, versioning, approvals | Already implemented (`schema/70_documents_governance.sql`) | **Built** | Missing | `documents/` with 24 registered templates; needed `schema/95` for the public verify lookup. `getDocumentRelations` is the one specified piece still unbuilt |
| Document design system / PDF rendering | Specified (`document-engine.md` §3) | **Built** | Missing | `documents/pdf-renderer.service.ts` + `documents/html/layout.ts` — headless Chromium via `puppeteer-core` (`DECISIONS.md` §24) |

**Bottom line, as written: nothing in this V1 scope requires a new entity,
a new API shape, or a schema modification.** The gap is 100% "write the
application," none of it "redesign the data model."

*How that held up:* mostly, and not entirely. No table was redesigned and
no domain entity was added. But nine corrective schema files were needed
(`schema/85`, `90`–`97`), and every one of them closed a constraint that
looked right on the page and enforced nothing in practice — four instances
of the same nullable-column uniqueness gap, two RLS lookups that had to
exist before login and QR verification could work at all, and one missing
idempotency column. Reviewing DDL is not the same as building on it.

## 10. Launch Blockers

**P0 — launch blockers** *(the first two are closed; see the banner in §1)*:
- ~~No application code exists yet~~ — the backend is built through Phase 8.
  What remains a launch blocker is that **no frontend exists**: every screen
  in §8 is unbuilt, and the API alone is not a product a warehouse can use.
- ~~Technology stack is still not chosen~~ — decided and built on
  (`DECISIONS.md` §0): NestJS + TypeScript on PostgreSQL 16.
- The Agreement template's legal wording needs actual legal review before
  any real tenant sends it to a real customer (blueprint's own explicit
  requirement) — engineering cannot close this, it needs a human legal
  reviewer engaged before launch, not after.
- The two judgment calls in §12 (Agreement wizard scope, approval-chain
  scope) need explicit product-owner sign-off before Phase 3/4 build
  starts, since they shape how much UI gets built.

**P1 — important, should land in or shortly after V1:**
- ~~Debit Note, Stock Transfer, Stock Verification, opt-in Packing List~~ —
  all four built (`receivables/`, `stock-transfers/`, `stock-verifications/`,
  and a standalone `packing_list` document type).
- A minimal Plan & Usage page (already scoped in `ux-system.md` §13) —
  launching the entitlement engine without any visible usage page would
  make the paywall feel arbitrary to a real subscriber.
- A manual/offline upgrade path (an admin or the vendor's own team
  upgrading a tenant's plan by hand) so the business can accept its first
  paying customers before a payment gateway is integrated.

**P2 — post-launch improvements:**
- Payment gateway integration, full Reports library, Notifications,
  Customer Portal, Return workflow, full Approval Engine UI, guided Demo
  Mode, Stock Ageing report screen.

## 11. Recommended Implementation Order

Follows `dev-phases.md`'s existing phase structure, trimmed to only the
items this document keeps in V1 (P1 items build in the same phase as their
P0 siblings when time allows, otherwise immediately after, never blocking
that phase's exit check):

1. **Phase 1** — Auth, tenancy, RBAC, entitlement engine (already scoped
   to include this — no change from `dev-phases.md`).
2. **Phase 2** — All masters + Rate Card + onboarding wizard. Add: KYC
   status workflow on the Customer screen.
3. **Phase 3** — Document engine + Quotation + Agreement (single-form,
   per §12) + Document Centre/relationships/timeline.
4. **Phase 4** — Gate Entry → Warehouse Receipt, including the
   conditional Discrepancy Report. Skip building the standalone
   `inspections` UI.
5. **Phase 5** — Stock engine, Stock Ledger report, Customer Stock
   Statement. Stock Transfer/Verification (P1) if time allows, else
   immediately after.
6. **Phase 6** — Release Order → POD, with Dispatch absorbing Packing
   List's fields. Skip building the Return workflow's UI.
7. **Phase 7** — Billing run, Invoice, Credit Note (P0), Payment Receipt,
   Customer Account Statement. Debit Note (P1) alongside if time allows.
8. **Phase 8, trimmed** — Plan & Usage page and pricing page (P0, moved
   up in priority within this phase); skip Customer Portal, full Reports
   library, and Notifications for V1.
9. **Phase 9** — Full testing per `test-plan.md`, including its §4
   entitlement test cases, scoped to exactly the P0/P1 set above.

## 12. Risks / Decisions Requiring Approval

1. **Agreement ships as a single structured form in V1, not the blueprint's
   full 11-step wizard.** No schema change either way (`agreements` is one
   flat table); this only affects how much frontend gets built in Phase 3.
   Confirm, or specify which of the 11 steps are non-negotiable for launch.
2. **Approval workflow ships as simple Draft → Approved for V1**, not the
   fully configurable multi-step chain engine `schema/70_documents_governance.sql`
   already supports generically. Confirm no launch customer requires a
   multi-approver chain on day one.
3. **`INWARD` is kept as the feature key** for Goods Inward (this message's
   own example list used `GOODS_INWARD`), because it was already
   established in `entitlement-engine.md`/blueprint-saas-layer §15 and
   there is no other tenant-facing reason to rename it. Flagging in case a
   different naming convention was actually intended.
4. **`STOCK_LEDGER` is a new feature key**, not present in the prior
   blueprint's §15 list, added here because Stock Ledger is now explicitly
   a V1 P0 item. Confirm this is fine to add to the catalog (it is additive
   only — no existing key changes meaning).
5. **Record-count/seat-based plan limits are not designed.** Everything in
   `entitlement-engine.md` and §7 above meters *actions* (a document
   generated), never *how many rows exist* (e.g. "Free plan: 1 warehouse,"
   "Starter: 5 users"). If V1's actual pricing needs that kind of limit
   at launch, it is a genuinely new enforcement pattern (check `count(*)`
   against a limit at creation time, not `usage_ledger`) and needs its own
   design pass before Phase 1 finalizes `plan_feature_limits` seed data.
6. **V1 launches without a live payment gateway.** Upgrades past the free
   limit are handled manually by the vendor's own team (an admin flips
   `tenant_subscriptions.plan_id`) until a gateway is chosen and
   integrated in V1.1. This is what makes "launch now, collect usage
   data" achievable on the stated timeline; confirm it's commercially
   acceptable to start this way.
7. **Packing List is folded into Dispatch Note's fields for V1**, with the
   separate document available only as a per-tenant opt-in later. Confirm
   no committed V1 launch customer requires a separate, formally issued
   packing list on day one.
8. **KYC and Quotation are soft gates, not hard-enforced blockers** — a
   tenant can create an Agreement or even transact with a KYC-pending
   customer. Confirm this matches the intended risk posture, or specify
   which step(s) must become a hard, code-enforced gate.
9. **Return workflow and Customer Portal are deferred to V1.1 in full**,
   despite already having schema support. Confirm no committed V1 launch
   customer needs either on day one — if one does, both are additive
   builds against existing schema, not scope surprises.
10. **Technology stack is still the one open item blocking Phase 1 from
    starting at all** (`DECISIONS.md` §0) — unrelated to this scope
    freeze, but worth restating since this document assumes Phase 1 can
    begin immediately once it's approved.
