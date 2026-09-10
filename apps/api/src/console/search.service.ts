import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { hasPermission } from '../auth/has-permission';
import { loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

export interface SearchHit {
  type: string;
  id: string;
  label: string;
  summary: string;
  status: string | null;
}

/**
 * `ux-system.md` §4's global search: "one search endpoint, one result
 * renderer, fanning out across customer, SKU, vehicle, GRN, invoice, gate
 * pass, dispatch, POD, and generic document number... unioned and ranked,
 * not twelve separate search boxes."
 *
 * One SQL union, so ranking is a single `order by` rather than an
 * application-side merge of twelve result sets, and each branch produces
 * the same four columns the one renderer needs. Ranking is by *how* the
 * row matched: an exact hit on an identifier outranks a prefix, which
 * outranks a substring, so typing a full GRN number puts that GRN first
 * even when a customer's name happens to contain the digits.
 *
 * Two filters are not optional. Warehouse scope narrows every
 * warehouse-bound branch, and each branch is dropped entirely when the
 * caller lacks the permission that governs it -- a search box must not
 * become the way an Operator reads invoice numbers.
 */
@Injectable()
export class SearchService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async search(actor: AuthenticatedUser, term: string, limit: number) {
    const trimmed = term.trim();
    if (trimmed.length < 2) return { query: trimmed, items: [], total: 0 };
    const exact = trimmed.toUpperCase();
    const prefix = `${trimmed}%`;
    const contains = `%${trimmed}%`;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [canSeeCustomers, canSeeProducts, canSeeTransport, canSeeOperations, canSeeBilling] = await Promise.all([
        hasPermission(tx, actor, 'view_customer'),
        hasPermission(tx, actor, 'view_product'),
        hasPermission(tx, actor, 'view_transport_master'),
        hasPermission(tx, actor, 'create_grn'),
        hasPermission(tx, actor, 'create_invoice'),
      ]);

      const rows = await tx<{ type: string; id: string; label: string; summary: string; status: string | null; rank: number }[]>`
        with hits as (
          select 'customer' as type, c.id, c.code as label,
                 coalesce(c.legal_name, c.name) || coalesce(' · ' || c.gstin, '') as summary,
                 case when c.is_active then 'active' else 'inactive' end as status,
                 case when upper(c.code) = ${exact} or upper(coalesce(c.gstin, '')) = ${exact} then 0
                      when c.code ilike ${prefix} or c.name ilike ${prefix} then 1 else 2 end as rank
          from customers c
          where ${canSeeCustomers} and c.tenant_id = ${actor.tenantId}
            and (c.code ilike ${contains} or c.name ilike ${contains} or c.legal_name ilike ${contains}
                 or c.gstin ilike ${contains} or c.mobile ilike ${contains})
          union all
          select 'product', p.id, p.sku, p.name || coalesce(' · HSN ' || p.hsn_code, ''),
                 case when p.is_active then 'active' else 'inactive' end,
                 case when upper(p.sku) = ${exact} or upper(coalesce(p.barcode, '')) = ${exact} then 0
                      when p.sku ilike ${prefix} then 1 else 2 end
          from products p
          where ${canSeeProducts} and p.tenant_id = ${actor.tenantId}
            and (p.sku ilike ${contains} or p.name ilike ${contains} or p.barcode ilike ${contains} or p.hsn_code ilike ${contains})
          union all
          select 'vehicle', v.id, v.vehicle_number, coalesce(t.name, 'No transporter') || coalesce(' · ' || v.vehicle_type, ''), null,
                 case when upper(v.vehicle_number) = ${exact} then 0 when v.vehicle_number ilike ${prefix} then 1 else 2 end
          from vehicles v left join transporters t on t.id = v.transporter_id
          where ${canSeeTransport} and v.tenant_id = ${actor.tenantId} and v.vehicle_number ilike ${contains}
          union all
          select 'grn', g.id, g.number, coalesce(c.legal_name, c.name) || ' · ' || w.code, g.status,
                 case when upper(g.number) = ${exact} then 0 when g.number ilike ${prefix} then 1 else 2 end
          from grns g join customers c on c.id = g.customer_id join warehouses w on w.id = g.warehouse_id
          where ${canSeeOperations} and g.tenant_id = ${actor.tenantId}
            and (${scope}::uuid[] is null or g.warehouse_id = any(${scope}))
            and (g.number ilike ${contains} or g.invoice_number ilike ${contains} or g.lr_number ilike ${contains})
          union all
          select 'dispatch', d.id, d.number, coalesce(c.legal_name, c.name) || coalesce(' · ' || d.vehicle_number, ''), d.status,
                 case when upper(d.number) = ${exact} then 0 when d.number ilike ${prefix} then 1 else 2 end
          from dispatches d join customers c on c.id = d.customer_id
          where ${canSeeOperations} and d.tenant_id = ${actor.tenantId}
            and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
            and (d.number ilike ${contains} or d.lr_number ilike ${contains} or d.vehicle_number ilike ${contains})
          union all
          select 'gate_pass', gp.id, gp.number, 'Dispatch ' || d.number, gp.status,
                 case when upper(gp.number) = ${exact} then 0 when gp.number ilike ${prefix} then 1 else 2 end
          from gate_passes gp join dispatches d on d.id = gp.dispatch_id
          where ${canSeeOperations} and gp.tenant_id = ${actor.tenantId}
            and (${scope}::uuid[] is null or gp.warehouse_id = any(${scope}))
            and gp.number ilike ${contains}
          union all
          select 'pod', pod.id, pod.number, 'Dispatch ' || d.number || coalesce(' · ' || pod.receiver_name, ''), pod.status,
                 case when upper(pod.number) = ${exact} then 0 when pod.number ilike ${prefix} then 1 else 2 end
          from pods pod join dispatches d on d.id = pod.dispatch_id
          where ${canSeeOperations} and pod.tenant_id = ${actor.tenantId}
            and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
            and (pod.number ilike ${contains} or pod.receiver_name ilike ${contains})
          union all
          select 'invoice', i.id, i.number,
                 coalesce(i.customer_snapshot->>'legal_name', i.customer_snapshot->>'name', '') || ' · ' || i.grand_total::text, i.status,
                 case when upper(i.number) = ${exact} then 0 when i.number ilike ${prefix} then 1 else 2 end
          from invoices i
          where ${canSeeBilling} and i.tenant_id = ${actor.tenantId} and i.number ilike ${contains}
          union all
          select 'document', doc.id, doc.document_number, replace(doc.document_type, '_', ' ') || ' · v' || doc.version_no::text,
                 doc.status_at_generation,
                 case when upper(doc.document_number) = ${exact} then 0 when doc.document_number ilike ${prefix} then 1 else 2 end
          from documents doc
          where doc.tenant_id = ${actor.tenantId} and doc.is_latest
            and (${scope}::uuid[] is null or doc.warehouse_id is null or doc.warehouse_id = any(${scope}))
            and doc.document_number ilike ${contains}
        )
        select * from hits order by rank, type, label limit ${limit}
      `;
      return {
        query: trimmed,
        items: rows.map((r) => ({ type: r.type, id: r.id, label: r.label, summary: r.summary, status: r.status })),
        total: rows.length,
      };
    });
  }
}
