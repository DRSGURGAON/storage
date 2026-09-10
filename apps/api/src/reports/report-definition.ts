import type postgres from 'postgres';
import { WarehouseScope } from '../auth/warehouse-scope';

export const REPORT_GROUPS = ['operations', 'stock', 'billing', 'documents'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

/** Which inputs a report accepts. The client draws exactly these and no more. */
export const REPORT_FILTERS = ['dateRange', 'customerId', 'warehouseId', 'productId', 'status'] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

export interface ReportColumn {
  key: string;
  label: string;
  /** Decides alignment and formatting on the screen, and nothing on the server. */
  type?: 'text' | 'number' | 'money' | 'date' | 'datetime';
  /** Summed into the totals row. Only ever `number` or `money`. */
  total?: boolean;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  customerId?: string;
  warehouseId?: string;
  productId?: string;
  status?: string;
}

export interface ReportContext {
  tenantId: string;
  /** `tenant_users.warehouse_ids`, already resolved. Every report must apply it. */
  scope: WarehouseScope;
  /** Defaults already filled in (a date range that was left open is the last 30 days). */
  filters: ReportFilters;
}

/**
 * Blueprint §55 lists twenty-three reports across four groups. They have
 * one thing in common and one thing only: each is *a query with filters
 * that returns rows*. So a report is data here -- a definition object --
 * rather than a controller method, which is what makes the catalogue
 * endpoint, the CSV export, the permission check and the screen generic
 * instead of twenty-three times over.
 *
 * The rule from `ux-system.md` §3 still holds inside every `run`: a report
 * reads the tables the engines already maintain (`stock_lots`,
 * `stock_ledger`, `invoices`, …) and never recomputes a balance of its
 * own, which could then disagree with the one the application acts on.
 */
export interface ReportDefinition {
  code: string;
  name: string;
  group: ReportGroup;
  /** One sentence, shown under the name. Says what the rows *are*. */
  description: string;
  /** Almost always `view_reports`; a report over money or stock may want its own. */
  permission: string;
  filters: ReportFilter[];
  columns: ReportColumn[];
  run(tx: postgres.TransactionSql, ctx: ReportContext): Promise<Record<string, unknown>[]>;
}
