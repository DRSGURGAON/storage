# Document Engine

Blueprint refs: §44–§49, §65, §75; saas-layer §11, §24, §31; `entitlement-engine.md`

## 1. One service, not one PDF renderer per page

```
generateDocument(tenantId, documentType, sourceId, { regenerate?: boolean }) -> Document
```

is the **only** entry point that produces a PDF. Every module (GRN, Invoice,
Gate Pass, …) calls this same function; none of them contain their own PDF
layout code. Internally it:

1. Loads the source record (e.g. the `grns` row + its `grn_items`) plus the
   master data it needs (company, customer, warehouse) **as of now**.
2. Resolves the document's **template** for `documentType` (one shared layout
   per §47, parameterised by section content, not per-document bespoke HTML).
3. Builds an immutable `render_data_snapshot` — the exact values that will be
   printed — and freezes it.
4. Allocates a `qr_token` (§48) and renders the PDF with the QR embedded.
5. Writes one row to `documents` (`schema/70_documents_governance.sql`):
   `version_no` incremented from any prior version for this
   `(document_type, source_id)`, previous version's `is_latest` flipped to
   `false` and `superseded_by_document_id` set (§49 — never delete old
   versions).
6. Stores the PDF via the `attachments` table and returns the `documents` row.

Regeneration (§75 "Regenerate if permitted") calls the same function with
`regenerate: true`; it is only permitted when the source record's status
still allows edits, or by a user holding a specific
`regenerate_after_approval` permission — regenerating an **approved**
document does not silently replace history, it creates a new version with an
audit-logged reason (§49, §51).

**Implemented** in `regeneration-policy.ts` +
`DocumentEngineService.assertMayRegenerate()`. Every regeneration needs
`regenerate_document`; one on a source past its provisional state needs
`regenerate_after_approval` as well. `PROVISIONAL_SOURCE_STATUSES` is the
table that decides which, and it is drawn from each module's own edit
guard — the same statuses in which `PATCH` is accepted — so it cannot
drift from what the workflow already treats as open. Two entries are not
edit guards and say so: a put-away has no `PATCH` at all but is a working
instruction until `complete` confirms it (`pending`/`in_progress` are
open), and a warehouse receipt has no open state by design — §22 makes it
the document that must never be quietly reissued, so every regeneration
of one is an Owner/Admin act. An unknown document type is treated as
final, so a template that forgets to declare itself gets the stricter
rule rather than the looser one.

This is checked in the service, not with `@RequirePermission`, because
the answer depends on the request body (`regenerate`) and on the source
record's current status — neither of which a route decorator can see. It
was specified and seeded from the start but not enforced until the Phase
5 audit found it: `regenerate` had been honoured for anyone holding the
source record's own create permission, so a Warehouse Operator (who holds
`create_grn` and neither regenerate code) could supersede an approved
GRN's document — flipping the copy already in the customer's hands to
`revoked` on the public verify page, unmetered, since regeneration
deliberately consumes no second entitlement unit. See `DECISIONS.md` §33.

