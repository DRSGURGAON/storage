# Sections 2–5 — Positioning, Core Principle, Connected Workflow, V1 Scope

## 2. Product Positioning

The product is **Warehouse Documentation & Operations SaaS**.

Core promise: *"Create, manage and track your warehouse documentation from
inward to outward, stock and billing — with minimum data entry."*

It is **not** a generic PDF generator, a generic CRM, a generic ERP, or a
generic inventory app. It is a vertical SaaS specifically for warehouses,
godowns, storage service providers, 3PL/general warehousing, distribution
warehouses, and industrial storage businesses.

## 3. Core Product Principle

> **ENTER ONCE → AUTO-FILL EVERYWHERE.**

The user should never repeatedly enter the same information. Selecting a
Customer auto-populates name, legal name, GSTIN, PAN, address, contact,
email, and commercial terms wherever applicable. Selecting a Warehouse,
SKU, Vehicle, or Driver auto-fills their respective details. A GRN inherits
data into Warehouse Receipt and Put-away. A Release Order inherits into Pick
List and Dispatch. A Dispatch inherits into Gate Pass and POD. Operational
transactions feed the billing engine automatically.

## 4. Connected Workflow

The application must work as one connected ecosystem:

```
CUSTOMER → KYC → QUOTATION → AGREEMENT → RATE CARD
→ GATE ENTRY → INWARD → GRN → INSPECTION / DISCREPANCY → PUT-AWAY
→ WAREHOUSE RECEIPT → STOCK
→ RELEASE ORDER → STOCK RESERVATION → PICK LIST → PACKING → DISPATCH
→ LOADING → GATE PASS → POD
→ STORAGE / HANDLING CHARGES → INVOICE → PAYMENT → CUSTOMER STATEMENT
```

Every stage must know its source transaction.

## 5. V1 Scope Guardrails

Keep out of V1: ASN, Cold Storage, WDRA, Customs Bonded Warehouse, Advanced
TMS, Full Accounting ERP, HRMS, Payroll, RFID, IoT, AI forecasting,
Marketplace integrations, Advanced e-commerce OMS.

Do not introduce these features just because they could be useful later.
Architecture may remain extensible, but current UX and implementation must
stay focused.
