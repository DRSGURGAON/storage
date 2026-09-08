# Sections 1–6 — Objective, Scope, Principles, Data Flow, Architecture, Multi-Tenancy

## 1. Project Objective

Build a production-ready, professional SaaS application for Indian general
warehousing / storage businesses.

The product is **not** merely a PDF/document generator. It must function as:

> Warehouse Documentation + Inventory Movement + Operational Records + Storage/Handling Billing SaaS

Core principle:

> **ENTER DATA ONCE → REUSE EVERYWHERE → GENERATE DOCUMENTS AUTOMATICALLY →
> UPDATE STOCK AUTOMATICALLY → GENERATE BILLING FROM ACTUAL OPERATIONS.**

The application must feel like a specialized vertical SaaS product, not an admin
dashboard or generic CRUD application.

## 2. V1 Scope

### Included
- General warehouses
- Godowns
- Storage service providers
- 3PL / general warehousing
- Distribution warehouses
- Industrial storage
- Basic fulfilment documentation

### Explicitly out of scope for V1 (do NOT build now)
- ASN
- Cold storage
- WDRA
- Customs bonded warehouse
- Advanced TMS
- Full accounting ERP
- HR / Payroll
- Advanced e-commerce OMS
- RFID
- IoT
- AI forecasting
- Marketplace integrations

Architecture must remain extensible so these can be added later.

## 3. Core Product Principle

The entire application must be **transaction-driven**. Never make the user
enter the same information repeatedly.

When a **Customer** is selected, auto-populate wherever applicable: legal name,
GSTIN, PAN, billing address, delivery address, contact person, mobile, email,
default payment terms, default rate card.

When a **Warehouse** is selected: warehouse name, code, address, GST details,
contact, manager.

When a **Product/SKU** is selected: product name, SKU, HSN, UOM, weight,
dimensions, barcode, tracking configuration.

When a **Vehicle** is selected: vehicle number, vehicle type, transporter.

When a **Driver** is selected: driver name, mobile, license information where
configured.

The user must only enter information that is genuinely new for the transaction.

## 4. Data Flow

```
CUSTOMER → KYC → QUOTATION → AGREEMENT → RATE CARD
→ GATE ENTRY → INWARD → GRN → INSPECTION / DISCREPANCY → PUT-AWAY
→ WAREHOUSE RECEIPT → STOCK
→ RELEASE ORDER → STOCK RESERVATION → PICK LIST → PACKING → DISPATCH
→ LOADING → GATE PASS → POD
→ STORAGE + HANDLING CHARGES → INVOICE → PAYMENT → CUSTOMER STATEMENT
```

Every stage must maintain references to previous and next stages.

## 5. Application Architecture

Use a clean, scalable architecture. Recommended layers:

1. Authentication
2. Authorization
3. Master Data
4. Operations
5. Inventory / Stock Engine
6. Billing Engine
7. Document Engine
8. Notification Engine
9. Audit Engine
10. Reporting
11. Customer Portal
12. Settings

Do not mix business logic directly into UI components. Use service / API /
business layers.

## 6. Multi-Tenant SaaS

Multi-tenant from day one. Each company/business is a tenant. All tenant-owned
data must be isolated. Every major database record must be associated with the
correct tenant/company.

A user from Company A must **never** be able to access Company B's customers,
stock, documents, invoices, warehouses or reports.

Implement **server-side** authorization. Do not rely only on frontend hiding.
