# Sections 71–75 — UI/UX, Forms, Auto-save, Customer Selection UX, Document Preview

## 71. UI/UX Design

Design language: professional, clean, modern, enterprise SaaS, minimal
unnecessary decoration, strong hierarchy, consistent spacing, clear statuses,
responsive, fast workflows.

Avoid: excessive cards, excessive gradients, huge empty spaces, unnecessary
animations, confusing multi-step forms, repetitive fields.

Use autocomplete/search selectors for master data.

## 72. Form Design

Forms should be sectioned. Example GRN: Basic Information · Customer &
Warehouse · Transport · Reference Documents · Goods · Inspection · Attachments
· Remarks · Approval.

Do not put 40+ fields into one flat form.

## 73. Auto-save / Draft

Long forms should support draft saving. If the user leaves midway, the draft
remains available. Never lose entered transaction data due to accidental
navigation.

## 74. Customer Selection UX

Instead of a plain dropdown with hundreds of customers, use a searchable
selector. Search by: customer name, customer code, GSTIN, mobile. Show a
concise result, e.g. `ABC Traders · CUST-001 · GSTIN: XXXXX`. Selecting it
fills the form.

Use the same pattern for SKU, warehouse, vehicle, driver, etc.

## 75. Document Preview

Before final PDF, show a preview. Actions: Generate PDF, Download, Print,
Share, Email, Regenerate (if permitted).

Document generation should use server-side authoritative data.
