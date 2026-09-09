import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateRateCardDto } from './dto/create-rate-card.dto';
import { ListRateCardsQuery } from './dto/list-rate-cards.query';
import { UpdateRateCardDto } from './dto/update-rate-card.dto';

export interface RateCardRow {
  id: string;
  code: string;
  name: string;
  scope: string;
  customer_id: string | null;
  warehouse_id: string | null;
  currency: string;
  valid_from: string;
  valid_to: string | null;
  status: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `
  id, code, name, scope, customer_id, warehouse_id, currency, valid_from, valid_to,
  status, notes, created_at, updated_at`;

function toApi(row: RateCardRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    scope: row.scope,
    customerId: row.customer_id,
    warehouseId: row.warehouse_id,
    currency: row.currency,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Blueprint §13; billing-engine.md §3's resolution priority reads from
 * this table. schema/10_masters.sql's check constraint enforces the
 * scope/id pairing at the database level; this service enforces the same
 * rule earlier, as a clean 400 instead of a raw constraint-violation 500,
 * and additionally rejects the *wrong* id being set for a scope (the
 * check constraint alone would silently allow e.g. a 'company' card with
 * a customer_id set).
 */
@Injectable()
export class RateCardsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  private async normalizeScope(
    tx: postgres.TransactionSql,
    tenantId: string,
    scope: string,
    customerId: string | null,
    warehouseId: string | null,
  ): Promise<{ customerId: string | null; warehouseId: string | null }> {
    if (scope === 'customer') {
      if (!customerId) throw new BadRequestException("customerId is required when scope is 'customer'");
      const [customer] = await tx`select 1 from customers where id = ${customerId} and tenant_id = ${tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');
      if (warehouseId) {
        const [warehouse] = await tx`select 1 from warehouses where id = ${warehouseId} and tenant_id = ${tenantId}`;
        if (!warehouse) throw new NotFoundException('Warehouse not found');
      }
      return { customerId, warehouseId: warehouseId ?? null };
    }
    if (scope === 'warehouse') {
      if (!warehouseId) throw new BadRequestException("warehouseId is required when scope is 'warehouse'");
      if (customerId) throw new BadRequestException("customerId must not be set when scope is 'warehouse'");
      const [warehouse] = await tx`select 1 from warehouses where id = ${warehouseId} and tenant_id = ${tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      return { customerId: null, warehouseId };
    }
    // scope === 'company'
    if (customerId || warehouseId) {
      throw new BadRequestException("customerId/warehouseId must not be set when scope is 'company'");
    }
    return { customerId: null, warehouseId: null };
  }

  async create(actor: AuthenticatedUser, dto: CreateRateCardDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const { customerId, warehouseId } = await this.normalizeScope(
        tx,
        actor.tenantId,
        dto.scope,
        dto.customerId ?? null,
        dto.warehouseId ?? null,
      );
      const [inserted] = await tx<RateCardRow[]>`
        insert into rate_cards (
          id, tenant_id, code, name, scope, customer_id, warehouse_id, currency,
          valid_from, valid_to, status, notes, created_by, updated_by
        ) values (
          ${randomUUID()}, ${actor.tenantId}, ${dto.code}, ${dto.name}, ${dto.scope},
          ${customerId}, ${warehouseId}, ${dto.currency ?? 'INR'},
          ${dto.validFrom}, ${dto.validTo ?? null}, ${dto.status ?? 'draft'}, ${dto.notes ?? null},
          ${actor.userId}, ${actor.userId}
        )
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return inserted;
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Rate card ${dto.code} already exists`);
      }
      throw err;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'rate_card',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, query: ListRateCardsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const scopeFilter = query.scope ?? null;
    const statusFilter = query.status ?? null;
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<RateCardRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from rate_cards
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or code ilike ${pattern} or name ilike ${pattern})
          and (${scopeFilter}::text is null or scope = ${scopeFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
        order by code
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from rate_cards
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or code ilike ${pattern} or name ilike ${pattern})
          and (${scopeFilter}::text is null or scope = ${scopeFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [found] = await tx<RateCardRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from rate_cards
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      return found;
    });
    if (!row) throw new NotFoundException('Rate card not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateRateCardDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<RateCardRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from rate_cards
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;

      const effectiveScope = dto.scope ?? before.scope;
      const effectiveCustomerId = dto.customerId !== undefined ? dto.customerId : before.customer_id;
      const effectiveWarehouseId = dto.warehouseId !== undefined ? dto.warehouseId : before.warehouse_id;
      const { customerId, warehouseId } = await this.normalizeScope(
        tx,
        actor.tenantId,
        effectiveScope,
        effectiveCustomerId ?? null,
        effectiveWarehouseId ?? null,
      );

      const [after] = await tx<RateCardRow[]>`
        update rate_cards
        set code = ${dto.code ?? before.code},
            name = ${dto.name ?? before.name},
            scope = ${effectiveScope},
            customer_id = ${customerId},
            warehouse_id = ${warehouseId},
            currency = ${dto.currency ?? before.currency},
            valid_from = ${dto.validFrom ?? before.valid_from},
            valid_to = ${dto.validTo !== undefined ? dto.validTo : before.valid_to},
            status = ${dto.status ?? before.status},
            notes = ${dto.notes !== undefined ? dto.notes : before.notes},
            updated_by = ${actor.userId},
            updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('That rate card code already exists');
      }
      throw err;
    });
    if (!result) throw new NotFoundException('Rate card not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'rate_card',
      entityId: id,
      previousValue: result.before,
      newValue: result.after,
      ipAddress,
    });
    return toApi(result.after);
  }

  /** Used by RateCardLinesService to confirm the parent card belongs to this tenant. */
  async exists(tx: postgres.TransactionSql, tenantId: string, id: string): Promise<boolean> {
    const [row] = await tx`select 1 from rate_cards where id = ${id} and tenant_id = ${tenantId}`;
    return Boolean(row);
  }
}
