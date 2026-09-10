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

> **Implemented** (`apps/api/src/portal/`, Phase 8): the service-layer half
> in full. `PortalGuard` admits only an active `customer` membership and
> re-reads its `customer_id` from `tenant_users` on **every** request --
> a token is authentic but it is also a snapshot, so a portal login that
> has been disabled or re-pointed stops working immediately rather than
> when its token expires. `PortalService` then writes every query in one
> file with `customer_id = ${customerId}` inline: none takes a customer
> from the request, and none calls a staff service that could be handed a
> different one. The portal's one write (a return request, per
> `permissions-matrix.md`) has no `customerId` or `warehouseId` field in
> its DTO at all — both come from the membership.
>
> The other direction is closed independently: the `customer` role is
> seeded with **no permission codes**, so `PermissionsGuard` refuses every
> staff endpoint before its handler runs, and staff are refused the portal
> by the same guard that admits customers. Neither half relies on the
> other. The RLS policy above (`app.customer_id` / `app.actor_kind`) is
> the third layer and is **not yet added** — `schema/90_row_level_security.sql`
> generates tenant policies only, and a portal-specific policy is still
> outstanding.

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

  > **Implemented** (`apps/api/src/auth/warehouse-scope.ts`), and not
  > before the Phase 5 audit: the column was written, returned by the API
  > as an active restriction, and enforced by nothing — an operator
  > "restricted" to one warehouse could create records in, and read stock
  > from, every other warehouse in the tenant. `loadWarehouseScope()` now
  > reads it per request (like the role, so narrowing takes effect
  > immediately rather than at token expiry) and every operational read —
  > gate entries, inwards, GRNs, inspections, discrepancy reports,
  > put-aways, warehouse receipts, `stock_lots`, `stock_ledger`, and the
  > warehouse list itself — carries
  > `and (${scope}::uuid[] is null or warehouse_id = any(${scope}))`.
  >
  > Reads narrow *silently* and writes refuse *loudly*: an out-of-scope
  > record is simply not there (404 on a fetch, absent from a list), which
  > is what a filter means, while a create naming a warehouse the caller
  > may not touch is a `403` — a silent 404 there would read as "that
  > warehouse doesn't exist", which is both confusing and less honest.
  > Where the warehouse is derived rather than chosen (a put-away or
  > warehouse receipt takes it from the GRN), the check is against where
  > the goods actually are.
  >
  > An empty array means *unrestricted*, deliberately: a membership with
  > `warehouse_ids = '{}'` is someone who was never restricted, not
  > someone locked out of everywhere, and treating it as "see nothing"
  > would silently disable an account on a stray empty write.
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
