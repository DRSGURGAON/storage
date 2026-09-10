import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { ChargeTypesService } from './charge-types.service';
import { CreateRateCardLineDto } from './dto/create-rate-card-line.dto';
import { UpdateRateCardLineDto } from './dto/update-rate-card-line.dto';
import { RateCardsService } from './rate-cards.service';
import { TaxRatesService } from './tax-rates.service';

export interface RateCardLineRow {
  id: string;
  rate_card_id: string;
  charge_type_id: string;
  basis: string;
  uom_code: string | null;
  rate: string;
  minimum_charge: string | null;
  free_days: number;
  slab_from: string | null;
  slab_to: string | null;
  product_id: string | null;
  category_id: string | null;
  tax_rate_id: string | null;
  sac_code: string | null;
  description: string | null;
  sort_order: number;
  /** Joined on the read path only -- a line is stored by id, and read with the name a human recognises. */
  charge_type_code?: string;
  charge_type_name?: string;
}

const SELECT_COLUMNS = `
  id, rate_card_id, charge_type_id, basis, uom_code, rate, minimum_charge, free_days,
  slab_from, slab_to, product_id, category_id, tax_rate_id, sac_code, description, sort_order`;

/** Exported for RateCardResolutionService, which returns the same shape for a resolved line. */
export function toApi(row: RateCardLineRow) {
  return {
    id: row.id,
    rateCardId: row.rate_card_id,
    chargeTypeId: row.charge_type_id,
    basis: row.basis,
    uomCode: row.uom_code,
    rate: Number(row.rate),
    minimumCharge: row.minimum_charge === null ? null : Number(row.minimum_charge),
    freeDays: row.free_days,
    slabFrom: row.slab_from === null ? null : Number(row.slab_from),
    slabTo: row.slab_to === null ? null : Number(row.slab_to),
    productId: row.product_id,
    categoryId: row.category_id,
    taxRateId: row.tax_rate_id,
    sacCode: row.sac_code,
    description: row.description,
    sortOrder: row.sort_order,
    // A rate card line is meaningless without the charge it prices, and
    // `chargeTypeId` alone means the screen shows a blank column or has to
    // fetch every charge type to translate one id. Present on the reads,
    // absent on a write's echo, which is why they are optional.
    ...(row.charge_type_code !== undefined
      ? { chargeTypeCode: row.charge_type_code, chargeTypeName: row.charge_type_name }
      : {}),
  };
}

/** Blueprint §13: the priced lines within a rate card, resolved by billing-engine.md §3. */
@Injectable()
export class RateCardLinesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly rateCards: RateCardsService,
    private readonly chargeTypes: ChargeTypesService,
    private readonly taxRates: TaxRatesService,
    private readonly audit: AuditService,
  ) {}

  private async validateReferences(
    tx: postgres.TransactionSql,
    tenantId: string,
    dto: Partial<CreateRateCardLineDto>,
  ) {
    if (dto.chargeTypeId && !(await this.chargeTypes.exists(tx, tenantId, dto.chargeTypeId))) {
      throw new NotFoundException('Charge type not found');
    }
    if (dto.taxRateId && !(await this.taxRates.exists(tx, tenantId, dto.taxRateId))) {
      throw new NotFoundException('Tax rate not found');
    }
    if (dto.productId) {
      const [product] = await tx`select 1 from products where id = ${dto.productId} and tenant_id = ${tenantId}`;
      if (!product) throw new NotFoundException('Product not found');
    }
    if (dto.categoryId) {
      const [category] = await tx`
        select 1 from product_categories where id = ${dto.categoryId} and tenant_id = ${tenantId}
      `;
      if (!category) throw new NotFoundException('Category not found');
    }
  }

  async create(actor: AuthenticatedUser, rateCardId: string, dto: CreateRateCardLineDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      if (!(await this.rateCards.exists(tx, actor.tenantId, rateCardId))) {
        throw new NotFoundException('Rate card not found');
      }
      await this.validateReferences(tx, actor.tenantId, dto);

      const [inserted] = await tx<RateCardLineRow[]>`
        insert into rate_card_lines (
          id, tenant_id, rate_card_id, charge_type_id, basis, uom_code, rate, minimum_charge,
          free_days, slab_from, slab_to, product_id, category_id, tax_rate_id, sac_code,
          description, sort_order
        ) values (
          ${randomUUID()}, ${actor.tenantId}, ${rateCardId}, ${dto.chargeTypeId}, ${dto.basis},
          ${dto.uomCode ?? null}, ${dto.rate}, ${dto.minimumCharge ?? null}, ${dto.freeDays ?? 0},
          ${dto.slabFrom ?? null}, ${dto.slabTo ?? null}, ${dto.productId ?? null}, ${dto.categoryId ?? null},
          ${dto.taxRateId ?? null}, ${dto.sacCode ?? null}, ${dto.description ?? null}, ${dto.sortOrder ?? 0}
        )
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return inserted;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'rate_card_line',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, rateCardId: string) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      if (!(await this.rateCards.exists(tx, actor.tenantId, rateCardId))) {
        throw new NotFoundException('Rate card not found');
      }
      const rows = await tx<RateCardLineRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS.split(',').map((c) => `l.${c.trim()}`).join(', '))},
               ct.code as charge_type_code, ct.name as charge_type_name
        from rate_card_lines l
        join charge_types ct on ct.id = l.charge_type_id
        where l.tenant_id = ${actor.tenantId} and l.rate_card_id = ${rateCardId}
        order by l.sort_order, l.id
      `;
      return rows.map(toApi);
    });
  }

  async update(
    actor: AuthenticatedUser,
    rateCardId: string,
    lineId: string,
    dto: UpdateRateCardLineDto,
    ipAddress?: string,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<RateCardLineRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from rate_card_lines
        where id = ${lineId} and rate_card_id = ${rateCardId} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      await this.validateReferences(tx, actor.tenantId, dto);

      const [after] = await tx<RateCardLineRow[]>`
        update rate_card_lines
        set charge_type_id = ${dto.chargeTypeId ?? before.charge_type_id},
            basis = ${dto.basis ?? before.basis},
            uom_code = ${dto.uomCode !== undefined ? dto.uomCode : before.uom_code},
            rate = ${dto.rate ?? before.rate},
            minimum_charge = ${dto.minimumCharge !== undefined ? dto.minimumCharge : before.minimum_charge},
            free_days = ${dto.freeDays ?? before.free_days},
            slab_from = ${dto.slabFrom !== undefined ? dto.slabFrom : before.slab_from},
            slab_to = ${dto.slabTo !== undefined ? dto.slabTo : before.slab_to},
            product_id = ${dto.productId !== undefined ? dto.productId : before.product_id},
            category_id = ${dto.categoryId !== undefined ? dto.categoryId : before.category_id},
            tax_rate_id = ${dto.taxRateId !== undefined ? dto.taxRateId : before.tax_rate_id},
            sac_code = ${dto.sacCode !== undefined ? dto.sacCode : before.sac_code},
            description = ${dto.description !== undefined ? dto.description : before.description},
            sort_order = ${dto.sortOrder ?? before.sort_order}
        where id = ${lineId} and rate_card_id = ${rateCardId} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Rate card line not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'rate_card_line',
      entityId: lineId,
      previousValue: result.before,
      newValue: result.after,
      ipAddress,
    });
    return toApi(result.after);
  }
}
