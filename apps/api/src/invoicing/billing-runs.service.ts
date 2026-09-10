import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { RateCardResolutionService } from '../billing/rate-card-resolution.service';
import { SETTINGS_BY_KEY } from '../company/tenant-settings.registry';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateBillingRunDto, ListBillingRunsQuery, ManualChargeLineDto } from './dto/invoicing.dtos';

const PARTIAL_MONTH = SETTINGS_BY_KEY.get('billing.partial_month_policy')!;
const DEFAULT_TAX = SETTINGS_BY_KEY.get('billing.default_tax_rate_code')!;

const STORAGE_BASES = ['unit_day', 'pallet_day', 'box_day', 'cbm_day', 'sqft_month', 'flat_month'];

interface RunRow {
  id: string;
  customer_id: string;
  warehouse_id: string | null;
  period_start: string;
  period_end: string;
  rate_card_id: string | null;
  status: string;
  calculation: Calculation;
  subtotal: string;
  invoice_id: string | null;
  invoice_number: string | null;
  generated_at: string;
  generated_by: string | null;
}

interface RunLineRow {
  id: string;
  charge_type_id: string;
  charge_type_code?: string;
  description: string;
  basis: string;
  quantity: string | null;
  days: number | null;
  rate: string;
  minimum_charge: string | null;
  computed_amount: string;
  source_type: string | null;
  source_id: string | null;
  tax_rate_id: string | null;
  tax_rate_pct?: string | null;
  sac_code: string | null;
}

/** billing-engine.md §4: every intermediate number, stored verbatim. */
export interface Calculation {
  periodStart: string;
  periodEnd: string;
  warehouseIds: string[];
  partialMonthPolicy: string;
  storage: {
    productId: string;
    sku: string;
    warehouseId: string;
    basis: string;
    rate: number;
    freeDays: number;
    minimumCharge: number | null;
    rateCardId: string;
    unitDays: number;
    chargeableDays: number;
    daily: { date: string; qty: number; chargeable: boolean }[];
    amount: number;
  }[];
  events: { chargeTypeCode: string; sourceType: string; sourceId: string; sourceNumber: string; occurredAt: string; basis: string; quantity: number; rate: number; amount: number }[];
  manual: { chargeTypeCode: string; description: string; quantity: number; rate: number; amount: number }[];
  /** Storage that sat there with no rate to bill it at: the run cannot be invoiced until these are resolved. */
  errors: string[];
  /** Operational events for charge types the tenant has not priced anywhere: shown, not billed. */
  unpriced: string[];
  /** Events left out because an invoiced run already carries them. */
  alreadyBilled: string[];
}

interface PendingLine {
  chargeTypeId: string;
  chargeTypeCode: string;
  description: string;
  basis: string;
  quantity: number | null;
  days: number | null;
  rate: number;
  minimumCharge: number | null;
  amount: number;
  sourceType: string | null;
  sourceId: string | null;
  taxRateId: string | null;
  sacCode: string | null;
}

interface ChargeType {
  id: string;
  code: string;
  category: string;
  default_basis: string;
  sac_code: string | null;
  trigger_event: string | null;
}

interface OperationalEvent {
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  warehouseId: string;
  occurredAt: string;
  units: number;
  packages: number | null;
  lines: number;
  weightKg: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return isoDate(x);
};

function toApi(row: RunRow, lines?: RunLineRow[]) {
  return {
    id: row.id,
    customerId: row.customer_id,
    warehouseId: row.warehouse_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    rateCardId: row.rate_card_id,
    status: row.status,
    subtotal: Number(row.subtotal),
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    hasErrors: row.calculation.errors.length > 0,
    calculation: row.calculation,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        chargeTypeId: l.charge_type_id,
        chargeTypeCode: l.charge_type_code,
        description: l.description,
        basis: l.basis,
        quantity: l.quantity === null ? null : Number(l.quantity),
        days: l.days,
        rate: Number(l.rate),
        minimumCharge: l.minimum_charge === null ? null : Number(l.minimum_charge),
        computedAmount: Number(l.computed_amount),
        sourceType: l.source_type,
        sourceId: l.source_id,
        taxRateId: l.tax_rate_id,
        taxRatePct: l.tax_rate_pct === undefined || l.tax_rate_pct === null ? null : Number(l.tax_rate_pct),
        sacCode: l.sac_code,
      })),
    }),
  };
}

