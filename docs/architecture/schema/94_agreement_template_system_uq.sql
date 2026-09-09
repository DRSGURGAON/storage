-- =============================================================================
-- 94_agreement_template_system_uq.sql — the same nullable-tenant_id gap as
-- §16/85_integrity_fixes.sql, caught proactively this time rather than by a
-- failing test: agreement_templates.tenant_id is nullable ("null = system
-- default template") with no unique constraint on it at all, so seeding a
-- system default template idempotently needs an ON CONFLICT target. Without
-- this index, `on conflict (name) where tenant_id is null` has nothing to
-- match against and every seed run would insert a fresh duplicate row. See
-- ../DECISIONS.md for the entry recording this.
-- =============================================================================

create unique index if not exists agreement_templates_system_name_uq
  on agreement_templates (name) where tenant_id is null;
