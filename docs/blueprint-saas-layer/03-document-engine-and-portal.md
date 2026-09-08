# Sections 30–33 — Professional PDF System, Preview, QR Verification, Customer Portal

## 30. Professional PDF System

One central document rendering engine. All documents follow a consistent
design language: A4, company branding, logo, document title, document
number, date, party details, structured sections, professional tables,
totals, terms, signatures, QR verification, footer, page numbering. The PDF
must look like a professional business document, not a browser printout.

## 31. Document Preview

Before final generation, show a polished preview with actions `[Generate]`
`[Download]` `[Print]` `[Share]`. If generation is restricted by the
entitlement engine, show the upgrade state **before consuming anything** —
the entitlement check happens at preview time, not only at commit time.

## 32. QR Verification

Every important final document supports QR verification using a secure
verification token. The verification page confirms: document type,
document number, issuing company, generated date, valid/invalid status. Do
not expose sensitive information publicly.

## 33. Customer Portal

Customer eventually gets: Dashboard, Stock, Inward, Outward, Documents,
Invoices, Statements. A customer can only access their own data —
server-side authorization is mandatory, not a frontend-only restriction.
