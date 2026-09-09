-- =============================================================================
-- 93_number_series_null_warehouse_fix.sql -- Same class of bug as
-- 85_integrity_fixes.sql, found implementing allocateNumber()
--
-- number_series.warehouse_id is nullable ("optional per-warehouse series" --
-- most document types get one tenant-wide series, warehouse_id null) and
-- unique (tenant_id, document_type, warehouse_id) is the composite
-- constraint meant to keep each series unique. SQL treats every NULL as
-- distinct for uniqueness, so two number_series rows for the same
-- (tenant, document_type) with warehouse_id null -- the common,
-- tenant-wide case -- would not be caught as duplicates. A lazy-init
-- allocateNumber() call ("create this tenant's GE series if it doesn't
-- exist yet") racing itself would have silently created two competing
-- series instead of erroring or upserting into one.
--
-- Fixed the same way as 85_integrity_fixes.sql: an additive partial
-- unique index for the null-warehouse case. The existing composite
-- constraint still correctly covers the warehouse_id-not-null case
-- unchanged.
-- =============================================================================

create unique index if not exists number_series_tenant_doctype_no_warehouse_uq
  on number_series (tenant_id, document_type) where warehouse_id is null;
