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

## What is built

Sign-in and workspace signup; the role-filtered shell and dashboard; the
setup checklist; every master (customers with addresses and contacts,
warehouses with their location tree, products, transport, rate cards with
priced lines); the inbound chain (gate entry → inward → GRN → put-away →
warehouse receipt); stock on hand, the ledger and ageing; the outbound
chain (release order → reserve → pick → dispatch → gate pass → gate-out →
POD); billing runs, invoices, payments and statements; quotations and
agreements; stock transfers and verifications; returns; the Document
Centre with its relationship graph; notifications; settings (company,
users, notification rules, plan and usage, audit log); and the **customer
portal**, which a `customer` login lands in instead of the staff app.

A route the navigation offers but that has no screen yet renders an
explicit "not built yet" page. The navigation is generated from what the
API supports, which is still ahead of the UI in a few places, and a blank
page would look like missing data.

Blueprint §64's phone pass **has** been run — 390×844 in a real browser,
across the operator screens, the settings screens and a create drawer, with
every screen reporting `scrollWidth == clientWidth == 390`. It found three
things worth fixing: there was no way to open the navigation at all below
`lg`, the list tables pushed the page sideways, and the login card and the
form drawers were both wider than the screen. All three are fixed.

Photographs and signatures are captured here too (Phase 12a): the
`Attachments` card on a GRN, gate entry, customer or POD uses an upload
control with `capture="environment"`, so a phone opens the camera rather
than a file browser, and the POD screen takes a real signature on a canvas
and saves it as the image the delivery document prints.

Still absent, and named rather than implied: a full reports library beyond
the stock statement and ageing, and the Agreement wizard's eleven separate
steps.

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

## How it is tested

There are no component tests. The app is exercised by driving a real
browser (Puppeteer) against a live API on a from-nothing database: the
whole inbound chain, the whole outbound chain, and every screen loaded and
looked at.

That is a deliberate trade rather than an omission to fix later. Driving
the real thing catches what a component test cannot — a wrong endpoint
shape, a field the API can derive that the form insists on, a response
that is a bare array where a page was expected — and every one of those
was found this way. It misses what a component test would catch: a
rendering regression in one component, with no API involved. If this app
grows a piece of genuinely tricky client-side logic, that piece should get
a unit test; today the tricky logic is all on the server, and it has 283
of them.