> **Implemented** (`apps/api/src/documents/`, `apps/api/src/attachments/`,
> Phase 3): `DocumentEngineService.previewDocument()` /
> `.commitDocument()` is this section's function split into its two halves
> (§6) — preview does steps 1–4 with no write, gated by `checkEntitlement`;
> commit does 1–6 inside one `withTenant` transaction, gated by
> `consumeEntitlement` on first commit only (a plain retry with no
> `regenerate` returns the existing row untouched — no re-render, no
> re-consumption; `regenerate: true` never calls `consumeEntitlement`
> again). PDF rendering is headless Chromium via `puppeteer-core`
> (`PdfRendererService`), driven by hand-written HTML/CSS functions in
> `documents/html/layout.ts` implementing §3's shared design system —
> `DECISIONS.md` §24 records why (this was §0's own already-locked choice,
> not reopened here) and §26 records an unrelated Jest/ESM loader issue
> the package's ESM-only build surfaced. QR codes are the `qrcode` package
> embedded as a data-URI before render. Attachments go through an
> `AttachmentStorage` interface with `LocalFilesystemAttachmentStorage` as
> the only implementation so far — `DECISIONS.md` §24 records the gap
> against this repo's own S3-signed-URL note and the proxy-endpoint
> fallback `tenancy-and-security.md` already sanctions. Thirteen templates
> are registered so far — Quotation, Agreement, Phase 4's whole inbound
> chain (Gate Entry, Inward, GRN, Discrepancy Report, Put-away, Warehouse
> Receipt), Phase 5's Stock Transfer, Stock Verification and Stock
> Statement, and Phase 6's Release Order and Pick List:
>
> | `documentType` | `featureCode` | Shape |
> |---|---|---|
> | `quotation` | `QUOTATION_GENERATION` | Party block, priced line items, totals |
> | `agreement` | `AGREEMENT_GENERATION` | Each already-resolved `rendered_clause` as its own titled section — no party card, since (unlike Quotation) there is no frozen `customer_snapshot` and the clause text already carries the resolved identity |
> | `gate_entry` | `GATE_ENTRY` | No line items or clauses at all, just two summary blocks |
> | `inward` | `INWARD` | Product/batch/quantity table, no money anywhere |
> | `grn` | `GRN_GENERATION` | Expected/received/accepted/rejected/short/excess columns, plus a discrepancy note on its face when the receipt does not tally |
> | `discrepancy_report` | `DISCREPANCY_REPORT` | Discrepant lines with both §19 acknowledgement lines |
> | `putaway` | `PUTAWAY` | Location codes with a confirmation checkbox — a sheet an operator carries |
> | `warehouse_receipt` | `WAREHOUSE_RECEIPT` | Frozen jsonb lines with locations, plus §22's mandatory "operational, not negotiable" disclaimer |
>
> Between them these cover every §3 primitive: the party block, the
> line-item table, totals, and the plain-prose section — and the two
> extremes (Gate Entry with no table at all, Quotation with a priced
> one) prove the shared design system degrades and scales without a
> per-document bespoke layout. Adding the next `documentType` from §2's
> list means one more `DocumentTemplate` implementation plus one more
> constructor argument to `DocumentTemplateRegistry`, not a new
> pipeline — proven eight times over now, not just asserted. Proven end-to-end in
> `documents.spec.ts`: preview vs. commit, idempotent retry, regenerate
> producing a new version with the old one's QR resolving `revoked`
> through the public verify endpoint (§4, below), cross-tenant isolation,
> permission gating, the FREE-plan 2-copy paywall on both preview and
> commit, and per-feature metering independence through the HTTP layer
> (proven on separate tenants for `QUOTATION_GENERATION`,
> `AGREEMENT_GENERATION`, `GATE_ENTRY` and `INWARD`; templates
> registered after that assert their own rendering and versioning
> rather than repeating the same proof).

## 2. Supported `documentType` values

Quotation, Agreement, Gate Entry, Inward, GRN, Discrepancy Report, Put-away,
Warehouse Receipt, Stock Statement, Stock Verification, Stock Transfer,
Release Order, Pick List, Packing List, Dispatch Note, Loading Sheet, Gate
Pass, POD, Return Inward, Invoice, Debit Note, Credit Note, Payment Receipt,
Customer Statement — the full §46/§76 list. Adding a new document type later
means adding one template + one data-loader function, not a new rendering
pipeline.

## 3. Design system (§47)

One shared A4 layout shell used by every template:

```
┌─────────────────────────────────────────────┐
│ [Logo]      Company legal name & GSTIN        │  ← header (company_snapshot)
│             Address · Phone · Email            │
├─────────────────────────────────────────────┤
│ DOCUMENT TITLE                Doc No: …        │  ← title band
│                                 Date: …         │
├─────────────────────────────────────────────┤
│ Party details (Customer / Consignee / …)       │  ← section, varies by type
├─────────────────────────────────────────────┤
│ [Section header]                               │
│ ┌───────────────────────────────────────────┐ │
│ │ clean table: line items                    │ │
│ └───────────────────────────────────────────┘ │
│ Totals block (right-aligned)                   │
├─────────────────────────────────────────────┤
│ Terms & conditions                             │
│ Signature area          [QR]                   │
├─────────────────────────────────────────────┤
│ Footer: generated by…, page X of Y             │
└─────────────────────────────────────────────┘
```

Shared primitives (one implementation, reused by every template): page
header/footer, party-detail block, line-item table, totals block, signature
block, QR block. A template for a specific document type only supplies which
sections it needs and their field bindings — it cannot introduce a different
visual language, which is what "documents should look like they belong to the
same professional software" (§47) requires structurally rather than by
reviewer diligence.

## 4. QR verification (§48, §65)

