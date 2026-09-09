import 'dotenv/config';
import postgres from 'postgres';
import {
  FEATURE_KEYS,
  FREE_PLAN,
  FREE_PLAN_DOCUMENT_LIMIT,
  METERED_FEATURE_KEYS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_CHARGE_TYPES,
  SYSTEM_ROLES,
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

  const sql = postgres(databaseUrl, { max: 1 });

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
    console.log(
      `seeded FREE plan with ${METERED_FEATURE_KEYS.length} metered + ${UNMETERED_FEATURE_KEYS.length} unlimited feature limits`,
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

    console.log('Seed complete.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
