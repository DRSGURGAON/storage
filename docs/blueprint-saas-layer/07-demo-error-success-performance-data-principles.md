# Sections 46–51 — Demo Data, Error/Success UX, Performance, Data & Architecture Principles

## 46. Free vs. Demo Data

Never mix demo data with real data. If demo mode exists, use a clearly
separated demo tenant/environment; demo documents must be visibly marked
**DEMO / SAMPLE**. Demo activity must never affect real stock, real
invoices, real billing, real customer statements, or real usage accounting.

## 47. Error UX

Errors must be human-friendly. Bad: "500 Internal Server Error." Better:
"We couldn't generate the document right now. Your free usage was not
consumed. Please try again." This matters especially for metered features,
where the user must trust that a failure did not cost them an entitlement.

## 48. Success UX

After successful generation, show: `✓ GRN generated successfully —
GRN/26-27/000123` with `[View Document]` `[Download PDF]`
`[Create Put-away]`. The user should immediately know what to do next.

## 49. Performance

Prioritize: fast navigation, server pagination, debounced search, lazy
loading, optimized PDFs, efficient database queries, caching where
appropriate, background processing for heavy tasks, no unnecessary API
calls. Do not load thousands of customers/SKUs into a dropdown.

## 50. Database Principle

Maintain clear relationships across the important entity families:
Company/Tenant, User, Role, Permission, **Subscription, Plan, Feature,
Entitlement, UsageLedger**; Warehouse/Zone/Rack/Row/Bin/Pallet; Customer,
CustomerDocument; Product, SKU, Batch; Transporter, Vehicle, Driver;
RateCard, Quotation, Agreement; GateEntry, Inward, GRN, GRNItem,
Discrepancy, Inspection, PutAway, WarehouseReceipt; Stock, StockLedger,
StockReservation, StockTransfer, StockAdjustment; ReleaseOrder, PickList,
PackingList, Dispatch, LoadingSheet, GatePass, POD; StorageCharge,
HandlingCharge, Invoice, DebitNote, CreditNote, Payment,
CustomerStatement; Document, DocumentVersion, DocumentGeneration;
Approval, AuditLog, Notification.

## 51. Do Not Duplicate Business Logic

Do not calculate stock independently in the dashboard, stock page,
customer page, and reports — use one authoritative stock service. Do not
calculate invoice charges independently in different screens — use one
billing engine. Do not enforce subscription limits separately in each UI —
use one entitlement service. Do not create separate PDF systems for every
document type.
