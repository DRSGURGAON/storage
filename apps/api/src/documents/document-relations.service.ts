import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

interface Edge {
  /** The table holding the foreign key. */
  from: string;
  /** The column on `from`. */
  column: string;
  /** The table it points at. */
  to: string;
}

interface Graph {
  tables: Map<string, { hasStatus: boolean; hasDate: boolean }>;
  /** `stock_ledger.source_type` ('grn') -> table name ('grns'). */
  bySourceType: Map<string, string>;
  /** Keyed by the table holding the FK: where a record says it came from. */
  parents: Map<string, Edge[]>;
  /** Keyed by the referenced table: what points back at a record. */
  children: Map<string, Edge[]>;
}

export interface RelatedRecord {
  type: string;
  id: string;
  number: string;
  status: string | null;
  date: string | null;
  /** The foreign key that ties it to the record being asked about. */
  via: string;
}

/**
 * `document-engine.md` §8 and `ux-system.md` §7: "Created From" and
 * "Related Documents", computed from the foreign-key graph rather than
 * stored. Both documents specified a `getDocumentRelations(documentType,
 * sourceId)` for years and nothing implemented it; this is it.
 *
 * The graph is **discovered from `information_schema`**, not hand-written,
 * which is what §7 asks for ("knows the fixed foreign-key graph implied by
 * `schema/README.md`'s conventions -- not a bespoke query written per
 * document type"). A hand-maintained edge list would be a second source of
 * truth for the schema, and the failure mode is silent: add
 * `return_inwards.grn_id` to the DDL, forget the list, and a whole arm of
 * the chain simply stops appearing with nothing to catch it.
 *
 * Two conventions do the work:
 *
 *   * A **transaction record is a table with a `number` column.** That is
 *     exactly the set with a document number allocated from
 *     `number_series` -- 24 tables today, the same 24 `numbering.md` §6
 *     lists. Masters (customers, products) and line-item tables have no
 *     `number` and are correctly not nodes: nobody wants "Related
 *     Documents" to include a customer.
 *   * An **edge is a foreign key between two of those tables.** Following
 *     it one way gives "Created From", the other way "Related Documents".
 *
 * `billing_runs` is deliberately outside the graph: it has no `number`
 * because it is a preview, not an issued document, so an invoice's
 * "Created From" shows nothing above it. That is a real limitation of the
 * convention, recorded rather than special-cased away.
 */
@Injectable()
export class DocumentRelationsService {
  private graph: Graph | null = null;

  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  /**
   * blueprint §45/§68's lifecycle order. Used only to sort the chain into
   * the sequence a person reads it in -- it decides nothing about which
   * records are found, so a table missing from here still appears, just at
   * the end.
   */
  private static readonly LIFECYCLE_ORDER = [
    'quotations', 'agreements',
    'gate_entries', 'inwards', 'grns', 'inspections', 'discrepancy_reports', 'putaways', 'warehouse_receipts',
    'stock_transfers', 'stock_verifications', 'stock_adjustments',
    'release_orders', 'pick_lists', 'packing_lists', 'dispatches', 'loading_sheets', 'gate_passes', 'pods',
    'return_requests', 'return_inwards',
    'invoices', 'credit_debit_notes', 'payment_receipts',
  ];

  /** Kept small on purpose: a chain is for reading, not for crawling the tenant. */
  private static readonly MAX_CHAIN_RECORDS = 60;

