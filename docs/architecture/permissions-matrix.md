# Role & Permission Matrix

Blueprint refs: §52

Roles are rows in `roles` (system-seeded, `tenant_id is null`, cloned or
extended per tenant if needed); permissions are rows in `permissions`, each
tagged with a `module`. `role_permissions` is the join table. This document
is the seed data specification — the source of truth at runtime is the
database, editable by an Owner/Admin for custom roles.

Legend: ✅ full access to the permission · ➖ not granted.

## Masters module

| Permission | Owner | Admin | Wh. Manager | Wh. Operator | Billing Exec. | Accountant | Customer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `view_customer` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | own only |
| `create_customer` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| `edit_customer` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| `view_warehouse` / `view_product` / `view_transport_master` / `view_rate_card` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |
| `create_warehouse` / `create_product` / `create_transport_master` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| `edit_warehouse` / `edit_product` / `edit_transport_master` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| `create_rate_card` / `edit_rate_card` | ✅ | ✅ | ➖ | ➖ | ✅ | ➖ | ➖ |
| `manage_company_settings` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| `manage_users_and_roles` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Commercial module

| Permission | Owner | Admin | Wh. Manager | Wh. Operator | Billing Exec. | Accountant | Customer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `view_quotation` / `create_quotation` / `edit_quotation` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ (their accepted quotations visible read-only via portal) |
| `view_agreement` | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | own only |
| `create_agreement` / `edit_agreement` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| `approve_agreement` | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Operations module

| Permission | Owner | Admin | Wh. Manager | Wh. Operator | Billing Exec. | Accountant | Customer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `create_gate_entry` / `create_inward` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `create_grn` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `approve_grn` | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| `create_discrepancy_report` / `create_inspection` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `create_putaway` / `complete_putaway` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `issue_warehouse_receipt` | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| `create_release_order` | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | request-only (§53 "pending releases") |
| `approve_release_order` / `reserve_stock` | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| `create_pick_list` / `confirm_pick` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `create_dispatch` / `create_loading_sheet` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `create_gate_pass` / `confirm_gate_out` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `capture_pod` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `create_return_request` | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | ✅ (their own goods) |

## Stock module

| Permission | Owner | Admin | Wh. Manager | Wh. Operator | Billing Exec. | Accountant | Customer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `view_stock` / `view_stock_ledger` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | own only |
| `create_stock_transfer` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `create_stock_verification` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `create_stock_adjustment` | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| `approve_stock_adjustment` | ✅ | ✅ | ✅ (step 1) | ➖ | ➖ | ➖ | ➖ |
| `approve_stock_adjustment_final` (Owner step, when configured) | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Billing module

| Permission | Owner | Admin | Wh. Manager | Wh. Operator | Billing Exec. | Accountant | Customer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `generate_billing_run` | ✅ | ✅ | ➖ | ➖ | ✅ | ✅ | ➖ |
| `create_invoice` | ✅ | ✅ | ➖ | ➖ | ✅ | ✅ | ➖ |
| `approve_invoice` | ✅ | ✅ | ➖ | ➖ | ➖ | ✅ | ➖ |
| `create_credit_debit_note` | ✅ | ✅ | ➖ | ➖ | ✅ | ✅ | ➖ |
| `approve_credit_debit_note` | ✅ | ✅ | ➖ | ➖ | ➖ | ✅ | ➖ |
| `record_payment` | ✅ | ✅ | ➖ | ➖ | ✅ | ✅ | ➖ |
| `view_customer_statement` | ✅ | ✅ | ➖ | ➖ | ✅ | ✅ | own only |

## Documents & reports module

| Permission | Owner | Admin | Wh. Manager | Wh. Operator | Billing Exec. | Accountant | Customer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `view_documents` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | own only |
| `regenerate_document` | ✅ | ✅ | ✅ | ➖ | ✅ | ➖ | ➖ |
| `regenerate_after_approval` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| `view_reports` | ✅ | ✅ | ✅ | ➖ | ✅ | ✅ | ➖ |
| `export_reports` | ✅ | ✅ | ✅ | ➖ | ✅ | ✅ | ➖ (portal export of own statement only, via `view_customer_statement`) |
| `view_audit_log` | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Notes

- **Customer** role rows never carry any of the non-"own only" permissions
  above; the portal's backend uses an entirely separate, narrower controller
  set (see `tenancy-and-security.md` §2) rather than the staff permission
  codes with a filter bolted on, so there is no path where a portal session
  could exercise a staff-only permission code even if the frontend allowed it.
- `tenant_users.warehouse_ids`, when set for a Warehouse Manager/Operator,
  narrows every one of that role's permissions above to the listed
  warehouses; it does not grant new permissions.
- This grid is the V1 default. Tenants may clone a system role into a custom
  one and adjust its `role_permissions`, but the *permission codes themselves*
  are fixed by the platform, not tenant-definable — only their assignment to
  roles is.
