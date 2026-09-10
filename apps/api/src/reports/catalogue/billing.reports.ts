import { ReportDefinition } from '../report-definition';

/**
 * Blueprint §55's Billing group: "Storage Charges, Handling Charges,
 * Invoice Register, Outstanding, Collection, Customer Statement."
 *
 * Storage and handling read `billing_run_lines` -- what the billing engine
 * actually computed -- rather than re-deriving charges from stock days and
 * handling events. Re-deriving would produce a second opinion about
 * somebody's bill, and `billing-engine.md` §7's whole argument is that
 * there is exactly one.
 */
const CHARGE_LINES = (category: string): ReportDefinition['run'] =>
  async function run(tx, { tenantId, scope, filters }) {
    return tx<Record<string, unknown>[]>`
      select coalesce(c.legal_name, c.name) as customer, w.name as warehouse,
             ct.name as "chargeType", br.period_start as "periodStart", br.period_end as "periodEnd",
             l.description, l.basis,
             coalesce(l.quantity, 0)::float8 as quantity,
             coalesce(l.days, 0)::float8 as days,
             coalesce(l.rate, 0)::float8 as rate,
             l.computed_amount::float8 as amount,
             i.number as "invoiceNumber", br.status
      from billing_run_lines l
      join billing_runs br on br.id = l.billing_run_id
      join charge_types ct on ct.id = l.charge_type_id
      join customers c on c.id = br.customer_id
      left join warehouses w on w.id = br.warehouse_id
      left join invoices i on i.id = br.invoice_id
      where l.tenant_id = ${tenantId} and ct.category = ${category}
        and br.period_start >= ${filters.from!} and br.period_end <= ${filters.to!}
        and (${scope}::uuid[] is null or br.warehouse_id is null or br.warehouse_id = any(${scope}))
        and (${filters.customerId ?? null}::uuid is null or br.customer_id = ${filters.customerId ?? null})
        and (${filters.warehouseId ?? null}::uuid is null or br.warehouse_id = ${filters.warehouseId ?? null})
      order by customer, br.period_start desc, ct.name
    `;
  };

const CHARGE_COLUMNS = [
  { key: 'customer', label: 'Customer' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'chargeType', label: 'Charge' },
  { key: 'periodStart', label: 'From', type: 'date' as const },
  { key: 'periodEnd', label: 'To', type: 'date' as const },
  { key: 'description', label: 'Description' },
  { key: 'basis', label: 'Basis' },
  { key: 'quantity', label: 'Quantity', type: 'number' as const, total: true },
  { key: 'days', label: 'Days', type: 'number' as const },
  { key: 'rate', label: 'Rate', type: 'money' as const },
  { key: 'amount', label: 'Amount', type: 'money' as const, total: true },
  { key: 'invoiceNumber', label: 'Invoice' },
  { key: 'status', label: 'Run status' },
];

