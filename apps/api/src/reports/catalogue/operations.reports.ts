import { ReportDefinition } from '../report-definition';

/**
 * Blueprint §55's Operations group: "Daily Inward, Daily Outward, Gate
 * Entry, GRN, Dispatch."
 *
 * The two "daily" ones are summaries by day; the three registers are one
 * row per record, which is what an operator means when they say "pull the
 * GRN register for last month".
 */
export const OPERATIONS_REPORTS: ReportDefinition[] = [
  {
    code: 'daily_inward',
    name: 'Daily inward',
    group: 'operations',
    description: 'What arrived each day: vehicles let in, inwards recorded, and the quantity a GRN actually accepted.',
    permission: 'view_reports',
    filters: ['dateRange', 'customerId', 'warehouseId'],
    columns: [
      { key: 'day', label: 'Date', type: 'date' },
      { key: 'gateEntries', label: 'Vehicles in', type: 'number', total: true },
      { key: 'inwards', label: 'Inwards', type: 'number', total: true },
      { key: 'grns', label: 'GRNs', type: 'number', total: true },
      { key: 'receivedQty', label: 'Received', type: 'number', total: true },
      { key: 'acceptedQty', label: 'Accepted', type: 'number', total: true },
      { key: 'rejectedQty', label: 'Rejected', type: 'number', total: true },
      { key: 'damagedQty', label: 'Damaged', type: 'number', total: true },
    ],
    async run(tx, { tenantId, scope, filters }) {
      const rows = await tx<Record<string, unknown>[]>`
        with days as (
          select generate_series(${filters.from!}::date, ${filters.to!}::date, interval '1 day')::date as day
        ),
        gate as (
          select entry_at::date as day, count(*)::int as gate_entries
          from gate_entries
          where tenant_id = ${tenantId} and direction = 'in' and status <> 'cancelled'
            and entry_at::date between ${filters.from!} and ${filters.to!}
            and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
            and (${filters.customerId ?? null}::uuid is null or customer_id = ${filters.customerId ?? null})
            and (${filters.warehouseId ?? null}::uuid is null or warehouse_id = ${filters.warehouseId ?? null})
          group by 1
        ),
        inward as (
          select inward_at::date as day, count(*)::int as inwards
          from inwards
          where tenant_id = ${tenantId} and status <> 'cancelled'
            and inward_at::date between ${filters.from!} and ${filters.to!}
            and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
            and (${filters.customerId ?? null}::uuid is null or customer_id = ${filters.customerId ?? null})
            and (${filters.warehouseId ?? null}::uuid is null or warehouse_id = ${filters.warehouseId ?? null})
          group by 1
        ),
        receipts as (
          select g.grn_date as day, count(distinct g.id)::int as grns,
                 coalesce(sum(i.received_qty), 0) as received_qty,
                 coalesce(sum(i.accepted_qty), 0) as accepted_qty,
                 coalesce(sum(i.rejected_qty), 0) as rejected_qty,
                 coalesce(sum(i.damaged_qty), 0) as damaged_qty
          from grns g left join grn_items i on i.grn_id = g.id
          where g.tenant_id = ${tenantId} and g.status <> 'cancelled'
            and g.grn_date between ${filters.from!} and ${filters.to!}
            and (${scope}::uuid[] is null or g.warehouse_id = any(${scope}))
            and (${filters.customerId ?? null}::uuid is null or g.customer_id = ${filters.customerId ?? null})
            and (${filters.warehouseId ?? null}::uuid is null or g.warehouse_id = ${filters.warehouseId ?? null})
          group by 1
        )
        select d.day,
               coalesce(gate.gate_entries, 0) as "gateEntries",
               coalesce(inward.inwards, 0) as inwards,
               coalesce(receipts.grns, 0) as grns,
               coalesce(receipts.received_qty, 0)::float8 as "receivedQty",
               coalesce(receipts.accepted_qty, 0)::float8 as "acceptedQty",
               coalesce(receipts.rejected_qty, 0)::float8 as "rejectedQty",
               coalesce(receipts.damaged_qty, 0)::float8 as "damagedQty"
        from days d
        left join gate on gate.day = d.day
        left join inward on inward.day = d.day
        left join receipts on receipts.day = d.day
        -- A day with nothing on it is dropped: an operator reading a
        -- month wants the days something happened, not thirty empty rows.
        where coalesce(gate.gate_entries, 0) + coalesce(inward.inwards, 0) + coalesce(receipts.grns, 0) > 0
        order by d.day
      `;
      return rows;
    },
  },
  {
    code: 'daily_outward',
    name: 'Daily outward',
    group: 'operations',
    description: 'What left each day: dispatches raised, quantity dispatched, and vehicles gated out.',
    permission: 'view_reports',
    filters: ['dateRange', 'customerId', 'warehouseId'],
    columns: [
      { key: 'day', label: 'Date', type: 'date' },
      { key: 'dispatches', label: 'Dispatches', type: 'number', total: true },
      { key: 'quantity', label: 'Quantity', type: 'number', total: true },
      { key: 'gatePasses', label: 'Gated out', type: 'number', total: true },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        with dispatched as (
          select d.dispatch_date as day, count(distinct d.id)::int as dispatches,
                 coalesce(sum(l.quantity), 0) as quantity
          from dispatches d left join dispatch_lines l on l.dispatch_id = d.id
          where d.tenant_id = ${tenantId} and d.status <> 'cancelled'
            and d.dispatch_date between ${filters.from!} and ${filters.to!}
            and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
            and (${filters.customerId ?? null}::uuid is null or d.customer_id = ${filters.customerId ?? null})
            and (${filters.warehouseId ?? null}::uuid is null or d.warehouse_id = ${filters.warehouseId ?? null})
          group by 1
        ),
        passes as (
          select gate_out_at::date as day, count(*)::int as gate_passes
          from gate_passes
          where tenant_id = ${tenantId} and gate_out_at is not null
            and gate_out_at::date between ${filters.from!} and ${filters.to!}
            and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
            and (${filters.customerId ?? null}::uuid is null or customer_id = ${filters.customerId ?? null})
            and (${filters.warehouseId ?? null}::uuid is null or warehouse_id = ${filters.warehouseId ?? null})
          group by 1
        )
        select coalesce(dispatched.day, passes.day) as day,
               coalesce(dispatched.dispatches, 0) as dispatches,
               coalesce(dispatched.quantity, 0)::float8 as quantity,
               coalesce(passes.gate_passes, 0) as "gatePasses"
        from dispatched full outer join passes on passes.day = dispatched.day
        order by 1
      `;
    },
  },
  {
    code: 'gate_entry_register',
    name: 'Gate entry register',
    group: 'operations',
    description: 'Every vehicle the security desk logged, in or out, with when it left.',
    permission: 'view_reports',
    filters: ['dateRange', 'customerId', 'warehouseId', 'status'],
    columns: [
      { key: 'number', label: 'Number' },
      { key: 'entryAt', label: 'Arrived', type: 'datetime' },
      { key: 'exitAt', label: 'Left', type: 'datetime' },
      { key: 'direction', label: 'Direction' },
      { key: 'purpose', label: 'Purpose' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'vehicleNumber', label: 'Vehicle' },
      { key: 'driverName', label: 'Driver' },
      { key: 'status', label: 'Status' },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select ge.number, ge.entry_at as "entryAt", ge.exit_at as "exitAt", ge.direction, ge.purpose,
               w.name as warehouse, coalesce(c.legal_name, c.name) as customer,
               ge.vehicle_number as "vehicleNumber", ge.driver_name as "driverName", ge.status
        from gate_entries ge
        join warehouses w on w.id = ge.warehouse_id
        left join customers c on c.id = ge.customer_id
        where ge.tenant_id = ${tenantId}
          and ge.entry_at::date between ${filters.from!} and ${filters.to!}
          and (${scope}::uuid[] is null or ge.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or ge.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or ge.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.status ?? null}::text is null or ge.status = ${filters.status ?? null})
        order by ge.entry_at desc
      `;
    },
  },
  {
    code: 'grn_register',
    name: 'GRN register',
    group: 'operations',
    description: 'Every goods receipt, what it accepted, and whether it tallied.',
    permission: 'view_reports',
    filters: ['dateRange', 'customerId', 'warehouseId', 'status'],
    columns: [
      { key: 'number', label: 'Number' },
      { key: 'grnDate', label: 'Date', type: 'date' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'receivedQty', label: 'Received', type: 'number', total: true },
      { key: 'acceptedQty', label: 'Accepted', type: 'number', total: true },
      { key: 'shortQty', label: 'Short', type: 'number', total: true },
      { key: 'damagedQty', label: 'Damaged', type: 'number', total: true },
      { key: 'discrepancy', label: 'Discrepancy' },
      { key: 'status', label: 'Status' },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select g.number, g.grn_date as "grnDate", w.name as warehouse,
               coalesce(c.legal_name, c.name) as customer,
               coalesce(s.name, g.supplier_name) as supplier,
               coalesce(sum(i.received_qty), 0)::float8 as "receivedQty",
               coalesce(sum(i.accepted_qty), 0)::float8 as "acceptedQty",
               coalesce(sum(i.short_qty), 0)::float8 as "shortQty",
               coalesce(sum(i.damaged_qty), 0)::float8 as "damagedQty",
               case when g.has_discrepancy then 'yes' else '' end as discrepancy,
               g.status
        from grns g
        join warehouses w on w.id = g.warehouse_id
        join customers c on c.id = g.customer_id
        left join suppliers s on s.id = g.supplier_id
        left join grn_items i on i.grn_id = g.id
        where g.tenant_id = ${tenantId}
          and g.grn_date between ${filters.from!} and ${filters.to!}
          and (${scope}::uuid[] is null or g.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or g.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or g.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.status ?? null}::text is null or g.status = ${filters.status ?? null})
        group by g.id, g.number, g.grn_date, w.name, c.legal_name, c.name, s.name, g.supplier_name, g.has_discrepancy, g.status
        order by g.grn_date desc, g.number desc
      `;
    },
  },
  {
    code: 'dispatch_register',
    name: 'Dispatch register',
    group: 'operations',
    description: 'Every dispatch, its quantity, and whether the proof of delivery came back.',
    permission: 'view_reports',
    filters: ['dateRange', 'customerId', 'warehouseId', 'status'],
    columns: [
      { key: 'number', label: 'Number' },
      { key: 'dispatchDate', label: 'Date', type: 'date' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'customer', label: 'Customer' },
      { key: 'vehicleNumber', label: 'Vehicle' },
      { key: 'quantity', label: 'Quantity', type: 'number', total: true },
      { key: 'gateOutAt', label: 'Gated out', type: 'datetime' },
      { key: 'podStatus', label: 'POD' },
      { key: 'status', label: 'Status' },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select d.number, d.dispatch_date as "dispatchDate", w.name as warehouse,
               coalesce(c.legal_name, c.name) as customer, d.vehicle_number as "vehicleNumber",
               coalesce(sum(l.quantity), 0)::float8 as quantity,
               max(gp.gate_out_at) as "gateOutAt",
               coalesce(max(pod.status), 'not raised') as "podStatus",
               d.status
        from dispatches d
        join warehouses w on w.id = d.warehouse_id
        join customers c on c.id = d.customer_id
        left join dispatch_lines l on l.dispatch_id = d.id
        left join gate_passes gp on gp.dispatch_id = d.id
        left join pods pod on pod.dispatch_id = d.id
        where d.tenant_id = ${tenantId}
          and d.dispatch_date between ${filters.from!} and ${filters.to!}
          and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or d.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or d.warehouse_id = ${filters.warehouseId ?? null})
          and (${filters.status ?? null}::text is null or d.status = ${filters.status ?? null})
        group by d.id, d.number, d.dispatch_date, w.name, c.legal_name, c.name, d.vehicle_number, d.status
        order by d.dispatch_date desc, d.number desc
      `;
    },
  },
];
