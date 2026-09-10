-- =============================================================================
-- 97_payment_idempotency.sql — billing-engine.md §7 / blueprint §61, §79:
-- "Duplicate payment posting" is prevented the same way duplicate stock
-- postings are (stock-engine.md §4): the client sends a token with the
-- request and the database refuses the second insert carrying it.
--
-- 60_billing.sql defines payment_receipts without a place to put that token,
-- which makes the requirement unenforceable rather than merely unimplemented
-- -- a retried "Record Payment" click would insert a second receipt and
-- silently over-credit the customer. The column belongs on the table, so it
-- is added here rather than worked around in application code.
-- =============================================================================

alter table payment_receipts add column if not exists idempotency_key text;

-- Per tenant, not global: two tenants' clients may generate the same token.
-- Partial, so receipts recorded before this column existed (and any future
-- server-side insert with no client token) do not collide on null.
create unique index if not exists payment_receipts_idempotency_uq
  on payment_receipts (tenant_id, idempotency_key)
  where idempotency_key is not null;
