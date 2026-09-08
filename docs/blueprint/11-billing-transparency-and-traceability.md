# Sections 66–68 — Storage Charge Transparency, Data Relationships, Document Lifecycle

## 66. Storage Charge Calculation

The billing engine calculates storage based on configurable billing rules, e.g.
Pallet × Days × Rate, or Quantity × Days × Rate, or Area × Month × Rate.

The calculation must be transparent. Before invoice, show: storage calculation
+ handling calculation + other charges, subtotal + applicable tax, total. The
user must be able to inspect the calculation before finalizing.

## 67. Data Relationship Principle

Every downstream record must reference its source, e.g.:

- **GRN:** `customerId`, `warehouseId`, `inwardId`
- **Warehouse Receipt:** `grnId`
- **Put-away:** `grnId`
- **Stock Transaction:** `sourceType = GRN`, `sourceId = GRN ID`
- **Release Order:** `customerId`, `warehouseId`
- **Pick List:** `releaseOrderId`
- **Dispatch:** `releaseOrderId`, `pickListId`
- **Gate Pass:** `dispatchId`
- **POD:** `dispatchId`
- **Invoice:** `customerId`, related operational transactions

This creates complete traceability.

## 68. Document Lifecycle Example

```
Gate Entry (GE-001)
 → Create Inward (pre-fills Gate Entry data)
 → Create GRN (pre-fills Inward data)
 → Approve GRN (posts stock)
 → Generate Put-away (pre-fills GRN items)
 → Complete Put-away (location assigned)
 → Generate Warehouse Receipt (pre-fills GRN + location)
 → Customer stock automatically updates
 → Customer requests release → Create Release Order (shows only available stock)
 → Reserve → Generate Pick List → Pick → Generate Dispatch
 → Generate Loading Sheet → Generate Gate Pass → Gate out (stock automatically reduces)
 → POD added
 → Monthly billing → Invoice generated from actual storage/handling data
```

This entire flow must work without duplicate data entry.
