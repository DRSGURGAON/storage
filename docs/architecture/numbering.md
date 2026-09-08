# Numbering Engine

Blueprint refs: §62 (centralized numbering), §16–§43 (every numbered document)

## 1. Rule

> "Do not generate document numbers independently in every module."

Every module that needs a document number calls **one** service:
`allocateNumber(tenantId, documentType, warehouseId?)` → `string`. No table's
insert path is allowed to compute its own `number` column inline.

## 2. Format

Backed by `number_series` (`schema/00_core.sql`). A number is assembled as:

```
{prefix}/{fy}/{seq:padding}
```

Configurable per tenant, per `document_type`, optionally per `warehouse_id`:

| Field | Meaning | Example |
|---|---|---|
| `prefix` | short code for the document type | `GE`, `GRN`, `WR`, `RO`, `GP`, `INV` |
| `fy_style` | how the financial-year segment is rendered | `YY-YY` → `26-27` |
| `padding` | zero-padding width of the running number | `6` → `000001` |
| `reset_policy` | when `next_seq` resets | `yearly` (default), `monthly`, `never` |

Full worked example: `GE/26-27/000001`.

Tenants may edit `prefix`/`format`/`padding`/starting number per document
type from Settings; the *mechanism* (one series row, one allocation function)
never changes.

## 3. Financial year computation

India's FY runs 1 Apr–31 Mar (`tenants.financial_year_start_month = 4` by
default, but kept configurable in case a future tenant needs a different
convention). `period_key` for `fy_style = 'YY-YY'` on a date `d`:

```
fy_start_year = d.year        if d.month >= financial_year_start_month
              = d.year - 1    otherwise
period_key    = "{fy_start_year % 100:02}-{(fy_start_year+1) % 100:02}"
```

## 4. Concurrency-safe allocation

Two users creating a GRN at the same instant must never receive the same
number. `allocateNumber` runs as:

```sql
begin;
  select next_seq, period_key
    from number_series
   where tenant_id = $1 and document_type = $2
     and warehouse_id is not distinct from $3
   for update;                          -- row lock serializes concurrent callers

  -- if reset_policy requires it and the computed period_key differs from the
  -- stored one, reset next_seq to 1 and update period_key first
  update number_series
     set next_seq = next_seq + 1, period_key = $new_period_key
   where tenant_id = $1 and document_type = $2
     and warehouse_id is not distinct from $3;
commit;
```

The `for update` row lock (not an application mutex) is what makes this safe
under concurrent requests and multiple app instances. The allocated number is
formatted and returned; the caller inserts its row with that number in the
**same transaction** that reserved it, so a later rollback (e.g. validation
fails after allocation) leaves a gap in the sequence rather than a duplicate —
gaps are acceptable, duplicates are not.

## 5. Idempotency vs. numbering

Numbering solves "never issue the same number twice." It does **not** solve
"never process the same submit-button click twice" — that is the separate
`idempotency_key` mechanism described in `stock-engine.md` §4 and applied to
GRN approval, invoice generation, and payment posting. A retried request must
detect the duplicate *before* calling `allocateNumber`, otherwise it would
correctly avoid a duplicate number while still double-posting stock or a
double invoice.

## 6. Document types requiring a series (canonical prefix list)

| Document | Suggested prefix | Blueprint § |
|---|---|---|
| Gate Entry | `GE` | 16 |
| Inward | `IN` | 17 |
| GRN | `GRN` | 18 |
| Discrepancy Report | `DR` | 19 |
| Inspection | `INS` | 20 |
| Put-away | `PA` | 21 |
| Warehouse Receipt | `WR` | 22 |
| Quotation | `QT` | 14 |
| Agreement | `AG` | 15 |
| Stock Transfer Note | `ST` | 28 |
| Stock Verification | `SV` | 27 |
| Stock Adjustment | `SA` | 27 |
| Release Order | `RO` | 29 |
| Pick List | `PL` | 31 |
| Packing List | `PK` | 32 |
| Dispatch Note | `DN` | 33 |
| Loading Sheet | `LS` | 34 |
| Gate Pass | `GP` | 35 |
| POD | `POD` | 36 |
| Return Request | `RR` | 37 |
| Return Inward | `RI` | 37 |
| Invoice | `INV` | 40 |
| Credit Note | `CN` | 41 |
| Debit Note | `DN2` (distinct from Dispatch Note `DN`) | 41 |
| Payment Receipt | `RCPT` | 42 |

These are seed defaults, editable per tenant — the table, not this list, is
authoritative at runtime.
