import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { RateCardLineRow, toApi as toLineApi } from './rate-card-lines.service';

export interface ResolveRateParams {
  customerId: string;
  warehouseId?: string;
  chargeTypeId: string;
  productId?: string;
  categoryId?: string;
}

/** Picks the most specific line within one card's lines for this charge type: product > category > general. */
function pickLine(lines: RateCardLineRow[], productId?: string, categoryId?: string): RateCardLineRow | undefined {
  if (productId) {
    const match = lines.find((l) => l.product_id === productId);
    if (match) return match;
  }
  if (categoryId) {
    const match = lines.find((l) => l.category_id === categoryId);
    if (match) return match;
  }
  return lines.find((l) => l.product_id === null && l.category_id === null);
}

/**
 * billing-engine.md §3: resolve `(tenant, customer, warehouse, charge_type,
 * product?)` to a rate_card_lines row by trying, in priority order, until a
 * matching *line* is found -- not just an active card. A customer-scope
 * card that has no line for this charge type falls through to the next
 * scope level rather than failing outright, so a customer's rate card can
 * override only some charge types and inherit the rest from the company
 * default. Throws (never falls back to zero/a guess) if nothing at any
 * level has a matching line -- billing-engine.md §1's "never silently
 * generate incorrect billing."
 */
@Injectable()
export class RateCardResolutionService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async resolve(tenantId: string, params: ResolveRateParams) {
    return withTenant(this.sql, tenantId, async (tx) => {
      const cardIds = await this.candidateCardIds(tx, tenantId, params);

      for (const rateCardId of cardIds) {
        const lines = await tx<RateCardLineRow[]>`
          select id, rate_card_id, charge_type_id, basis, uom_code, rate, minimum_charge, free_days,
                 slab_from, slab_to, product_id, category_id, tax_rate_id, sac_code, description, sort_order
          from rate_card_lines
          where tenant_id = ${tenantId} and rate_card_id = ${rateCardId} and charge_type_id = ${params.chargeTypeId}
        `;
        const line = pickLine(lines, params.productId, params.categoryId);
        if (line) return { rateCardId, line: toLineApi(line) };
      }

      throw new NotFoundException('No applicable rate found for this charge type');
    });
  }

  private async candidateCardIds(
    tx: postgres.TransactionSql,
    tenantId: string,
    { customerId, warehouseId }: ResolveRateParams,
  ): Promise<string[]> {
    const ids: string[] = [];

    if (warehouseId) {
      const [customerNarrowed] = await tx<{ id: string }[]>`
        select id from rate_cards
        where tenant_id = ${tenantId} and scope = 'customer' and customer_id = ${customerId}
          and warehouse_id = ${warehouseId} and status = 'active'
          and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
        order by valid_from desc limit 1
      `;
      if (customerNarrowed) ids.push(customerNarrowed.id);
    }

    const [customerCard] = await tx<{ id: string }[]>`
      select id from rate_cards
      where tenant_id = ${tenantId} and scope = 'customer' and customer_id = ${customerId}
        and warehouse_id is null and status = 'active'
        and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
      order by valid_from desc limit 1
    `;
    if (customerCard) ids.push(customerCard.id);

    if (warehouseId) {
      const [warehouseCard] = await tx<{ id: string }[]>`
        select id from rate_cards
        where tenant_id = ${tenantId} and scope = 'warehouse' and warehouse_id = ${warehouseId}
          and status = 'active'
          and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
        order by valid_from desc limit 1
      `;
      if (warehouseCard) ids.push(warehouseCard.id);
    }

    const [companyCard] = await tx<{ id: string }[]>`
      select id from rate_cards
      where tenant_id = ${tenantId} and scope = 'company' and status = 'active'
        and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
      order by valid_from desc limit 1
    `;
    if (companyCard) ids.push(companyCard.id);

    return ids;
  }
}
