# UX System

Blueprint refs: saas-layer §18–29, §34–36, §41–44, §47–49

This document specifies the product-facing surfaces that make the
difference between "a CRUD admin panel" and "a professional vertical
SaaS." It assumes the data model and services in the other architecture
documents; this is about how they are presented and sequenced.

## 1. Onboarding (§18)

A first-login wizard, not a dashboard dump. Steps, each backed by the
ordinary create-endpoint for that entity (no special onboarding-only API):

```
1. Welcome           "Let's set up your warehouse."
2. Company details    → creates the tenants row (schema/00_core.sql)
3. First warehouse    → creates one warehouses row
4. Customer           → creates one customers row
5. Products/SKUs      → creates one or more products rows
6. Rate card           → creates one rate_cards + rate_card_lines set
7. Ready              "Your warehouse is ready."
```

Progress persists server-side (a small `onboarding_state` field on the
tenant, or derived live by checking whether each entity type has at least
one row) so refreshing or returning later resumes at the right step rather
than restarting. Each completed step renders a checkmark
(`Company ✓ Warehouse ✓ Customer ✓ Products ✓ Rates ✓`). Skipping ahead is
allowed — this is guidance, not a hard gate — but the dashboard's empty
states (§2) pick up exactly where onboarding left off if the user skips.

> **Implemented** (`apps/api/src/onboarding/`, Phase 2): `GET
> /onboarding/status`, taking the derived-live option above rather than a
> stored `onboarding_state` field, so a tenant that creates records
> out of order or skips the wizard always gets an accurate status. The
> Rate card step checks for a `rate_card_lines` row, not just a
> `rate_cards` row, matching this section's own "creates one `rate_cards`
> + `rate_card_lines` set." No onboarding-only endpoints exist — every
> step is the ordinary create-endpoint for that entity, exactly as
> specified above.

## 2. Empty States (§19)

Every list/table view has a designed empty state, not a bare "No data."
Pattern: a one-line explanation of what belongs here, plus one primary
action.

```
No customers yet
Add your first customer to start creating warehouse documents.
[Add Customer]
```

The copy and CTA are data attached to the view definition (per entity
type), not hand-written per screen inconsistently — one small
`emptyStateCopy(entityType)` lookup, reused everywhere a list can be empty.

## 3. Dashboard (§20)

Fixed composition, not a customizable widget grid (avoiding "meaningless
charts" per the design direction in §34):

- **Top row (today, at a glance):** Today's Inward, Today's Outward,
  Current Stock, Pending GRNs, Pending PODs, Outstanding. Each is a single
  authoritative query against the stock engine / billing engine — never a
  bespoke recalculation for the dashboard (see §51's no-duplicated-logic
  rule, and `stock-engine.md` / `billing-engine.md` as the only source for
  these numbers).
- **Below:** Recent Activity (a feed over `audit_logs` and `documents`,
  filtered to the user's warehouse scope), Pending Approvals (a query over
  `approval_instances` where `status = 'pending'` and the user's role
  matches the current step), Stock Summary, Billing Summary, Ageing Alerts.

## 4. Global Search (§21)

One search endpoint, one result renderer, fanning out across customer, SKU,
vehicle, GRN, invoice, gate pass, dispatch, POD, and generic document
number. Implementation-wise this is a single query layer over each
searchable table's indexed identifier columns (customer code/GSTIN/mobile,
product SKU/barcode, vehicle number, and every `number` column across the
numbered-document tables), unioned and ranked, not twelve separate search
boxes. Results are grouped by type with a one-line summary per hit
(`GRN/26-27/000045 · ABC Traders · Approved`) and clicking one navigates
straight to that record.

## 5. Universal Document Centre (§22)

One screen, backed directly by the `documents` table
(`schema/70_documents_governance.sql`) filtered to `is_latest = true` by
default. Filters: document type, customer, warehouse, date range, status.
No module maintains its own "my documents" list — GRN's detail page links
into this same Document Centre pre-filtered to that GRN's chain, rather
than rendering a parallel document list of its own.

## 6. Document Lifecycle (§23)

Every document-backed entity's status column (already defined per-domain in
`schema/*.sql` and governed by `workflow-and-statuses.md` §3) drives what
the Document Centre and detail pages show: Draft/Generated states allow
edits and regeneration; Approved/Issued states only allow the
smart-actions in §26 below plus a permitted, audit-logged Cancel; there is
no "just edit the issued PDF" path anywhere in the UI.

## 7. Document Relationships (§24) & Timeline (§25)

Every document detail page renders two things, generated from the same
traversal, not hand-maintained per document type:

- **Created From** — walk the record's direct foreign key to its source
  (e.g. `grns.inward_id`, `warehouse_receipts.grn_id`).
- **Related Documents** — walk every table with a foreign key pointing at
  this record (e.g. everything referencing this GRN's id: its Put-away, its
  Warehouse Receipt, its Discrepancy Report, its `stock_ledger` rows via
  `source_type='grn', source_id=this.id`).