  private async load(): Promise<Graph> {
    if (this.graph) return this.graph;
    const columns = await this.sql<{ table_name: string; has_status: boolean; has_date: boolean }[]>`
      select table_name,
             bool_or(column_name = 'status') as has_status,
             bool_or(column_name in ('grn_date', 'invoice_date', 'request_date', 'dispatch_date', 'entry_date', 'inward_date', 'receipt_date', 'quotation_date', 'transfer_date', 'note_date', 'payment_date', 'order_date', 'verification_date', 'adjustment_date', 'pod_date', 'pass_date', 'sheet_date', 'putaway_date', 'report_date', 'inspection_date', 'agreement_date', 'pick_date', 'pack_date')) as has_date
      from information_schema.columns
      where table_schema = 'public'
      group by table_name
      having bool_or(column_name = 'number')
    `;
    const tables = new Map(columns.map((c) => [c.table_name, { hasStatus: c.has_status, hasDate: c.has_date }]));
    const names = [...tables.keys()];
    const fks = await this.sql<{ from_table: string; from_column: string; to_table: string }[]>`
      select kcu.table_name as from_table, kcu.column_name as from_column, ccu.table_name as to_table
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
        and kcu.table_name = any(${names}) and ccu.table_name = any(${names})
    `;
    const parents = new Map<string, Edge[]>();
    const children = new Map<string, Edge[]>();
    for (const fk of fks) {
      const edge: Edge = { from: fk.from_table, column: fk.from_column, to: fk.to_table };
      parents.set(edge.from, [...(parents.get(edge.from) ?? []), edge]);
      children.set(edge.to, [...(children.get(edge.to) ?? []), edge]);
    }
    // `stock_ledger.source_type` names a record in the singular ('grn',
    // 'dispatch'); the graph is keyed by table. Derived rather than listed,
    // for the same reason the edges are.
    const bySourceType = new Map<string, string>();
    for (const table of names) bySourceType.set(DocumentRelationsService.singular(table), table);

    this.graph = { tables, bySourceType, parents, children };
    return this.graph;
  }

  /** The set of record types this endpoint understands, for a 404 that can say so. */
  async knownTypes(): Promise<string[]> {
    return [...(await this.load()).tables.keys()].sort();
  }

