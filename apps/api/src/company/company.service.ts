import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { SetSettingDto } from './dto/set-setting.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { SETTINGS_BY_KEY, TENANT_SETTINGS, validateSettingValue } from './tenant-settings.registry';

interface TenantRow {
  id: string;
  slug: string;
  legal_name: string;
  trade_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  gstin: string | null;
  pan: string | null;
  cin: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  terms_and_conditions: string | null;
  financial_year_start_month: number;
  timezone: string;
  currency: string;
  status: string;
  updated_at: string;
}

const SELECT_COLUMNS = `
  id, slug, legal_name, trade_name, address_line1, address_line2, city, state, state_code,
  pincode, gstin, pan, cin, phone, email, website, bank_name, bank_account_no, bank_ifsc,
  bank_branch, signatory_name, signatory_designation, terms_and_conditions,
  financial_year_start_month, timezone, currency, status, updated_at`;

/** DTO field -> column, and the whole set of columns this endpoint may write. */
const COLUMN_MAP: Record<keyof UpdateCompanyDto, string> = {
  legalName: 'legal_name',
  tradeName: 'trade_name',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  state: 'state',
  stateCode: 'state_code',
  pincode: 'pincode',
  gstin: 'gstin',
  pan: 'pan',
  cin: 'cin',
  phone: 'phone',
  email: 'email',
  website: 'website',
  bankName: 'bank_name',
  bankAccountNo: 'bank_account_no',
  bankIfsc: 'bank_ifsc',
  bankBranch: 'bank_branch',
  signatoryName: 'signatory_name',
  signatoryDesignation: 'signatory_designation',
  termsAndConditions: 'terms_and_conditions',
  timezone: 'timezone',
  currency: 'currency',
};

function toApi(row: TenantRow) {
  return {
    id: row.id,
    slug: row.slug,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    stateCode: row.state_code,
    pincode: row.pincode,
    gstin: row.gstin,
    pan: row.pan,
    cin: row.cin,
    phone: row.phone,
    email: row.email,
    website: row.website,
    bankName: row.bank_name,
    bankAccountNo: row.bank_account_no,
    bankIfsc: row.bank_ifsc,
    bankBranch: row.bank_branch,
    signatoryName: row.signatory_name,
    signatoryDesignation: row.signatory_designation,
    termsAndConditions: row.terms_and_conditions,
    financialYearStartMonth: row.financial_year_start_month,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status,
    updatedAt: row.updated_at,
    // What a document's letterhead needs before it stops looking unfinished
    // -- surfaced so the onboarding wizard and settings page can say so
    // without re-deriving the rule.
    isDocumentReady: Boolean(row.gstin && row.address_line1 && row.city && row.state && row.pincode),
  };
}

/**
 * The company profile behind every document (`documents/company-context.ts`
 * builds the letterhead from it, and the seeded agreement template resolves
 * `{{company.legalName}}`, `{{company.gstin}}`, `{{company.addressLine1}}`
 * and friends against it), plus the `tenant_settings` key/value store.
 *
 * Until this existed, signup wrote `legal_name` and nothing in the codebase
 * could ever write the rest: every letterhead rendered with a bare company
 * name and no GSTIN or address, and every agreement's Parties clause had
 * holes in it. `tenant_settings` had no writer at all, which meant
 * `stock.allow_negative` -- documented in three places as implemented --
 * could not actually be turned on. See `DECISIONS.md` §35.
 *
 * `tenants` is the one table with no RLS policy, because it is keyed by
 * `id` rather than `tenant_id` (schema/90's generator looks for the latter).
 * So the `where id = ${actor.tenantId}` filter here is the *only* thing
 * scoping these writes -- there is no second layer to catch a mistake, and
 * that is why it is stated explicitly on every statement below rather than
 * left to `withTenant`.
 */
@Injectable()
export class CompanyService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async getProfile(actor: AuthenticatedUser) {
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) => tx<TenantRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from tenants where id = ${actor.tenantId}
    `);
    if (!row) throw new NotFoundException('Company not found');
    return toApi(row);
  }

  async updateProfile(actor: AuthenticatedUser, dto: UpdateCompanyDto, ipAddress?: string) {
    const patch: Record<string, unknown> = {};
    for (const [field, column] of Object.entries(COLUMN_MAP)) {
      const value = dto[field as keyof UpdateCompanyDto];
      if (value !== undefined) patch[column] = value === '' ? null : value;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No company fields to update');
    }

    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<TenantRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from tenants where id = ${actor.tenantId} for update
      `;
      if (!before) return null;
      await tx`
        update tenants set ${tx(patch)}, updated_at = now() where id = ${actor.tenantId}
      `;
      const [after] = await tx<TenantRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from tenants where id = ${actor.tenantId}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Company not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'tenant',
      entityId: actor.tenantId,
      previousValue: result.before,
      newValue: result.after,
      ipAddress,
    });
    return toApi(result.after);
  }

  /**
   * Every *known* setting with its effective value, whether or not the
   * tenant has stored one -- so a settings page shows the real behaviour
   * rather than a list of blanks, and `source` says which is which.
   */
  async listSettings(actor: AuthenticatedUser) {
    const stored = await withTenant(this.sql, actor.tenantId, (tx) => tx<{ key: string; value: unknown }[]>`
      select key, value from tenant_settings where tenant_id = ${actor.tenantId}
    `);
    const byKey = new Map(stored.map((r) => [r.key, r.value]));
    return TENANT_SETTINGS.map((def) => ({
      key: def.key,
      type: def.type,
      value: byKey.has(def.key) ? byKey.get(def.key) : def.default,
      default: def.default,
      source: byKey.has(def.key) ? 'tenant' : 'default',
      description: def.description,
      ...(def.allowed ? { allowed: def.allowed } : {}),
    }));
  }

  async setSetting(actor: AuthenticatedUser, key: string, dto: SetSettingDto, ipAddress?: string) {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) {
      // Fail closed on an unknown key rather than storing it: a typo that
      // saves cleanly and then does nothing is the exact failure this
      // registry exists to prevent.
      throw new BadRequestException(
        `Unknown setting '${key}'. Known settings: ${TENANT_SETTINGS.map((s) => s.key).join(', ')}`,
      );
    }
    const problem = validateSettingValue(def, dto.value);
    if (problem) throw new BadRequestException(problem);

    await withTenant(this.sql, actor.tenantId, (tx) => tx`
      insert into tenant_settings (tenant_id, key, value, updated_by, updated_at)
      values (${actor.tenantId}, ${key}, ${JSON.stringify(dto.value)}::jsonb, ${actor.userId}, now())
      on conflict (tenant_id, key)
      do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
    `);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'tenant_setting',
      entityId: actor.tenantId,
      newValue: { key, value: dto.value },
      ipAddress,
    });
    return { key, value: dto.value, source: 'tenant' as const, default: def.default };
  }

  /** Clearing a setting returns it to its documented default, never to null. */
  async clearSetting(actor: AuthenticatedUser, key: string, ipAddress?: string) {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) throw new BadRequestException(`Unknown setting '${key}'`);

    await withTenant(this.sql, actor.tenantId, (tx) => tx`
      delete from tenant_settings where tenant_id = ${actor.tenantId} and key = ${key}
    `);
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'delete',
      entityType: 'tenant_setting',
      entityId: actor.tenantId,
      newValue: { key },
      ipAddress,
    });
    return { key, value: def.default, source: 'default' as const, default: def.default };
  }
}
