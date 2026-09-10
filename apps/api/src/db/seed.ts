import 'dotenv/config';
import { createDbConnection } from './client';
import {
  FEATURE_KEYS,
  FREE_PLAN,
  FREE_PLAN_DOCUMENT_LIMIT,
  FREE_PLAN_WAREHOUSES,
  PAID_PLANS,
  METERED_FEATURE_KEYS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_AGREEMENT_TEMPLATE,
  SYSTEM_CHARGE_TYPES,
  SYSTEM_ROLES,
  SYSTEM_NOTIFICATION_RULES,
  SYSTEM_TAX_RATES,
  UNMETERED_FEATURE_KEYS,
} from './seed-data';

/**
 * Idempotent: safe to run on every deploy. Relies on
 * schema/85_integrity_fixes.sql's partial unique index on
 * roles(code) where tenant_id is null -- without it, ON CONFLICT (code)
 * would not match these rows at all (see DECISIONS.md §16), and every run
 * would insert a fresh set of duplicate system roles.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  }

  // Goes through the same createDbConnection() factory (and its drizzle()
  // wrapping) as the running app, rather than a bare postgres() connection
  // of its own -- see DECISIONS.md §23 for why that divergence mattered.
  const { sql } = createDbConnection(databaseUrl);

  try {
    const roleIds = new Map<string, string>();

    for (const role of SYSTEM_ROLES) {
      const [row] = await sql<{ id: string }[]>`
        insert into roles (id, tenant_id, code, name, is_system)
        values (gen_random_uuid(), null, ${role.code}, ${role.name}, true)
        on conflict (code) where tenant_id is null
        do update set name = excluded.name
        returning id
      `;
      roleIds.set(role.code, row.id);
    }
    console.log(`seeded ${SYSTEM_ROLES.length} system roles`);

    for (const permission of PERMISSIONS) {
      await sql`
        insert into permissions (code, module)
        values (${permission.code}, ${permission.module})
        on conflict (code) do update set module = excluded.module
      `;
    }
    console.log(`seeded ${PERMISSIONS.length} permissions`);

    let grantCount = 0;
    for (const [roleCode, permissionCodes] of Object.entries(
      ROLE_PERMISSIONS,
    )) {
      const roleId = roleIds.get(roleCode);
      if (!roleId) {
        throw new Error(`Unknown role code in ROLE_PERMISSIONS: ${roleCode}`);
      }
      for (const permissionCode of permissionCodes) {
        await sql`
          insert into role_permissions (role_id, permission_code)
          values (${roleId}, ${permissionCode})
          on conflict (role_id, permission_code) do nothing
        `;
        grantCount++;
      }
    }
    console.log(`seeded ${grantCount} role-permission grants`);

    for (const feature of FEATURE_KEYS) {
      await sql`
        insert into feature_keys (code, module, name, is_meterable)
        values (${feature.code}, ${feature.module}, ${feature.name}, ${feature.isMeterable})
        on conflict (code)
        do update set module = excluded.module, name = excluded.name, is_meterable = excluded.is_meterable
      `;
    }
    console.log(`seeded ${FEATURE_KEYS.length} feature keys`);

    const [freePlan] = await sql<{ id: string }[]>`
      insert into plans (id, code, name, description, is_public, is_active, trial_days, price_monthly, price_yearly, sort_order)
      values (gen_random_uuid(), ${FREE_PLAN.code}, ${FREE_PLAN.name}, ${FREE_PLAN.description}, ${FREE_PLAN.isPublic}, true, ${FREE_PLAN.trialDays}, ${FREE_PLAN.priceMonthly}, ${FREE_PLAN.priceYearly}, 0)
      on conflict (code) do update set name = excluded.name, description = excluded.description
      returning id
    `;

    // The 2-free-copies rule (entitlement-engine.md §6): seed data, not a
    // constant in application code.
    for (const feature of METERED_FEATURE_KEYS) {
      await sql`
        insert into plan_feature_limits (id, plan_id, feature_code, limit_type, limit_value, period)
        values (gen_random_uuid(), ${freePlan.id}, ${feature.code}, 'counted', ${FREE_PLAN_DOCUMENT_LIMIT}, 'lifetime')
        on conflict (plan_id, feature_code)
        do update set limit_type = excluded.limit_type, limit_value = excluded.limit_value, period = excluded.period
      `;
    }
    // "Always available" (v1-scope-specification.md §7) has to be an explicit
    // unlimited row -- entitlement-engine.md §3 resolves an absent row to
    // disabled, fail-closed, not to unlimited.
    for (const feature of UNMETERED_FEATURE_KEYS) {
      await sql`
        insert into plan_feature_limits (id, plan_id, feature_code, limit_type, limit_value, period)
        values (gen_random_uuid(), ${freePlan.id}, ${feature.code}, 'unlimited', null, 'lifetime')
        on conflict (plan_id, feature_code)
        do update set limit_type = excluded.limit_type, limit_value = excluded.limit_value, period = excluded.period
      `;
    }
    // One godown on Free. Enough to run a real warehouse end to end and
    // decide whether this is worth paying for -- which is the only job the
    // free plan has.
    await sql`
      insert into plan_feature_limits (id, plan_id, feature_code, limit_type, limit_value, period)
      values (gen_random_uuid(), ${freePlan.id}, 'WAREHOUSE', 'counted', ${FREE_PLAN_WAREHOUSES}, 'lifetime')
      on conflict (plan_id, feature_code)
      do update set limit_type = excluded.limit_type, limit_value = excluded.limit_value, period = excluded.period
    `;
    console.log(
      `seeded FREE plan with ${METERED_FEATURE_KEYS.length} metered + ${UNMETERED_FEATURE_KEYS.length} unlimited feature limits`,
    );

    // The paid plans. Everything is unlimited on them except the godown
    // count, which is what they are priced on -- see PAID_PLANS in
    // seed-data.ts, which is the one place to change a price.
    //
    // Upserted rather than inserted, so changing a price and re-running the
    // seed moves it. `plan_feature_limits` is upserted the same way, which
    // is what lets a plan's allowance be raised without a migration.
    for (const plan of PAID_PLANS) {
      const [row] = await sql<{ id: string }[]>`
        insert into plans (id, code, name, description, is_public, is_active, trial_days,
                           price_monthly, price_yearly, currency, sort_order)
        values (gen_random_uuid(), ${plan.code}, ${plan.name}, ${plan.description}, true, true,
                ${plan.trialDays}, ${plan.priceMonthly}, ${plan.priceYearly}, 'INR', ${plan.sortOrder})
        on conflict (code) do update set
          name = excluded.name, description = excluded.description,
          trial_days = excluded.trial_days, price_monthly = excluded.price_monthly,
          price_yearly = excluded.price_yearly, currency = excluded.currency,
          sort_order = excluded.sort_order, is_public = excluded.is_public, is_active = excluded.is_active
        returning id
      `;
      await sql`
        insert into plan_feature_limits (id, plan_id, feature_code, limit_type, limit_value, period)
        values (gen_random_uuid(), ${row.id}, 'WAREHOUSE', 'counted', ${plan.warehouses}, 'lifetime')
        on conflict (plan_id, feature_code)
        do update set limit_type = excluded.limit_type, limit_value = excluded.limit_value, period = excluded.period
      `;
      // Every document type, unlimited. An absent row resolves to disabled
      // (entitlement-engine.md §3, fail-closed), so "unlimited" has to be
      // written down -- a paid plan that simply omitted these would refuse
      // to generate anything at all.
      for (const feature of [...METERED_FEATURE_KEYS, ...UNMETERED_FEATURE_KEYS]) {
        await sql`
          insert into plan_feature_limits (id, plan_id, feature_code, limit_type, limit_value, period)
          values (gen_random_uuid(), ${row.id}, ${feature.code}, 'unlimited', null, 'lifetime')
          on conflict (plan_id, feature_code)
          do update set limit_type = excluded.limit_type, limit_value = excluded.limit_value, period = excluded.period
        `;
      }
    }
    console.log(
      `seeded ${PAID_PLANS.length} paid plans (${PAID_PLANS.map((p) => `${p.code} ${p.warehouses}x`).join(', ')})`,
    );

    for (const chargeType of SYSTEM_CHARGE_TYPES) {
      await sql`
        insert into charge_types (id, tenant_id, code, name, category, default_basis, trigger_event, is_billable_event)
        values (gen_random_uuid(), null, ${chargeType.code}, ${chargeType.name}, ${chargeType.category},
                ${chargeType.defaultBasis}, ${chargeType.triggerEvent}, ${chargeType.triggerEvent !== null})
        on conflict (code) where tenant_id is null
        do update set name = excluded.name, category = excluded.category,
                       default_basis = excluded.default_basis, trigger_event = excluded.trigger_event
      `;
    }
    console.log(`seeded ${SYSTEM_CHARGE_TYPES.length} system charge types`);

    for (const taxRate of SYSTEM_TAX_RATES) {
      await sql`
        insert into tax_rates (id, tenant_id, code, name, rate_pct)
        values (gen_random_uuid(), null, ${taxRate.code}, ${taxRate.name}, ${taxRate.ratePct})
        on conflict (code) where tenant_id is null
        do update set name = excluded.name, rate_pct = excluded.rate_pct
      `;
    }
    console.log(`seeded ${SYSTEM_TAX_RATES.length} system tax rates`);

    for (const rule of SYSTEM_NOTIFICATION_RULES) {
      await sql`
        insert into notification_rules (id, tenant_id, code, channels, audience_role_codes, is_active)
        values (gen_random_uuid(), null, ${rule.code}, ${rule.channels as unknown as string[]}, ${rule.audience as unknown as string[]}, true)
        on conflict (code) where tenant_id is null
        do update set channels = excluded.channels, audience_role_codes = excluded.audience_role_codes
      `;
    }
    console.log(`seeded ${SYSTEM_NOTIFICATION_RULES.length} system notification rules`);

    await sql`
      insert into agreement_templates (id, tenant_id, name, version, clauses)
      values (gen_random_uuid(), null, ${SYSTEM_AGREEMENT_TEMPLATE.name}, 1, ${JSON.stringify(SYSTEM_AGREEMENT_TEMPLATE.clauses)}::jsonb)
      on conflict (name) where tenant_id is null
      do update set clauses = excluded.clauses
    `;
    console.log('seeded system default agreement template');

    console.log('Seed complete.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
