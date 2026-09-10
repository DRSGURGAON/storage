-- =============================================================================
-- 99b_password_credentials.sql -- Let a password be changed, and let changing
-- it actually mean something
--
-- Until this file, a password could be set exactly once: at signup for an
-- Owner, and by whoever invited you for everyone else. There was no
-- "change my password", no "I forgot it", and no way for an Owner to
-- reissue one. A workspace's only recovery from a forgotten password was
-- a row edited by hand in psql.
--
-- Two things are added, and the second is the one that matters.
--
-- 1. `password_reset_tokens` -- single-use, expiring, and stored only as a
--    SHA-256 hash. The plaintext exists in the email and nowhere else, so a
--    dump of this table (or a backup of it, or a support engineer reading
--    it) cannot be used to take over an account. `used_at` is what makes it
--    single-use: the row is not deleted on use, because "this link was
--    already used" is a different, more useful answer than "no such link",
--    and because the trail of who reset what belongs in the database rather
--    than only in the logs.
--
-- 2. `users.password_changed_at` -- the reason a reset means anything.
--    Sessions here are stateless JWTs with a 12-hour life, so without this
--    column, changing a password locks nobody out: whoever knew the old one
--    keeps a working token for the rest of the day, which is the exact
--    situation a reset exists to end. `JwtAuthGuard` compares a token's
--    `iat` against this column and refuses anything issued before it.
--
--    Backfilled to each user's own `created_at`, not to now(): every token
--    in flight was issued after the account existed, so a deployment of
--    this change must not sign out everyone who is mid-shift.
-- =============================================================================

alter table users add column if not exists password_changed_at timestamptz;

update users set password_changed_at = created_at where password_changed_at is null;

alter table users alter column password_changed_at set default now();
alter table users alter column password_changed_at set not null;

-- And `session_epoch`, which is what the guard actually compares.
--
-- The first attempt compared a token's `iat` against `password_changed_at`
-- and did not work: `iat` is whole seconds, so a token minted at 10.2s and
-- a password changed at 10.9s are indistinguishable, and the test that
-- signed in and immediately changed its password watched the old token
-- keep working. A counter has no resolution to lose. The token carries the
-- epoch it was minted under; the guard refuses anything below the current
-- one.
--
-- `password_changed_at` stays: it is what an Owner reads in the audit
-- trail and what a support conversation needs ("when did this last
-- change?"). The counter enforces; the timestamp explains.
alter table users add column if not exists session_epoch integer not null default 0;

create table if not exists password_reset_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  -- SHA-256 of the token the email carries. Not argon2: this is a
  -- 256-bit random value, not a human-chosen password, so there is no
  -- dictionary to slow an attacker down against -- and a reset lookup
  -- that costs 100ms of memory-hard hashing is a denial-of-service
  -- invitation on an endpoint anyone can call.
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip text,
  created_at timestamptz not null default now()
);

-- The only query the reset path makes: one token, by its hash.
create index if not exists password_reset_tokens_user_idx
  on password_reset_tokens (user_id) where used_at is null;

-- `users` is global identity, not tenant data (a person can hold
-- memberships in several workspaces), so neither table is tenant-scoped
-- and neither carries a row-level security policy. Access is controlled by
-- the fact that only the auth module reads them, and only by a token hash
-- the caller had to already possess.

-- `audit_logs.action` is a CHECK against a fixed list, so the four
-- credential events have to be added to it or the insert that records them
-- fails -- and it fails *inside* the password change, rolling back a
-- change the caller was told nothing about. Found exactly that way: the
-- first run of the new tests turned "wrong current password" into a 500.
alter table audit_logs drop constraint if exists audit_logs_action_check;
alter table audit_logs add constraint audit_logs_action_check check (
  action in (
    'create', 'update', 'delete', 'approve', 'reject', 'cancel',
    'stock_adjustment', 'status_change', 'document_generate', 'document_regenerate',
    'login', 'login_failed', 'permission_denied',
    'password_changed', 'password_change_failed', 'password_reset', 'password_set_for_member',
    'account_deleted', 'workspace_deletion_requested'
  )
);

-- An anonymised account has no password: `deleteOwnAccount` clears the
-- hash rather than leaving a live credential attached to a name that is no
-- longer anybody's. The column was already nullable (a membership can be
-- created for an email that has not set one yet), so this is a note rather
-- than a change -- but the login path's `if (!user.password_hash)` is what
-- makes a deleted account unreachable, and that is worth writing down next
-- to the constraint rather than leaving as a coincidence.

-- `users.deleted_at` -- an account that has been deleted, said explicitly.
--
-- Anonymising the row (name replaced, email rewritten to an unroutable
-- address, password cleared) is what removes the personal data, but it
-- leaves no reliable way to *ask* whether an account is gone: the closest
-- thing is pattern-matching an email domain, which is the kind of check
-- that works until somebody changes the domain. An Owner is offered "Set
-- password" against every member, and against a deleted one that would be
-- an offer to bring the account back.
alter table users add column if not exists deleted_at timestamptz;

create index if not exists users_active_idx on users (id) where deleted_at is null;