The QR encodes a URL: `https://{tenant-portal-domain}/verify/{qr_token}`.
`qr_token` is a random opaque value (not the document's row id, not its
document number) so it cannot be guessed or enumerated. The public
verification page, on a `document_verifications`-logged hit, shows **only**:

```
VALID DOCUMENT
GRN/26-27/000123
Issued by: {tenant trade name}
Generated: {date}
Status: {current status of the source record, e.g. "Approved"}
```

It never returns line items, customer contact details, amounts, or any other
field from `render_data_snapshot` — satisfying §48's "do not expose
unnecessary customer-sensitive information publicly." A revoked/superseded
document's QR resolves with `result = 'revoked'` and a corresponding message,
not a 404 (so a scanner can tell "this used to be valid" from "never
existed").

> **Implemented** (`apps/api/src/documents/verify.controller.ts`): a
> fully public `GET /verify/:qrToken` (no `@UseGuards`, matching this
> section's requirement that it needs no login). `documents` carries
> `force row level security` with only the standard tenant-isolation
> policy, which blocks every row when no tenant is known yet — exactly
> the problem the QR-verify flow starts with. Fixed the same way the
> login self-lookup was (`schema/91_tenant_users_self_lookup.sql`): a
> second, narrow, SELECT-only policy
> (`schema/95_document_qr_verify_lookup.sql`) that only exposes a row
> once the caller already supplies its own `qr_token` as a session
> variable — see `DECISIONS.md` §25 for the full bug and fix.

## 5. Versioning (§49)

`documents.version_no` / `is_latest` / `superseded_by_document_id` give a
full chain. The Document Timeline (§45) and Document Centre (§44) always
default to `is_latest = true` but let a user open "Version history" to see
every prior render, who generated it, and when it was approved/superseded —
never a destructive overwrite.

## 6. Preview before commit (§75)

`generateDocument` is split into `previewDocument` (steps 1–4 above, no DB
write) and `commitDocument` (step 5–6). The UI always calls `previewDocument`
first and renders it inline; only an explicit "Generate PDF" / "Issue" action
calls `commitDocument`. This is what makes the preview screens in Quotation,
Invoice, and Billing Run (§39, §66) consistent with every other document
instead of a one-off feature.

## 7. Entitlement gating (saas-layer §11, §31; `entitlement-engine.md`)

Not every `documentType` is metered — see `feature_keys.is_meterable` in
`schema/80_subscription.sql` — but for those that are, `generateDocument`
calls the entitlement engine at two distinct points, never conflated:

- **`previewDocument`** calls `checkEntitlement(tenantId, featureCode)`
  first. If `allowed: false`, it returns the paywall state instead of a
  rendered preview — the user sees the upgrade screen (`ux-system.md` §11)
  before any document content is built, satisfying saas-layer §31's "show
  the upgrade state before consuming anything." A preview that *is*
  rendered because the check passed still consumes nothing; only
  `commitDocument` does.
- **`commitDocument`** calls `consumeEntitlement(...)` in the **same
  transaction** as step 5 (the `documents` row insert), using an
  idempotency key derived from the source record and action (e.g.
  `"grn:{grn_id}:generate"` — the identical key the stock engine would use
  for that GRN's approval, since both represent "this GRN was approved
  exactly once," see `entitlement-engine.md` §4). If a retry lands on a
  document that was already committed, the entitlement insert is a
  no-op via `ON CONFLICT DO NOTHING`, and `commitDocument` itself detects
  the existing `documents` row and returns it rather than rendering a
  duplicate — one user action, one document, one unit of usage, regardless
  of how many times the request was retried.

A generation that fails after `checkEntitlement` passed but before
`commitDocument` succeeds (a rendering error, a timeout) writes a
`usage_ledger` row with `result = 'failed'`, `consumed = false` — visible
for audit, but never debited against the tenant's allowance (saas-layer
§7). Regeneration of an already-committed document (§75) reuses the
original `generation_id` and does not call `consumeEntitlement` again,
consistent with saas-layer §8: viewing, downloading, printing, or
re-rendering an existing document is never a new unit of usage.

## 8. Created From & Related Documents (saas-layer §24, §25)

`documents` rows don't duplicate the foreign-key graph already present on
every source table — "Created From" and "Related Documents" are computed,
not stored. See `ux-system.md` §7 for the UI contract and the
`getDocumentRelations(documentType, sourceId)` traversal it's built on.
