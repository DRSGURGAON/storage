# Sections 38–43 — Billing

## 38. Billing Engine

Billing must derive charges from actual operational transactions. Do not make
the user manually calculate every monthly charge.

**Storage:** quantity × days × rate; pallet × days × rate; area × period × rate;
CBM × days × rate; flat monthly.

**Handling:** inward quantity × rate; outward quantity × rate; loading;
unloading; labour; pick/pack.

**Other:** configurable charge types.

## 39. Monthly Billing

Provide **Generate Monthly Billing**. User selects customer, warehouse, billing
period. System calculates applicable storage, inward handling, outward
handling, loading, unloading, labour, other configured services.

Show preview before invoice creation. Never silently generate incorrect billing.

## 40. Invoice

Generate a professional tax invoice according to configured business/tax
requirements.

Auto-fill: company, customer, billing address, GST details, services, applicable
HSN/SAC, quantity, rate, tax, total, bank details, payment terms, terms and
conditions.

Tax configuration must be flexible and must not hard-code one universal GST
treatment.

## 41. Debit / Credit Note

Support Debit Note and Credit Note. Both should reference the original invoice
where applicable. Maintain proper audit trail.

## 42. Payment Receipt

Fields: receipt number, customer, invoice/reference, payment date, amount,
payment mode, transaction/reference number, remarks.

Payment should update customer outstanding.

## 43. Customer Statement

Show invoice, debit, credit, payment, balance, outstanding. Support date range
and customer filters.