Both use one generic `getDocumentRelations(documentType, sourceId)`
service function that knows the fixed foreign-key graph implied by
`schema/README.md`'s conventions — not a bespoke query written per document
type. The **Document Timeline** is the same underlying graph rendered as
the fixed sequence from blueprint §45/§68 (Gate Entry → Inward → GRN →
Inspection → Put-away → Warehouse Receipt → Stock → Release → Picking →
Dispatch → Gate Pass → POD → Invoice), with the records that actually exist
for this chain highlighted and clickable, and the ones that don't yet exist
shown as the next available smart action (§8).

## 8. "Create Next" Smart Actions (§26)

Same mechanism as `workflow-and-statuses.md` §2 — each detail page computes
its available actions from the record's current status, not a static
per-page button list. This section is the UX framing of that same backend
contract: the moment a GRN is approved, `[Create Put-away]`
`[Generate Warehouse Receipt]` `[View Stock]` appear in place of whatever
pre-approval actions were showing, without a page reload changing the
information architecture around them.

## 9. Auto-fill UX (§27) & Smart Forms (§28)

The visual contract for `workflow-and-statuses.md` §1's `resolve{Entity}()`
auto-fill: selecting a customer shows the compact identity line
(`ABC Traders · CUST-001 · GSTIN: XXXXXXXX`) immediately, then visibly
populates the dependent fields below it (billing address, delivery address,
GSTIN, contact, payment terms) rather than filling them silently off-screen
— the user must be able to see and, where policy allows, correct what was
auto-filled, per §27's explicit requirement. Every picker (customer, SKU,
vehicle, warehouse, driver) is the same searchable combobox component
described in `workflow-and-statuses.md` §6, matching on the fields listed
in §28 (name/code/GSTIN/mobile for customer, SKU/name/barcode for product,
registration number for vehicle, name/code for warehouse, name/mobile for
driver) — never a plain `<select>` enumerating every row.

## 10. Drafts (§29)

Same mechanism as `workflow-and-statuses.md` §5 (auto-save into the actual
target table at `status='draft'`, not a shadow drafts table). The UX
contract layered on top: a debounced "Draft saved" indicator near the form
title, and a "Continue draft" entry point from both the module's list view
and the Document Centre so an interrupted transaction is never orphaned.

## 11. Paywall UX (§11 of saas-layer, entitlement-engine.md §3)

Rendered whenever `checkEntitlement` returns `allowed: false`. Never a bare
"Payment required" dialog. Fixed structure: a value-forward headline, a
short checklist of what unlocking buys, and two actions — `[View Plans]`
(→ the pricing page, §14 below) and `[Continue Exploring]` (dismiss, stay
on read-only/lower-tier functionality). Copy is templated per feature
(`"You've used your {limit} free {featureName} documents."`), not
hand-written per module, pulling `featureName` from `feature_keys.name`.

## 12. Usage Indicators & Nudges (§41, §42)

Inline nudges appear only at two moments: after the first consumption of a
lifetime-limited feature ("1 of 2 free GRN generations used") and at the
limit ("2 of 2 free GRN generations used — [View Plans]"). No screen shows
a permanent usage badge by default — that lives in the Plan & Usage page
(§13) instead, keeping the day-to-day UI uncluttered per the design
direction in §34.

## 13. Plan & Usage Page (§43)

One settings page, driven directly by `checkEntitlement` results across
every meterable `feature_keys` row for the tenant's current plan: current
plan name and status, renewal date, and a table of feature → used → limit
→ remaining, each rendered as a simple progress bar. This page is the only
place usage is shown in full; it exists precisely so individual screens
don't need to (§42).

## 14. Pricing Page (§44)

Rendered directly from `plans` and `plan_feature_limits` where
`plans.is_public = true`, ordered by `sort_order` — a comparison table of
warehouses/users/customers/documents/stock/billing/customer
portal/reports/QR verification/support derived from the same rows the
entitlement engine checks against, so the pricing page can never drift out
of sync with what is actually enforced. Final price points are configured
data (`plans.price_monthly`/`price_yearly`), not hard-coded in the page.

## 15. Error UX (§47)

A failed metered action's error message explicitly states that usage was
not consumed, because `entitlement-engine.md` §2 guarantees that as a fact,
not just a friendly claim: `"We couldn't generate the document right now.
Your free usage was not consumed. Please try again."` Generic 500s are
never shown verbatim to the user; every user-facing error is a mapped,
human-readable message with the underlying error retained in the audit/
error log for support.

## 16. Success UX (§48)

A successful generation always shows: a confirmation line with the
document number, and the next-action buttons from §8 in place —
`✓ GRN generated successfully — GRN/26-27/000123`, `[View Document]`
`[Download PDF]` `[Create Put-away]`. This is rendered from the same
`generateDocument()` response and the same smart-actions computation used
elsewhere, not a one-off success screen per document type.

## 17. Responsive Surfaces & Mobile Capture (§35, §36)

Desktop-first screens: masters, billing, reports, agreements, dashboard,
configuration, Plan & Usage, pricing. Mobile-first screens: Gate Entry,
GRN, stock lookup, barcode/QR scan, picking, loading, Gate Pass, POD. These
are not the same layouts at a smaller breakpoint — the mobile versions are
purpose-built single-column, large-touch-target flows. Camera-driven inputs
(damage photos, POD photos, signature capture) upload directly into the
`attachments` table scoped to the specific transaction being worked, per
`tenancy-and-security.md` §5 — never a generic unattached media library.