/**
 * billing-engine.md §4–§5: the preview. Every line traces to an
 * operational record -- a day-by-day storage accrual rebuilt from the
 * ledger, or a handling event (GRN approved, gate-out, loading confirmed,
 * put-away completed, pick confirmed) -- or is an explicit `manual` line.
 * The run is a *preview*: nothing is committed until an invoice is created
 * from it (§39), and re-running the same customer/warehouse/period
 * replaces the previous preview rather than adding a second one.
 *
 * "Never silently generate incorrect billing" (§1) is read two ways here.
 * Stock that sat in the warehouse with no storage rate at any level is an
 * *error*: the run records it and refuses to be invoiced. A handling event
 * for a charge type the tenant has not priced anywhere is *unpriced*: shown
 * in the preview, not billed, not blocking -- a tenant that does not charge
 * for unloading should not have to invent a zero rate to invoice storage.
 */
@Injectable()
export class BillingRunsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
    private readonly rates: RateCardResolutionService,
  ) {}

  async generate(actor: AuthenticatedUser, dto: CreateBillingRunDto, ipAddress?: string) {
    if (dto.periodEnd < dto.periodStart) throw new BadRequestException('periodEnd must not be before periodStart');
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      if (dto.warehouseId) assertWarehouseInScope(scope, dto.warehouseId);
      const [customer] = await tx<{ id: string; name: string }[]>`select id, name from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');
      if (dto.warehouseId) {
        const [w] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
        if (!w) throw new NotFoundException('Warehouse not found');
      }

      // One live preview per key; an invoiced run for the key is the period already billed.
      const [invoiced] = await tx<{ number: string }[]>`
        select i.number from billing_runs br join invoices i on i.id = br.invoice_id
        where br.tenant_id = ${actor.tenantId} and br.customer_id = ${dto.customerId} and br.warehouse_id is not distinct from ${dto.warehouseId ?? null}
          and br.period_start = ${dto.periodStart} and br.period_end = ${dto.periodEnd} and br.status = 'invoiced'
      `;
      if (invoiced) throw new BadRequestException(`This period is already invoiced (${invoiced.number}); correct it with a credit or debit note`);
      await tx`
        delete from billing_runs
        where tenant_id = ${actor.tenantId} and customer_id = ${dto.customerId} and warehouse_id is not distinct from ${dto.warehouseId ?? null}
          and period_start = ${dto.periodStart} and period_end = ${dto.periodEnd} and status <> 'invoiced'
      `;

      const warehouseIds = dto.warehouseId
        ? [dto.warehouseId]
        : (
            await tx<{ warehouse_id: string }[]>`
              select distinct warehouse_id from stock_ledger
              where tenant_id = ${actor.tenantId} and customer_id = ${dto.customerId} and txn_at < ${addDays(dto.periodEnd, 1)}::date
                and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
            `
          ).map((r) => r.warehouse_id);

      const calc: Calculation = {
        periodStart: dto.periodStart, periodEnd: dto.periodEnd, warehouseIds,
        partialMonthPolicy: await this.setting(tx, actor.tenantId, PARTIAL_MONTH.key, PARTIAL_MONTH.default as string),
        storage: [], events: [], manual: [], errors: [], unpriced: [], alreadyBilled: [],
      };
      const chargeTypes = await this.chargeTypes(tx, actor.tenantId);
      const lines: PendingLine[] = [];
      let rateCardId: string | null = null;

      const storage = chargeTypes.find((c) => c.code === 'STORAGE');
      for (const warehouseId of warehouseIds) {
        if (storage) {
          const storageLines = await this.storageLines(tx, actor.tenantId, dto, warehouseId, storage, calc);
          lines.push(...storageLines.lines);
          rateCardId = rateCardId ?? storageLines.rateCardId;
        }
        lines.push(...(await this.eventLines(tx, actor.tenantId, dto, warehouseId, chargeTypes, calc)));
      }
      for (const m of dto.manualLines ?? []) lines.push(await this.manualLine(tx, actor.tenantId, m, chargeTypes, calc));

      const id = randomUUID();
      const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
      await tx`
        insert into billing_runs (id, tenant_id, customer_id, warehouse_id, period_start, period_end, rate_card_id, calculation, subtotal, generated_by)
        values (${id}, ${actor.tenantId}, ${dto.customerId}, ${dto.warehouseId ?? null}, ${dto.periodStart}, ${dto.periodEnd}, ${rateCardId},
                ${JSON.stringify(calc)}::jsonb, ${subtotal}, ${actor.userId})
      `;
      for (const l of lines) {
        await tx`
          insert into billing_run_lines (id, tenant_id, billing_run_id, charge_type_id, description, basis, quantity, days, rate, minimum_charge,
                                         computed_amount, source_type, source_id, tax_rate_id, sac_code)
          values (${randomUUID()}, ${actor.tenantId}, ${id}, ${l.chargeTypeId}, ${l.description}, ${l.basis}, ${l.quantity}, ${l.days}, ${l.rate},
                  ${l.minimumCharge}, ${l.amount}, ${l.sourceType}, ${l.sourceId}, ${l.taxRateId}, ${l.sacCode})
        `;
      }
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'billing_run', entityId: result.row.id,
      newValue: { customerId: dto.customerId, warehouseId: dto.warehouseId ?? null, periodStart: dto.periodStart, periodEnd: dto.periodEnd, subtotal: result.row.subtotal, errors: result.row.calculation.errors },
      ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  private async setting(tx: postgres.TransactionSql, tenantId: string, key: string, fallback: string): Promise<string> {
    const [row] = await tx<{ value: unknown }[]>`select value from tenant_settings where tenant_id = ${tenantId} and key = ${key}`;
    return typeof row?.value === 'string' ? row.value : fallback;
  }

  /** Tenant overrides win over the system catalogue for the same code. */
  private async chargeTypes(tx: postgres.TransactionSql, tenantId: string): Promise<ChargeType[]> {
    const rows = await tx<ChargeType[]>`
      select distinct on (code) id, code, category, default_basis, sac_code, trigger_event from charge_types
      where (tenant_id = ${tenantId} or tenant_id is null) and is_active
      order by code, tenant_id nulls last
    `;
    return rows;
  }

  private async taxRateFor(tx: postgres.TransactionSql, tenantId: string, taxRateId: string | null): Promise<string | null> {
    if (taxRateId) return taxRateId;
    const code = await this.setting(tx, tenantId, DEFAULT_TAX.key, DEFAULT_TAX.default as string);
    const [row] = await tx<{ id: string }[]>`
      select id from tax_rates where (tenant_id = ${tenantId} or tenant_id is null) and code = ${code} order by tenant_id nulls last limit 1
    `;
    return row?.id ?? null;
  }

  private async resolve(tenantId: string, params: { customerId: string; warehouseId: string; chargeTypeId: string; productId?: string; categoryId?: string }) {
    try {
      return await this.rates.resolve(tenantId, params);
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  /**
   * §4: quantity on hand for each day of the period, per lot key, rebuilt
   * from the ledger; a day is chargeable once it is past the key's first
   * receipt plus the rate's free days. Summed per product so the invoice
   * reads as one line per SKU, with the daily series kept in the
   * calculation for the preview to show.
   */
  private async storageLines(
    tx: postgres.TransactionSql,
    tenantId: string,
    dto: CreateBillingRunDto,
    warehouseId: string,
    storage: ChargeType,
    calc: Calculation,
  ): Promise<{ lines: PendingLine[]; rateCardId: string | null }> {
    const dayAfter = addDays(dto.periodEnd, 1);
    const daily = await tx<{ product_id: string; sku: string; name: string; category_id: string | null; units_per_package: number | null; volume_cbm: string | null; batch_id: string | null; d: string; qty: string; first_in: string | null }[]>`
      with keys as (
        select l.product_id, l.batch_id, min(l.txn_at) filter (where l.qty_in > 0 and l.txn_type in ('INWARD', 'RETURN', 'TRANSFER_IN')) as first_in
        from stock_ledger l
        where l.tenant_id = ${tenantId} and l.customer_id = ${dto.customerId} and l.warehouse_id = ${warehouseId} and l.txn_at < ${dayAfter}::date
        group by l.product_id, l.batch_id
      ),
      days as (select generate_series(${dto.periodStart}::date, ${dto.periodEnd}::date, interval '1 day')::date as d)
      select k.product_id, p.sku, p.name, p.category_id, p.units_per_package, p.volume_cbm, k.batch_id, to_char(days.d, 'YYYY-MM-DD') as d,
             (select coalesce(sum(l.qty_in - l.qty_out), 0) from stock_ledger l
              where l.tenant_id = ${tenantId} and l.customer_id = ${dto.customerId} and l.warehouse_id = ${warehouseId}
                and l.product_id = k.product_id and l.batch_id is not distinct from k.batch_id and l.txn_at < days.d + 1)::text as qty,
             to_char(k.first_in, 'YYYY-MM-DD') as first_in
      from keys k join products p on p.id = k.product_id cross join days
      order by p.sku, k.batch_id, days.d
    `;
    if (daily.length === 0) return { lines: [], rateCardId: null };

    type DailyRow = (typeof daily)[number];
    const byProduct = new Map<string, DailyRow[]>();
    for (const row of daily) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(row);
      byProduct.set(row.product_id, list);
    }
    const lines: PendingLine[] = [];
    let rateCardId: string | null = null;
    for (const [productId, rows] of byProduct) {
      const { sku, name, category_id, units_per_package, volume_cbm } = rows[0];
      if (!rows.some((r) => Number(r.qty) > 0)) continue; // nothing on hand this period
      const resolved = await this.resolve(tenantId, { customerId: dto.customerId, warehouseId, chargeTypeId: storage.id, productId, categoryId: category_id ?? undefined });
      if (!resolved) {
        calc.errors.push(`No storage rate for ${sku} (${name}) in warehouse ${warehouseId}: stock was on hand this period`);
        continue;
      }
      rateCardId = rateCardId ?? resolved.rateCardId;
      const line = resolved.line;
      const freeDays = line.freeDays ?? 0;

      // Merge the per-batch series into a per-product daily series, applying free days per batch key.
      const perDay = new Map<string, { qty: number; chargeable: number }>();
      for (const r of rows) {
        const qty = Number(r.qty);
        const cur = perDay.get(r.d) ?? { qty: 0, chargeable: 0 };
        cur.qty += qty;
        const pastFree = r.first_in === null || r.d >= addDays(r.first_in, freeDays);
        if (qty > 0 && pastFree) cur.chargeable += qty;
        perDay.set(r.d, cur);
      }
      const series = [...perDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, qty: v.qty, chargeable: v.chargeable > 0 }));
      const chargeableUnitDays = [...perDay.values()].reduce((s, v) => s + v.chargeable, 0);
      const chargeableDays = [...perDay.values()].filter((v) => v.chargeable > 0).length;

      let quantity: number;
      let days: number | null = chargeableDays;
      let description: string;
      switch (line.basis) {
        case 'unit_day':
        case 'pallet_day':
          quantity = chargeableUnitDays;
          description = `Storage ${sku}: ${quantity} ${line.basis === 'pallet_day' ? 'pallet' : 'unit'}-days over ${chargeableDays} day(s)`;
          break;
        case 'box_day':
          quantity = units_per_package ? [...perDay.values()].reduce((s, v) => s + Math.ceil(v.chargeable / units_per_package), 0) : chargeableUnitDays;
          description = `Storage ${sku}: ${quantity} box-days over ${chargeableDays} day(s)`;
          break;
        case 'cbm_day':
          if (volume_cbm === null) {
            calc.errors.push(`Storage rate for ${sku} is per cbm-day but the product has no volume on file`);
            continue;
          }
          quantity = round2(chargeableUnitDays * Number(volume_cbm));
          description = `Storage ${sku}: ${quantity} cbm-days over ${chargeableDays} day(s)`;
          break;
        case 'flat_month':
        case 'sqft_month': {
          if (line.basis === 'sqft_month') {
            calc.errors.push(`Storage rate for ${sku} is per sqft-month, and no floor area is on file for this customer`);
            continue;
          }
          quantity = this.monthsCovered(dto.periodStart, dto.periodEnd, calc.partialMonthPolicy, series);
          days = null;
          description = `Storage ${sku}: ${quantity} month(s) flat`;
          break;
        }
        default:
          calc.errors.push(`Storage rate for ${sku} has basis '${line.basis}', which is not a storage basis (${STORAGE_BASES.join(', ')})`);
          continue;
      }
      const raw = round2(quantity * line.rate);
      const amount = line.minimumCharge !== null && raw < line.minimumCharge ? line.minimumCharge : raw;
      calc.storage.push({
        productId, sku, warehouseId, basis: line.basis, rate: line.rate, freeDays, minimumCharge: line.minimumCharge, rateCardId: resolved.rateCardId,
        unitDays: chargeableUnitDays, chargeableDays, daily: series, amount,
      });
      lines.push({
        chargeTypeId: storage.id, chargeTypeCode: storage.code, description, basis: line.basis, quantity, days, rate: line.rate,
        minimumCharge: line.minimumCharge, amount, sourceType: 'stock_lot', sourceId: null,
        taxRateId: await this.taxRateFor(tx, tenantId, line.taxRateId), sacCode: line.sacCode ?? storage.sac_code,
      });
    }
    return { lines, rateCardId };
  }

  /** Calendar months the period touches in which stock was on hand, whole or pro-rated by the tenant's policy. */
  private monthsCovered(start: string, end: string, policy: string, series: { date: string; qty: number }[]): number {
    const months = new Map<string, { days: number; inMonth: number; stocked: boolean }>();
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const key = d.slice(0, 7);
      const [y, m] = key.split('-').map(Number);
      const inMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const cur = months.get(key) ?? { days: 0, inMonth, stocked: false };
      cur.days += 1;
      if ((series.find((s) => s.date === d)?.qty ?? 0) > 0) cur.stocked = true;
      months.set(key, cur);
    }
    let total = 0;
    for (const m of months.values()) {
      if (!m.stocked) continue;
      total += policy === 'prorate' ? m.days / m.inMonth : 1;
    }
    return Math.round(total * 1000) / 1000;
  }

  /** §2's trigger events for this customer and warehouse within the period, less those an invoiced run already carries. */
  private async eventLines(
    tx: postgres.TransactionSql,
    tenantId: string,
    dto: CreateBillingRunDto,
    warehouseId: string,
    chargeTypes: ChargeType[],
    calc: Calculation,
  ): Promise<PendingLine[]> {
    const dayAfter = addDays(dto.periodEnd, 1);
    const events: Record<string, OperationalEvent[]> = {
      grn_approved: (
        await tx<Record<string, any>[]>`
          select g.id, g.number, g.warehouse_id, g.approved_at, coalesce(sum(gi.accepted_qty), 0)::text as units, sum(gi.packages) as packages,
                 count(gi.id)::int as lines, sum(gi.gross_weight_kg)::text as weight
          from grns g join grn_items gi on gi.grn_id = g.id
          where g.tenant_id = ${tenantId} and g.customer_id = ${dto.customerId} and g.warehouse_id = ${warehouseId}
            and g.status = 'approved' and g.approved_at >= ${dto.periodStart}::date and g.approved_at < ${dayAfter}::date
          group by g.id order by g.approved_at
        `
      ).map((r) => ({ sourceType: 'grn', sourceId: r.id, sourceNumber: r.number, warehouseId: r.warehouse_id, occurredAt: r.approved_at, units: Number(r.units), packages: r.packages === null ? null : Number(r.packages), lines: r.lines, weightKg: r.weight === null ? null : Number(r.weight) })),
      gate_out: (
        await tx<Record<string, any>[]>`
          select d.id, d.number, d.warehouse_id, min(l.txn_at) as occurred_at, sum(l.qty_out)::text as units, d.total_packages, count(distinct l.source_line_id)::int as lines, d.total_weight_kg
          from stock_ledger l join dispatches d on d.id = l.source_id
          where l.tenant_id = ${tenantId} and l.txn_type = 'OUTWARD' and l.source_type = 'dispatch' and l.customer_id = ${dto.customerId} and l.warehouse_id = ${warehouseId}
          group by d.id having min(l.txn_at) >= ${dto.periodStart}::date and min(l.txn_at) < ${dayAfter}::date
          order by min(l.txn_at)
        `
      ).map((r) => ({ sourceType: 'dispatch', sourceId: r.id, sourceNumber: r.number, warehouseId: r.warehouse_id, occurredAt: r.occurred_at, units: Number(r.units), packages: r.total_packages, lines: r.lines, weightKg: r.total_weight_kg === null ? null : Number(r.total_weight_kg) })),
      loading_confirmed: (
        await tx<Record<string, any>[]>`
          select ls.id, ls.number, d.warehouse_id, ls.loading_completed_at, coalesce(sum(lsl.quantity), 0)::text as units, count(lsl.id)::int as lines, sum(lsl.weight_kg)::text as weight
          from loading_sheets ls join dispatches d on d.id = ls.dispatch_id join loading_sheet_lines lsl on lsl.loading_sheet_id = ls.id
          where ls.tenant_id = ${tenantId} and d.customer_id = ${dto.customerId} and d.warehouse_id = ${warehouseId} and ls.status = 'loaded'
            and ls.loading_completed_at >= ${dto.periodStart}::date and ls.loading_completed_at < ${dayAfter}::date
          group by ls.id, d.warehouse_id order by ls.loading_completed_at
        `
      ).map((r) => ({ sourceType: 'loading_sheet', sourceId: r.id, sourceNumber: r.number, warehouseId: r.warehouse_id, occurredAt: r.loading_completed_at, units: Number(r.units), packages: null, lines: r.lines, weightKg: r.weight === null ? null : Number(r.weight) })),
      putaway_completed: (
        await tx<Record<string, any>[]>`
          select pa.id, pa.number, pa.warehouse_id, pa.completed_at, coalesce(sum(pl.quantity), 0)::text as units, count(pl.id)::int as lines
          from putaways pa join putaway_lines pl on pl.putaway_id = pa.id
          where pa.tenant_id = ${tenantId} and pa.customer_id = ${dto.customerId} and pa.warehouse_id = ${warehouseId} and pa.status = 'completed'
            and pa.completed_at >= ${dto.periodStart}::date and pa.completed_at < ${dayAfter}::date
          group by pa.id order by pa.completed_at
        `
      ).map((r) => ({ sourceType: 'putaway', sourceId: r.id, sourceNumber: r.number, warehouseId: r.warehouse_id, occurredAt: r.completed_at, units: Number(r.units), packages: null, lines: r.lines, weightKg: null })),
      pick_confirmed: (
        await tx<Record<string, any>[]>`
          select pl.id, pl.number, pl.warehouse_id, pl.completed_at, coalesce(sum(pll.pick_qty), 0)::text as units, count(pll.id)::int as lines
          from pick_lists pl join pick_list_lines pll on pll.pick_list_id = pl.id
          where pl.tenant_id = ${tenantId} and pl.customer_id = ${dto.customerId} and pl.warehouse_id = ${warehouseId} and pl.status = 'completed'
            and pl.completed_at >= ${dto.periodStart}::date and pl.completed_at < ${dayAfter}::date
          group by pl.id order by pl.completed_at
        `
      ).map((r) => ({ sourceType: 'pick_list', sourceId: r.id, sourceNumber: r.number, warehouseId: r.warehouse_id, occurredAt: r.completed_at, units: Number(r.units), packages: null, lines: r.lines, weightKg: null })),
    };

    const lines: PendingLine[] = [];
    const unpriced = new Set<string>();
    for (const chargeType of chargeTypes.filter((c) => c.trigger_event && events[c.trigger_event])) {
      for (const event of events[chargeType.trigger_event!]) {
        const [billed] = await tx<{ number: string }[]>`
          select i.number from billing_run_lines brl join billing_runs br on br.id = brl.billing_run_id join invoices i on i.id = br.invoice_id
          where brl.tenant_id = ${tenantId} and br.status = 'invoiced' and brl.charge_type_id = ${chargeType.id}
            and brl.source_type = ${event.sourceType} and brl.source_id = ${event.sourceId}
        `;
        if (billed) {
          calc.alreadyBilled.push(`${chargeType.code} for ${event.sourceNumber} (on ${billed.number})`);
          continue;
        }
        const resolved = await this.resolve(tenantId, { customerId: dto.customerId, warehouseId, chargeTypeId: chargeType.id });
        if (!resolved) {
          unpriced.add(chargeType.code);
          continue;
        }
        const line = resolved.line;
        const quantity = this.eventQuantity(line.basis, event);
        const raw = round2(quantity * line.rate);
        const amount = line.minimumCharge !== null && raw < line.minimumCharge ? line.minimumCharge : raw;
        calc.events.push({ chargeTypeCode: chargeType.code, sourceType: event.sourceType, sourceId: event.sourceId, sourceNumber: event.sourceNumber, occurredAt: event.occurredAt, basis: line.basis, quantity, rate: line.rate, amount });
        lines.push({
          chargeTypeId: chargeType.id, chargeTypeCode: chargeType.code, description: `${chargeType.code.replace(/_/g, ' ')} — ${event.sourceNumber}`,
          basis: line.basis, quantity, days: null, rate: line.rate, minimumCharge: line.minimumCharge, amount,
          sourceType: event.sourceType, sourceId: event.sourceId, taxRateId: await this.taxRateFor(tx, tenantId, line.taxRateId), sacCode: line.sacCode ?? chargeType.sac_code,
        });
      }
    }
    for (const code of unpriced) if (!calc.unpriced.includes(code)) calc.unpriced.push(code);
    return lines;
  }

  /** What "quantity" means for an event under each basis; anything else counts units. */
  private eventQuantity(basis: string, e: OperationalEvent): number {
    switch (basis) {
      case 'per_vehicle':
      case 'per_document':
      case 'per_hour':
      case 'lumpsum':
        return 1;
      case 'per_package':
        return e.packages ?? e.lines;
      case 'per_pallet':
        return e.lines;
      case 'per_kg':
        return e.weightKg ?? e.units;
      default:
        return e.units;
    }
  }

  private async manualLine(tx: postgres.TransactionSql, tenantId: string, m: ManualChargeLineDto, chargeTypes: ChargeType[], calc: Calculation): Promise<PendingLine> {
    const chargeType = chargeTypes.find((c) => c.id === m.chargeTypeId);
    if (!chargeType) throw new NotFoundException(`Charge type ${m.chargeTypeId} not found`);
    if (m.taxRateId) {
      const [t] = await tx`select 1 from tax_rates where id = ${m.taxRateId} and (tenant_id = ${tenantId} or tenant_id is null)`;
      if (!t) throw new NotFoundException('Tax rate not found');
    }
    const amount = round2(m.quantity * m.rate);
    calc.manual.push({ chargeTypeCode: chargeType.code, description: m.description, quantity: m.quantity, rate: m.rate, amount });
    return {
      chargeTypeId: chargeType.id, chargeTypeCode: chargeType.code, description: m.description, basis: chargeType.default_basis, quantity: m.quantity,
      days: null, rate: m.rate, minimumCharge: null, amount, sourceType: 'manual', sourceId: null,
      taxRateId: await this.taxRateFor(tx, tenantId, m.taxRateId ?? null), sacCode: m.sacCode ?? chargeType.sac_code,
    };
  }

  async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<RunRow[]>`
      select br.id, br.customer_id, br.warehouse_id, br.period_start, br.period_end, br.rate_card_id, br.status, br.calculation, br.subtotal,
             br.invoice_id, i.number as invoice_number, br.generated_at, br.generated_by
      from billing_runs br left join invoices i on i.id = br.invoice_id where br.id = ${id} and br.tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<RunLineRow[]>`
      select brl.id, brl.charge_type_id, ct.code as charge_type_code, brl.description, brl.basis, brl.quantity, brl.days, brl.rate, brl.minimum_charge,
             brl.computed_amount, brl.source_type, brl.source_id, brl.tax_rate_id, tr.rate_pct as tax_rate_pct, brl.sac_code
      from billing_run_lines brl join charge_types ct on ct.id = brl.charge_type_id left join tax_rates tr on tr.id = brl.tax_rate_id
      where brl.tenant_id = ${tenantId} and brl.billing_run_id = ${id}
      order by case brl.source_type when 'stock_lot' then 0 when 'manual' then 2 else 1 end, brl.description
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListBillingRunsQuery) {
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where br.tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or br.warehouse_id = any(${scope}))
          and (${customerFilter}::uuid is null or br.customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or br.warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or br.status = ${statusFilter})`;
      const rows = await tx<RunRow[]>`
        select br.id, br.customer_id, br.warehouse_id, br.period_start, br.period_end, br.rate_card_id, br.status, br.calculation, br.subtotal,
               br.invoice_id, i.number as invoice_number, br.generated_at, br.generated_by
        from billing_runs br left join invoices i on i.id = br.invoice_id ${where}
        order by br.period_end desc, br.generated_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from billing_runs br ${where}`;
      return { items: rows.map((r) => toApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const found = await this.fetchWithLines(tx, actor.tenantId, id);
      if (!found || (scope && found.row.warehouse_id && !scope.includes(found.row.warehouse_id))) return null;
      return found;
    });
    if (!fetched) throw new NotFoundException('Billing run not found');
    return toApi(fetched.row, fetched.lines);
  }

  async discard(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<{ status: string }[]>`select status from billing_runs where id = ${id} and tenant_id = ${actor.tenantId} for update`;
      if (!before) return null;
      if (before.status !== 'previewed') throw new BadRequestException(`Cannot discard a billing run in '${before.status}' status`);
      await tx`update billing_runs set status = 'discarded' where id = ${id} and tenant_id = ${actor.tenantId}`;
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    if (!row) throw new NotFoundException('Billing run not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'billing_run', entityId: id, previousValue: { status: 'previewed' }, newValue: { status: 'discarded' }, ipAddress,
    });
    return toApi(row.row, row.lines);
  }
}
