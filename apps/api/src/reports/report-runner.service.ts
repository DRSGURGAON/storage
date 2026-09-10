import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { hasPermission } from '../auth/has-permission';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { DOCUMENT_REPORTS } from './catalogue/documents.reports';
import { OPERATIONS_REPORTS } from './catalogue/operations.reports';
import { ReportDefinition, ReportFilters } from './report-definition';

const DEFINITIONS: ReportDefinition[] = [...OPERATIONS_REPORTS, ...DOCUMENT_REPORTS];

const BY_CODE = new Map(DEFINITIONS.map((report) => [report.code, report]));

/** A month back, which is what "the report" usually means when nobody says. */
const DEFAULT_DAYS = 30;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Runs blueprint §55's reports and answers what exists.
 *
 * Two things are deliberately generic. The **catalogue** is filtered by
 * what the caller may actually run, so a Billing Executive is not offered
 * a stock report they would then be refused -- the same "offer only what
 * is permitted" rule the UI follows, applied at the source. And the
 * **CSV** is produced from the same rows and columns the screen shows,
 * rather than a second query written for export, which is how an export
 * quietly stops matching the report it is named after.
 */
@Injectable()
export class ReportRunnerService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async catalogue(actor: AuthenticatedUser) {
    const granted = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const codes = [...new Set(DEFINITIONS.map((report) => report.permission))];
      const checks = await Promise.all(codes.map((code) => hasPermission(tx, actor, code)));
      return new Set(codes.filter((_, index) => checks[index]));
    });

    return DEFINITIONS.filter((report) => granted.has(report.permission)).map((report) => ({
      code: report.code,
      name: report.name,
      group: report.group,
      description: report.description,
      filters: report.filters,
      columns: report.columns,
    }));
  }

  async run(actor: AuthenticatedUser, code: string, filters: ReportFilters) {
    const report = BY_CODE.get(code);
    if (!report) throw new NotFoundException(`No report called '${code}'`);

    const applied = this.applyDefaults(report, filters);
    const rows = await withTenant(this.sql, actor.tenantId, async (tx) => {
      if (!(await hasPermission(tx, actor, report.permission))) {
        throw new ForbiddenException(`Missing permission: ${report.permission}`);
      }
      const scope = await loadWarehouseScope(tx, actor);
      return report.run(tx, { tenantId: actor.tenantId, scope, filters: applied });
    });

    return {
      code: report.code,
      name: report.name,
      group: report.group,
      description: report.description,
      columns: report.columns,
      filters: applied,
      rows,
      totals: this.totals(report, rows),
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
    };
  }

  /** The same rows the screen shows, as text. `export_reports`, checked by the controller. */
  async csv(actor: AuthenticatedUser, code: string, filters: ReportFilters) {
    const result = await this.run(actor, code, filters);
    const header = result.columns.map((column) => column.label);
    const lines = [
      toCsvRow(header),
      ...result.rows.map((row) => toCsvRow(result.columns.map((column) => row[column.key]))),
    ];
    return { fileName: `${result.code}-${result.filters.from ?? 'all'}-to-${result.filters.to ?? 'now'}.csv`, csv: lines.join('\r\n') };
  }

  private applyDefaults(report: ReportDefinition, filters: ReportFilters): ReportFilters {
    const applied: ReportFilters = {};
    for (const filter of report.filters) {
      if (filter === 'dateRange') {
        const to = filters.to ?? isoDate(new Date());
        const from = filters.from ?? isoDate(new Date(Date.parse(to) - DEFAULT_DAYS * 86400 * 1000));
        if (Date.parse(from) > Date.parse(to)) {
          throw new BadRequestException('The "from" date is after the "to" date');
        }
        Object.assign(applied, { from, to });
      } else if (filters[filter] !== undefined) {
        // A filter a report does not declare is dropped rather than
        // refused: the client asks for a report and passes what it has,
        // and silently narrowing by something the query ignores would be
        // worse than ignoring it visibly (the response echoes `filters`).
        Object.assign(applied, { [filter]: filters[filter] });
      }
    }
    return applied;
  }

  private totals(report: ReportDefinition, rows: Record<string, unknown>[]) {
    const columns = report.columns.filter((column) => column.total);
    if (columns.length === 0 || rows.length === 0) return null;
    const totals: Record<string, number> = {};
    for (const column of columns) {
      totals[column.key] = rows.reduce((sum, row) => sum + Number(row[column.key] ?? 0), 0);
    }
    return totals;
  }
}

/** RFC 4180: quote anything containing a comma, a quote or a newline; double the quotes inside. */
function toCsvRow(values: unknown[]): string {
  return values
    .map((value) => {
      if (value === null || value === undefined) return '';
      const text = value instanceof Date ? value.toISOString() : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(',');
}
