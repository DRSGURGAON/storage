# Web — Warehouse Documentation & Operations SaaS

The operator-facing frontend for [`apps/api`](../api/README.md), and the
last P0 item in
[`docs/architecture/v1-scope-specification.md`](../../docs/architecture/v1-scope-specification.md)
§10: every screen in that document's §8 screen map existed only as an API
until this app.

## Stack

React 18 + TypeScript on Vite, Ant Design for the component set, TanStack
Query for server state, React Router for navigation — `DECISIONS.md` §0's
choices, unchanged. No global state library: everything on screen is server
state, and inventing a second place to keep it is how a stock figure ends
up disagreeing with itself.

## Running it

```bash
cd apps/api && npm run start:dev      # the API, on :3000
cd apps/web && npm run dev            # this app, on :5173
```

The dev server proxies `/api` to `http://localhost:3000` (override with
`API_PROXY_TARGET`), so the browser's requests are same-origin: no CORS
configuration on the API, and no base URL compiled into the bundle.
`VITE_API_URL` exists only for a deployment that really does serve the two
from different hosts.

## How it is put together

- **`src/lib/api.ts`** — the one place this app talks to the API. It
  attaches the bearer token, unwraps JSON, and turns a non-2xx into an
  `ApiError` carrying *the server's own message*. That last part matters:
  the API says specific, useful things ("Only 30 of that product is
  available to return on this dispatch"), and a client that replaces them
  with "Something went wrong" throws away the most valuable thing it was
  handed.
- **`src/lib/session.tsx`** — the session, read from `GET /auth/me` rather
  than decoded from the JWT. The token's claims are the same data and one
  fetch cheaper, but they are a snapshot from login: a role change or a
  disabled membership bites the server immediately, and a UI drawn from
  stale claims would offer actions that no longer exist.
- **`session.can(permission)`** — whether to *offer* an action, never
  whether to allow one. `/auth/me` returns the caller's live grants and the
  navigation and buttons are filtered from them; the API re-resolves the
  same grants on every request and is what actually decides (saas-layer
  §14, "never trust the frontend"). Hiding a button the server would refuse
  is courtesy, not a control.
- **`src/lib/format.ts`** — the formatting rules every screen shares,
  including the status → colour map. The status vocabulary is common across
  modules (draft, submitted, approved, cancelled), so colouring it per
  screen would mean the same word rendering differently depending on where
  you saw it.

Quantities arrive as **strings**, deliberately: they are `numeric` columns
and postgres.js hands them over as text, so a three-decimal warehouse
quantity cannot be quietly rounded through a float. `format.quantity()` is
the only place they become numbers.
