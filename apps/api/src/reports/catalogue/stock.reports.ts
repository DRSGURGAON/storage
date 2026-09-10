import { SETTINGS_BY_KEY } from '../../company/tenant-settings.registry';
import { ReportDefinition } from '../report-definition';
import { parseBucket } from '../reports.service';

const AGEING_BUCKETS = SETTINGS_BY_KEY.get('stock.ageing_buckets')!;

/**
 * Blueprint §55's Stock group: "Current Stock, Customer Stock, Stock
 * Ledger, Stock Ageing, Stock Movement, Location Stock, Stock
 * Verification, Stock Adjustment."
 *
 * Every one of these reads `stock_lots` or `stock_ledger` -- the tables
 * `StockService` maintains -- and none recomputes a balance of its own.
 * That is `stock-engine.md`'s rule, and the reason it matters here
 * specifically: a report that arrived at a different number than the
 * screen the operator acts on would be worse than no report.
 */
export const STOCK_REPORTS: ReportDefinition[] = [
  {
    code: 'current_stock',
    name: 'Current stock',
    group: 'stock',
    description: 'What is in the building right now, by product and batch, with how much of it is already spoken for.',
    permission: 'view_stock',
    filters: ['customerId', 'warehouseId', 'productId'],
    columns: [
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'sku', label: 'SKU' },
      { key: 'product', label: 'Product' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'expiryDate', label: 'Expires', type: 'date' },
      { key: 'uomCode', label: 'UOM' },
      { key: 'physicalQty', label: 'Physical', type: 'number', total: true },
      { key: 'reservedQty', label: 'Reserved', type: 'number', total: true },
      { key: 'availableQty', label: 'Available', type: 'number', total: true },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select w.name as warehouse, coalesce(c.legal_name, c.name) as customer,
               p.sku, p.name as product, b.batch_no as "batchNo", b.expiry_date as "expiryDate",
               sl.uom_code as "uomCode",
               sum(sl.physical_qty)::float8 as "physicalQty",
               sum(sl.reserved_qty)::float8 as "reservedQty",
               sum(sl.available_qty)::float8 as "availableQty"
        from stock_lots sl
        join warehouses w on w.id = sl.warehouse_id
        join customers c on c.id = sl.customer_id
        join products p on p.id = sl.product_id
        left join batches b on b.id = sl.batch_id
        where sl.tenant_id = ${tenantId} and sl.physical_qty <> 0
          and (${scope}::uuid[] is null or sl.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or sl.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or sl.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.productId ?? null}::uuid is null or sl.product_id = ${filters.productId ?? null})
        group by w.name, c.legal_name, c.name, p.sku, p.name, b.batch_no, b.expiry_date, sl.uom_code
        order by w.name, customer, p.sku, b.batch_no
      `;
    },
  },
  {
    code: 'customer_stock',
    name: 'Customer stock',
    group: 'stock',
    description: 'The same balances totalled per customer — who is storing how much, and where.',
    permission: 'view_stock',
    filters: ['customerId', 'warehouseId'],
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'skus', label: 'SKUs', type: 'number', total: true },
      { key: 'physicalQty', label: 'Physical', type: 'number', total: true },
      { key: 'reservedQty', label: 'Reserved', type: 'number', total: true },
      { key: 'availableQty', label: 'Available', type: 'number', total: true },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select coalesce(c.legal_name, c.name) as customer, w.name as warehouse,
               count(distinct sl.product_id)::int as skus,
               sum(sl.physical_qty)::float8 as "physicalQty",
               sum(sl.reserved_qty)::float8 as "reservedQty",
               sum(sl.available_qty)::float8 as "availableQty"
        from stock_lots sl
        join customers c on c.id = sl.customer_id
        join warehouses w on w.id = sl.warehouse_id
        where sl.tenant_id = ${tenantId} and sl.physical_qty <> 0
          and (${scope}::uuid[] is null or sl.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or sl.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or sl.warehouse_id = ${filters.warehouseId ?? null})
        group by customer, w.name
        order by customer, w.name
      `;
    },
  },
  {
    code: 'stock_ledger',
    name: 'Stock ledger',
    group: 'stock',
    description: 'Every movement in the period, with the running balance the engine recorded at the time.',
    permission: 'view_stock_ledger',
    filters: ['dateRange', 'customerId', 'warehouseId', 'productId'],
    columns: [
      { key: 'txnAt', label: 'When', type: 'datetime' },
      { key: 'txnType', label: 'Type' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'sku', label: 'SKU' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'qtyIn', label: 'In', type: 'number', total: true },
      { key: 'qtyOut', label: 'Out', type: 'number', total: true },
      { key: 'balance', label: 'Balance after', type: 'number' },
      { key: 'sourceType', label: 'Source' },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select le.txn_at as "txnAt", le.txn_type as "txnType", w.name as warehouse,
               coalesce(c.legal_name, c.name) as customer, p.sku, b.batch_no as "batchNo",
               le.qty_in::float8 as "qtyIn", le.qty_out::float8 as "qtyOut",
               le.balance_physical_qty::float8 as balance, le.source_type as "sourceType"
        from stock_ledger le
        join warehouses w on w.id = le.warehouse_id
        join customers c on c.id = le.customer_id
        join products p on p.id = le.product_id
        left join batches b on b.id = le.batch_id
        where le.tenant_id = ${tenantId}
          and le.txn_at::date between ${filters.from!} and ${filters.to!}
          and (${scope}::uuid[] is null or le.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or le.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or le.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.productId ?? null}::uuid is null or le.product_id = ${filters.productId ?? null})
        order by le.txn_at desc, le.id desc
      `;
    },
  },
  {
    code: 'stock_movement',
    name: 'Stock movement',
    group: 'stock',
    description: 'The period in one line per product: opening, in, out, closing — reconciled from the ledger, not recounted.',
    permission: 'view_stock_ledger',
    filters: ['dateRange', 'customerId', 'warehouseId', 'productId'],
    columns: [
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'sku', label: 'SKU' },
      { key: 'product', label: 'Product' },
      { key: 'openingQty', label: 'Opening', type: 'number', total: true },
      { key: 'inQty', label: 'In', type: 'number', total: true },
      { key: 'outQty', label: 'Out', type: 'number', total: true },
      { key: 'closingQty', label: 'Closing', type: 'number', total: true },
    ],
    async run(tx, { tenantId, scope, filters }) {
      // Opening is the closing balance of the last movement *before* the
      // window -- read from `balance_physical_qty`, which the engine wrote
      // at the time, rather than summed from the beginning of the world.
      return tx<Record<string, unknown>[]>`
        with scoped as (
          select le.*, w.name as warehouse_name, coalesce(c.legal_name, c.name) as customer_name,
                 p.sku, p.name as product_name
          from stock_ledger le
          join warehouses w on w.id = le.warehouse_id
          join customers c on c.id = le.customer_id
          join products p on p.id = le.product_id
          where le.tenant_id = ${tenantId}
            and (${scope}::uuid[] is null or le.warehouse_id = any(${scope}))
            and (${filters.customerId ?? null}::uuid is null or le.customer_id = ${filters.customerId ?? null})
            and (${filters.warehouseId ?? null}::uuid is null or le.warehouse_id = ${filters.warehouseId ?? null})
            and (${filters.productId ?? null}::uuid is null or le.product_id = ${filters.productId ?? null})
        ),
        opening as (
          select distinct on (warehouse_id, customer_id, product_id)
                 warehouse_id, customer_id, product_id, balance_physical_qty as qty
          from scoped where txn_at::date < ${filters.from!}
          order by warehouse_id, customer_id, product_id, txn_at desc, id desc
        ),
        window_rows as (
          select warehouse_id, customer_id, product_id,
                 max(warehouse_name) as warehouse_name, max(customer_name) as customer_name,
                 max(sku) as sku, max(product_name) as product_name,
                 sum(qty_in) as in_qty, sum(qty_out) as out_qty
          from scoped where txn_at::date between ${filters.from!} and ${filters.to!}
          group by warehouse_id, customer_id, product_id
        )
        select coalesce(wr.warehouse_name, w.name) as warehouse,
               coalesce(wr.customer_name, coalesce(c.legal_name, c.name)) as customer,
               coalesce(wr.sku, p.sku) as sku,
               coalesce(wr.product_name, p.name) as product,
               coalesce(o.qty, 0)::float8 as "openingQty",
               coalesce(wr.in_qty, 0)::float8 as "inQty",
               coalesce(wr.out_qty, 0)::float8 as "outQty",
               (coalesce(o.qty, 0) + coalesce(wr.in_qty, 0) - coalesce(wr.out_qty, 0))::float8 as "closingQty"
        from window_rows wr
        full outer join opening o
          on o.warehouse_id = wr.warehouse_id and o.customer_id = wr.customer_id and o.product_id = wr.product_id
        left join warehouses w on w.id = coalesce(wr.warehouse_id, o.warehouse_id)
        left join customers c on c.id = coalesce(wr.customer_id, o.customer_id)
        left join products p on p.id = coalesce(wr.product_id, o.product_id)
        order by warehouse, customer, sku
      `;
    },
  },
  {
    code: 'stock_ageing',
    name: 'Stock ageing',
    group: 'stock',
    description: 'How long each lot has been sitting, bucketed by the workspace\'s own ageing bands.',
    permission: 'view_stock',
    filters: ['customerId', 'warehouseId', 'productId'],
    columns: [
      { key: 'bucket', label: 'Age band' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'sku', label: 'SKU' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'receivedAt', label: 'First received', type: 'date' },
      { key: 'ageDays', label: 'Days', type: 'number' },
      { key: 'physicalQty', label: 'Physical', type: 'number', total: true },
    ],
    async run(tx, { tenantId, scope, filters }) {
      // The bands are a tenant setting (`stock.ageing_buckets`), so the
      // report reads them rather than hard-coding 0-30/31-60/…, and a
      // workspace that has changed them sees its own bands here and on the
      // ageing screen alike.
      const [setting] = await tx<{ value: unknown }[]>`
        select value from tenant_settings where tenant_id = ${tenantId} and key = ${AGEING_BUCKETS.key}
      `;
      const buckets = ((setting?.value as string[] | undefined) ?? (AGEING_BUCKETS.default as string[])).map(parseBucket);

      const rows = await tx<Record<string, unknown>[]>`
        select w.name as warehouse, coalesce(c.legal_name, c.name) as customer, p.sku,
               b.batch_no as "batchNo",
               coalesce(b.first_received_at, first_in.txn_at) as "receivedAt",
               extract(day from now() - coalesce(b.first_received_at, first_in.txn_at))::int as "ageDays",
               sl.physical_qty::float8 as "physicalQty"
        from stock_lots sl
        join warehouses w on w.id = sl.warehouse_id
        join customers c on c.id = sl.customer_id
        join products p on p.id = sl.product_id
        left join batches b on b.id = sl.batch_id
        left join lateral (
          select min(txn_at) as txn_at from stock_ledger le
          where le.tenant_id = sl.tenant_id and le.customer_id = sl.customer_id
            and le.warehouse_id = sl.warehouse_id and le.product_id = sl.product_id
            and le.txn_type in ('INWARD', 'RETURN')
        ) first_in on true
        where sl.tenant_id = ${tenantId} and sl.physical_qty <> 0
          and (${scope}::uuid[] is null or sl.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or sl.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or sl.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.productId ?? null}::uuid is null or sl.product_id = ${filters.productId ?? null})
        order by "ageDays" desc nulls last
      `;

      return rows.map((row) => {
        const age = row.ageDays === null || row.ageDays === undefined ? null : Number(row.ageDays);
        const bucket = age === null
          ? 'unknown'
          : buckets.find((b) => age >= b.from && (b.to === null || age <= b.to))?.label ?? 'unknown';
        return { ...row, bucket };
      });
    },
  },
  {
    code: 'location_stock',
    name: 'Location stock',
    group: 'stock',
    description: 'Where each lot physically sits, so a picker can be sent to it — and so an empty bay can be found.',
    permission: 'view_stock',
    filters: ['customerId', 'warehouseId', 'productId'],
    columns: [
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'location', label: 'Location' },
      { key: 'customer', label: 'Customer' },
      { key: 'sku', label: 'SKU' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'physicalQty', label: 'Physical', type: 'number', total: true },
      { key: 'availableQty', label: 'Available', type: 'number', total: true },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select w.name as warehouse, coalesce(l.full_code, '(not put away)') as location,
               coalesce(c.legal_name, c.name) as customer, p.sku, b.batch_no as "batchNo",
               sum(sl.physical_qty)::float8 as "physicalQty",
               sum(sl.available_qty)::float8 as "availableQty"
        from stock_lots sl
        join warehouses w on w.id = sl.warehouse_id
        join customers c on c.id = sl.customer_id
        join products p on p.id = sl.product_id
        left join locations l on l.id = sl.location_id
        left join batches b on b.id = sl.batch_id
        where sl.tenant_id = ${tenantId} and sl.physical_qty <> 0
          and (${scope}::uuid[] is null or sl.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or sl.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or sl.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.productId ?? null}::uuid is null or sl.product_id = ${filters.productId ?? null})
        group by w.name, l.full_code, customer, p.sku, b.batch_no
        order by w.name, location, p.sku
      `;
    },
  },
  {
    code: 'stock_verification_register',
    name: 'Stock verification register',
    group: 'stock',
    description: 'Physical counts done in the period, and what they found.',
    permission: 'create_stock_verification',
    filters: ['dateRange', 'customerId', 'warehouseId', 'status'],
    columns: [
      { key: 'number', label: 'Number' },
      { key: 'verificationDate', label: 'Date', type: 'date' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'lines', label: 'Lines counted', type: 'number', total: true },
      { key: 'variances', label: 'With a variance', type: 'number', total: true },
      { key: 'status', label: 'Status' },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select v.number, v.verification_date as "verificationDate", w.name as warehouse,
               coalesce(c.legal_name, c.name) as customer,
               count(vl.id)::int as lines,
               count(vl.id) filter (where vl.difference_qty <> 0)::int as variances,
               v.status
        from stock_verifications v
        join warehouses w on w.id = v.warehouse_id
        left join customers c on c.id = v.customer_id
        left join stock_verification_lines vl on vl.verification_id = v.id
        where v.tenant_id = ${tenantId}
          and v.verification_date between ${filters.from!} and ${filters.to!}
          and (${scope}::uuid[] is null or v.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or v.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or v.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.status ?? null}::text is null or v.status = ${filters.status ?? null})
        group by v.id, v.number, v.verification_date, w.name, customer, v.status
        order by v.verification_date desc, v.number desc
      `;
    },
  },
  {
    code: 'stock_adjustment_register',
    name: 'Stock adjustment register',
    group: 'stock',
    description: 'Every correction to a balance, who approved it, and whether it has posted.',
    permission: 'create_stock_adjustment',
    filters: ['dateRange', 'customerId', 'warehouseId', 'status'],
    columns: [
      { key: 'number', label: 'Number' },
      { key: 'adjustmentDate', label: 'Date', type: 'date' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'reason', label: 'Reason' },
      { key: 'increaseQty', label: 'Increase', type: 'number', total: true },
      { key: 'decreaseQty', label: 'Decrease', type: 'number', total: true },
      { key: 'approvedBy', label: 'Approved by' },
      { key: 'postedAt', label: 'Posted', type: 'datetime' },
      { key: 'status', label: 'Status' },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select a.number, a.adjustment_date as "adjustmentDate", w.name as warehouse,
               coalesce(c.legal_name, c.name) as customer, a.reason,
               coalesce(sum(al.quantity_delta) filter (where al.quantity_delta > 0), 0)::float8 as "increaseQty",
               coalesce(-sum(al.quantity_delta) filter (where al.quantity_delta < 0), 0)::float8 as "decreaseQty",
               coalesce(owner_u.full_name, mgr_u.full_name) as "approvedBy",
               a.posted_at as "postedAt", a.status
        from stock_adjustments a
        join warehouses w on w.id = a.warehouse_id
        left join customers c on c.id = a.customer_id
        left join stock_adjustment_lines al on al.adjustment_id = a.id
        left join users mgr_u on mgr_u.id = a.manager_approved_by
        left join users owner_u on owner_u.id = a.owner_approved_by
        where a.tenant_id = ${tenantId}
          and a.adjustment_date between ${filters.from!} and ${filters.to!}
          and (${scope}::uuid[] is null or a.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or a.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or a.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.status ?? null}::text is null or a.status = ${filters.status ?? null})
        group by a.id, a.number, a.adjustment_date, w.name, customer, a.reason, owner_u.full_name, mgr_u.full_name, a.posted_at, a.status
        order by a.adjustment_date desc, a.number desc
      `;
    },
  },
];