export const BILLING_REPORTS: ReportDefinition[] = [
  {
    code: 'storage_charges',
    name: 'Storage charges',
    group: 'billing',
    description: 'What the billing engine computed for storage in the period, line by line, as it will be invoiced.',
    permission: 'generate_billing_run',
    filters: ['dateRange', 'customerId', 'warehouseId'],
    columns: CHARGE_COLUMNS,
    run: CHARGE_LINES('storage'),
  },
  {
    code: 'handling_charges',
    name: 'Handling charges',
    group: 'billing',
    description: 'The same for handling — inward, outward, labour, palletization — as computed, not as estimated.',
    permission: 'generate_billing_run',
    filters: ['dateRange', 'customerId', 'warehouseId'],
    columns: CHARGE_COLUMNS,
    run: CHARGE_LINES('handling'),
  },
  {
    code: 'invoice_register',
    name: 'Invoice register',
    group: 'billing',
    description:
      'Every invoice raised in the period with its tax split, what has been paid, and what is left. Cancelled ones are listed too — a register is the numbering record, and a missing number is the thing an auditor asks about.',
    permission: 'create_invoice',
    filters: ['dateRange', 'customerId', 'status'],
    columns: [
      { key: 'number', label: 'Number' },
      { key: 'invoiceDate', label: 'Date', type: 'date' },
      { key: 'customer', label: 'Customer' },
      { key: 'placeOfSupply', label: 'Place of supply' },
      { key: 'taxTreatment', label: 'Tax' },
      { key: 'subtotal', label: 'Subtotal', type: 'money', total: true },
      { key: 'cgstAmount', label: 'CGST', type: 'money', total: true },
      { key: 'sgstAmount', label: 'SGST', type: 'money', total: true },
      { key: 'igstAmount', label: 'IGST', type: 'money', total: true },
      { key: 'grandTotal', label: 'Total', type: 'money', total: true },
      { key: 'amountPaid', label: 'Paid', type: 'money', total: true },
      { key: 'balanceDue', label: 'Due', type: 'money', total: true },
      { key: 'status', label: 'Status' },
    ],
    async run(tx, { tenantId, filters }) {
      return tx<Record<string, unknown>[]>`
        select i.number, i.invoice_date as "invoiceDate", coalesce(c.legal_name, c.name) as customer,
               i.place_of_supply as "placeOfSupply", i.tax_treatment as "taxTreatment",
               i.subtotal::float8 as subtotal, i.cgst_amount::float8 as "cgstAmount",
               i.sgst_amount::float8 as "sgstAmount", i.igst_amount::float8 as "igstAmount",
               i.grand_total::float8 as "grandTotal", i.amount_paid::float8 as "amountPaid",
               i.balance_due::float8 as "balanceDue", i.status
        from invoices i
        join customers c on c.id = i.customer_id
        where i.tenant_id = ${tenantId}
          and i.invoice_date between ${filters.from!} and ${filters.to!}
          and (${filters.customerId ?? null}::uuid is null or i.customer_id = ${filters.customerId ?? null})
          and (${filters.status ?? null}::text is null or i.status = ${filters.status ?? null})
        order by i.invoice_date desc, i.number desc
      `;
    },
  },
  {
    code: 'outstanding',
    name: 'Outstanding',
    group: 'billing',
    description: 'What is owed right now, by customer and by how overdue it is. An exception report: rows here are money not collected.',
    permission: 'view_customer_statement',
    filters: ['customerId'],
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'invoices', label: 'Invoices', type: 'number', total: true },
      { key: 'notDue', label: 'Not yet due', type: 'money', total: true },
      { key: 'due0to30', label: '0–30 days', type: 'money', total: true },
      { key: 'due31to60', label: '31–60 days', type: 'money', total: true },
      { key: 'due61to90', label: '61–90 days', type: 'money', total: true },
      { key: 'due90plus', label: '90+ days', type: 'money', total: true },
      { key: 'totalDue', label: 'Total due', type: 'money', total: true },
    ],
    async run(tx, { tenantId, filters }) {
      // Ageing by how long past its own due date each invoice is -- the
      // buckets are the ones a receivables ledger uses everywhere, and
      // deliberately not the stock ageing setting, which means something
      // else entirely.
      return tx<Record<string, unknown>[]>`
        select coalesce(c.legal_name, c.name) as customer,
               count(*)::int as invoices,
               coalesce(sum(i.balance_due) filter (where i.due_date is null or i.due_date >= current_date), 0)::float8 as "notDue",
               coalesce(sum(i.balance_due) filter (where current_date - i.due_date between 0 and 30), 0)::float8 as "due0to30",
               coalesce(sum(i.balance_due) filter (where current_date - i.due_date between 31 and 60), 0)::float8 as "due31to60",
               coalesce(sum(i.balance_due) filter (where current_date - i.due_date between 61 and 90), 0)::float8 as "due61to90",
               coalesce(sum(i.balance_due) filter (where current_date - i.due_date > 90), 0)::float8 as "due90plus",
               sum(i.balance_due)::float8 as "totalDue"
        from invoices i
        join customers c on c.id = i.customer_id
        where i.tenant_id = ${tenantId} and i.balance_due > 0
          and i.status not in ('draft', 'cancelled')
          and (${filters.customerId ?? null}::uuid is null or i.customer_id = ${filters.customerId ?? null})
        group by customer
        order by "totalDue" desc
      `;
    },
  },
  {
    code: 'collection',
    name: 'Collection',
    group: 'billing',
    description:
      'Money received in the period, how it came in, and which invoices it was put against. Cancelled receipts are left out: a cancelled receipt is money that was not collected, and counting it here would overstate the day.',
    permission: 'record_payment',
    filters: ['dateRange', 'customerId'],
    columns: [
      { key: 'number', label: 'Receipt' },
      { key: 'paymentDate', label: 'Date', type: 'date' },
      { key: 'customer', label: 'Customer' },
      { key: 'paymentMode', label: 'Mode' },
      { key: 'referenceNumber', label: 'Reference' },
      { key: 'amount', label: 'Received', type: 'money', total: true },
      { key: 'allocated', label: 'Allocated', type: 'money', total: true },
      { key: 'unallocated', label: 'On account', type: 'money', total: true },
      { key: 'invoices', label: 'Against' },
    ],
    async run(tx, { tenantId, filters }) {
      return tx<Record<string, unknown>[]>`
        select r.number, r.payment_date as "paymentDate", coalesce(c.legal_name, c.name) as customer,
               r.payment_mode as "paymentMode", r.reference_number as "referenceNumber",
               r.amount::float8 as amount,
               coalesce(sum(a.amount), 0)::float8 as allocated,
               (r.amount - coalesce(sum(a.amount), 0))::float8 as unallocated,
               string_agg(i.number, ', ' order by i.number) as invoices
        from payment_receipts r
        join customers c on c.id = r.customer_id
        left join payment_allocations a on a.receipt_id = r.id
        left join invoices i on i.id = a.invoice_id
        where r.tenant_id = ${tenantId} and r.status <> 'cancelled'
          and r.payment_date between ${filters.from!} and ${filters.to!}
          and (${filters.customerId ?? null}::uuid is null or r.customer_id = ${filters.customerId ?? null})
        group by r.id, r.number, r.payment_date, customer, r.payment_mode, r.reference_number, r.amount
        order by r.payment_date desc, r.number desc
      `;
    },
  },
  {
    code: 'customer_statement',
    name: 'Customer statement',
    group: 'billing',
    description: 'One customer\'s account as a running balance: invoices, notes and receipts in the order they happened.',
    permission: 'view_customer_statement',
    filters: ['dateRange', 'customerId'],
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'kind', label: 'Entry' },
      { key: 'reference', label: 'Reference' },
      { key: 'customer', label: 'Customer' },
      { key: 'debit', label: 'Debit', type: 'money', total: true },
      { key: 'credit', label: 'Credit', type: 'money', total: true },
    ],
    async run(tx, { tenantId, filters }) {
      // Debits raise what is owed (an invoice, a debit note); credits
      // reduce it (a receipt, a credit note). The running balance is left
      // to the reader rather than computed per row, because a statement
      // filtered to a period has no opening balance to run from -- and
      // implying one would be a number that is quietly wrong.
      return tx<Record<string, unknown>[]>`
        select i.invoice_date as date, 'invoice' as kind, i.number as reference,
               coalesce(c.legal_name, c.name) as customer,
               i.grand_total::float8 as debit, 0::float8 as credit
        from invoices i join customers c on c.id = i.customer_id
        where i.tenant_id = ${tenantId} and i.status not in ('draft', 'cancelled')
          and i.invoice_date between ${filters.from!} and ${filters.to!}
          and (${filters.customerId ?? null}::uuid is null or i.customer_id = ${filters.customerId ?? null})
        union all
        select n.note_date as date, n.note_type as kind, n.number as reference,
               coalesce(c.legal_name, c.name) as customer,
               case when n.note_type = 'debit' then n.grand_total else 0 end::float8 as debit,
               case when n.note_type = 'credit' then n.grand_total else 0 end::float8 as credit
        from credit_debit_notes n join customers c on c.id = n.customer_id
        where n.tenant_id = ${tenantId} and n.status <> 'draft'
          and n.note_date between ${filters.from!} and ${filters.to!}
          and (${filters.customerId ?? null}::uuid is null or n.customer_id = ${filters.customerId ?? null})
        union all
        select r.payment_date as date, 'receipt' as kind, r.number as reference,
               coalesce(c.legal_name, c.name) as customer,
               0::float8 as debit, r.amount::float8 as credit
        from payment_receipts r join customers c on c.id = r.customer_id
        where r.tenant_id = ${tenantId} and r.status <> 'cancelled'
          and r.payment_date between ${filters.from!} and ${filters.to!}
          and (${filters.customerId ?? null}::uuid is null or r.customer_id = ${filters.customerId ?? null})
        order by 1, 2
      `;
    },
  },
];
