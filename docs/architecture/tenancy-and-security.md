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
   query against a tenant-scoped table runs inside
   `withTenant(sql, tenantId, fn)` (`apps/api/src/db/tenant-context.ts`),
   which opens a transaction, sets `app.tenant_id` for it, and hands the
   callback the only handle that can see the tenant's rows. Services also
   carry their own `where tenant_id = ${...}` clauses, so the filter is
   explicit in the SQL as well as enforced under it. There is no generated
   repository layer and no lint rule policing this: the discipline is
   `withTenant` plus layer 2 below, which is what actually makes a forgotten
   filter harmless.
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
  the "all customers" query path from a portal request handler. Built as
  `apps/api/src/portal/portal.service.ts` — one file, every query written
  with `customer_id = ${customerId}` inline, none of them taking a customer
  from the request and none of them calling a staff service that could be
  handed a different one.
- Database layer: `schema/98_portal_row_level_security.sql` adds a
  **restrictive** policy, `portal_customer_isolation`, to every table with a
  `customer_id` (and to `customers`, on its `id`). A portal request runs
  through `withPortalTenant()`, which sets `app.actor_kind = 'customer'` and
  `app.customer_id` alongside `app.tenant_id`; the policy narrows every read
  and write to that customer. It has to be *restrictive*, not another
  ordinary policy: permissive policies are OR-ed together, so a second one
  would have widened access rather than narrowed it, and the portal's own
  tests would still have passed. Staff requests never set `app.actor_kind`,
  so the added clause is trivially true for them and nothing else in the
  application changes.
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
- Passwords are hashed with **argon2id** (`argon2`), and the auth stack is
  Passport-JWT under NestJS (`apps/api/src/auth/`): `JwtAuthGuard` resolves
  the session, `PermissionsGuard` enforces §4's permission codes, and both
  are wired as global guards so a route cannot ship without passing them.
  MFA and SSO/OIDC are described here but not built in V1.

### 3a. Changing a password, and what that does to a session

A password could be set exactly once for the first twenty phases: at
signup, or by whoever invited you. Four routes now exist, because a
warehouse has four situations:

| Route | Who | Needs |
| --- | --- | --- |
| `POST /auth/change-password` | signed in | the current password |
| `POST /auth/forgot-password` | anyone | an email address |
| `POST /auth/reset-password` | anyone | a link from that email |
| `POST /users/:id/password` | Owner/Admin (`manage_users_and_roles`) | nothing but the permission |

The last one is the path that works with no mail server at all, and on a
warehouse floor it is the common one: the person who forgot their password
is standing in front of the person who can fix it. It refuses the caller's
own membership — an Owner changes their own password where the current one
has to be typed, or this route would be a way around ever knowing it.

`forgot-password` answers identically whether or not the address has an
account, and is rate-limited per credential rather than per IP, so it
cannot be walked down a list. The token is 256 bits of randomness stored
only as a SHA-256: the plaintext exists in the email and nowhere else, so a
dump of `password_reset_tokens` cannot be used to take an account over. It
is single-use and expires in an hour, and using one cancels every other
outstanding link for that account.

**What makes any of this mean something is `users.session_epoch`**
(`schema/99b_password_credentials.sql`). Sessions are stateless JWTs with a
twelve-hour life, so without it a reset locks nobody out: whoever knew the
old password keeps a working token for the rest of the day — the exact
situation a reset exists to end. Every token carries the epoch it was
minted under, every password write increments it, and `JwtStrategy` refuses
anything behind the current value.

It is a counter rather than a timestamp comparison because `iat` has
one-second resolution: a token minted at 10.2s and a password changed at
10.9s are indistinguishable by time, and the first implementation of this
check let exactly that token through. `password_changed_at` is still
recorded — it is what an audit trail and a support conversation need — but
the counter is what enforces.

The same lookup answers a second question that used to go unasked: is this
membership still active? A membership disabled at 9am kept working until
that evening. Both refusals are **401, not 403** — "this session is over"
rather than "you may not do this" — which is the difference between a
client signing someone out and leaving them staring at a permission error
on every screen.

The cost is one indexed lookup per authenticated request, next to the
several every handler already makes. That is the price of a session that
can be ended.

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
- Downloads are served two ways, and both re-validate rather than trusting an
  id the caller supplied:
  - **The authenticated proxy endpoint.** `GET /documents/:id/download`
    (and the portal's own `GET /portal/documents/:id/download`) reads the row
    under the caller's tenant context and streams the bytes. This is the
    default path and the only one a normal UI needs.
  - **A short-lived signed link**, for the places a session cannot travel:
    an `<iframe>` preview, a print window, a PDF forwarded by email.
    `POST /documents/:id/download-link` (or its portal twin) returns
    `/document-links/<token>`, where the token is
    `base64url(claims).base64url(HMAC-SHA256(claims))` and the claims name
    one document, its tenant, an optional customer, and an expiry — five
    minutes by default (`DOCUMENT_LINK_TTL_SECONDS`). The public consumer
    (`apps/api/src/documents/download-link.service.ts`) checks the signature
    in constant time before parsing anything, refuses an expired token with a
    message that says so, and re-reads the document under the claims' tenant
    *and* customer, so a valid signature can never be walked sideways onto
    another customer's file.

    The claims travel in the link rather than in a table, so consuming one
    costs no write and there is nothing to expire out of a database. The
    trade, stated plainly: **a minted link cannot be revoked before it
    expires.** That is what makes the lifetime minutes rather than days, and
    why a link names a single document rather than a customer or a folder.
    It is a bearer capability, not a second authentication scheme.
- QR verification pages (§48) are the one deliberate public exception, and
  only expose the minimal fields listed in `document-engine.md` §4 — never
  the underlying `attachments` row or `render_data_snapshot`.

## 6. Audit logging & rate limiting

- Every mutating action writes one `audit_logs` row (see
  `schema/70_documents_governance.sql`) with the previous/new value, inside
  the same transaction as the change — so an audit-log write failure rolls
  the change back rather than silently skipping the record. This is an
  explicit `this.audit.record(...)` call in each service
  (`apps/api/src/audit/audit.service.ts`), not an interceptor: an
  interceptor sees the HTTP verb and the DTO, but not *which* row changed or
  what it held before, which is the part worth recording. The cost of the
  choice is that a new mutating endpoint can forget to audit; the
  compensating control is that every module's spec asserts the audit row.
- Login attempts, permission denials, and public endpoints (QR verification,
  portal login) are rate-limited per IP/user to blunt credential stuffing and
  token enumeration (`apps/api/src/throttling.ts`: one global limit, a much
  tighter per-(IP, email) limit on `/auth/login` and `/auth/signup`, and a
  separate limit on `/verify/:qrToken`); thresholds are deployment-time
  configuration, not a schema concern.

## 7. Input validation

- All write endpoints validate against a schema (types, required fields,
  enum membership, cross-field rules such as
  `accepted_qty + rejected_qty <= received_qty` on GRN lines) before touching
  the database. Database `check` constraints are the last line of defense,
  not the primary one, so validation errors surface as clear messages
  (§61) rather than raw constraint-violation text.
