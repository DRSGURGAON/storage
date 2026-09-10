-- =============================================================================
-- 99_notification_delivery.sql -- Give `notifications` somewhere to record
-- what happened when it tried to deliver
--
-- 70_documents_governance.sql already models the *intent* of blueprint §56
-- correctly: a `channel` per row and a `delivery_status` of
-- pending/sent/failed/read. What it has nowhere to put is the outcome --
-- when the send succeeded, how many times it has been tried, and why the
-- last attempt failed. Without those, a delivery worker can only flip a
-- row to 'failed' and forget: no retry that terminates, no way for an
-- operator to answer "did that invoice email actually go out, and if not,
-- what did the server say?"
--
-- So this is not a nicety. `delivery_status = 'failed'` with no reason
-- attached is the kind of column that looks like observability and
-- provides none.
--
-- attempt_count also bounds the retry loop. A permanent failure (a
-- malformed address, a provider rejecting the sender) must stop being
-- retried, or one bad row is dispatched forever; the worker stops at
-- NOTIFICATION_MAX_ATTEMPTS and leaves the row 'failed' with the last
-- error still readable.
-- =============================================================================

alter table notifications add column if not exists attempt_count integer not null default 0;
alter table notifications add column if not exists last_error text;
alter table notifications add column if not exists sent_at timestamptz;

-- The worker's only query: the oldest pending rows, across channels.
create index if not exists notifications_pending_idx
  on notifications (tenant_id, created_at)
  where delivery_status = 'pending';
