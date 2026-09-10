import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import {
  DOCUMENT_TYPE_PREFIXES,
  SERIES_DEFAULT_OVERRIDES,
  TABLE_DEFAULTS,
} from './numbering-defaults';

interface SeriesRow {
  id: string;
  prefix: string;
  format: string;
  fy_style: 'YY-YY' | 'YYYY-YY' | 'YYYY' | 'NONE';
  reset_policy: 'never' | 'yearly' | 'monthly';
  padding: number;
  next_seq: string; // bigint column -- postgres.js returns it as a string, see the Number() conversion below
  period_key: string | null;
}

/**
 * numbering.md §1: "Do not generate document numbers independently in
 * every module." One function, called everywhere a document number is
 * needed -- no insert path computes its own `number` column inline.
 *
 * The FOR UPDATE row lock (not an application mutex) is what makes
 * concurrent allocation safe under concurrent requests and multiple app
 * instances (numbering.md §4) -- the same discipline as
 * entitlement-engine.md's usage_counters lock.
 */
@Injectable()
export class NumberingService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async allocateNumber(
    tenantId: string,
    documentType: string,
    warehouseId?: string,
  ): Promise<string> {
    return withTenant(this.sql, tenantId, (tx) =>
      this.allocateNumberIn(tx, tenantId, documentType, warehouseId),
    );
  }

  /**
   * numbering.md §4: the caller inserts its row in the *same* transaction
   * that reserved the number, so a later rollback leaves a gap in the
   * sequence rather than a duplicate. Callers already inside withTenant()
   * use this; allocateNumber() is the convenience wrapper.
   */
  async allocateNumberIn(
    tx: postgres.TransactionSql,
    tenantId: string,
    documentType: string,
    warehouseId?: string,
  ): Promise<string> {
    const defaultPrefix = DOCUMENT_TYPE_PREFIXES[documentType];
    if (!defaultPrefix) {
      throw new Error(
        `No default prefix configured for document type "${documentType}" -- add one to numbering-defaults.ts`,
      );
    }

    {
      // Lazy series creation: the first allocation for a (tenant,
      // document_type[, warehouse]) creates its series with the canonical
      // default prefix. ON CONFLICT DO NOTHING makes two concurrent first
      // allocations serialize around the unique index instead of racing
      // to create two competing series (schema/93_number_series_null_warehouse_fix.sql
      // is what makes the null-warehouse case -- the common one -- actually
      // enforce that).
      const d = SERIES_DEFAULT_OVERRIDES[documentType] ?? TABLE_DEFAULTS;
      if (warehouseId) {
        await tx`
          insert into number_series
            (id, tenant_id, document_type, warehouse_id, prefix, format, fy_style, reset_policy, padding)
          values
            (gen_random_uuid(), ${tenantId}, ${documentType}, ${warehouseId}, ${defaultPrefix},
             ${d.format}, ${d.fyStyle}, ${d.resetPolicy}, ${d.padding})
          on conflict (tenant_id, document_type, warehouse_id) do nothing
        `;
      } else {
        await tx`
          insert into number_series
            (id, tenant_id, document_type, warehouse_id, prefix, format, fy_style, reset_policy, padding)
          values
            (gen_random_uuid(), ${tenantId}, ${documentType}, null, ${defaultPrefix},
             ${d.format}, ${d.fyStyle}, ${d.resetPolicy}, ${d.padding})
          on conflict (tenant_id, document_type) where warehouse_id is null do nothing
        `;
      }

      const [series] = await tx<SeriesRow[]>`
        select id, prefix, format, fy_style, reset_policy, padding, next_seq, period_key
        from number_series
        where tenant_id = ${tenantId} and document_type = ${documentType}
          and warehouse_id is not distinct from ${warehouseId ?? null}
        for update
      `;

      const [tenantRow] = await tx<{ financial_year_start_month: number }[]>`
        select financial_year_start_month from tenants where id = ${tenantId}
      `;
      const fyStartMonth = tenantRow.financial_year_start_month;
      const now = new Date();

      // period_key tracks reset_policy's own granularity (yearly -> FY,
      // monthly -> calendar month, never -> a constant) -- deliberately
      // independent of fy_style, which only controls what {fy} looks like
      // in the printed number. A tenant can want yearly-reset numbering
      // that still only ever prints a bare calendar year, or vice versa.
      const resetKey = resetPeriodKeyFor(series.reset_policy, fyStartMonth, now);
      // postgres.js returns a `bigint` column as a JS string, not a
      // number, to avoid silent precision loss above Number.MAX_SAFE_INTEGER
      // -- real for this column type, but irrelevant at document-numbering
      // scale, so it's converted once here rather than carried as a string
      // into arithmetic (which would silently concatenate: "2" + 1 -> "21").
      const storedNextSeq = Number(series.next_seq);
      const seq = series.period_key === resetKey ? storedNextSeq : 1;

      const fySegment = fyDisplaySegment(series.fy_style, fyStartMonth, now);
      const formatted = renderFormat(series.format, series.prefix, fySegment, seq, series.padding);

      await tx`
        update number_series
        set next_seq = ${seq + 1}, period_key = ${resetKey}
        where id = ${series.id}
      `;

      return formatted;
    }
  }
}

function fyStartYearFor(fyStartMonth: number, now: Date): number {
  const month = now.getUTCMonth() + 1;
  return month >= fyStartMonth ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function pad2(n: number): string {
  return String(((n % 100) + 100) % 100).padStart(2, '0');
}

function fyDisplaySegment(
  fyStyle: SeriesRow['fy_style'],
  fyStartMonth: number,
  now: Date,
): string {
  if (fyStyle === 'NONE') return '';
  const fyStartYear = fyStartYearFor(fyStartMonth, now);
  if (fyStyle === 'YY-YY') return `${pad2(fyStartYear)}-${pad2(fyStartYear + 1)}`;
  if (fyStyle === 'YYYY-YY') return `${fyStartYear}-${pad2(fyStartYear + 1)}`;
  return `${fyStartYear}`; // 'YYYY'
}

function resetPeriodKeyFor(
  resetPolicy: SeriesRow['reset_policy'],
  fyStartMonth: number,
  now: Date,
): string {
  if (resetPolicy === 'yearly') return `fy-${fyStartYearFor(fyStartMonth, now)}`;
  if (resetPolicy === 'monthly') {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return 'never';
}

function renderFormat(
  format: string,
  prefix: string,
  fySegment: string,
  seq: number,
  defaultPadding: number,
): string {
  return format
    .replace('{prefix}', prefix)
    .replace('{fy}', fySegment)
    .replace(/\{seq(?::(\d+))?\}/, (_match, explicitPadding?: string) =>
      String(seq).padStart(explicitPadding ? Number(explicitPadding) : defaultPadding, '0'),
    );
}
