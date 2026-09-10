import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import {
  DOCUMENT_TYPE_PREFIXES,
  SERIES_DEFAULT_OVERRIDES,
  SeriesDefaults,
  TABLE_DEFAULTS,
} from './numbering-defaults';

interface SeriesRow {
  id: string;
  document_type: string;
  warehouse_id: string | null;
  prefix: string;
  format: string;
  fy_style: string;
  reset_policy: string;
  padding: number;
  next_seq: string;
  period_key: string | null;
  warehouse_name: string | null;
}

export interface UpdateSeries {
  prefix?: string;
  format?: string;
  fyStyle?: string;
  resetPolicy?: string;
  padding?: number;
  nextSeq?: number;
}

/**
 * numbering.md §2: "Tenants may edit `prefix`/`format`/`padding`/starting
 * number per document type from Settings." The engine has always read
 * those columns; nothing could write them, and a tenant that wanted `GR/`
 * instead of `GRN/` had no way to say so. `number_series` rows are also
 * created lazily by the first allocation, so before a document type has
 * ever been used there is no row to show -- which is why this lists every
 * known document type and says which are configured and which would be
 * created with the shipped defaults.
 *
 * One rule decides the shape of the write path: **the next number may be
 * raised, never lowered.** Every numbered table has `unique (tenant_id,
 * number)`, so a lowered counter does not quietly re-issue -- it collides,
 * at some unrelated user's save, minutes or weeks later. Raising it is a
 * legitimate and common need (migrating from an old system that already
 * printed up to INV/26-27/004120).
 */
@Injectable()
export class NumberSeriesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser) {
    const rows = await withTenant(this.sql, actor.tenantId, (tx) => tx<SeriesRow[]>`
      select s.id, s.document_type, s.warehouse_id, s.prefix, s.format, s.fy_style, s.reset_policy,
             s.padding, s.next_seq, s.period_key, w.name as warehouse_name
      from number_series s
      left join warehouses w on w.id = s.warehouse_id
      where s.tenant_id = ${actor.tenantId}
      order by s.document_type, w.name nulls first
    `);

    const configured = rows.map(toApi);
    const seen = new Set(configured.filter((s) => s.warehouseId === null).map((s) => s.documentType));

    // Every document type this application can number, whether or not it
    // has been used yet. A settings screen that only listed the six series
    // a young workspace happens to have would hide the twenty it is about
    // to create.
    const unused = Object.keys(DOCUMENT_TYPE_PREFIXES)
      .filter((documentType) => !seen.has(documentType))
      .map((documentType) => {
        const defaults = defaultsFor(documentType);
        return {
          id: null,
          documentType,
          warehouseId: null,
          warehouseName: null,
          prefix: DOCUMENT_TYPE_PREFIXES[documentType],
          ...defaults,
          nextSeq: 1,
          periodKey: null,
          /** No row exists yet: these are the values the first allocation would create. */
          isConfigured: false,
        };
      });

    return [...configured, ...unused].sort((a, b) => a.documentType.localeCompare(b.documentType));
  }

  async update(actor: AuthenticatedUser, documentType: string, dto: UpdateSeries, ipAddress?: string) {
    if (!DOCUMENT_TYPE_PREFIXES[documentType]) {
      throw new BadRequestException(`'${documentType}' is not a document type this application numbers`);
    }
    if (dto.format !== undefined && !dto.format.includes('{seq')) {
      throw new BadRequestException(
        'The format must contain {seq} (or {seq:n}) — without a running number, every document would be numbered the same',
      );
    }

    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      // The tenant-wide series (no warehouse). Per-warehouse series exist
      // and are shown, but are created by allocation against a warehouse;
      // editing one is not offered until someone needs it.
      const [before] = await tx<SeriesRow[]>`
        select s.id, s.document_type, s.warehouse_id, s.prefix, s.format, s.fy_style, s.reset_policy,
               s.padding, s.next_seq, s.period_key, null as warehouse_name
        from number_series s
        where s.tenant_id = ${actor.tenantId} and s.document_type = ${documentType} and s.warehouse_id is null
        for update
      `;

      if (before && dto.nextSeq !== undefined && dto.nextSeq < Number(before.next_seq)) {
        throw new BadRequestException(
          `The next number can be raised but not lowered: this series is already at ${before.next_seq}, and re-issuing a number that has been printed collides with the document that carries it`,
        );
      }

      const defaults = defaultsFor(documentType);
      // `padding` and the format's own `{seq:6}` are two places to say the
      // same thing, and the format wins at render time -- so setting
      // padding to 4 against the shipped `{prefix}/{fy}/{seq:6}` silently
      // did nothing. Changing one changes the other: the width is a single
      // setting, whichever field the caller used to say it.
      const format = dto.format ?? before?.format ?? defaults.format;
      const padding = dto.padding ?? before?.padding ?? defaults.padding;
      const alignedFormat =
        dto.padding !== undefined ? format.replace(/\{seq(?::\d+)?\}/, `{seq:${padding}}`) : format;

      const next = {
        prefix: dto.prefix ?? before?.prefix ?? DOCUMENT_TYPE_PREFIXES[documentType],
        format: alignedFormat,
        fy_style: dto.fyStyle ?? before?.fy_style ?? defaults.fyStyle,
        reset_policy: dto.resetPolicy ?? before?.reset_policy ?? defaults.resetPolicy,
        padding,
        next_seq: dto.nextSeq ?? Number(before?.next_seq ?? 1),
      };

      if (before) {
        await tx`
          update number_series set ${tx(next)}
          where id = ${before.id} and tenant_id = ${actor.tenantId}
        `;
      } else {
        // Created here rather than waiting for the first allocation, so a
        // workspace can set its prefixes on day one -- which is the whole
        // point of the screen.
        await tx`
          insert into number_series (id, tenant_id, document_type, warehouse_id, prefix, format, fy_style, reset_policy, padding, next_seq)
          values (${randomUUID()}, ${actor.tenantId}, ${documentType}, null, ${next.prefix}, ${next.format},
                  ${next.fy_style}, ${next.reset_policy}, ${next.padding}, ${next.next_seq})
        `;
      }

      const [after] = await tx<SeriesRow[]>`
        select s.id, s.document_type, s.warehouse_id, s.prefix, s.format, s.fy_style, s.reset_policy,
               s.padding, s.next_seq, s.period_key, null as warehouse_name
        from number_series s
        where s.tenant_id = ${actor.tenantId} and s.document_type = ${documentType} and s.warehouse_id is null
      `;
      return { before, after };
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: result.before ? 'update' : 'create',
      entityType: 'number_series',
      entityId: result.after.id,
      previousValue: result.before ? toApi(result.before) : undefined,
      newValue: toApi(result.after),
      ipAddress,
    });
    return toApi(result.after);
  }
}

function defaultsFor(documentType: string): SeriesDefaults {
  return SERIES_DEFAULT_OVERRIDES[documentType] ?? TABLE_DEFAULTS;
}

function toApi(row: SeriesRow) {
  return {
    id: row.id,
    documentType: row.document_type,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    prefix: row.prefix,
    format: row.format,
    fyStyle: row.fy_style,
    resetPolicy: row.reset_policy,
    padding: row.padding,
    /** The number the *next* document of this type will carry. */
    nextSeq: Number(row.next_seq),
    periodKey: row.period_key,
    isConfigured: true,
  };
}
