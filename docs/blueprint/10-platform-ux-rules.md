# Sections 56–65 — Notifications, Search, Auto-fill, Smart Actions, Status, Error Prevention, Numbering, Attachments, Mobile, QR

## 56. Notifications

Support in-app notifications. Examples: GRN pending approval, POD pending,
payment due, payment overdue, agreement expiring, stock discrepancy, pending
stock adjustment, pending customer request.

Design the notification engine so email/WhatsApp/SMS can be integrated later.

## 57. Search

Global search should support: customer, SKU, vehicle, GRN, gate entry, invoice,
gate pass, dispatch, POD.

Example: searching `ABC-123` should show all matching records.

## 58. Auto-fill Rules (critical requirement)

Whenever a master record is selected:

| Selecting… | Auto-fills… |
|---|---|
| Customer | all stored customer details |
| Warehouse | warehouse details |
| SKU | product details |
| Vehicle | transporter and vehicle details |
| Driver | driver details |
| GRN | from Inward |
| Warehouse Receipt | from GRN |
| Put-away | from GRN |
| Release Order | customer + available stock |
| Pick List | from Release Order |
| Dispatch | from Pick List + Release Order |
| Gate Pass | from Dispatch |
| POD | from Dispatch |
| Invoice | customer + operational charges |
| Customer Statement | aggregate invoices/payments automatically |

## 59. Smart Create Buttons

Every relevant record should have contextual actions, e.g.:

- **GRN page:** Generate Warehouse Receipt · Create Put-away · Create Discrepancy Report · View Stock
- **Release Order:** Reserve Stock · Generate Pick List · Create Dispatch
- **Dispatch:** Generate Loading Sheet · Generate Gate Pass · Add POD
- **Invoice:** Record Payment · Generate Receipt

This makes the application workflow-driven.

## 60. Status System

Use consistent statuses. Do not allow impossible status transitions. Examples:

- **GRN:** Draft → Submitted → Approved → Completed → Cancelled
- **Release Order:** Draft → Approved → Partially Picked → Picked → Dispatched → Completed → Cancelled
- **Invoice:** Draft → Approved → Issued → Partially Paid → Paid → Overdue → Cancelled

## 61. Error Prevention

The application must prevent: dispatching more than available stock; reserving
unavailable stock; duplicate document numbers; duplicate stock transactions;
duplicate payment posting; editing approved transactions without permission;
cross-tenant data access; negative stock unless explicitly enabled by company
settings; deleting referenced transactions.

Show clear validation messages.

## 62. Numbering Engine

Create centralized numbering. Examples: `GE/26-27/000001`, `GRN/26-27/000001`,
`WR/26-27/000001`, `RO/26-27/000001`, `GP/26-27/000001`, `INV/26-27/000001`.

Allow: prefix, financial year, starting number, padding, custom format. Do not
generate document numbers independently in every module.

## 63. File Attachments

Allow attachments against relevant records, e.g.:

- **GRN:** invoice, LR, e-way bill, photos
- **POD:** signed POD, delivery photo
- **Customer:** KYC, GST certificate
- **Agreement:** signed agreement

Store metadata: file name, type, uploaded by, date, related record.

## 64. Mobile Experience

**Mobile prioritizes warehouse operations:** gate entry, GRN, stock lookup,
QR/barcode scan, picking, loading, gate pass, POD, photo capture, signature
capture.

**Desktop prioritizes:** masters, billing, reports, agreements, dashboard,
configuration.

Responsive design is mandatory.

## 65. QR / Barcode

V1 basic support:

- **Product barcode:** scan → identify SKU.
- **Location QR:** scan → identify location.
- **Document QR:** scan → verify document.

Do not make RFID or advanced warehouse automation part of V1.
