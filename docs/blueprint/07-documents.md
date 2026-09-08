# Sections 44–49 — Documents

## 44. Document Centre

One central document repository.

Filters: document type, customer, warehouse, date, status, document number.

Search should support: GRN number, invoice number, gate pass number, customer
name, vehicle number, SKU, reference number.

Clicking a document should show its lifecycle.

## 45. Document Timeline

For every operational chain show:
Gate Entry → Inward → GRN → Inspection → Put-away → Warehouse Receipt →
Release Order → Picking → Dispatch → Gate Pass → POD → Invoice.

Each event must show: date/time, user, status, reference, document.

## 46. Document Engine

Build ONE centralized document generation system. Do not create separate PDF
logic for every page. Example service: `generateDocument(documentType, recordId)`.

Supported document types: Quotation, Agreement, Gate Entry, Inward, GRN,
Discrepancy Report, Put-away, Warehouse Receipt, Stock Statement, Stock
Verification, Stock Transfer, Release Order, Pick List, Packing List, Dispatch
Note, Loading Sheet, Gate Pass, POD, Return Inward, Invoice, Debit Note, Credit
Note, Payment Receipt, Customer Statement.

## 47. Document Design System

All PDFs follow ONE professional visual language: A4, company header, logo,
document title, document number, date, party details, section headers, clean
tables, totals, terms, signature area, QR verification, footer, page number.

Documents should look like they belong to the same professional software. Do
not create random designs for different documents.

## 48. QR Verification

Every important generated document should have a QR code containing a secure
verification token/URL, NOT sensitive raw database information.

Verification page shows: document type, document number, status, issuing
company, generated date, verification result. Example: `VALID DOCUMENT —
GRN/26-27/000123`.

Do not expose unnecessary customer-sensitive information publicly.

## 49. Document Versioning

Documents have version history (Version 1, 2, 3 …). Do not delete old versions.

Track: created by, created date, modified by, modified date, approved by,
approval date.
