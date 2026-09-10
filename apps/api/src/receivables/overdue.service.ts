import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * `workflow-and-statuses.md` §3: "Overdue is not a manual click — a
 * scheduled job flips issued/partially_paid invoices past due_date to
 * overdue." This is that job.
 *
 * It runs across every tenant, and that is exactly why it **loops** rather
 * than issuing one global `update`. `invoices` is under
 * `FORCE ROW LEVEL SECURITY`, so a statement on the bare connection --
 * with no `app.tenant_id` set -- matches zero rows and reports success:
 * the job would have run nightly, logged nothing, and flipped nothing.
 * (The first cut did precisely that, and the spec caught it.) So the
 * tenant list is read from `tenants`, which is keyed by `id` and carries
 * no policy, and each tenant's invoices are updated inside its own
 * `withTenant` transaction.
 *
 * The update is guarded by the same conditions the status machine states,
 * which is why it is safe to run as often as it likes: an invoice already
 * `overdue` matches nothing, and one that has since been paid is excluded
 * by `balance_due > 0`.
 *
 * The reverse direction is not this job's business: a payment recomputes
 * its invoice's status in `PaymentsService`, which is where the money
 * actually moved.
 */
@Injectable()
export class OverdueService {
  private readonly logger = new Logger(OverdueService.name);

  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'flip-overdue-invoices' })
  async scheduled() {
    const flipped = await this.flipOverdue();
    if (flipped.length > 0) this.logger.log(`Marked ${flipped.length} invoice(s) overdue`);
  }

  /** Returns what it flipped, so a caller that triggers it directly can report. */
  async flipOverdue(tenantId?: string): Promise<{ id: string; number: string; tenantId: string; dueDate: string; balanceDue: string }[]> {
    const tenants = tenantId
      ? [{ id: tenantId }]
      : await this.sql<{ id: string }[]>`select id from tenants where status = 'active'`;
    const flipped: { id: string; number: string; tenantId: string; dueDate: string; balanceDue: string }[] = [];
    for (const tenant of tenants) {
      const rows = await withTenant(this.sql, tenant.id, (tx) => tx<{ id: string; number: string; due_date: string; balance_due: string }[]>`
        update invoices set status = 'overdue', updated_at = now()
        where tenant_id = ${tenant.id} and status in ('issued', 'partially_paid')
          and due_date is not null and due_date < current_date and balance_due > 0
        returning id, number, due_date, balance_due
      `);
      for (const r of rows) {
        flipped.push({ id: r.id, number: r.number, tenantId: tenant.id, dueDate: r.due_date, balanceDue: r.balance_due });
      }
    }
    return flipped;
  }
}
