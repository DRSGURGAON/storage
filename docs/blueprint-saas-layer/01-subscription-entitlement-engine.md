# Sections 6–17 — Subscription Model & Centralized Entitlement Engine

## 6. Subscription Model — Critical

The monetization architecture must be built **centrally**. Do not hard-code
`if count > 2 then show payment` inside individual modules. Instead build a
centralized **Entitlement / Usage Limit Engine** supporting: free usage,
trial/demo usage, subscription plans, module-level limits, feature-level
limits, document-generation limits, usage tracking, subscription status,
grace periods, upgrade prompts, future plan changes, and admin-configurable
limits.

## 7. Two Free Copies Rule

Initial business rule: **every document module/generation feature gets 2
free successful copies** (GRN, Warehouse Receipt, Gate Pass, Invoice,
Quotation, POD, and so on). After 2 successful generations, show a
professional upgrade/subscription screen.

Important: a **failed** PDF generation must not consume usage. A **preview**
must not consume usage unless explicitly configured as billable. A
**cancelled draft** must not consume usage. Only a successful, finalized,
generated document consumes the free entitlement.

## 8. What "Copy" Means

One successful finalized/generated document = one usage. GRN #001 generated
successfully = 1 usage; GRN #002 = 1 usage; GRN #003 = subscription
required. Downloading, printing, or viewing an already-generated document
must **not** consume another usage. Regenerating a document after an actual
content revision may be treated as a new generation only if business rules
explicitly define it that way. This must be a centralized policy, not
module-specific hacks.

## 9. Usage Tracking

A robust usage ledger tracks: tenant/company, user, feature/module,
document type, record ID, generation ID, timestamp, subscription status,
usage consumed, success/failure, reason. Example:

```
Tenant: ABC Logistics
Feature: GRN
Free allowance: 2
Used: 2
Remaining: 0
Status: UPGRADE_REQUIRED
```

This must be auditable.

## 10. Idempotency

Extremely important: if the user clicks "Generate PDF" twice due to slow
internet, the system must **not** accidentally consume two usages or create
duplicate documents. Use idempotent generation logic. A successful
generation has a unique generation/document identifier.

## 11. Paywall UX

Do not abruptly block the user with an ugly generic popup. After the free
limit, show a polished SaaS upgrade experience that explains **value**, not
simply "Payment required":

```
You've used your 2 free GRN documents.
Your warehouse is ready for unlimited documentation.

✓ Unlimited GRNs
✓ Professional PDF documents
✓ Automatic stock updates
✓ Customer-wise records
✓ Document history
✓ QR verification
✓ More warehouse tools

[View Plans]   [Continue Exploring]
```

## 12. Demo Mode

When a user reaches a limit, provide a safe demo experience where
appropriate — sample document, sample warehouse, sample customer, sample
stock, sample workflow — to show what the paid product provides. Demo data
must **never** mix with real customer data and must be clearly labelled
demo/sample.

## 13. Subscription Architecture

Do not assume only one plan. Build a flexible structure:

```
PLAN → PLAN FEATURES → PLAN LIMITS → TENANT SUBSCRIPTION → USAGE → ENTITLEMENT CHECK
```

Possible future plans: Free/Trial, Starter, Business, Professional,
Enterprise. Do not hard-code these names throughout the application — store
plan configuration centrally.

## 14. Entitlement Check

Every restricted action passes through a common entitlement service.
Conceptual API:

```
checkEntitlement({ tenantId, feature: "GRN_GENERATION" })
```

Response when allowed: `{ allowed: true, reason: null, remaining: 1 }`.
Response when blocked: `{ allowed: false, reason: "LIMIT_REACHED",
remaining: 0, upgradeRequired: true }`.

The frontend uses the response to display the appropriate UX. The
**backend must enforce** the entitlement — never trust frontend-only
restrictions.

## 15. Feature Identifiers

Use stable, centrally managed feature keys, e.g.: `CUSTOMER_KYC`,
`QUOTATION_GENERATION`, `AGREEMENT_GENERATION`, `GATE_ENTRY`, `INWARD`,
`GRN_GENERATION`, `DISCREPANCY_REPORT`, `PUTAWAY`, `WAREHOUSE_RECEIPT`,
`STOCK_STATEMENT`, `STOCK_VERIFICATION`, `STOCK_TRANSFER`,
`RELEASE_ORDER`, `PICK_LIST`, `PACKING_LIST`, `DISPATCH_NOTE`,
`LOADING_SHEET`, `GATE_PASS`, `POD`, `RETURN_INWARD`,
`INVOICE_GENERATION`, `DEBIT_NOTE`, `CREDIT_NOTE`, `PAYMENT_RECEIPT`,
`CUSTOMER_STATEMENT`.

## 16. Free Limit Configuration

Do not hard-code "2" throughout the application. Configuration shape:
`feature`, `freeLimit`, `subscriptionRequired`, `enabled`, `planLimits`.
Today `freeLimit = 2`; tomorrow it may become `5` without changing
application code.

## 17. Module vs. Feature

Architecturally distinguish **Module** (e.g. Billing) from **Feature**
(e.g. Invoice generation, Debit note, Credit note, Payment receipt). This
allows future plans such as: Starter = billing enabled but limited,
Business = billing fully enabled, Enterprise = advanced billing. Do not
make the architecture dependent on today's exact pricing.
