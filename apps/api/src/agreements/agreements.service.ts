import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { AgreementTemplateClause, AgreementTemplatesService } from './agreement-templates.service';
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { ListAgreementsQuery } from './dto/list-agreements.query';
import { TerminateAgreementDto } from './dto/terminate-agreement.dto';
import { UpdateAgreementDto } from './dto/update-agreement.dto';

interface AgreementRow {
  id: string;
  number: string;
  agreement_date: string;
  customer_id: string;
  warehouse_id: string | null;
  quotation_id: string | null;
  rate_card_id: string | null;
  template_id: string | null;
  wizard_data: Record<string, unknown>;
  rendered_clauses: AgreementTemplateClause[] | null;
  start_date: string;
  end_date: string | null;
  auto_renew: boolean;
  notice_period_days: number | null;
  status: string;
  approved_at: Date | null;
  approved_by: string | null;
  signed_at: Date | null;
  terminated_at: Date | null;
  termination_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `
  id, number, agreement_date, customer_id, warehouse_id, quotation_id, rate_card_id, template_id,
  wizard_data, rendered_clauses, start_date, end_date, auto_renew, notice_period_days, status,
  approved_at, approved_by, signed_at, terminated_at, termination_reason, created_at, updated_at`;

function toApi(row: AgreementRow) {
  return {
    id: row.id,
    number: row.number,
    agreementDate: row.agreement_date,
    customerId: row.customer_id,
    warehouseId: row.warehouse_id,
    quotationId: row.quotation_id,
    rateCardId: row.rate_card_id,
    templateId: row.template_id,
    wizardData: row.wizard_data,
    renderedClauses: row.rendered_clauses,
    startDate: row.start_date,
    endDate: row.end_date,
    autoRenew: row.auto_renew,
    noticePeriodDays: row.notice_period_days,
    status: row.status,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    signedAt: row.signed_at,
    terminatedAt: row.terminated_at,
    terminationReason: row.termination_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** {{dotted.path}} -> a value from context, or '' if that path isn't present -- a clause must never crash on optional context (no warehouse chosen yet, etc.). */
function resolvePlaceholders(text: string, context: Record<string, unknown>): string {
  return text.replace(/\{\{([\w.]+)\}\}/g, (_match, path: string) => {
    const value = path
      .split('.')
      .reduce<unknown>(
        (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
        context,
      );
    return value === undefined || value === null ? '' : String(value);
  });
}

function renderClauses(clauses: AgreementTemplateClause[], context: Record<string, unknown>): AgreementTemplateClause[] {
  return clauses.map((clause) => ({ ...clause, body: resolvePlaceholders(clause.body, context) }));
}

/**
 * Blueprint §15: the warehousing/storage service agreement. Draft ->
 * Pending Approval -> Approved -> Active (signed), or Terminated/
 * Cancelled. "expired" is in the schema's status enum but has no
 * transition here -- same deferral as quotations' expired state, for the
 * same reason (no scheduler in this codebase yet).
 */
@Injectable()
export class AgreementsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly templates: AgreementTemplatesService,
    private readonly audit: AuditService,
  ) {}

  private async buildContext(
    tx: postgres.TransactionSql,
    tenantId: string,
    customerId: string,
    warehouseId: string | null,
    agreement: {
      number: string;
      agreementDate: string;
      startDate: string;
      endDate: string | null;
      noticePeriodDays: number | null;
    },
  ): Promise<Record<string, unknown>> {
    const [company] = await tx<
      {
        legal_name: string;
        trade_name: string | null;
        address_line1: string | null;
        city: string | null;
        state: string | null;
        pincode: string | null;
        gstin: string | null;
      }[]
    >`
      select legal_name, trade_name, address_line1, city, state, pincode, gstin
      from tenants where id = ${tenantId}
    `;

    const [customer] = await tx<{ name: string; legal_name: string | null; gstin: string | null; pan: string | null }[]>`
      select name, legal_name, gstin, pan from customers where id = ${customerId} and tenant_id = ${tenantId}
    `;
    if (!customer) throw new NotFoundException('Customer not found');

    let warehouse: { name: string; code: string; address_line1: string | null; city: string | null; state: string | null } | null =
      null;
    if (warehouseId) {
      const [row] = await tx<
        { name: string; code: string; address_line1: string | null; city: string | null; state: string | null }[]
      >`
        select name, code, address_line1, city, state from warehouses where id = ${warehouseId} and tenant_id = ${tenantId}
      `;
      if (!row) throw new NotFoundException('Warehouse not found');
      warehouse = row;
    }

    return {
      company: {
        legalName: company.legal_name,
        tradeName: company.trade_name,
        addressLine1: company.address_line1,
        city: company.city,
        state: company.state,
        pincode: company.pincode,
        gstin: company.gstin,
      },
      customer: { name: customer.name, legalName: customer.legal_name ?? customer.name, gstin: customer.gstin, pan: customer.pan },
      warehouse: warehouse
        ? { name: warehouse.name, code: warehouse.code, addressLine1: warehouse.address_line1, city: warehouse.city, state: warehouse.state }
        : {},
      agreement,
    };
  }

  async create(actor: AuthenticatedUser, dto: CreateAgreementDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      let customerId = dto.customerId;
      let warehouseId = dto.warehouseId ?? null;

      if (dto.quotationId) {
        const [quotation] = await tx<{ customer_id: string; warehouse_id: string | null; status: string }[]>`
          select customer_id, warehouse_id, status from quotations
          where id = ${dto.quotationId} and tenant_id = ${actor.tenantId}
        `;
        if (!quotation) throw new NotFoundException('Quotation not found');
        if (quotation.status !== 'accepted') {
          throw new BadRequestException(
            `Cannot create an Agreement from a quotation in '${quotation.status}' status (blueprint §14: "After acceptance provide Create Agreement")`,
          );
        }
        // blueprint §14: "Create Agreement, which pre-fills agreement information" -- an explicit
        // customerId/warehouseId in the request still wins over the quotation's own.
        customerId = customerId ?? quotation.customer_id;
        warehouseId = warehouseId ?? quotation.warehouse_id;
      }
      if (!customerId) {
        throw new BadRequestException('customerId is required (directly, or via an accepted quotationId)');
      }

      if (dto.rateCardId) {
        const [rateCard] = await tx`select 1 from rate_cards where id = ${dto.rateCardId} and tenant_id = ${actor.tenantId}`;
        if (!rateCard) throw new NotFoundException('Rate card not found');
      }

      const template = await this.templates.get(tx, actor.tenantId, dto.templateId);
      if (dto.templateId && !template) throw new NotFoundException('Agreement template not found');

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'AGREEMENT_GENERATION');
      const agreementDate = dto.agreementDate ?? new Date().toISOString().slice(0, 10);

      const context = await this.buildContext(tx, actor.tenantId, customerId, warehouseId, {
        number,
        agreementDate,
        startDate: dto.startDate,
        endDate: dto.endDate ?? null,
        noticePeriodDays: dto.noticePeriodDays ?? null,
      });
      const renderedClauses = template ? renderClauses(template.clauses, context) : null;

      const id = randomUUID();
      await tx`
        insert into agreements (
          id, tenant_id, number, agreement_date, customer_id, warehouse_id, quotation_id, rate_card_id,
          template_id, wizard_data, rendered_clauses, start_date, end_date, auto_renew, notice_period_days,
          created_by, updated_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${agreementDate}, ${customerId}, ${warehouseId}, ${dto.quotationId ?? null},
          ${dto.rateCardId ?? null}, ${template?.id ?? null}, ${JSON.stringify(dto.wizardData ?? {})}::jsonb,
          ${renderedClauses ? JSON.stringify(renderedClauses) : null}::jsonb, ${dto.startDate}, ${dto.endDate ?? null},
          ${dto.autoRenew ?? false}, ${dto.noticePeriodDays ?? null}, ${actor.userId}, ${actor.userId}
        )
      `;

      const [row] = await tx<AgreementRow[]>`select ${tx.unsafe(SELECT_COLUMNS)} from agreements where id = ${id}`;
      return row;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'agreement',
      entityId: result.id,
      newValue: result,
      ipAddress,
    });
    return toApi(result);
  }

  async list(actor: AuthenticatedUser, query: ListAgreementsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<AgreementRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from agreements
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from agreements
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) => tx<AgreementRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from agreements where id = ${id} and tenant_id = ${actor.tenantId}
    `);
    if (!row) throw new NotFoundException('Agreement not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateAgreementDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<AgreementRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from agreements
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (before.status !== 'draft') {
        throw new BadRequestException(`Cannot edit an agreement in '${before.status}' status`);
      }

      const customerId = dto.customerId ?? before.customer_id;
      const warehouseId = dto.warehouseId !== undefined ? dto.warehouseId : before.warehouse_id;
      if (dto.rateCardId) {
        const [rateCard] = await tx`select 1 from rate_cards where id = ${dto.rateCardId} and tenant_id = ${actor.tenantId}`;
        if (!rateCard) throw new NotFoundException('Rate card not found');
      }

      const templateId = dto.templateId !== undefined ? dto.templateId : (before.template_id ?? undefined);
      const template = await this.templates.get(tx, actor.tenantId, templateId);
      if (dto.templateId && !template) throw new NotFoundException('Agreement template not found');

      const agreementDate = dto.agreementDate ?? before.agreement_date;
      const startDate = dto.startDate ?? before.start_date;
      const endDate = dto.endDate !== undefined ? dto.endDate : before.end_date;
      const noticePeriodDays = dto.noticePeriodDays !== undefined ? dto.noticePeriodDays : before.notice_period_days;

      const context = await this.buildContext(tx, actor.tenantId, customerId, warehouseId, {
        number: before.number,
        agreementDate,
        startDate,
        endDate,
        noticePeriodDays,
      });
      const renderedClauses = template ? renderClauses(template.clauses, context) : null;

      await tx`
        update agreements
        set customer_id = ${customerId},
            warehouse_id = ${warehouseId},
            quotation_id = ${dto.quotationId !== undefined ? dto.quotationId : before.quotation_id},
            rate_card_id = ${dto.rateCardId !== undefined ? dto.rateCardId : before.rate_card_id},
            template_id = ${template?.id ?? null},
            wizard_data = ${JSON.stringify(dto.wizardData ?? before.wizard_data)}::jsonb,
            rendered_clauses = ${renderedClauses ? JSON.stringify(renderedClauses) : null}::jsonb,
            agreement_date = ${agreementDate},
            start_date = ${startDate},
            end_date = ${endDate},
            auto_renew = ${dto.autoRenew ?? before.auto_renew},
            notice_period_days = ${noticePeriodDays},
            updated_by = ${actor.userId},
            updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;

      const [after] = await tx<AgreementRow[]>`select ${tx.unsafe(SELECT_COLUMNS)} from agreements where id = ${id}`;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Agreement not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'agreement',
      entityId: id,
      previousValue: result.before,
      newValue: result.after,
      ipAddress,
    });
    return toApi(result.after);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    setClauseFor: (tx: postgres.TransactionSql, before: AgreementRow) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<AgreementRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from agreements
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition an agreement from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await setClauseFor(tx, before);
      const [after] = await tx<AgreementRow[]>`select ${tx.unsafe(SELECT_COLUMNS)} from agreements where id = ${id}`;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Agreement not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'agreement',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.status },
      ipAddress,
    });
    return toApi(result.after);
  }

  submit(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`update agreements set status = 'pending_approval' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  /** approve_agreement is Owner-only (permissions-matrix.md) -- enforced by the controller's @RequirePermission, not here. */
  approve(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending_approval'], async (tx) => {
      await tx`
        update agreements set status = 'approved', approved_at = now(), approved_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  sign(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved'], async (tx) => {
      await tx`update agreements set status = 'active', signed_at = now() where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  terminate(actor: AuthenticatedUser, id: string, dto: TerminateAgreementDto, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved', 'active'], async (tx) => {
      await tx`
        update agreements
        set status = 'terminated', terminated_at = now(), termination_reason = ${dto.reason}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'pending_approval'], async (tx) => {
      await tx`update agreements set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
