# Tenancy & Security

Blueprint refs: §6, §52, §53, §69

## 1. Tenant isolation model

Every business (warehouse operator company) that signs up is one row in
`tenants`. Every table that stores tenant-owned data carries a `tenant_id`
column (see `schema/README.md` conventions). Isolation is enforced in **two
independent layers**, because the blueprint explicitly forbids relying on the
frontend alone (§6, §69):

1. **Service-layer guard (primary).** The authenticated request always
   resolves to exactly one `tenant_id` (from the session/JWT), and every
   repository/query method requires that value as a mandatory first
   argument — there is no code path that queries a tenant-scoped table
   without it. This is enforced by a lint rule / code-review gate, not
   convention alone: repository methods for tenant-scoped tables are
   generated with `tenant_id` as a non-optional parameter.
2. **Database row-level security (defense in depth).** Every tenant-scoped
   table has `ENABLE ROW LEVEL SECURITY` with a policy of the form
   `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. The
   application sets `app.tenant_id` once per request/transaction
   (`SET LOCAL app.tenant_id = $1`) immediately after authenticating. Even a
   bug that forgets a `WHERE tenant_id = ...` clause cannot leak another
   tenant's rows, because Postgres silently filters them out.

A user is never trusted to supply `tenant_id` on a request; it is derived
server-side from `tenant_users` for the authenticated `user_id`.

## 2. Customer portal isolation (§53)

Customer-portal logins are ordinary `tenant_users` rows with `role = customer`
and a mandatory `customer_id`. All portal queries add a second, non-optional
filter: `customer_id = tenant_users.customer_id`, enforced the same
belt-and-braces way as tenant isolation:

- Service layer: portal API controllers use a distinct base repository that
  hard-codes the `customer_id` filter; it is structurally impossible to call
  the "all customers" query path from a portal request handler.
- RLS: an additional policy on customer-visible tables
  (`grns`, `warehouse_receipts`, `dispatches`, `pods`, `invoices`,
  `payment_receipts`, `stock_lots`, `documents`, …) checks
  `customer_id = current_setting('app.customer_id')::uuid` when
  `current_setting('app.actor_kind') = 'customer_portal'`.

Document downloads (§53, §75) go through a signed, time-limited URL generated
per request from `attachments.storage_key` — the object store is never
publicly readable, and the sign step re-checks tenant/customer ownership at
issue time (see §5 below).

## 3. Authentication

- Staff users (`users` table) authenticate with password + optional
  MFA, or SSO/OIDC where the tenant configures it. A `users` row is global;
  `tenant_users` is where role/tenant/customer scoping lives, so one email can
  belong to multiple tenants (e.g. a consultant) without duplicate identities.
- Sessions carry `user_id`, the active `tenant_id` (chosen at login if the
  user belongs to more than one tenant), and `role_id`.
- Passwords are hashed with a memory-hard KDF (argon2id/bcrypt); this
  document does not select a specific auth stack since no framework has been
  chosen yet (see `DECISIONS.md` §0).

## 4. Authorization (RBAC)

- `roles` + `permissions` + `role_permissions` implement the granular
  permission codes listed in blueprint §52 (`view_customer`,
  `approve_grn`, `create_stock_adjustment`, …) — see
  [`permissions-matrix.md`](permissions-matrix.md) for the full grid.
- Every API endpoint declares the permission code(s) it requires; the
  request is rejected with 403 before any handler logic runs if the acting
  user's role lacks it. This is enforced centrally (middleware/decorator),
  not per-handler, so a new endpoint cannot ship without an explicit
  permission check.
- `tenant_users.warehouse_ids` optionally restricts a Warehouse
  Manager/Operator to specific warehouses; when set, every operational query
  additionally filters `warehouse_id = ANY(tenant_users.warehouse_ids)`.
- Permission checks and RLS are independent: RBAC decides *whether this role
  may perform this action at all*; RLS decides *which rows of that type this
  tenant/customer may see*. Both must pass.

## 5. Secure file access (§69)

- `attachments.storage_key` is never exposed to the client directly.
- Downloads are served via short-lived signed URLs (or a proxy endpoint) that
  re-validates: the requester's tenant matches `attachments.tenant_id`, and
  for portal users, that the owning record's `customer_id` matches the
  session's `customer_id`.
- QR verification pages (§48) are the one deliberate public exception, and
  only expose the minimal fields listed in `document-engine.md` §4 — never
  the underlying `attachments` row or `render_data_snapshot`.

## 6. Audit logging & rate limiting

- Every mutating action funnels through a single service-layer interceptor
  that writes one `audit_logs` row (see `schema/70_documents_governance.sql`)
  with the previous/new value, before returning success to the caller — so an
  audit-log write failure fails the whole request rather than silently
  skipping the record.
- Login attempts, permission denials, and public endpoints (QR verification,
  portal login) are rate-limited per IP/user to blunt credential stuffing and
  token enumeration; thresholds are a deployment-time configuration, not a
  schema concern.

## 7. Input validation

- All write endpoints validate against a schema (types, required fields,
  enum membership, cross-field rules such as
  `accepted_qty + rejected_qty <= received_qty` on GRN lines) before touching
  the database. Database `check` constraints are the last line of defense,
  not the primary one, so validation errors surface as clear messages
  (§61) rather than raw constraint-violation text.