  async relations(actor: AuthenticatedUser, requestedType: string, sourceId: string) {
    const graph = await this.load();
    // Either spelling works. `documents.document_type` is singular ('grn')
    // and the graph is keyed by table ('grns'), so a client walking from a
    // document row to its relations has the singular in hand and should not
    // have to know how to pluralise 'dispatch'.
    const sourceType = graph.tables.has(requestedType)
      ? requestedType
      : (graph.bySourceType.get(requestedType) ?? requestedType);
    const meta = graph.tables.get(sourceType);
    if (!meta) {
      throw new BadRequestException(
        `'${requestedType}' is not a record type with documents. Known types: ${(await this.knownTypes()).join(', ')}`,
      );
    }

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const record = await this.fetch(tx, actor.tenantId, sourceType, sourceId);
      if (!record) throw new NotFoundException('Record not found');

      const createdFrom: RelatedRecord[] = [];
      for (const edge of graph.parents.get(sourceType) ?? []) {
        // A self-referencing key (a revision, a reversal) is a relation, not a
        // parent in the lifecycle sense -- but it is the single most useful
        // thing to see on a superseded record, so it is kept.
        const [row] = await tx<{ id: string }[]>`
          select ${tx.unsafe(edge.column)} as id from ${tx.unsafe(sourceType)}
          where id = ${sourceId} and tenant_id = ${actor.tenantId}
        `;
        if (!row?.id) continue;
        const parent = await this.fetch(tx, actor.tenantId, edge.to, row.id);
        if (parent) createdFrom.push({ ...parent, via: edge.column });
      }

      const related: RelatedRecord[] = [];
      for (const edge of graph.children.get(sourceType) ?? []) {
        const rows = await this.fetchBy(tx, actor.tenantId, edge.from, edge.column, sourceId);
        for (const row of rows) related.push({ ...row, via: `${edge.from}.${edge.column}` });
      }

      // The record's own generated documents -- the third panel of §7, and the
      // only part of this that reads the `documents` table at all.
      //
      // Keyed on `source_id` alone: `documents` has no `source_type` column,
      // because `document_type` already implies it and a source id is a uuid.
      // One record can still carry documents of more than one type (a GRN and
      // its Discrepancy Report share a source), which is why they are returned
      // with their type rather than assumed to be one kind.
      const documents = await tx<Record<string, any>[]>`
        select id, document_type, document_number, version_no, is_latest, generated_at, qr_token
        from documents
        where tenant_id = ${actor.tenantId} and source_id = ${sourceId}
        order by generated_at desc
      `;

      return {
        record,
        createdFrom,
        related,
        documents: documents.map((d) => ({
          id: d.id, documentType: d.document_type, documentNumber: d.document_number,
          versionNo: d.version_no, isLatest: d.is_latest, generatedAt: d.generated_at, qrToken: d.qr_token,
        })),
        chain: await this.chain(tx, actor.tenantId, graph, sourceType, sourceId),
      };
    });
  }

  /**
   * §7's Document Timeline: the whole connected component this record sits
   * in, walked in both directions and sorted into blueprint §68's order --
   * so a POD shows the gate entry the goods arrived on, five hops back,
   * without the caller knowing the path.
   *
   * Bounded, and visibly so. A gate entry with fifty inwards under it is a
   * legitimate shape, and an unbounded walk from one of those inwards would
   * pull in every GRN, put-away and receipt of all fifty. `truncated: true`
   * says the timeline is partial rather than pretending it is complete.
   */
  private async chain(
    tx: postgres.TransactionSql,
    tenantId: string,
    graph: Graph,
    startType: string,
    startId: string,
  ) {
    const seen = new Set<string>([`${startType}:${startId}`]);
    const found: RelatedRecord[] = [];
    let frontier: { type: string; id: string }[] = [{ type: startType, id: startId }];
    let truncated = false;

    while (frontier.length && !truncated) {
      const next: { type: string; id: string }[] = [];
      for (const node of frontier) {
        const neighbours: { type: string; id: string; via: string }[] = [];
        for (const edge of graph.parents.get(node.type) ?? []) {
          const [row] = await tx<{ id: string }[]>`
            select ${tx.unsafe(edge.column)} as id from ${tx.unsafe(node.type)}
            where id = ${node.id} and tenant_id = ${tenantId}
          `;
          if (row?.id) neighbours.push({ type: edge.to, id: row.id, via: edge.column });
        }
        for (const edge of graph.children.get(node.type) ?? []) {
          const rows = await tx<{ id: string }[]>`
            select id from ${tx.unsafe(edge.from)}
            where ${tx.unsafe(edge.column)} = ${node.id} and tenant_id = ${tenantId}
          `;
          for (const row of rows) neighbours.push({ type: edge.from, id: row.id, via: `${edge.from}.${edge.column}` });
        }
        neighbours.push(...(await this.stockNeighbours(tx, tenantId, node)));
        for (const neighbour of neighbours) {
          const key = `${neighbour.type}:${neighbour.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (found.length >= DocumentRelationsService.MAX_CHAIN_RECORDS) {
            truncated = true;
            break;
          }
          const record = await this.fetch(tx, tenantId, neighbour.type, neighbour.id);
          if (!record) continue;
          found.push({ ...record, via: neighbour.via });
          next.push({ type: neighbour.type, id: neighbour.id });
        }
        if (truncated) break;
      }
      frontier = next;
    }

    const order = DocumentRelationsService.LIFECYCLE_ORDER;
    const rank = (type: string) => {
      const at = order.indexOf(type);
      return at === -1 ? order.length : at;
    };
    found.sort((a, b) => rank(a.type) - rank(b.type) || a.number.localeCompare(b.number));
    return { records: found, truncated };
  }

  /** 'dispatches' -> 'dispatch', 'putaways' -> 'putaway', 'grns' -> 'grn'. */
  private static singular(table: string): string {
    if (table.endsWith('ies')) return `${table.slice(0, -3)}y`;
    if (/(s|x|z|ch|sh)es$/.test(table)) return table.slice(0, -2);
    return table.replace(/s$/, '');
  }

  /**
   * The one edge blueprint §68's lifecycle has that the foreign keys do
   * not: **the goods themselves**.
   *
   * A Release Order does not reference the GRN the stock arrived on, and
   * it should not -- what was received and what is shipped are separate
   * events, joined by the balance in between. So the FK graph is genuinely
   * two components, inbound and outbound, and a timeline that stopped at
   * the release order would be correct and useless: "where did these goods
   * come from" is the first thing anyone asks of a dispatch.
   *
   * `stock_ledger` is the join, and it is the honest one: two records are
   * linked if they moved the *same goods* -- the same customer's, in the
   * same warehouse, of the same product and batch. That is provenance, not
   * a guess. It is deliberately kept out of `related` (which stays strictly
   * foreign-key, as `ux-system.md` §7 specifies) and used only to walk the
   * chain, where it is labelled `via: 'stock_ledger'` so a reader can see
   * that this hop is different in kind from the others.
   */
  private async stockNeighbours(
    tx: postgres.TransactionSql,
    tenantId: string,
    node: { type: string; id: string },
  ): Promise<{ type: string; id: string; via: string }[]> {
    const graph = this.graph!;
    const sourceType = DocumentRelationsService.singular(node.type);
    const rows = await tx<{ source_type: string; source_id: string }[]>`
      select distinct peer.source_type, peer.source_id
      from stock_ledger mine
      join stock_ledger peer
        on peer.tenant_id = mine.tenant_id
       and peer.customer_id is not distinct from mine.customer_id
       and peer.warehouse_id is not distinct from mine.warehouse_id
       and peer.product_id = mine.product_id
       and peer.batch_id is not distinct from mine.batch_id
      where mine.tenant_id = ${tenantId}
        and mine.source_type = ${sourceType} and mine.source_id = ${node.id}
        and peer.source_id <> mine.source_id
      limit 40
    `;
    const neighbours: { type: string; id: string; via: string }[] = [];
    for (const row of rows) {
      const table = graph.bySourceType.get(row.source_type);
      // 'test' and anything else not a document-bearing record is skipped
      // rather than guessed at.
      if (table) neighbours.push({ type: table, id: row.source_id, via: 'stock_ledger' });
    }
    return neighbours;
  }

  private async fetch(
    tx: postgres.TransactionSql,
    tenantId: string,
    table: string,
    id: string,
  ): Promise<Omit<RelatedRecord, 'via'> | null> {
    const rows = await this.select(tx, tenantId, table, 'id', id);
    return rows[0] ?? null;
  }

  private fetchBy(tx: postgres.TransactionSql, tenantId: string, table: string, column: string, value: string) {
    return this.select(tx, tenantId, table, column, value);
  }

  /**
   * One projection for every node type: id, number, and status where the
   * table has one (`packing_lists` does not). Table and column names come
   * from `information_schema`, never from the request -- the request's
   * `sourceType` is checked against the graph's keys before anything is
   * interpolated.
   */
  private async select(
    tx: postgres.TransactionSql,
    tenantId: string,
    table: string,
    keyColumn: string,
    keyValue: string,
  ): Promise<Omit<RelatedRecord, 'via'>[]> {
    const graph = this.graph!;
    const meta = graph.tables.get(table);
    if (!meta) return [];
    const status = meta.hasStatus ? tx.unsafe('status') : tx.unsafe('null::text as status');
    const rows = await tx<{ id: string; number: string; status: string | null; created_at: Date | null }[]>`
      select id, number, ${status}, created_at from ${tx.unsafe(table)}
      where ${tx.unsafe(keyColumn)} = ${keyValue} and tenant_id = ${tenantId}
      order by number
    `;
    return rows.map((r) => ({
      type: table,
      id: r.id,
      number: r.number,
      status: r.status,
      date: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
  }
}
