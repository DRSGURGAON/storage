# Sections 40–45 — Billing Architecture, Subscription UX, Plan & Usage, Pricing, Payments

## 40. Billing Architecture

Billing is based on actual operations. Storage = quantity/pallet/area/etc.
× duration × rate. Handling = actual inward/outward quantity × configured
rate. Generate the invoice from calculated charges, always showing the
calculation breakdown before final invoice.

## 41. Subscription UX

Do not show upgrade prompts everywhere. Show them intelligently when: free
allowance is nearly exhausted, the user attempts a restricted action, the
user opens a premium feature, or the user needs a higher plan. Progression
example: "1 of 2 free GRN generations used" → "2 of 2 free GRN generations
used" → "Unlock continued GRN generation." This creates natural conversion
instead of aggressive advertising.

## 42. Usage Indicators

Where useful, show compact indicators (`GRN 2/2 free used`, `Invoices 1/2
free used`, `Gate Pass 0/2 free used`) but do not clutter every screen.
Provide a central **Plan & Usage** page instead.

## 43. Plan & Usage Page

Shows: current plan, billing status, renewal date, feature usage, free
usage, subscription usage, available features. Example:

```
GRN        — 2 free used, subscription required
Invoice    — 1 free used, 1 remaining
POD        — 0 free used, 2 remaining
```

Use clean visual progress indicators.

## 44. Subscription (Pricing) Page

A premium pricing page with configurable plans, comparing: warehouses,
users, customers, documents, stock, billing, customer portal, reports, QR
verification, support. Do not hard-code final pricing yet unless provided —
the architecture must support pricing configuration.

## 45. Payment Integration

Do not implement a fake payment system. Design an abstraction layer so a
real Indian payment gateway can be connected later. Subscription lifecycle
must support: active, trial, past_due, cancelled, expired, paused (if
supported), payment failure, renewal. Do not allow client-side manipulation
of subscription state.
