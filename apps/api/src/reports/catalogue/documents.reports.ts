import { ReportDefinition } from '../report-definition';

/**
 * Blueprint §55's Documents group: "Document Register, Pending POD,
 * Pending Approvals, Agreement Expiry."
 *
 * Three of the four are *exception* reports -- they exist to be empty. A
 * pending-POD list with rows on it is a delivery nobody has closed out; an
 * agreement-expiry list with rows on it is a contract about to lapse
 * unnoticed. That is why they are dated forward rather than back.
 */
export const DOCUMENT_REPORTS: ReportDefinition[] = [
  {
    code: 'document_register',
    name: 'Document register',
    group: 'documents',
    description: 'Every document issued, its version, and whether a later version has replaced it.',
    permission: 'view_documents',
    filters: ['dateRange', 'customerId', 'warehouseId'],
    columns: [
      { key: 'documentNumber', label: 'Number' },
      { key: 'documentType', label: 'Type' },
      { key: 'versionNo', label: 'Version', type: 'number' },
      { key: 'isLatest', label: 'Current' },
      { key: 'customer', label: 'Customer' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'generatedAt', label: 'Generated', type: 'datetime' },
      { key: 'generatedBy', label: 'By' },
      { key: 'verifications', label: 'QR scans', type: 'number', total: true },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select d.document_number as "documentNumber", d.document_type as "documentType",
               d.version_no as "versionNo",
               case when d.is_latest then 'current' else 'superseded' end as "isLatest",
               coalesce(c.legal_name, c.name) as customer, w.name as warehouse,
               d.generated_at as "generatedAt", u.full_name as "generatedBy",
               (select count(*)::int from document_verifications v where v.document_id = d.id) as verifications
        from documents d
        left join customers c on c.id = d.customer_id
        left join warehouses w on w.id = d.warehouse_id
        left join users u on u.id = d.generated_by
        where d.tenant_id = ${tenantId}
          and d.generated_at::date between ${filters.from!} and ${filters.to!}
          -- A document with no warehouse (a quotation, a customer
          -- statement) belongs to the tenant, not to a warehouse, so a
          -- warehouse-scoped member still sees it.
          and (${scope}::uuid[] is null or d.warehouse_id is null or d.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or d.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or d.warehouse_id = ${filters.warehouseId ?? null})
        order by d.generated_at desc
      `;
    },
  },
  {
    code: 'pending_pod',
    name: 'Pending POD',
    group: 'documents',
    description: 'Vehicles that left the yard and whose proof of delivery has not come back.',
    permission: 'view_reports',
    filters: ['customerId', 'warehouseId'],
    columns: [
      { key: 'dispatchNumber', label: 'Dispatch' },
      { key: 'gatePassNumber', label: 'Gate pass' },
      { key: 'customer', label: 'Customer' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'vehicleNumber', label: 'Vehicle' },
      { key: 'gateOutAt', label: 'Gated out', type: 'datetime' },
      { key: 'daysOutstanding', label: 'Days out', type: 'number' },
      { key: 'podStatus', label: 'POD' },
    ],
    async run(tx, { tenantId, scope, filters }) {
      return tx<Record<string, unknown>[]>`
        select d.number as "dispatchNumber", gp.number as "gatePassNumber",
               coalesce(c.legal_name, c.name) as customer, w.name as warehouse,
               d.vehicle_number as "vehicleNumber", gp.gate_out_at as "gateOutAt",
               (current_date - gp.gate_out_at::date) as "daysOutstanding",
               coalesce(pod.status, 'not raised') as "podStatus"
        from gate_passes gp
        join dispatches d on d.id = gp.dispatch_id
        join customers c on c.id = d.customer_id
        join warehouses w on w.id = d.warehouse_id
        left join pods pod on pod.dispatch_id = d.id
        where gp.tenant_id = ${tenantId} and gp.gate_out_at is not null
          and (pod.id is null or pod.status = 'pending')
          and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or d.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or d.warehouse_id = ${filters.warehouseId ?? null})
        order by gp.gate_out_at
      `;
    },
  },
  {
    code: 'pending_approvals',
    name: 'Pending approvals',
    group: 'documents',
    description: 'Everything waiting on somebody: which record, which step, and how long it has waited.',
    permission: 'view_reports',
    filters: [],
    columns: [
      { key: 'entityType', label: 'Record' },
      { key: 'number', label: 'Number' },
      { key: 'currentStep', label: 'Step', type: 'number' },
      { key: 'waitingOn', label: 'Waiting on' },
      { key: 'raisedAt', label: 'Raised', type: 'datetime' },
      { key: 'daysWaiting', label: 'Days waiting', type: 'number' },
    ],
    async run(tx, { tenantId }) {
      // `approval_instances` is polymorphic (entity_type/entity_id), and
      // the number lives on whichever table that names -- so the number is
      // resolved per type rather than through a join that cannot exist.
      return tx<Record<string, unknown>[]>`
        select ai.entity_type as "entityType",
               coalesce(
                 (select g.number from grns g where g.id = ai.entity_id),
                 (select sa.number from stock_adjustments sa where sa.id = ai.entity_id),
                 (select ro.number from release_orders ro where ro.id = ai.entity_id),
                 (select i.number from invoices i where i.id = ai.entity_id),
                 (select a.number from agreements a where a.id = ai.entity_id)
               ) as number,
               ai.current_step as "currentStep",
               (select s.role_code from approval_steps s
                 where s.instance_id = ai.id and s.step_no = ai.current_step limit 1) as "waitingOn",
               ai.created_at as "raisedAt",
               (current_date - ai.created_at::date) as "daysWaiting"
        from approval_instances ai
        where ai.tenant_id = ${tenantId} and ai.status = 'pending'
        order by ai.created_at
      `;
    },
  },
  {
    code: 'agreement_expiry',
    name: 'Agreement expiry',
    group: 'documents',
    description: 'Agreements that have expired or are about to, with whether they renew themselves.',
    permission: 'view_agreement',
    filters: ['customerId', 'warehouseId'],
    columns: [
      { key: 'number', label: 'Number' },
      { key: 'customer', label: 'Customer' },
      { key: 'warehouse', label: 'Warehouse' },
      { key: 'startDate', label: 'From', type: 'date' },
      { key: 'endDate', label: 'To', type: 'date' },
      { key: 'daysToExpiry', label: 'Days left', type: 'number' },
      { key: 'autoRenew', label: 'Auto-renews' },
      { key: 'status', label: 'Status' },
    ],
    async run(tx, { tenantId, scope, filters }) {
      // Ninety days ahead, and anything already past its end date that is
      // still active -- the second half is the one that matters, because
      // an expired agreement nobody noticed is still being billed against.
      return tx<Record<string, unknown>[]>`
        select a.number, coalesce(c.legal_name, c.name) as customer, w.name as warehouse,
               a.start_date as "startDate", a.end_date as "endDate",
               (a.end_date - current_date) as "daysToExpiry",
               case when a.auto_renew then 'yes' else 'no' end as "autoRenew",
               a.status
        from agreements a
        join customers c on c.id = a.customer_id
        left join warehouses w on w.id = a.warehouse_id
        where a.tenant_id = ${tenantId}
          and a.status in ('active', 'approved')
          and a.end_date is not null and a.end_date <= current_date + 90
          and (${scope}::uuid[] is null or a.warehouse_id is null or a.warehouse_id = any(${scope}))
          and (${filters.customerId ?? null}::uuid is null or a.customer_id = ${filters.customerId ?? null})
          and (${filters.warehouseId ?? null}::uuid is null or a.warehouse_id = ${filters.warehouseId ?? null})
        order by a.end_date
      `;
    },
  },
];
