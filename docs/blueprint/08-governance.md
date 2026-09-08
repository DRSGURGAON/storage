# Sections 50–52 — Governance

## 50. Approval Engine

Configurable approvals. Examples:

- GRN: Operator → Manager
- Stock Adjustment: Operator → Manager → Owner (where configured)
- Invoice: Billing → Approval
- Credit Note: approval required
- Agreement: Admin → Owner

Approved transactions must not be freely editable. Changes after approval
should create controlled revision/reversal workflows.

## 51. Audit Log

Track: create, edit, delete (where permitted), approve, reject, cancel, stock
adjustment, status change, document generation, document regeneration.

Record: user, date/time, action, record, previous value (where appropriate),
new value (where appropriate).

## 52. Role & Permission System

| Role | Access |
|------|--------|
| Owner | Full access |
| Admin | Masters + operations + documents + reports |
| Warehouse Manager | Operations + stock + approvals |
| Warehouse Operator | Gate entry, GRN, picking, packing, loading |
| Billing Executive | Charges + invoices + receipts |
| Accountant | Billing / account-related functions |
| Customer | Only their own data |

Permissions should be granular, e.g. `view_customer`, `create_customer`,
`edit_customer`, `approve_grn`, `create_stock_adjustment`,
`approve_stock_adjustment`, `create_invoice`, `approve_invoice`, `view_reports`.
