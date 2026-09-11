import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { hasPermission } from '../auth/has-permission';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { BillingRunsService } from '../invoicing/billing-runs.service';
import { InvoicesService } from '../invoicing/invoices.service';
import { RaiseRentInvoiceDto } from './dto/storage.dtos';

/** Two decimals, once, so the invoice never disagrees with the arithmetic behind it. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

function daysInMonthOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The monthly rent invoice for a household storage booking.
 *
 * It reuses the invoicing engine rather than growing a second one: the
 * same numbering series, the same CGST/SGST split decided from the two
 * state codes, the same PDF, and the same payments, receipts and customer
 * statement. What this service adds is only what that engine cannot know
 * -- that a booking's rent is monthly, what a part-month is worth, and how
 * far this booking has already been billed.
 *
 * The rent goes through as a *manual line* on a billing run. That is not a
 * workaround: `billing-engine.md`'s run derives charges from stock
 * movements, and a household booking has no stock rows at all. The rent is
 * a fact about the agreement, not something to be re-derived from
 * operations.
 */
@Injectable()
export class StorageBillingService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly billingRuns: BillingRunsService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * A part-month is charged by the day, at the month's own day count --
   * so 11 days of a 30-day September cost 11/30 of the rent, and a
   * customer who moves in mid-month is not billed for the half they were
   * not here. Whole months are never pro-rated into a rounding error:
   * they are simply the rent.
   */
  private rentFor(monthlyRent: number, periodStart: string, periodEnd: string) {
    const days = daysBetween(periodStart, periodEnd);
    const inMonth = daysInMonthOf(periodStart);
    if (days >= inMonth) {
      const wholeMonths = Math.floor(days / inMonth);
      const spare = days - wholeMonths * inMonth;
      return {
        days,
        amount: round2(monthlyRent * wholeMonths + (monthlyRent / inMonth) * spare),
      };
    }
    return { days, amount: round2((monthlyRent / inMonth) * days) };
  }

  async preview(actor: AuthenticatedUser, bookingId: string, dto: RaiseRentInvoiceDto) {
    const plan = await this.plan(actor, bookingId, dto);
    return {
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      days: plan.days,
      rentAmount: plan.rentAmount,
      charges: plan.charges.map((c) => ({ id: c.id, description: c.description, amount: c.amount })),
      subtotal: round2(plan.rentAmount + plan.charges.reduce((sum, c) => sum + c.amount, 0)),
      description: plan.rentDescription,
    };
  }

  private async plan(actor: AuthenticatedUser, bookingId: string, dto: RaiseRentInvoiceDto) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const [booking] = await tx<
        {
          id: string;
          number: string;
          customer_id: string;
          warehouse_id: string;
          status: string;
          monthly_rent: string;
          storage_start_date: string | null;
          actual_end_date: string | null;
          rent_billed_upto: string | null;
        }[]
      >`
        select id, number, customer_id, warehouse_id, status, monthly_rent,
               storage_start_date, actual_end_date, rent_billed_upto
        from storage_bookings where id = ${bookingId} and tenant_id = ${actor.tenantId}
      `;
      if (!booking) throw new NotFoundException('Booking not found');
      if (!booking.storage_start_date) {
        throw new BadRequestException(
          'The goods have not arrived yet, so there is no rent to bill — record the intake first',
        );
      }
      if (booking.status === 'cancelled') throw new BadRequestException('This booking is cancelled');

      // Where the last invoice stopped, or the day the goods arrived. The
      // operator is not asked to remember; they are only allowed to
      // override the end date.
      const periodStart =
        dto.periodStart ??
        (booking.rent_billed_upto ? addDays(booking.rent_billed_upto, 1) : booking.storage_start_date);
      const defaultEnd = booking.actual_end_date ?? today();
      const periodEnd = dto.periodEnd ?? defaultEnd;

      if (periodEnd < periodStart) {
        throw new BadRequestException('The period ends before it starts');
      }
      if (booking.rent_billed_upto && periodStart <= booking.rent_billed_upto) {
        throw new BadRequestException(
          `Rent on this booking is already billed up to ${booking.rent_billed_upto} — the next invoice starts the day after`,
        );
      }
      if (booking.storage_start_date > periodStart) {
        throw new BadRequestException(
          `The goods only arrived on ${booking.storage_start_date}; rent cannot be charged from before that`,
        );
      }

      const { days, amount } = this.rentFor(Number(booking.monthly_rent), periodStart, periodEnd);
      const wholeMonth = days >= daysInMonthOf(periodStart);
      const rentDescription = wholeMonth
        ? `Storage rent — ${monthLabel(periodStart)}`
        : `Storage rent — ${monthLabel(periodStart)} (${days} day${days === 1 ? '' : 's'})`;

      const charges = dto.includeCharges === false
        ? []
        : (
            await tx<{ id: string; description: string; amount: string; charge_type_id: string | null }[]>`
              select id, description, amount, charge_type_id
              from storage_booking_charges
              where tenant_id = ${actor.tenantId} and booking_id = ${bookingId} and invoiced_at is null
              order by charged_on, created_at
            `
          ).map((c) => ({
            id: c.id,
            description: c.description,
            amount: Number(c.amount),
            chargeTypeId: c.charge_type_id,
          }));

      return {
        booking,
        periodStart,
        periodEnd,
        days,
        rentAmount: amount,
        rentDescription,
        charges,
      };
    });
  }

  async raise(actor: AuthenticatedUser, bookingId: string, dto: RaiseRentInvoiceDto, ip?: string) {
    const plan = await this.plan(actor, bookingId, dto);

    // The charge types and the tax rate the manual lines ride on. Looked up
    // by code rather than hard-coded ids, because they are seed data a
    // tenant may have replaced with their own.
    const { storageTypeId, fallbackTypeId, taxRateId } = await withTenant(
      this.sql,
      actor.tenantId,
      async (tx) => {
        const types = await tx<{ id: string; code: string }[]>`
          select id, code from charge_types
          where code in ('STORAGE', 'SPECIAL_HANDLING') and (tenant_id = ${actor.tenantId} or tenant_id is null)
          order by (tenant_id is not null) desc
        `;
        const [tax] = await tx<{ id: string }[]>`
          select id from tax_rates where code = 'GST18' and (tenant_id = ${actor.tenantId} or tenant_id is null)
          order by (tenant_id is not null) desc limit 1
        `;
        const byCode = (code: string) => types.find((t) => t.code === code)?.id ?? null;
        return {
          storageTypeId: byCode('STORAGE'),
          fallbackTypeId: byCode('SPECIAL_HANDLING') ?? byCode('STORAGE'),
          taxRateId: tax?.id ?? undefined,
        };
      },
    );
    if (!storageTypeId) {
      throw new BadRequestException('The Storage charge type is missing — run the seed before billing');
    }

    const manualLines = [
      {
        chargeTypeId: storageTypeId,
        description: plan.rentDescription,
        quantity: 1,
        rate: plan.rentAmount,
        taxRateId,
        // One amount for the period, not a per-unit-day rate: the days are
        // already in the description, and the customer's eye goes to this
        // column.
        basis: 'lumpsum',
        // Storage and warehousing of non-agricultural goods, 18% GST.
        sacCode: '996729',
      },
      ...plan.charges.map((c) => ({
        chargeTypeId: c.chargeTypeId ?? fallbackTypeId!,
        description: c.description,
        quantity: 1,
        rate: c.amount,
        taxRateId,
        basis: 'lumpsum',
        sacCode: '996729',
      })),
    ];

    const run = await this.billingRuns.generate(
      actor,
      {
        customerId: plan.booking.customer_id,
        warehouseId: plan.booking.warehouse_id,
        periodStart: plan.periodStart,
        periodEnd: plan.periodEnd,
        manualLines,
      } as never,
      ip,
    );
    let invoice = await this.invoices.createFromRun(
      actor,
      { billingRunId: run.id, ...(dto.invoiceDate ? { invoiceDate: dto.invoiceDate } : {}) } as never,
      ip,
    );

    // A 3PL invoice is drafted by one person and approved by another. A
    // household rent bill is handed over at the counter by the person who
    // raised it -- and until it is *issued* it is not on the customer's
    // statement and cannot take a payment, so a draft here is a dead end.
    // So walk it through the same state machine (three audited
    // transitions, no status written behind the engine's back) whenever
    // the person raising it is also allowed to approve invoices. A billing
    // executive, who is not, still leaves a draft for the accountant --
    // that rule is not weakened here, only skipped for the people it was
    // never about.
    const mayApprove = await withTenant(this.sql, actor.tenantId, (tx) =>
      hasPermission(tx, actor, 'approve_invoice'),
    );
    if (mayApprove) {
      await this.invoices.submit(actor, invoice.id, ip);
      await this.invoices.approve(actor, invoice.id, ip);
      invoice = await this.invoices.issue(actor, invoice.id, ip);
    }

    await withTenant(this.sql, actor.tenantId, async (tx) => {
      await tx`
        insert into storage_booking_invoices
          (id, tenant_id, booking_id, invoice_id, period_start, period_end, rent_amount, created_by)
        values (${randomUUID()}, ${actor.tenantId}, ${bookingId}, ${invoice.id},
                ${plan.periodStart}, ${plan.periodEnd}, ${plan.rentAmount}, ${actor.userId})
      `;
      // Both writes matter: the watermark is what stops the same month
      // being billed twice, and the charge rows are what stop a pickup fee
      // riding on every invoice for the rest of the year.
      await tx`
        update storage_bookings set rent_billed_upto = ${plan.periodEnd}, updated_at = now()
        where id = ${bookingId} and tenant_id = ${actor.tenantId}
      `;
      if (plan.charges.length > 0) {
        await tx`
          update storage_booking_charges
          set invoiced_at = now(), invoice_id = ${invoice.id}, updated_at = now()
          where tenant_id = ${actor.tenantId} and id in ${tx(plan.charges.map((c) => c.id))}
        `;
      }
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'storage_booking',
      entityId: bookingId,
      newValue: {
        invoiceNumber: invoice.number,
        periodStart: plan.periodStart,
        periodEnd: plan.periodEnd,
        rentAmount: plan.rentAmount,
        charges: plan.charges.length,
      },
      ipAddress: ip,
    });

    return {
      invoice,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      rentAmount: plan.rentAmount,
      days: plan.days,
    };
  }

  /** Every rent invoice raised against a booking, for the booking screen. */
  async listForBooking(actor: AuthenticatedUser, bookingId: string) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<
        {
          invoice_id: string;
          number: string;
          invoice_date: string;
          grand_total: string;
          amount_paid: string;
          status: string;
          period_start: string;
          period_end: string;
          rent_amount: string;
        }[]
      >`
        select bi.invoice_id, i.number, i.invoice_date, i.grand_total, i.amount_paid, i.status,
               bi.period_start, bi.period_end, bi.rent_amount
        from storage_booking_invoices bi
        join invoices i on i.id = bi.invoice_id
        where bi.tenant_id = ${actor.tenantId} and bi.booking_id = ${bookingId}
        order by bi.period_start desc
      `;
      return rows.map((r) => ({
        invoiceId: r.invoice_id,
        number: r.number,
        invoiceDate: r.invoice_date,
        grandTotal: Number(r.grand_total),
        amountPaid: Number(r.amount_paid),
        outstanding: round2(Number(r.grand_total) - Number(r.amount_paid)),
        status: r.status,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        rentAmount: Number(r.rent_amount),
      }));
    });
  }
}
