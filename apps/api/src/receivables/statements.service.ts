import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CustomerStatementQuery } from './dto/receivables.dtos';

export interface StatementEntry {
  date: string;
  type: 'invoice' | 'credit_note' | 'debit_note' | 'payment';
  number: string;
  reference: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  sourceId: string;
  status: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Blueprint §43's Customer Statement. `schema/60_billing.sql` is explicit
 * that there is no table for this -- it is a projection over invoices,
 * credit/debit notes and payment receipts -- and this is that projection.
 *
 * The running balance is what the customer actually owes: invoices and
 * debit notes add to it, credit notes and payments reduce it. Only
 * documents that have reached the customer count -- an invoice from
 * `issued` on, a note from `issued` on, a receipt while `posted` -- so a
 * draft invoice sitting in someone's queue never appears on the statement
 * as a demand for money.
 *
 * The opening balance is the same computation over everything before
 * `from`, so a statement for a window still starts from the truth rather
 * than from zero.
 */
@Injectable()
export class StatementsService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  /**
   * Reading a statement is not audited, for the same reason no other read
   * in this codebase is: `audit_logs` records what changed, and a GET
   * changes nothing. *Issuing* the statement as a document is a change --
   * a `documents` row the customer can be handed -- and the document
   * engine audits that.
   */
  forCustomer(actor: AuthenticatedUser, customerId: string, query: CustomerStatementQuery) {
    return withTenant(this.sql, actor.tenantId, (tx) => this.build(tx, actor.tenantId, customerId, query));
  }

  build(tx: postgres.TransactionSql, tenantId: string, customerId: string, query: CustomerStatementQuery) {
    return buildCustomerStatement(tx, tenantId, customerId, query);
  }
}

/**
 * The projection itself, as a plain function: the Customer Statement
 * document template renders exactly what the endpoint returns, and the only
 * way to guarantee that is for both to call one piece of code. A service
 * method would have meant the template either constructing a service by
 * hand or duplicating the query.
 */
export async function buildCustomerStatement(tx: postgres.TransactionSql, tenantId: string, customerId: string, query: CustomerStatementQuery) {
    const [customer] = await tx<{ id: string; code: string; name: string; legal_name: string | null; gstin: string | null; credit_days: number; payment_terms: string | null }[]>`
      select id, code, name, legal_name, gstin, credit_days, payment_terms from customers where id = ${customerId} and tenant_id = ${tenantId}
    `;
    if (!customer) throw new NotFoundException('Customer not found');
    const from = query.from ?? null;
    const to = query.to ?? null;

    const rows = await tx<{ d: string; type: string; number: string; reference: string | null; description: string; debit: string; credit: string; source_id: string; status: string }[]>`
      select * from (
        select i.invoice_date as d, 'invoice' as type, i.number, null::text as reference,
               coalesce('Period ' || to_char((i.customer_snapshot->>'period_start')::date, 'DD Mon YYYY') || ' to ' || to_char((i.customer_snapshot->>'period_end')::date, 'DD Mon YYYY'), 'Tax invoice') as description,
               i.grand_total::text as debit, '0'::text as credit, i.id as source_id, i.status
        from invoices i
        where i.tenant_id = ${tenantId} and i.customer_id = ${customerId} and i.status in ('issued', 'partially_paid', 'paid', 'overdue')
        union all
        select n.note_date as d, case when n.note_type = 'credit' then 'credit_note' else 'debit_note' end as type, n.number,
               inv.number as reference, n.reason as description,
               case when n.note_type = 'debit' then n.grand_total::text else '0' end as debit,
               case when n.note_type = 'credit' then n.grand_total::text else '0' end as credit,
               n.id as source_id, n.status
        from credit_debit_notes n left join invoices inv on inv.id = n.invoice_id
        where n.tenant_id = ${tenantId} and n.customer_id = ${customerId} and n.status = 'issued'
        union all
        select r.payment_date as d, 'payment' as type, r.number, r.reference_number as reference,
               'Payment received (' || r.payment_mode || ')' as description, '0'::text as debit, r.amount::text as credit, r.id as source_id, r.status
        from payment_receipts r
        where r.tenant_id = ${tenantId} and r.customer_id = ${customerId} and r.status = 'posted'
      ) e
      order by e.d, case e.type when 'invoice' then 0 when 'debit_note' then 1 when 'credit_note' then 2 else 3 end, e.number
    `;

    let opening = 0;
    const entries: StatementEntry[] = [];
    let balance = 0;
    for (const r of rows) {
      const debit = Number(r.debit);
      const credit = Number(r.credit);
      if (from !== null && r.d < from) {
        opening = round2(opening + debit - credit);
        continue;
      }
      if (to !== null && r.d > to) continue;
      balance = round2((entries.length === 0 ? opening : balance) + debit - credit);
      entries.push({
        date: r.d, type: r.type as StatementEntry['type'], number: r.number, reference: r.reference,
        description: r.description, debit, credit, balance, sourceId: r.source_id, status: r.status,
      });
    }
    const closing = entries.length > 0 ? entries[entries.length - 1].balance : opening;

    const [ageing] = await tx<{ not_due: string; d30: string; d60: string; d90: string; older: string }[]>`
      select
        coalesce(sum(balance_due) filter (where due_date is null or due_date >= current_date), 0)::text as not_due,
        coalesce(sum(balance_due) filter (where due_date < current_date and due_date >= current_date - 30), 0)::text as d30,
        coalesce(sum(balance_due) filter (where due_date < current_date - 30 and due_date >= current_date - 60), 0)::text as d60,
        coalesce(sum(balance_due) filter (where due_date < current_date - 60 and due_date >= current_date - 90), 0)::text as d90,
        coalesce(sum(balance_due) filter (where due_date < current_date - 90), 0)::text as older
      from invoices
      where tenant_id = ${tenantId} and customer_id = ${customerId} and status in ('issued', 'partially_paid', 'overdue') and balance_due > 0
    `;

    return {
      customer: {
        id: customer.id, code: customer.code, name: customer.name, legalName: customer.legal_name,
        gstin: customer.gstin, creditDays: customer.credit_days, paymentTerms: customer.payment_terms,
      },
      from, to,
      openingBalance: opening,
      closingBalance: closing,
      totals: {
        invoiced: round2(entries.filter((e) => e.type === 'invoice').reduce((s, e) => s + e.debit, 0)),
        debitNotes: round2(entries.filter((e) => e.type === 'debit_note').reduce((s, e) => s + e.debit, 0)),
        creditNotes: round2(entries.filter((e) => e.type === 'credit_note').reduce((s, e) => s + e.credit, 0)),
        received: round2(entries.filter((e) => e.type === 'payment').reduce((s, e) => s + e.credit, 0)),
      },
      /** Outstanding by how far past its due date each invoice is, from live invoices rather than the entry list. */
      ageing: {
        notDue: Number(ageing.not_due), upTo30: Number(ageing.d30), upTo60: Number(ageing.d60),
        upTo90: Number(ageing.d90), over90: Number(ageing.older),
      },
      entries,
    };
  }
